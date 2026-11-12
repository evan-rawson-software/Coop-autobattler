import { describe, expect, test } from 'vitest';
import {
  canonicalJson,
  ghostBucketKey,
  ghostKey,
  ghostValueBound,
  placeFromStash,
  addToStash,
  validateGhostSnapshot,
  type GhostSnapshot,
  type TeamState,
} from '@game/core';
import {
  begin,
  ghostDeps,
  INSTALLED,
  listBucket,
  newRig,
  playUntil,
  type Game,
  type Rig,
} from './ghost-test-support.js';
import { runGhostStoreConformance } from './ghost-conformance.js';
import { createMemoryGhostStore } from './ghost-store.js';
import {
  BOSS_LABEL,
  MAX_GHOST_CANDIDATES,
  SELECT_GHOST,
  eligibleGhosts,
  ghostContext,
  selectGhost,
  snapshotOf,
} from './ghosts.js';
import { applyIntent, replayRun } from './machine.js';
import { openRun } from './run-controller.js';
import { buildSaveRecord } from './save.js';
import { verifyLastBattle } from './replay.js';
import {
  content,
  gameConfigs,
  makeGameDeps,
  newRun,
  ok,
  placeCoreAll,
} from './test-support.js';
import type { Intent, RunState } from './types.js';
import { validateRunState } from './validate.js';

runGhostStoreConformance('memory', () => createMemoryGhostStore());

const atPvpShop = (round: number) => (s: RunState) =>
  s.step === 'shop' && s.leg === 'pve' && s.round === round;
const atPvpSummary = (round: number) => (s: RunState) =>
  s.step === 'pvp_summary' && s.round === round;

/** Play a run to the end of its PvP battle of `round`. */
async function playRounds(g: Game, round: number): Promise<RunState> {
  return playUntil(g, atPvpSummary(round));
}

/** A mutable, loosely typed view of JSON data, for crafting bad input. */
interface Loose {
  team: {
    stash: Record<string, unknown>[];
    buildings: Record<string, unknown>[];
    nextId: number;
    map: { nodes: unknown[] };
  };
  owner: { id: string; label: string };
  runId: string;
  ghost: Loose;
  battle: { detail: { source: { type: string; team: TeamState } } };
  options: { id: string }[];
  followUp: { perPlayer?: boolean; options: { id: string }[] };
}
function loose(v: unknown): Loose {
  return JSON.parse(JSON.stringify(v)) as Loose;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Run A as `dev-a` ("Ann"): leaves snapshots for rounds 1 and 2. */
async function seedPool(rig: Rig, second = false): Promise<void> {
  const a = await begin(rig, ghostDeps('dev-a'), { runId: 'run-a', seed: 7 });
  await playRounds(a, 2);
  if (second) {
    // A second owner ("Cy"), who can be met in the other round.
    const c = await begin(rig, ghostDeps('dev-c'), {
      runId: 'run-c',
      seed: 21,
      players: ['Cy'],
    });
    await playRounds(c, 2);
  }
}

describe('taking snapshots', () => {
  test('one is taken at the start of every PvP battle, win or lose, and earlier runs of the owner stay beside the new one', async () => {
    const rig = newRig();
    const a = await begin(rig, ghostDeps('dev-a'), { runId: 'run-a' });
    await playRounds(a, 2);
    const r1 = await listBucket(rig, '0.1', 1, 1);
    const r2 = await listBucket(rig, '0.1', 1, 2);
    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
    expect(r1[0]?.owner).toEqual({ id: 'dev-a', label: 'Ann' });
    expect(r1[0]?.runId).toBe('run-a');
    expect(r1[0]?.pvpRecord).toEqual({ wins: 0, losses: 0 });
    // Round 2: one PvP battle was lost before (the party has no defences).
    expect((r2[0]?.pvpRecord.wins ?? 0) + (r2[0]?.pvpRecord.losses ?? 0)).toBe(
      1,
    );
    expect(r2[0]?.lives).toBe(5 - (r2[0]?.pvpRecord.losses ?? 0));
    // A second run of the same owner adds a snapshot to the bucket.
    const again = await begin(rig, ghostDeps('dev-a'), {
      runId: 'run-a2',
      seed: 11,
    });
    await playRounds(again, 1);
    const after = await listBucket(rig, '0.1', 1, 1);
    expect(after.map((g) => g.runId)).toEqual(['run-a', 'run-a2']);
  });

  test('the snapshot is derived from the state alone and is what the effect carries', () => {
    const deps = ghostDeps('dev-a');
    let s = placeCoreAll(newRun(deps), deps);
    const seen: string[] = [];
    for (let i = 0; i < 60 && s.pvpOpponent === null; i++) {
      let intent: Intent;
      if (s.step === 'pve_choice') intent = { type: 'vote', choice: 'easy' };
      else if (s.step === 'event_choice')
        intent = {
          type: 'vote',
          choice: loose(s.pending).options[0]?.id ?? '',
        };
      else if (s.step === 'event_resolve') {
        const fu = loose(s.pending).followUp;
        intent = {
          type: 'event_choose',
          choice: fu.perPlayer === true ? 'skip' : fu.options[0]?.id,
        };
      } else if (s.step === 'shop' && s.leg === 'pve')
        intent = { type: SELECT_GHOST, candidates: [] };
      else intent = { type: 'ready' };
      const r = ok(s, 0, intent, deps);
      seen.push(...r.effects.map((e) => e.type));
      s = r.state;
    }
    expect(seen).toContain('ghost_selection_needed');
    expect(seen).not.toContain('ghost_snapshot');
    expect(s.pvpOpponent?.kind).toBe('boss');
    const before = s;
    const r = ok(s, 0, { type: 'ready' }, deps);
    const fx = r.effects.find((e) => e.type === 'ghost_snapshot');
    expect(fx?.type === 'ghost_snapshot' ? fx.snapshot : null).toEqual(
      snapshotOf({ ...before, leg: 'pvp' }, { id: 'dev-a', label: 'Ann' }),
    );
    // The same state gives the same snapshot however often it is derived.
    expect(snapshotOf(before, { id: 'dev-a', label: 'Ann' })).toEqual(
      snapshotOf(clone(before), { id: 'dev-a', label: 'Ann' }),
    );
  });

  test('the snapshot validates, survives a JSON round trip and its schema-level fields are as specified', async () => {
    const rig = newRig();
    await seedPool(rig);
    const [g] = await listBucket(rig, '0.1', 1, 2);
    expect(g).toBeDefined();
    const snap = g as GhostSnapshot;
    const ctx = ghostContext(ghostDeps('x')) as NonNullable<
      ReturnType<typeof ghostContext>
    >;
    const v = validateGhostSnapshot(clone(snap), ctx);
    expect(v.ok).toBe(true);
    expect(canonicalJson(JSON.parse(JSON.stringify(snap)))).toBe(
      canonicalJson(snap),
    );
    expect(snap.formatVersion).toBe(1);
    expect(snap.gameVersion).toBe('0.1');
    expect(snap.partySize).toBe(1);
    expect(snap.mapSeed).toBe(7);
    // The reserved fields are never written.
    expect('runSeed' in snap).toBe(false);
    expect('actionLog' in snap).toBe(false);
  });
});

describe('matching and selection', () => {
  test("a second run meets the first run's snapshot at the matching round, never at another", async () => {
    const rig = newRig();
    await seedPool(rig, true);
    const b = await begin(rig, ghostDeps('dev-b'), {
      runId: 'run-b',
      seed: 9,
      players: ['Bea'],
    });
    const met: string[] = [];
    const seen: { round: number; kind: string; ghostRound: number | null }[] =
      [];
    for (const round of [1, 2]) {
      const s = await playUntil(b, atPvpShop(round), (x) => {
        // Any ghost held in state is always of the state's round.
        if (x.pvpOpponent?.ghost)
          expect(x.pvpOpponent.ghost.round).toBe(x.round);
      });
      expect(s.pvpOpponent?.kind).toBe('ghost');
      const ghost = s.pvpOpponent?.ghost as GhostSnapshot;
      expect(['Ann', 'Cy']).toContain(s.pvpOpponent?.label);
      expect(s.pvpOpponent?.round).toBe(round);
      expect(ghost.runId).toBe(ghost.owner.id === 'dev-a' ? 'run-a' : 'run-c');
      met.push(ghost.owner.id);
      seen.push({
        round,
        kind: s.pvpOpponent?.kind ?? '',
        ghostRound: s.pvpOpponent?.ghost?.round ?? null,
      });
      const done = await playUntil(b, atPvpSummary(round));
      expect(done.thisRound.pvp?.opponent).toEqual({
        kind: 'ghost',
        label: ghost.owner.label,
      });
      expect(done.pvpOpponent).toBeNull();
      expect(verifyLastBattle(done, b.deps)).toBe(true);
      const detail: { source: { type: string; team: TeamState } } = loose(
        done.pending,
      ).battle.detail;
      expect(detail.source.type).toBe('ghost');
      const stored = (await listBucket(rig, '0.1', 1, round)).find(
        (x) => x.owner.id === ghost.owner.id,
      );
      expect(detail.source.team).toEqual(stored?.team);
    }
    expect(seen.map((x) => x.ghostRound)).toEqual([1, 2]);
    // A ghost already fought in the run is not met again (MM-3).
    expect(new Set(met).size).toBe(2);
    // Round 3: nothing was ever stored for it, so the boss.
    const s3 = await playUntil(b, atPvpShop(3));
    expect(s3.pvpOpponent).toMatchObject({
      kind: 'boss',
      ghost: null,
      label: BOSS_LABEL,
      round: 3,
    });
  });

  test('an empty bucket gives the boss, and the state says so', async () => {
    const rig = newRig();
    const b = await begin(rig, ghostDeps('dev-b'), { runId: 'run-b' });
    const shop = await playUntil(b, atPvpShop(1));
    expect(shop.pvpOpponent).toEqual({
      round: 1,
      kind: 'boss',
      label: BOSS_LABEL,
      ghost: null,
    });
    const done = await playUntil(b, atPvpSummary(1));
    expect(done.thisRound.pvp?.opponent.kind).toBe('boss');
    expect(verifyLastBattle(done, b.deps)).toBe(true);
  });

  test('a snapshot of another version or party size is never selected', async () => {
    const rig = newRig();
    await seedPool(rig);
    const other = await begin(rig, ghostDeps('dev-b'), {
      runId: 'run-v',
      runVersion: '0.2',
    });
    expect((await playUntil(other, atPvpShop(1))).pvpOpponent?.kind).toBe(
      'boss',
    );
    const pair = await begin(rig, ghostDeps('dev-c'), {
      runId: 'run-p',
      players: ['Cy', 'Di'],
    });
    expect((await playUntil(pair, atPvpShop(1))).pvpOpponent?.kind).toBe(
      'boss',
    );
    // Planting a mismatched snapshot in the right bucket changes nothing.
    const [ok1] = await listBucket(rig, '0.1', 1, 1);
    const planted = {
      ...(ok1 as GhostSnapshot),
      gameVersion: '0.2',
      owner: { id: 'zz', label: 'Zed' },
    };
    rig.ghosts.injectRaw(
      { gameVersion: '0.1', partySize: 1, round: 1 },
      'zz',
      planted,
    );
    const again = await begin(rig, ghostDeps('dev-d'), {
      runId: 'run-d',
      seed: 3,
    });
    const s = await playUntil(again, atPvpShop(1));
    expect(s.pvpOpponent?.ghost?.owner.id).toBe('dev-a');
  });

  test("the run's own snapshots are excluded", async () => {
    const rig = newRig();
    const a = await begin(rig, ghostDeps('dev-a'), { runId: 'run-a' });
    await playRounds(a, 1);
    // The pool now holds run-a's snapshot of round 1; round 2 has none yet.
    const s = await playUntil(a, atPvpShop(2));
    expect(s.pvpOpponent?.kind).toBe('boss');
    const ctx = ghostContext(a.deps) as NonNullable<
      ReturnType<typeof ghostContext>
    >;
    const mine = (await listBucket(rig, '0.1', 1, 1)) as unknown[];
    expect(eligibleGhosts(mine, { ...s, round: 1 }, ctx)).toEqual([]);
  });

  test('ghosts already fought in the run are excluded', async () => {
    const rig = newRig();
    await seedPool(rig);
    const b = await begin(rig, ghostDeps('dev-b'), { runId: 'run-b', seed: 9 });
    const s = await playUntil(b, atPvpShop(1));
    const ghost = s.pvpOpponent?.ghost as GhostSnapshot;
    const ctx = ghostContext(b.deps) as NonNullable<
      ReturnType<typeof ghostContext>
    >;
    expect(eligibleGhosts([ghost], s, ctx)).toHaveLength(1);
    expect(
      eligibleGhosts([ghost], { ...s, ghostsFought: [ghostKey(ghost)] }, ctx),
    ).toEqual([]);
    const done = await playUntil(b, atPvpSummary(1));
    expect(done.ghostsFought).toEqual([ghostKey(ghost)]);
  });

  test('the draw consumes the stream the same way whatever the pool holds, and is uniform enough', async () => {
    const rig = newRig();
    await seedPool(rig);
    const deps = ghostDeps('dev-b');
    const ctx = ghostContext(deps) as NonNullable<
      ReturnType<typeof ghostContext>
    >;
    const base = await begin(rig, deps, { runId: 'run-b', seed: 9 });
    const s = await playUntil(base, atPvpShop(1));
    const [a1] = await listBucket(rig, '0.1', 1, 1);
    const g = a1 as GhostSnapshot;
    const mk = (id: string): GhostSnapshot => ({
      ...g,
      owner: { id, label: `L ${id}` },
      runId: `r-${id}`,
    });
    const pre: RunState = { ...s, pvpOpponent: null };
    const none = selectGhost(pre, [], ctx);
    const one = selectGhost(pre, [mk('a')], ctx);
    const many = selectGhost(pre, [mk('a'), mk('b'), mk('c')], ctx);
    const garbage = selectGhost(pre, [{ x: 1 }, null, 5], ctx);
    for (const r of [one, many, garbage])
      expect(r.state.rng).toEqual(none.state.rng);
    expect(none.choice.kind).toBe('boss');
    expect(garbage.choice.kind).toBe('boss');
    // Order of presentation does not matter (canonical order).
    const rev = selectGhost(pre, [mk('c'), mk('b'), mk('a')], ctx);
    expect(rev.choice).toEqual(many.choice);
    // Over many run generators each of three is picked.
    const hits = new Map<string, number>();
    for (let i = 0; i < 90; i++) {
      const st: RunState = { ...pre, rng: [i + 1, 2, 3, 4] };
      const r = selectGhost(st, [mk('a'), mk('b'), mk('c')], ctx);
      const id = r.choice.ghost?.owner.id ?? '?';
      hits.set(id, (hits.get(id) ?? 0) + 1);
    }
    expect([...hits.keys()].sort()).toEqual(['a', 'b', 'c']);
    for (const n of hits.values()) expect(n).toBeGreaterThan(10);
  });

  test('more candidates than the cap are rejected in the intent, and the controller presents at most the cap', async () => {
    const deps = ghostDeps('dev-a');
    const rig = newRig();
    await seedPool(rig);
    const [src] = await listBucket(rig, '0.1', 1, 1);
    const g = src as GhostSnapshot;
    for (let i = 0; i < MAX_GHOST_CANDIDATES + 5; i++) {
      rig.ghosts.injectRaw(
        { gameVersion: '0.1', partySize: 1, round: 1 },
        `o${String(i)}`,
        {
          ...g,
          owner: { id: `o${String(i)}`, label: `O${String(i)}` },
          runId: `r${String(i)}`,
        },
      );
    }
    const b = await begin(rig, ghostDeps('dev-b'), { runId: 'run-b', seed: 5 });
    await playUntil(b, atPvpShop(1));
    const log = b.controller.state.actionLog.find(
      (l) => (l.intent as { type: string }).type === SELECT_GHOST,
    );
    // The log keeps the compact record of the draw, not the candidates.
    const logged = log?.intent as unknown as { n: number };
    expect(logged.n).toBe(MAX_GHOST_CANDIDATES);
    // A direct oversized intent is refused.
    const s0 = clone(b.controller.state);
    const r = applyIntent(
      { ...s0, pvpOpponent: null },
      0,
      {
        type: SELECT_GHOST,
        candidates: Array.from({ length: 17 }, () => ({})) as never,
      },
      deps,
    );
    expect(r.ok).toBe(false);
  });
});

describe('validation', () => {
  async function setup() {
    const rig = newRig();
    await seedPool(rig);
    const deps = ghostDeps('dev-b');
    const ctx = ghostContext(deps) as NonNullable<
      ReturnType<typeof ghostContext>
    >;
    const [src] = await listBucket(rig, '0.1', 1, 1);
    return { rig, deps, ctx, good: src as GhostSnapshot };
  }

  /** A snapshot with a legal extractor on a node. */
  function withExtractor(good: GhostSnapshot): GhostSnapshot {
    const stashed = addToStash(good.team, content, {
      def: 'bld_extractor',
      tier: 1,
      owner: 0,
    });
    if (!stashed.ok) throw new Error('stash');
    const id = stashed.state.stash[stashed.state.stash.length - 1]
      ?.id as number;
    const w = good.team.map.width;
    const h = good.team.map.height;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = placeFromStash(stashed.state, content, {
          actor: 0,
          id,
          x,
          y,
          rotation: 0,
        });
        if (p.ok) return { ...good, team: p.state };
      }
    }
    throw new Error('no legal extractor cell');
  }

  test('the control snapshots are valid', async () => {
    const { ctx, good } = await setup();
    expect(validateGhostSnapshot(clone(good), ctx).ok).toBe(true);
    expect(validateGhostSnapshot(clone(withExtractor(good)), ctx).ok).toBe(
      true,
    );
  });

  test('hand-crafted invalid snapshots are rejected', async () => {
    const { ctx, good } = await setup();
    const ex = withExtractor(good);
    const placed = ex.team.buildings[0];
    expect(placed?.def).toBe('bld_extractor');
    const bad: Record<string, unknown> = {};
    // an extractor off a resource node
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ] as const) {
      const moved = loose(ex);
      moved.team.buildings[0] = {
        ...placed,
        x: (placed?.x ?? 0) + dx,
        y: (placed?.y ?? 0) + dy,
      };
      if (!validateGhostSnapshot(moved, ctx).ok) {
        bad['extractor off a node'] = moved;
        break;
      }
    }
    expect(bad['extractor off a node']).toBeDefined();
    // impossible building value
    const rich = loose(good);
    const base = rich.team.nextId;
    for (let i = 0; i < 60; i++) {
      rich.team.stash.push({
        id: base + i,
        def: 'bld_turret',
        tier: 3,
        owner: 0,
      });
    }
    rich.team.nextId = base + 60;
    bad['impossible value'] = rich;
    // an altered map
    const altered = loose(good);
    altered.team.map.nodes.pop();
    bad['altered map'] = altered;
    // unknown building id
    const unknown = loose(good);
    unknown.team.stash.push({
      id: unknown.team.nextId,
      def: 'bld_nonexistent',
      tier: 1,
      owner: 0,
    });
    unknown.team.nextId += 1;
    bad['unknown building'] = unknown;
    // tier 4
    const t4 = loose(good);
    t4.team.stash.push({
      id: t4.team.nextId,
      def: 'bld_wall',
      tier: 4,
      owner: 0,
    });
    t4.team.nextId += 1;
    bad['tier 4'] = t4;
    // numbers
    bad['wrong round record'] = {
      ...clone(good),
      pvpRecord: { wins: 3, losses: 0 },
    };
    bad['wrong lives'] = { ...clone(good), lives: 1 };
    bad['bad party size'] = { ...clone(good), partySize: 2 };
    bad['unknown field'] = { ...clone(good), extra: 1 };
    bad['unknown modifier'] = {
      ...clone(good),
      team: {
        ...clone(good.team),
        modifiers: [
          {
            id: 'mod_nope',
            effects: [{ kind: 'core_health_percent', percent: 5 }],
          },
        ],
      },
    };
    bad['too many modifiers'] = {
      ...clone(good),
      team: {
        ...clone(good.team),
        modifiers: [
          {
            id: 'mod_drilled_troops',
            effects: [{ kind: 'unit_strength_percent', percent: 10 }],
          },
          {
            id: 'mod_drilled_troops',
            effects: [{ kind: 'unit_strength_percent', percent: 10 }],
          },
        ],
      },
    };
    bad['changed modifier effect'] = {
      ...clone(good),
      team: {
        ...clone(good.team),
        modifiers: [
          {
            id: 'mod_drilled_troops',
            effects: [{ kind: 'unit_strength_percent', percent: 99 }],
          },
        ],
      },
    };
    bad['unplaced Core'] = {
      ...clone(good),
      team: { ...clone(good.team), core: null },
    };
    bad['not an object'] = 7;
    for (const [name, snap] of Object.entries(bad)) {
      const v = validateGhostSnapshot(snap, ctx);
      expect(v.ok, name).toBe(false);
    }
    // Each is also skipped by the selection, which then falls back.
    const deps = ghostDeps('dev-b');
    const state = placeCoreAll(newRun(deps), deps);
    const pre: RunState = { ...state, round: 1 };
    const all = Object.values(bad);
    const none = selectGhost(pre, all, ctx);
    expect(none.choice.kind).toBe('boss');
    expect(none.candidates).toBe(0);
    // The next valid candidate is used when mixed in.
    const mixed = selectGhost(
      pre,
      [
        ...all,
        { ...clone(good), owner: { id: 'good', label: 'Good' }, runId: 'rg' },
      ],
      ctx,
    );
    expect(mixed.choice.kind).toBe('ghost');
    expect(mixed.choice.label).toBe('Good');
    expect(mixed.candidates).toBe(1);
  });

  test('a run drawing among invalid and valid snapshots from the pool skips the invalid ones', async () => {
    const { rig, good } = await setup();
    const bucket = { gameVersion: '0.1', partySize: 1, round: 1 };
    const bad = loose(good);
    bad.team.stash.push({
      id: bad.team.nextId,
      def: 'bld_wall',
      tier: 4,
      owner: 0,
    });
    bad.team.nextId += 1;
    bad.owner = { id: 'aaa-bad', label: 'Bad' };
    bad.runId = 'rbad';
    rig.ghosts.injectRaw(bucket, 'aaa-bad', bad);
    rig.ghosts.injectRaw(bucket, 'zzz-junk', 'garbage');
    for (let seed = 1; seed <= 6; seed++) {
      const g = await begin(rig, ghostDeps('dev-b'), {
        runId: `rb${String(seed)}`,
        seed,
      });
      const s = await playUntil(g, atPvpShop(1));
      expect(s.pvpOpponent?.ghost?.owner.id).toBe('dev-a');
    }
  });

  test('the building-value bound: formula and example numbers', () => {
    const deps = ghostDeps('x');
    const g = deps.ghosts;
    expect(g).toBeDefined();
    const e = gameConfigs.economy;
    const table = [1, 2, 3, 5, 8, 12].map((round) => {
      const b = ghostValueBound(round, 1, content, e, gameConfigs.events);
      return [round, b.goldPerPlayer, b.kitPerPlayer, b.limit];
    });
    // startingGold 10, income 3 per shop, PvE hard 8, PvP win 6, Windfall 4.
    // round 1: 10 + 3*1 + 8*1 + 6*0 + 4*1 = 25 gold.
    expect(table[0]?.[1]).toBe(25);
    // round 2: 10 + 3*3 + 8*2 + 6*1 + 4*3 = 53.
    expect(table[1]?.[1]).toBe(53);
    // No margin: the limit is players * (gold + kit) = 53 + 67.
    expect(table[1]?.[3]).toBe(53 + 67);
    // A party of two has twice the bound.
    const two = ghostValueBound(3, 2, content, e, gameConfigs.events);
    const one = ghostValueBound(3, 1, content, e, gameConfigs.events);
    expect(two.limit).toBe(2 * one.limit);
  });
});

describe('replay and reload', () => {
  test('reloading before the battle keeps the selected opponent, with the pool emptied or changed', async () => {
    const rig = newRig();
    await seedPool(rig);
    const b = await begin(rig, ghostDeps('dev-b'), { runId: 'run-b', seed: 9 });
    const s = await playUntil(b, atPvpShop(1));
    const chosen = clone(s.pvpOpponent);
    expect(chosen?.kind).toBe('ghost');
    // The pool is wiped; the run is reopened from its save.
    await rig.ghosts.clear();
    const deps2 = ghostDeps('dev-b');
    const reopened = await openRun('run-b', deps2, rig.saves, INSTALLED, {
      ghostStore: rig.ghosts,
    });
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.controller.state.pvpOpponent).toEqual(chosen);
    expect(validateRunState(clone(reopened.controller.state), deps2).ok).toBe(
      true,
    );
    await reopened.controller.prepare(5000);
    expect(reopened.controller.state.pvpOpponent).toEqual(chosen);
    // Fight with the same opponent although the store is empty.
    const game: Game = {
      controller: reopened.controller,
      args: b.args,
      deps: deps2,
    };
    const done = await playUntil(game, atPvpSummary(1));
    expect(done.thisRound.pvp?.opponent).toEqual({
      kind: 'ghost',
      label: 'Ann',
    });
    expect(verifyLastBattle(done, deps2)).toBe(true);
  });

  test('a save made between entering the shop and selecting is completed on prepare', async () => {
    const rig = newRig();
    await seedPool(rig);
    const deps = ghostDeps('dev-b');
    // Reach the shop by hand (no selection), save it, reopen.
    let s = placeCoreAll(newRun(deps), deps);
    for (let i = 0; i < 40 && !(s.step === 'shop' && s.leg === 'pve'); i++) {
      const step = s.step;
      let intent;
      if (step === 'pve_choice') intent = { type: 'vote', choice: 'easy' };
      else if (step === 'event_choice')
        intent = {
          type: 'vote',
          choice: (s.pending as { options: { id: string }[] }).options[0]?.id,
        };
      else if (step === 'event_resolve') {
        const fu = (
          s.pending as {
            followUp: { options: { id: string }[]; perPlayer?: boolean };
          }
        ).followUp;
        intent = {
          type: 'event_choose',
          choice: fu.perPlayer === true ? 'skip' : fu.options[0]?.id,
        };
      } else intent = { type: 'ready' };
      s = ok(s, 0, intent, deps).state;
    }
    expect(s.pvpOpponent).toBeNull();
    // `ready` is refused until the opponent is fixed.
    const refused = applyIntent(s, 0, { type: 'ready' }, deps);
    expect(refused).toMatchObject({
      ok: false,
      reason: 'ghost_selection_pending',
    });
    await rig.saves.put(buildSaveRecord({ ...runArgsFor(s) }, s, INSTALLED, 1));
    const reopened = await openRun(s.runId, deps, rig.saves, INSTALLED, {
      ghostStore: rig.ghosts,
    });
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    await reopened.controller.prepare(2);
    expect(reopened.controller.state.pvpOpponent?.kind).toBe('ghost');
  });

  function runArgsFor(s: RunState) {
    return {
      runId: s.runId,
      runVersion: s.runVersion,
      seed: s.seed,
      players: s.players.map((p) => p.name),
      host: s.host,
    };
  }

  test('replayRun reproduces the run with an empty or a different store, and verifyLastBattle passes', async () => {
    const rig = newRig();
    await seedPool(rig, true);
    const b = await begin(rig, ghostDeps('dev-b'), { runId: 'run-b', seed: 9 });
    const end = await playUntil(b, atPvpSummary(2));
    expect(end.ghostsFought.length).toBe(2);
    // No store is consulted: replay needs only the args and the log, and the
    // deps carry no store. A different owner id changes nothing in the state.
    for (const deps of [
      ghostDeps('dev-b'),
      ghostDeps('someone-else'),
      b.deps,
    ]) {
      const r = replayRun(
        b.args,
        end.actionLog.map((a) => ({ ...a })),
        deps,
      );
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.state).toEqual(end);
    }
    // And the stored battle replays.
    expect(verifyLastBattle(end, b.deps)).toBe(true);
  });

  test('without ghost deps the log of a ghost run is refused, not silently reinterpreted', async () => {
    const rig = newRig();
    await seedPool(rig);
    const b = await begin(rig, ghostDeps('dev-b'), { runId: 'run-b', seed: 9 });
    const end = await playUntil(b, atPvpShop(1));
    const r = replayRun(b.args, end.actionLog, makeGameDeps());
    expect(r.ok).toBe(false);
  });
});

describe('failures of the pool never break a run', () => {
  test('a failing write loses the snapshot; a failing read means the boss', async () => {
    const rig = newRig();
    const a = await begin(rig, ghostDeps('dev-a'), { runId: 'run-a' });
    rig.ghosts.failNextSave();
    await playRounds(a, 1);
    expect(await listBucket(rig, '0.1', 1, 1)).toHaveLength(0);
    const broken = {
      ...rig.ghosts,
      list: () => Promise.reject(new Error('boom')),
    };
    const g = await begin(
      { saves: rig.saves, ghosts: broken },
      ghostDeps('dev-b'),
      { runId: 'run-b' },
    );
    const s = await playUntil(g, atPvpShop(1));
    expect(s.pvpOpponent?.kind).toBe('boss');
  });
});

describe('run state validation of the ghost fields', () => {
  test('rejects a ghost in the wrong place, round, version or with a bad label', async () => {
    const rig = newRig();
    await seedPool(rig);
    const b = await begin(rig, ghostDeps('dev-b'), { runId: 'run-b', seed: 9 });
    const s = await playUntil(b, atPvpShop(1));
    const deps = b.deps;
    expect(validateRunState(clone(s), deps).ok).toBe(true);
    const errs = (v: unknown) => {
      const r = validateRunState(v, deps);
      return r.ok ? [] : r.errors;
    };
    expect(
      errs({ ...clone(s), step: 'event_choice', leg: 'pve' }).join(),
    ).toMatch(/pvpOpponent|pending|votes/);
    expect(errs({ ...clone(s), round: 2 }).join()).toMatch(/pvpOpponent/);
    const o = clone(s.pvpOpponent) as NonNullable<RunState['pvpOpponent']>;
    expect(
      errs({ ...clone(s), pvpOpponent: { ...o, label: 'Other' } }).join(),
    ).toMatch(/label/);
    expect(
      errs({ ...clone(s), pvpOpponent: { ...o, kind: 'boss' } }).join(),
    ).toMatch(/boss/);
    expect(
      errs({
        ...clone(s),
        ghostsFought: [ghostKey(o.ghost as GhostSnapshot)],
      }).join(),
    ).toMatch(/already fought/);
    expect(errs({ ...clone(s), ghostsFought: 'x' }).join()).toMatch(
      /ghostsFought/,
    );
    expect(errs({ ...clone(s), runId: 'run-a' }).join()).toMatch(/eligible/);
    const lifted = loose(o);
    lifted.ghost.team.stash.push({
      id: lifted.ghost.team.nextId,
      def: 'bld_wall',
      tier: 4,
      owner: 0,
    });
    lifted.ghost.team.nextId += 1;
    expect(errs({ ...clone(s), pvpOpponent: lifted }).join()).toMatch(
      /tier|ghost/,
    );
    expect(ghostBucketKey({ gameVersion: '0.1', partySize: 1, round: 1 })).toBe(
      '0.1|1|1',
    );
  });
});
