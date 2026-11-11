/**
 * Ghost hardening (review of #78): reserved fields, size and structure
 * limits, tier plausibility, host-only selection, the compact action-log form
 * of `select_ghost`, and the run controller never saving an invalid state.
 */
import { describe, expect, test } from 'vitest';
import {
  Rng,
  canonicalJson,
  ghostMaxSerializedSize,
  ghostTierBound,
  ghostValueBound,
  hashJson,
  tierPrice,
  validateGhostSnapshot,
  workshopPrice,
  type GhostSnapshot,
  type Json,
} from '@game/core';
import { fixedBattle } from './defaults.js';
import {
  INSTALLED,
  begin,
  botRun,
  botStep,
  ghostDeps,
  listBucket,
  newRig,
  playUntil,
} from './ghost-test-support.js';
import {
  MAX_GHOST_CANDIDATES,
  SELECT_GHOST,
  ghostContext,
  presentCandidates,
} from './ghosts.js';
import { applyIntent, createRun, replayRun } from './machine.js';
import { startRun, openRun } from './run-controller.js';
import { buildSaveRecord } from './save.js';
import { createMemorySaveStore } from './save-store-memory.js';
import { allowedIntents } from './selectors.js';
import { content, gameConfigs, makeGameDeps } from './test-support.js';
import type {
  CreateRunArgs,
  Intent,
  IntentHandler,
  RunDeps,
  RunState,
} from './types.js';
import { validateRunState } from './validate.js';

const perf = (globalThis as unknown as { performance: { now(): number } })
  .performance;

const RULES = { startingLives: 99, pvpLossLifeCost: 1 };

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

type Loose = Record<string, unknown> & {
  team: {
    stash: Record<string, unknown>[];
    buildings: Record<string, unknown>[];
    map: { nodes: Record<string, unknown>[] } & Record<string, unknown>;
  } & Record<string, unknown>;
  owner: Record<string, unknown>;
  pvpRecord: Record<string, unknown>;
};
function loose(v: unknown): Loose {
  return clone(v) as Loose;
}

function botDeps(ownerId: string, won = true): RunDeps {
  return makeGameDeps({
    ghosts: { ownerId },
    battle: fixedBattle(won),
    rules: RULES,
  });
}

function argsFor(
  runId: string,
  seed: number,
  players: string[] = ['A'],
): CreateRunArgs {
  return { runId, runVersion: '0.1', seed, players, host: 0 };
}

const atRound = (r: number) => (s: RunState) =>
  s.round >= r && s.step === 'pvp_summary';

/** A valid solo snapshot of `round`, from a bot run. */
function goodSnapshot(round: number, owner = 'dev-a'): GhostSnapshot {
  const run = botRun(
    botDeps(owner),
    argsFor(`good-${owner}`, 7),
    1,
    atRound(round),
  );
  const found = run.snapshots.find((s) => s.round === round);
  if (found === undefined) throw new Error('no snapshot');
  return found;
}

function ctxOf(deps: RunDeps = botDeps('x')) {
  const c = ghostContext(deps);
  if (c === null) throw new Error('ghosts are on');
  return c;
}

describe('item 1: reserved fields and structural hardening', () => {
  const ctx = ctxOf();
  const good = goodSnapshot(3);

  test('the control snapshot is valid, and snapshotOf never writes the reserved fields', () => {
    expect(validateGhostSnapshot(clone(good), ctx).ok).toBe(true);
    expect(Object.keys(good).sort()).toEqual(
      [
        'formatVersion',
        'gameVersion',
        'lives',
        'mapSeed',
        'owner',
        'partySize',
        'pvpRecord',
        'round',
        'runId',
        'team',
      ].sort(),
    );
  });

  test('actionLog and runSeed are rejected at all, whatever they hold', () => {
    const deep: unknown[] = [];
    let cur = deep;
    for (let i = 0; i < 50_000; i++) {
      const next: unknown[] = [];
      cur.push(next);
      cur = next;
    }
    const variants: [string, unknown][] = [
      ['actionLog', []],
      ['actionLog', [1, 2, 3]],
      ['actionLog', deep],
      ['actionLog', new Array<number>(500_000).fill(1)],
      ['runSeed', 5],
      ['runSeed', 'x'],
    ];
    for (const [key, value] of variants) {
      const bad = { ...clone(good), [key]: value };
      const r = validateGhostSnapshot(bad, ctx);
      expect(r.ok, key).toBe(false);
      if (!r.ok) expect(r.errors.join(' ')).toContain('reserved');
    }
  });

  test('a snapshot over the size limit is rejected, with the limit scaled by party size', () => {
    const bad = loose(good);
    for (let i = 0; i < 2000; i++) {
      bad.team.stash.push({ id: 100 + i, def: 'bld_wall', tier: 1, owner: 0 });
    }
    expect(canonicalJson(bad).length).toBeGreaterThan(
      ghostMaxSerializedSize(1),
    );
    const r = validateGhostSnapshot(bad, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toContain('larger than');
    expect(ghostMaxSerializedSize(4)).toBeGreaterThan(
      ghostMaxSerializedSize(1),
    );
    // The limit has margin over real snapshots of every party size.
    for (const size of [1, 2, 3, 4]) {
      const run = botRun(
        botDeps('m'),
        argsFor('m', 5, ['A', 'B', 'C', 'D'].slice(0, size)),
        3,
        atRound(13),
      );
      const last = run.snapshots[run.snapshots.length - 1] as GhostSnapshot;
      const bytes = canonicalJson(last).length;
      expect(bytes * 4, `party ${String(size)}`).toBeLessThan(
        ghostMaxSerializedSize(size),
      );
    }
  });

  test('deep nesting, long strings and non-integer numbers are rejected, never thrown on', () => {
    let nest: Record<string, unknown> = {};
    const top = nest;
    for (let i = 0; i < 100_000; i++) {
      const next: Record<string, unknown> = {};
      nest['n'] = next;
      nest = next;
    }
    const cases: Record<string, (o: Loose) => void> = {
      'nested value in a building': (o) => {
        o.team.stash[0] = { ...(o.team.stash[0] ?? {}), extra: top };
      },
      'long string': (o) => {
        o.team.stash[0] = { ...(o.team.stash[0] ?? {}), def: 'x'.repeat(5000) };
      },
      'float mapSeed': (o) => {
        o['mapSeed'] = 1.5;
      },
      'NaN lives': (o) => {
        o['lives'] = Number.NaN;
      },
      'Infinity wins': (o) => {
        o.pvpRecord['wins'] = Number.POSITIVE_INFINITY;
      },
      'unsafe integer': (o) => {
        o.team.stash[0] = { ...(o.team.stash[0] ?? {}), id: 2 ** 60 };
      },
      'float in the map': (o) => {
        o.team.map.nodes[0] = { ...(o.team.map.nodes[0] ?? {}), x: 1.5 };
      },
      'undefined value': (o) => {
        o['gameVersion'] = undefined;
      },
    };
    for (const [name, change] of Object.entries(cases)) {
      const bad = loose(good);
      change(bad);
      const r = validateGhostSnapshot(bad, ctx);
      expect(r.ok, name).toBe(false);
    }
    // A class instance or a function is not plain JSON either.
    expect(
      validateGhostSnapshot({ ...clone(good), team: new Map() }, ctx).ok,
    ).toBe(false);
    expect(
      validateGhostSnapshot({ ...clone(good), owner: () => 1 }, ctx).ok,
    ).toBe(false);
  });

  test('unknown keys are rejected at every level', () => {
    const withBuilding = (() => {
      // A snapshot that has a placed building: the bot only stashes, so place
      // the first extractor of the kit on any legal cell.
      const run = botRun(botDeps('p'), argsFor('p', 11), 2, atRound(1));
      return run.snapshots[0] as GhostSnapshot;
    })();
    const base = loose(withBuilding);
    const levels: Record<string, (o: Loose) => void> = {
      top: (o) => {
        o['extra'] = 1;
      },
      owner: (o) => {
        o.owner['extra'] = 1;
      },
      pvpRecord: (o) => {
        o.pvpRecord['extra'] = 1;
      },
      team: (o) => {
        o.team['extra'] = 1;
      },
      map: (o) => {
        o.team.map['extra'] = 1;
      },
      'map node': (o) => {
        o.team.map.nodes[0] = { ...(o.team.map.nodes[0] ?? {}), extra: 1 };
      },
      stash: (o) => {
        o.team.stash[0] = { ...(o.team.stash[0] ?? {}), extra: 1 };
      },
    };
    expect(validateGhostSnapshot(clone(base), ctx).ok).toBe(true);
    for (const [name, change] of Object.entries(levels)) {
      const bad = loose(base);
      change(bad);
      expect(validateGhostSnapshot(bad, ctx).ok, name).toBe(false);
    }
  });

  test('a poisoned pool never reaches the run state or its save, which still reopens', async () => {
    const rig = newRig();
    const a = await begin(rig, ghostDeps('dev-a'), { runId: 'run-a', seed: 7 });
    await playUntil(a, (s) => s.step === 'pvp_summary' && s.round === 1);
    const [src] = await listBucket(rig, '0.1', 1, 1);
    const g = src as GhostSnapshot;
    const bucket = { gameVersion: '0.1', partySize: 1, round: 1 };
    const big = new Array<number>(50_000).fill(7);
    rig.ghosts.injectRaw(bucket, 'aaa-log', {
      ...g,
      owner: { id: 'aaa-log', label: 'Log' },
      runId: 'r-log',
      actionLog: big,
    });
    rig.ghosts.injectRaw(bucket, 'aab-seed', {
      ...g,
      owner: { id: 'aab-seed', label: 'Seed' },
      runId: 'r-seed',
      runSeed: 5,
    });
    // Only poisoned snapshots (dev-a's removed): the boss, not an error.
    rig.ghosts.injectRaw(bucket, 'dev-a', 'gone');
    const deps = ghostDeps('dev-b');
    const only = await begin(rig, deps, { runId: 'run-only', seed: 9 });
    const s1 = await playUntil(
      only,
      (s) => s.step === 'shop' && s.leg === 'pve',
    );
    expect(s1.pvpOpponent?.kind).toBe('boss');
    // With a good one beside them the good one is drawn and the run's own save
    // reopens and validates.
    rig.ghosts.injectRaw(bucket, 'dev-a', g);
    const b = await begin(rig, ghostDeps('dev-b'), { runId: 'run-b', seed: 9 });
    const s2 = await playUntil(b, (s) => s.step === 'shop' && s.leg === 'pve');
    expect(s2.pvpOpponent?.ghost?.owner.id).toBe('dev-a');
    expect(JSON.stringify(s2).length).toBeLessThan(100_000);
    for (const id of ['run-only', 'run-b']) {
      const reopened = await openRun(id, deps, rig.saves, INSTALLED, {
        ghostStore: rig.ghosts,
      });
      expect(reopened.ok, id).toBe(true);
      if (reopened.ok) {
        expect(
          validateRunState(clone(reopened.controller.state), deps).ok,
        ).toBe(true);
      }
    }
    // Handing the poisoned ones straight to the intent changes nothing either.
    const direct = applyIntent(
      { ...clone(s1), pvpOpponent: null },
      0,
      {
        type: SELECT_GHOST,
        candidates: [
          { ...g, actionLog: big, runId: 'x1' },
          { ...g, runSeed: 1, runId: 'x2' },
        ] as unknown as Json,
      },
      deps,
    );
    expect(direct.ok).toBe(true);
    if (direct.ok) expect(direct.state.pvpOpponent?.kind).toBe('boss');
  });
});

describe('item 2: the controller validates the next state before every save', () => {
  /** A handler that, on request, produces a state that fails validation. */
  const evil: IntentHandler = {
    steps: ['build', 'shop'],
    handle({ state, intent }) {
      const mode = intent['mode'];
      if (mode === 'lives') return { ok: true, state: { ...state, lives: -3 } };
      return { ok: true, state: state };
    },
  };

  test('a state that fails validateRunState is not saved, not revealed, not committed', async () => {
    const deps = makeGameDeps({
      battle: fixedBattle(true),
      handlers: { evil },
    });
    const saves = createMemorySaveStore();
    const args = argsFor('run-v', 3);
    const started = await startRun(args, deps, saves, 1, INSTALLED);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const c = started.controller;
    const pos = (await import('./test-support.js')).corePosition(c.state);
    expect((await c.dispatch(0, { type: 'propose_core', ...pos }, 2)).ok).toBe(
      true,
    );
    expect(c.state.step).toBe('build');
    const before = c.state;
    const stored = JSON.stringify(await saves.get('run-v'));
    const bad = await c.dispatch(0, { type: 'evil', mode: 'lives' }, 3);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.reason).toBe('invalid_state');
      expect(bad.detail).toContain('lives');
    }
    // Nothing advanced, nothing was written.
    expect(c.state).toBe(before);
    expect(JSON.stringify(await saves.get('run-v'))).toBe(stored);
    // The controller still works.
    const fine = await c.dispatch(0, { type: 'evil', mode: 'fine' }, 4);
    expect(fine.ok).toBe(true);
    expect(c.state.actionCounter).toBe(before.actionCounter + 1);
    const reopened = await openRun('run-v', deps, saves, INSTALLED);
    expect(reopened.ok).toBe(true);
  });

  test('cost: validateRunState on late-run states of every party size', () => {
    const rows: string[] = [];
    for (const size of [1, 2, 3, 4]) {
      const deps = botDeps('t');
      const run = botRun(
        deps,
        argsFor('t', 5, ['A', 'B', 'C', 'D'].slice(0, size)),
        3,
        atRound(12),
      );
      validateRunState(run.state, deps); // warm up
      const t0 = perf.now();
      for (let i = 0; i < 50; i++) {
        expect(validateRunState(run.state, deps).ok).toBe(true);
      }
      const ms = (perf.now() - t0) / 50;
      rows.push(
        `party ${String(size)} round ${String(run.state.round)} log ${String(run.state.actionLog.length)}: ${ms.toFixed(2)} ms`,
      );
      // Well under a frame; the fix would be to sample if this ever fails.
      expect(ms).toBeLessThan(10);
    }
    expect(rows).toHaveLength(4);
  });
});

describe('item 2b: found by the validation before save', () => {
  test('abandoning in the shop after the opponent was selected leaves a valid state', () => {
    const deps = botDeps('x');
    const run = botRun(
      deps,
      argsFor('ab', 5),
      3,
      (s) => s.step === 'shop' && s.leg === 'pve',
    );
    const sel = applyIntent(
      run.state,
      0,
      { type: SELECT_GHOST, candidates: [] },
      deps,
    );
    if (!sel.ok) throw new Error('select');
    const ab = applyIntent(sel.state, 0, { type: 'abandon' }, deps);
    expect(ab.ok).toBe(true);
    if (!ab.ok) return;
    expect(ab.state.pvpOpponent).toBeNull();
    const v = validateRunState(clone(ab.state), deps);
    expect(v.ok ? [] : v.errors).toEqual([]);
  });
});

describe('item 3: tier plausibility', () => {
  const econ = gameConfigs.economy;
  const events = gameConfigs.events;

  test('the rule, from the configuration', () => {
    // tierOdds: tier 2 from round 3, tier 3 from round 5; the kit is tier 1.
    expect(ghostTierBound(1, econ, events)).toEqual({
      shopTier: 1,
      upgradesPerOwner: 1,
    });
    expect(ghostTierBound(2, econ, events)).toEqual({
      shopTier: 1,
      upgradesPerOwner: 3,
    });
    expect(ghostTierBound(3, econ, events)).toEqual({
      shopTier: 2,
      upgradesPerOwner: 5,
    });
    expect(ghostTierBound(4, econ, events).shopTier).toBe(2);
    expect(ghostTierBound(5, econ, events).shopTier).toBe(3);
    // No Workshop event configured: no raises. Odds changed: the tier moves.
    const noWorkshop = {
      ...events,
      events: events.events.filter((e) => e.type !== 'workshop'),
    };
    expect(ghostTierBound(5, econ, noWorkshop).upgradesPerOwner).toBe(0);
    const early = {
      ...econ,
      tierOdds: [
        { fromRound: 1, weights: [50, 50, 0] as [number, number, number] },
        ...econ.tierOdds.slice(1),
      ],
    };
    expect(ghostTierBound(1, early, events).shopTier).toBe(2);
  });

  test('a Workshop raise never adds as much value as it costs, for every building and tier', () => {
    const percent = Number(
      events.events.find((e) => e.type === 'workshop')?.params[
        'workshopPricePercent'
      ],
    );
    expect(percent).toBeGreaterThan(0);
    for (const def of content.buildings.list()) {
      const id = def.id;
      for (let t = 1; t < def.tiers.length; t++) {
        const cost = workshopPrice(content, id, t + 1, percent);
        const gain = tierPrice(content, id, t + 1) - tierPrice(content, id, t);
        expect(gain, `${id} ${String(t)}->${String(t + 1)}`).toBeLessThan(cost);
      }
    }
  });

  /** A round-`round` snapshot whose team is replaced by the given stash. */
  function forged(
    round: number,
    items: { def: string; tier: number; owner: number }[],
    partySize = 1,
  ): GhostSnapshot {
    const base = goodSnapshot(round);
    const t = loose(base);
    t.team.stash = items.map((it, i) => ({ id: 1 + i, ...it }));
    t.team['nextId'] = 1 + items.length;
    if (partySize !== 1) throw new Error('solo only');
    return t as unknown as GhostSnapshot;
  }

  test('a round-1 tier-3 turret within the value bound is rejected; plausible ones pass', () => {
    const ctx = ctxOf();
    const turret3 = forged(1, [{ def: 'bld_turret', tier: 3, owner: 0 }]);
    const bound = ghostValueBound(1, 1, content, econ, events);
    // Value-wise it would pass: 65 <= 92.
    expect(tierPrice(content, 'bld_turret', 3)).toBeLessThanOrEqual(
      bound.limit,
    );
    const r = validateGhostSnapshot(turret3, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toContain('tiers above');
    // One raise is possible before the first PvP battle (tier 2); not two.
    expect(
      validateGhostSnapshot(
        forged(1, [{ def: 'bld_turret', tier: 2, owner: 0 }]),
        ctx,
      ).ok,
    ).toBe(true);
    expect(
      validateGhostSnapshot(
        forged(1, [
          { def: 'bld_wall', tier: 2, owner: 0 },
          { def: 'bld_wall', tier: 2, owner: 0 },
        ]),
        ctx,
      ).ok,
    ).toBe(false);
    // Round 2 has 3 events: tier 3 is reachable. Round 5 sells tier 3.
    expect(
      validateGhostSnapshot(
        forged(2, [{ def: 'bld_turret', tier: 3, owner: 0 }]),
        ctx,
      ).ok,
    ).toBe(true);
    expect(
      validateGhostSnapshot(
        forged(5, [{ def: 'bld_turret', tier: 3, owner: 0 }]),
        ctx,
      ).ok,
    ).toBe(true);
  });

  test('the bound is per owner: raises of one player do not pay for another', () => {
    const ctx = ctxOf(
      makeGameDeps({
        ghosts: { ownerId: 'x' },
        battle: fixedBattle(true),
        rules: RULES,
      }),
    );
    // A real two-player round-1 snapshot, its stash replaced.
    const run = botRun(
      botDeps('two'),
      argsFor('two', 4, ['A', 'B']),
      1,
      atRound(1),
    );
    const base = run.snapshots[0] as GhostSnapshot;
    const make = (items: { def: string; tier: number; owner: number }[]) => {
      const t = loose(base);
      t.team.stash = items.map((it, i) => ({ id: 1 + i, ...it }));
      t.team['nextId'] = 1 + items.length;
      return t;
    };
    // One tier-2 wall each: one raise per owner, fine.
    expect(
      validateGhostSnapshot(
        make([
          { def: 'bld_wall', tier: 2, owner: 0 },
          { def: 'bld_wall', tier: 2, owner: 1 },
        ]),
        ctx,
      ).ok,
    ).toBe(true);
    // Two tier-2 walls of one owner need two raises by round 1: rejected.
    const r = validateGhostSnapshot(
      make([
        { def: 'bld_wall', tier: 2, owner: 0 },
        { def: 'bld_wall', tier: 2, owner: 0 },
      ]),
      ctx,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toContain('player 0');
  });

  test('fuzz: snapshots of buying, upgrading runs are never falsely rejected', () => {
    let checked = 0;
    let withRaises = 0;
    let tier3 = 0;
    let maxValueShare = 0;
    for (let seed = 1; seed <= 48; seed++) {
      const rng = Rng.fromSeed(seed);
      const size = 1 + rng.nextInt(3);
      const players = ['A', 'B', 'C'].slice(0, size);
      for (const won of [true, false]) {
        const deps = botDeps(`f${String(seed)}`, won);
        const ctx = ctxOf(deps);
        const run = botRun(
          deps,
          argsFor(`f${String(seed)}${won ? 'w' : 'l'}`, seed, players),
          seed,
          (s) => s.round >= 14,
        );
        for (const snap of run.snapshots) {
          const v = validateGhostSnapshot(clone(snap), ctx);
          expect(
            v.ok ? [] : v.errors,
            `seed ${String(seed)} r${String(snap.round)}`,
          ).toEqual([]);
          checked++;
          const tb = ghostTierBound(snap.round, ctx.economy, ctx.events);
          const items = [...snap.team.buildings, ...snap.team.stash];
          if (items.some((b) => b.tier > tb.shopTier)) withRaises++;
          if (items.some((b) => b.tier === 3)) tier3++;
          const value = items.reduce(
            (n, b) => n + tierPrice(content, b.def, b.tier),
            0,
          );
          const limit = ghostValueBound(
            snap.round,
            snap.partySize,
            content,
            ctx.economy,
            ctx.events,
          ).limit;
          maxValueShare = Math.max(maxValueShare, value / limit);
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
    // The fuzz really exercised Workshop raises and tier 3, and came close to
    // the value bound without crossing it.
    expect(withRaises).toBeGreaterThan(20);
    expect(tier3).toBeGreaterThan(20);
    expect(maxValueShare).toBeLessThanOrEqual(1);
  });
});

describe('item 4: only the host may select the ghost', () => {
  test('a non-host sender is refused with not_host and cannot force the boss', () => {
    const deps = botDeps('x');
    const run = botRun(
      deps,
      argsFor('two', 4, ['A', 'B']),
      1,
      (s) => s.step === 'shop' && s.leg === 'pve',
    );
    const s = run.state;
    expect(s.pvpOpponent).toBeNull();
    const r = applyIntent(s, 1, { type: SELECT_GHOST, candidates: [] }, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not_host');
    expect(allowedIntents(s, 1, deps)).not.toContain(SELECT_GHOST);
    expect(allowedIntents(s, 0, deps)).toContain(SELECT_GHOST);
    // The host's still works.
    const ok = applyIntent(s, 0, { type: SELECT_GHOST, candidates: [] }, deps);
    expect(ok.ok).toBe(true);
  });
});

describe('item 5: the compact log form of select_ghost', () => {
  const rules = RULES;
  /** A pool of one snapshot for each of 16 owners, in rounds 1 to `rounds`. */
  function pool(rounds: number): GhostSnapshot[] {
    const out: GhostSnapshot[] = [];
    for (let o = 0; o < 16; o++) {
      const run = botRun(
        botDeps(`o${String(o)}`),
        argsFor(`p${String(o)}`, 100 + o),
        o,
        atRound(rounds),
      );
      out.push(...run.snapshots);
    }
    return out;
  }
  const candidatesFrom =
    (all: GhostSnapshot[], deps: RunDeps) =>
    (s: RunState): readonly unknown[] =>
      presentCandidates(
        all.filter((g) => g.round === s.round),
        s,
        ctxOf(deps),
      );

  function play(all: GhostSnapshot[], withGhosts: boolean, rounds: number) {
    const deps = makeGameDeps({
      ...(withGhosts ? { ghosts: { ownerId: 'me' } } : {}),
      battle: fixedBattle(true),
      rules,
    });
    const args = argsFor('me', 9);
    const run = botRun(
      deps,
      args,
      4,
      atRound(rounds),
      candidatesFrom(all, deps),
    );
    return { deps, args, run };
  }

  test('save size after 10 rounds beside 16 owners is a small multiple of the size without ghosts', () => {
    const all = pool(10);
    const without = play(all, false, 10);
    const withGhosts = play(all, true, 10);
    const size = (p: typeof without) =>
      JSON.stringify(buildSaveRecord(p.args, p.run.state, INSTALLED, 1)).length;
    const a = size(without);
    const b = size(withGhosts);
    // Before this change the same run was 264,717 bytes (candidates in the log).
    expect(b).toBeLessThan(4 * a);
    expect(b).toBeLessThan(60_000);
    // The log keeps no candidate lists.
    const picks = withGhosts.run.state.actionLog.filter(
      (l) => (l.intent as { type: string }).type === SELECT_GHOST,
    );
    expect(picks).toHaveLength(10);
    for (const l of picks) {
      const i = l.intent as Record<string, unknown>;
      expect(Object.keys(i).sort()).toEqual(
        ['chosen', 'chosenHash', 'hash', 'index', 'n', 'type'].sort(),
      );
      // A ghost fought in an earlier round is not met again.
      expect(i['n']).toBeGreaterThanOrEqual(1);
      expect(i['n']).toBeLessThanOrEqual(MAX_GHOST_CANDIDATES);
    }
  });

  test('replayRun reproduces the run from the compact log, with no store, whatever the owner id', () => {
    const all = pool(4);
    const { deps, args, run } = play(all, true, 4);
    for (const d of [deps, botDeps('someone-else')]) {
      const r = replayRun(args, clone(run.state.actionLog), d);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.state).toEqual(run.state);
    }
    expect(run.state.ghostsFought).toHaveLength(4);
  });

  test('replay with changed validation numbers still meets the same opponents', () => {
    const all = pool(4);
    const { deps, args, run } = play(all, true, 4);
    // Validation (not the run's own economy) now allows almost nothing.
    const strict: RunDeps = {
      ...deps,
      ghosts: {
        ownerId: 'me',
        economy: {
          ...gameConfigs.economy,
          startingGold: 0,
          baseIncomePerShop: 0,
          startingKit: [],
          rewards: {
            pveWin: { easy: 0, medium: 0, hard: 0 },
            pvpWin: 0,
            pvpLoss: 0,
          },
        },
        events: { ...gameConfigs.events, events: [] },
      },
    };
    const chosen = run.state.actionLog
      .filter((l) => (l.intent as { type: string }).type === SELECT_GHOST)
      .map((l) => (l.intent as unknown as { chosen: GhostSnapshot }).chosen);
    // The strict rules would reject every one of them today ...
    for (const g of chosen) {
      expect(validateGhostSnapshot(clone(g), ctxOf(strict)).ok).toBe(false);
    }
    // ... yet the replay reproduces the very same run.
    const r = replayRun(args, clone(run.state.actionLog), strict);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state).toEqual(run.state);
  });

  test('a tampered log fails the replay loudly', () => {
    const all = pool(3);
    const { deps, args, run } = play(all, true, 3);
    const log = clone(run.state.actionLog);
    const at = log.findIndex(
      (l) => (l.intent as { type: string }).type === SELECT_GHOST,
    );
    const entry = log[at] as { n: number; intent: Record<string, unknown> };
    const intent = entry.intent as {
      index: number;
      chosen: GhostSnapshot;
      chosenHash: string;
      hash: string;
      n: number;
    };
    const tamper = (change: (i: Record<string, unknown>) => void) => {
      const copy = clone(log);
      change((copy[at] as { intent: Record<string, unknown> }).intent);
      return replayRun(args, copy, deps);
    };
    const expectFail = (r: ReturnType<typeof replayRun>, why: string) => {
      expect(r.ok, why).toBe(false);
      if (!r.ok) {
        expect(r.reason, why).toBe('replay_mismatch');
        expect(r.at, why).toBe(entry.n);
      }
    };
    // Untouched: fine.
    expect(replayRun(args, clone(log), deps).ok).toBe(true);
    // A different index than the draw gives.
    expectFail(
      tamper((i) => {
        i['index'] = (intent.index + 1) % intent.n;
      }),
      'index',
    );
    // A different number of candidates changes the draw.
    expectFail(
      tamper((i) => {
        i['n'] = intent.n - 1;
      }),
      'n',
    );
    // Another valid snapshot in place of the chosen one, hash left alone.
    const other = all.find(
      (g) => g.round === 1 && g.owner.id !== intent.chosen.owner.id,
    ) as GhostSnapshot;
    expectFail(
      tamper((i) => {
        i['chosen'] = other;
      }),
      'swapped chosen',
    );
    // An edited field of the chosen snapshot.
    expectFail(
      tamper((i) => {
        (i['chosen'] as { owner: { label: string } }).owner.label = 'Evil';
      }),
      'edited chosen',
    );
    // A chosen snapshot from the wrong round (hash fixed up), malformed ones.
    const wrongRound = all.find((g) => g.round === 2) as GhostSnapshot;
    expectFail(
      tamper((i) => {
        i['chosen'] = wrongRound;
        i['chosenHash'] = hashJson(wrongRound);
      }),
      'wrong bucket',
    );
    expectFail(
      tamper((i) => {
        i['chosen'] = { junk: 1 };
        i['chosenHash'] = hashJson({ junk: 1 });
      }),
      'malformed chosen',
    );
    // The boss recorded with a snapshot, or a snapshot recorded as the boss.
    expectFail(
      tamper((i) => {
        i['n'] = 0;
      }),
      'boss with a snapshot',
    );
    expectFail(
      tamper((i) => {
        i['extra'] = 1;
      }),
      'extra field',
    );
    // The old full form is not reinterpreted.
    const old = clone(log);
    (old[at] as { intent: unknown }).intent = {
      type: SELECT_GHOST,
      candidates: [],
    };
    expectFail(replayRun(args, old, deps), 'candidates form');
  });

  test('the compact form is refused live: nobody names their opponent', () => {
    const all = pool(1);
    const { deps, run } = play(all, true, 1);
    const entry = run.state.actionLog.find(
      (l) => (l.intent as { type: string }).type === SELECT_GHOST,
    );
    const compact = entry?.intent as unknown as Intent;
    const created = createRun(argsFor('me', 9), deps);
    if (!created.ok) throw new Error('create');
    // Bring a fresh run to the same shop and send the compact form.
    let s = created.state;
    const rng = Rng.fromSeed(4);
    while (!(s.step === 'shop' && s.leg === 'pve')) {
      const next = botStep(s, deps, rng, []);
      if (next === null) throw new Error('stuck');
      s = next;
    }
    const r = applyIntent(s, 0, compact, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_intent');
  });

  test('with no candidates the boss is logged compactly and replays', () => {
    const { deps, args, run } = play([], true, 2);
    const picks = run.state.actionLog.filter(
      (l) => (l.intent as { type: string }).type === SELECT_GHOST,
    );
    expect(picks).toHaveLength(2);
    for (const l of picks) {
      expect(l.intent).toMatchObject({
        n: 0,
        index: null,
        chosen: null,
        chosenHash: null,
      });
    }
    const r = replayRun(args, clone(run.state.actionLog), deps);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state).toEqual(run.state);
  });
});
