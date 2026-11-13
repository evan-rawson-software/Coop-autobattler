/**
 * Ghost snapshot size limit and fast rejection (review round 2 of #78): the
 * limit is derived from the board a legitimate snapshot can hold, and a
 * hostile value is rejected without sorting or listing its keys.
 */
import { describe, expect, test } from 'vitest';
import {
  addConduit,
  addToStash,
  canonicalJson,
  createTeamState,
  GHOST_MAX_ROUND,
  GHOST_MAX_SERIALIZED_BYTES,
  ghostMaxSerializedSize,
  ghostValueBound,
  hashJson,
  placeFromStash,
  queryMap,
  validateGhostSnapshot,
  validateTeamState,
  type Cell,
  type GhostSnapshot,
  type TeamState,
} from '@game/core';
import { fixedBattle } from './defaults.js';
import { botRun } from './ghost-test-support.js';
import { ghostContext, selectGhostHandler } from './ghosts.js';
import { makeGameDeps, newRun } from './test-support.js';

const perf = (globalThis as unknown as { performance: { now(): number } })
  .performance;

const RULES = { startingLives: 99, pvpLossLifeCost: 1 };
const deps = makeGameDeps({
  ghosts: { ownerId: 'size' },
  battle: fixedBattle(true),
  rules: RULES,
});
const ctx = (() => {
  const c = ghostContext(deps);
  if (c === null) throw new Error('ghosts are on');
  return c;
})();
const { content, mapgen } = ctx;

/** A real four-player snapshot (a valid Core and map to build on). */
function base4(): GhostSnapshot {
  const run = botRun(
    deps,
    {
      runId: 'size-4',
      runVersion: '0.1',
      seed: 5,
      players: ['A', 'B', 'C', 'D'],
      host: 0,
    },
    3,
    (s) => s.round >= 3 && s.step === 'pvp_summary',
  );
  const found = run.snapshots[run.snapshots.length - 1];
  if (found === undefined) throw new Error('no snapshot');
  return found;
}

const DIRS: readonly [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/**
 * The biggest legitimate board of `round`: every conduit-reachable resource
 * node an extractor feeding an Armory over the longest free path, then every
 * free cell a Wall, as many as the value bound of the round pays for, with
 * every modifier slot of the round filled.
 */
function maximalBoard(round: number): GhostSnapshot {
  const snap = base4();
  const partySize = 4;
  let team: TeamState = {
    ...createTeamState(snap.team.map),
    cores: snap.team.cores,
  };
  const q = queryMap(team.map, content.terrain);
  const { width, height } = team.map;
  const taken = new Set<number>();
  const key = (x: number, y: number): number => y * width + x;
  const core = content.buildings.get('bld_core');
  if (core === undefined) throw new Error('no core');
  for (const coreAt of team.cores) {
    if (coreAt === null) continue;
    for (let dy = 0; dy < core.footprint.height; dy++) {
      for (let dx = 0; dx < core.footprint.width; dx++) {
        taken.add(key(coreAt.x + dx, coreAt.y + dy));
      }
    }
  }
  const budget = ghostValueBound(
    round,
    partySize,
    content,
    ctx.economy,
    ctx.events,
  ).limit;
  // Gold cannot be given (PP-17): one owner's buildings are worth at most
  // `goldPerPlayer + kitPerPlayer`, so the board is filled owner by owner.
  const perOwner = budget / partySize;
  const spentBy = new Map<number, number>();
  let spent = 0;
  const price = (def: string): number => {
    const b = content.buildings.get(def);
    const t = b?.tiers[0] as { price?: number } | undefined;
    return t?.price ?? 0;
  };
  const put = (
    def: string,
    x: number,
    y: number,
    rotation = 0,
  ): number | null => {
    if (spent + price(def) > budget) return null;
    const owner = q.plotOf(x);
    if ((spentBy.get(owner) ?? 0) + price(def) > perOwner) return null;
    const added = addToStash(team, content, { def, tier: 1, owner });
    if (!added.ok) throw new Error(added.reason);
    const placed = placeFromStash(added.state, content, {
      actor: owner,
      id: added.id,
      x,
      y,
      rotation,
    });
    if (!placed.ok) return null;
    team = placed.state;
    spent += price(def);
    spentBy.set(owner, (spentBy.get(owner) ?? 0) + price(def));
    taken.add(key(x, y));
    return added.id;
  };
  const free = (x: number, y: number): boolean =>
    q.isBuildable(x, y) &&
    q.nodeAt(x, y) === undefined &&
    !taken.has(key(x, y));

  // Long conduits: an extractor on a node of res_a to an Armory far away.
  for (const node of team.map.nodes) {
    if (node.resource !== 'res_a') continue;
    if (!free(node.x, node.y + 1)) continue;
    const ex = put('bld_extractor', node.x, node.y);
    if (ex === null) continue;
    const start = { x: node.x, y: node.y + 1 };
    const dist = new Map<number, number>([[key(start.x, start.y), 0]]);
    const from = new Map<number, number>();
    const order: Cell[] = [start];
    for (let i = 0; i < order.length; i++) {
      const c = order[i] as Cell;
      for (const [dx, dy] of DIRS) {
        const nx = c.x + dx;
        const ny = c.y + dy;
        // A conduit stays in its owner's plot (PP-1).
        if (q.plotOf(nx) !== q.plotOf(node.x)) continue;
        if (!free(nx, ny) || dist.has(key(nx, ny))) continue;
        dist.set(key(nx, ny), (dist.get(key(c.x, c.y)) ?? 0) + 1);
        from.set(key(nx, ny), key(c.x, c.y));
        order.push({ x: nx, y: ny });
      }
    }
    for (const end of [...order].reverse()) {
      const armory = { x: end.x, y: end.y + 1 };
      if (
        !free(armory.x, armory.y) ||
        (armory.x === start.x && armory.y === start.y)
      )
        continue;
      const path: Cell[] = [];
      for (
        let k: number | undefined = key(end.x, end.y);
        k !== undefined;
        k = from.get(k)
      ) {
        path.unshift({ x: k % width, y: Math.floor(k / width) });
      }
      const before = team;
      const trial = put('bld_armory', armory.x, armory.y);
      if (trial === null) break;
      const added = addConduit(team, content, {
        actor: team.buildings.find((b) => b.id === ex)?.owner ?? 0,
        from: { building: ex, side: 'north' },
        to: { building: trial, side: 'south' },
        cells: path,
      });
      if (added.ok) {
        team = added.state;
        for (const c of path) taken.add(key(c.x, c.y));
        break;
      }
      // Not placeable that way: undo the Armory.
      team = before;
      spent -= price('bld_armory');
      const o = q.plotOf(armory.x);
      spentBy.set(o, (spentBy.get(o) ?? 0) - price('bld_armory'));
      taken.delete(key(armory.x, armory.y));
    }
  }
  const conduitCells = team.conduits.reduce((n, c) => n + c.cells.length, 0);

  // Walls on every other free cell, while the value bound pays for them.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (free(x, y)) put('bld_wall', x, y);
    }
  }
  expect(team.conduits.length).toBeGreaterThan(0);
  expect(conduitCells).toBeGreaterThan(40);

  const held = [];
  const defs = ctx.events.modifiers;
  const stackable = defs.find((m) => m.stackable);
  if (stackable === undefined) throw new Error('no stackable modifier');
  for (const m of defs)
    if (!m.stackable) held.push({ id: m.id, effects: m.effects });
  while (held.length < 2 * round - 1) {
    held.push({ id: stackable.id, effects: stackable.effects });
  }
  team = { ...team, modifiers: held };
  // Still maximal: every owner is within one wall of the per-owner limit.
  for (let owner = 0; owner < partySize; owner++) {
    const spendOf = spentBy.get(owner) ?? 0;
    expect(
      perOwner - spendOf,
      `round ${String(round)} owner ${String(owner)}: spend ${String(spendOf)} of ${String(perOwner)}`,
    ).toBeLessThan(price('bld_wall') + 1e-9);
  }
  return {
    ...snap,
    round,
    team,
    pvpRecord: { wins: round - 1, losses: 0 },
    lives: RULES.startingLives,
  };
}

describe('size limit derived from board capacity', () => {
  test('grows with party size and round; documented examples', () => {
    const size = (n: number, r: number) => ghostMaxSerializedSize(n, r, ctx);
    for (const n of [1, 2, 3, 4]) {
      expect(size(n, 10)).toBeGreaterThan(size(n, 1));
      expect(size(n, 25)).toBeGreaterThan(size(n, 10));
    }
    expect(size(4, 1)).toBeGreaterThan(size(1, 1));
    // Without economy numbers the stash allowance is by cells: looser early,
    // but NOT looser at late rounds, where the value bound allows more
    // buildings than the board has cells (so replay must use the same bounds).
    expect(ghostMaxSerializedSize(4, 10, { content, mapgen })).toBeGreaterThan(
      size(4, 10),
    );
    expect(ghostMaxSerializedSize(4, 200, { content, mapgen })).toBeLessThan(
      size(4, 200),
    );
  });

  test('a maximal legitimate four-player board at round 23 passes', () => {
    const snap = maximalBoard(23);
    const bytes = canonicalJson(snap).length;
    const limit = ghostMaxSerializedSize(4, 23, ctx);
    expect(bytes).toBeLessThan(limit);
    // The old flat limit (4096 + 12288 * 4 = 53248) would have dropped it.
    expect(bytes).toBeGreaterThan(4096 + 12288 * 4);
    const r = validateGhostSnapshot(JSON.parse(JSON.stringify(snap)), ctx);
    expect(r.ok, r.ok ? '' : r.errors.join('\n')).toBe(true);
  });

  test('just over the limit fails, just under is not a size error', () => {
    const snap = maximalBoard(23);
    const limit = ghostMaxSerializedSize(4, 23, ctx);
    const entry = canonicalJson({
      id: 1_000_000,
      def: 'bld_wall',
      tier: 1,
      owner: 0,
    }).length;
    const baseLength = canonicalJson(snap).length;
    const pad = (target: number) => {
      const copy = JSON.parse(JSON.stringify(snap)) as GhostSnapshot & {
        team: { stash: unknown[] };
      };
      const extra = Math.ceil((target - baseLength) / (entry + 1));
      for (let i = 0; i < extra; i++) {
        copy.team.stash.push({
          id: 1_000_000 + i,
          def: 'bld_wall',
          tier: 1,
          owner: 0,
        });
      }
      return copy;
    };
    const over = pad(limit + 1);
    expect(canonicalJson(over).length).toBeGreaterThan(limit);
    const r = validateGhostSnapshot(over, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toContain('larger than');
    const under = pad(limit - 120);
    expect(canonicalJson(under).length).toBeLessThanOrEqual(limit);
    const r2 = validateGhostSnapshot(under, ctx);
    expect(r2.ok ? '' : r2.errors.join(' ')).not.toContain('larger than');
  });
});

describe('fast rejection of hostile values', () => {
  const good = (() => {
    const run = botRun(
      deps,
      { runId: 'size-1', runVersion: '0.1', seed: 7, players: ['A'], host: 0 },
      1,
      (s) => s.round >= 3 && s.step === 'pvp_summary',
    );
    return run.snapshots[run.snapshots.length - 1] as GhostSnapshot;
  })();

  function timed(v: unknown): { ms: number; errors: readonly string[] } {
    // Best of several runs: a load spike hits one run, rarely all of them.
    let ms = Infinity;
    let errors: readonly string[] = [];
    for (let i = 0; i < 5; i++) {
      const t = perf.now();
      const r = validateGhostSnapshot(v, ctx);
      ms = Math.min(ms, perf.now() - t);
      errors = r.ok ? [] : r.errors;
    }
    return { ms, errors };
  }

  test('a 2e6-key object and a 2e6-element array are rejected without walking them', () => {
    const keys: Record<string, number> = {};
    for (let i = 0; i < 2_000_000; i++) keys['k' + String(i)] = 1;
    const big = new Array<number>(2_000_000).fill(1);
    const clone = () =>
      JSON.parse(JSON.stringify(good)) as Record<string, unknown>;
    // An object of junk keys (fails on the cheap fields, no key is listed).
    const a = timed(keys);
    // The right fields plus a huge array in place of the team or an extra field.
    const b = timed({ ...clone(), actionLog: big });
    const c = timed({ ...clone(), team: big });
    const d = timed({ ...clone(), extra: big });
    for (const r of [a, b, c, d]) {
      // Typical: well under 1 ms. Walking the 2e6 keys takes ~900 ms, so this
      // bound still separates a walk from a skip with a wide margin for load.
      expect(r.ms).toBeLessThan(250);
      expect(r.errors.length).toBeGreaterThan(0);
      expect(r.errors.length).toBeLessThanOrEqual(11);
    }
  }, 120_000);

  test('a huge object inside the snapshot gives a handful of errors, not one per key', () => {
    const keys: Record<string, number> = {};
    for (let i = 0; i < 300_000; i++) keys['k' + String(i)] = 1;
    const s = JSON.parse(JSON.stringify(good)) as Record<string, unknown>;
    (s['team'] as Record<string, unknown>)['extra'] = keys;
    const r = timed(s);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors.length).toBeLessThanOrEqual(11);
  });

  test('errors are capped', () => {
    const s = JSON.parse(JSON.stringify(good)) as Record<string, unknown>;
    for (let i = 0; i < 100; i++) s['extra' + String(i)] = 1;
    const r = validateGhostSnapshot(s, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.length).toBeLessThanOrEqual(11);
      expect(r.errors[r.errors.length - 1]).toContain('more');
    }
  });
});

describe('conduit padding (quadratic check)', () => {
  /** A snapshot of `round` whose team holds `count` junk conduits. */
  function padded(count: number, round: number): GhostSnapshot {
    const snap = JSON.parse(JSON.stringify(base4())) as GhostSnapshot & {
      team: { conduits: unknown[]; buildings: { id: number }[] };
    };
    const id = snap.team.buildings[0]?.id ?? 1;
    for (let i = 0; i < count; i++) {
      snap.team.conduits.push({
        id: 1000 + i,
        from: { building: id, side: 'north' },
        to: { building: id, side: 'south' },
        cells: [],
      });
    }
    return {
      ...snap,
      round,
      pvpRecord: { wins: round - 1, losses: 0 },
      lives: RULES.startingLives,
    };
  }

  test('a conduit-padded junk snapshot at party 4 / round 200 is rejected quickly', () => {
    const limit = ghostMaxSerializedSize(4, 200, ctx);
    const probe = canonicalJson(padded(100, 200)).length;
    const base = canonicalJson(padded(0, 200)).length;
    const per = (probe - base) / 100;
    const count = Math.floor(((limit - base) / per) * 0.98);
    const snap = padded(count, 200);
    expect(canonicalJson(snap).length).toBeLessThanOrEqual(limit);
    const t = perf.now();
    const r = validateGhostSnapshot(snap, ctx);
    const ms = perf.now() - t;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toContain('more conduits');
    expect(ms).toBeLessThan(1500);
  });

  test('the per-conduit checks are linear even past the count bound', () => {
    const snap = padded(20_000, 4);
    const t = perf.now();
    const r = validateTeamState(snap.team, content, mapgen);
    const ms = perf.now() - t;
    expect(r.ok).toBe(false);
    expect(ms).toBeLessThan(1500);
  });

  /** `count` junk buildings of `def` at (0, 0), linked in pairs south to north. */
  function crowded(count: number, round: number, def: string): GhostSnapshot {
    const snap = JSON.parse(JSON.stringify(base4())) as GhostSnapshot & {
      team: { conduits: unknown[]; buildings: unknown[]; nextId: number };
    };
    const buildings: unknown[] = [];
    const conduits: unknown[] = [];
    for (let i = 0; i < count; i++) {
      buildings.push({
        id: i + 1,
        def,
        tier: 1,
        owner: 0,
        x: 0,
        y: 0,
        rotation: 0,
      });
    }
    for (let i = 0; i + 1 < count; i += 2) {
      conduits.push({
        id: count + 1 + i,
        from: { building: i + 1, side: 'north' },
        to: { building: i + 2, side: 'south' },
        cells: [],
      });
    }
    return {
      ...snap,
      round,
      pvpRecord: { wins: round - 1, losses: 0 },
      lives: RULES.startingLives,
      team: {
        ...snap.team,
        buildings,
        conduits,
        stash: [],
        nextId: 10 * count + 10,
      },
    } as unknown as GhostSnapshot;
  }

  test('building-padded junk at party 4 / round 200 is rejected quickly', () => {
    const cells = 4 * mapgen.plotWidth * mapgen.plotDepth;
    const limit = ghostMaxSerializedSize(4, 200, ctx);
    for (const def of ['bld_merger', 'bld_splitter']) {
      const probe = canonicalJson(crowded(10_000, 200, def)).length;
      const empty = canonicalJson(crowded(0, 200, def)).length;
      const per = (probe - empty) / 10_000;
      const count = Math.floor(((limit - empty) / per) * 0.9);
      expect(count).toBeGreaterThan(cells);
      const snap = crowded(count, 200, def);
      expect(canonicalJson(snap).length).toBeLessThanOrEqual(limit);
      const t = perf.now();
      const r = validateGhostSnapshot(snap, ctx);
      const ms = perf.now() - t;
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.join(' ')).toContain('more buildings');
      expect(ms).toBeLessThan(1500);
    }
  });

  test('the network analysis is linear even past the building bound', () => {
    // Past the ghost bound the team check alone must stay fast (it was
    // quadratic in the number of buildings: about 4 s at 18,000).
    for (const def of ['bld_merger', 'bld_splitter']) {
      const snap = crowded(20_000, 4, def);
      const t = perf.now();
      const r = validateTeamState(snap.team, content, mapgen);
      const ms = perf.now() - t;
      expect(r.ok).toBe(false);
      expect(ms).toBeLessThan(1500);
    }
  });

  test('a legal board never has more buildings than cells', () => {
    for (const round of [10, 23]) {
      const m = maximalBoard(round);
      expect(m.team.buildings.length).toBeLessThanOrEqual(
        4 * mapgen.plotWidth * mapgen.plotDepth,
      );
    }
  });

  test('the largest legal boards still pass', () => {
    for (const round of [10, 23]) {
      const r = validateGhostSnapshot(
        JSON.parse(JSON.stringify(maximalBoard(round))),
        ctx,
      );
      expect(r.ok, r.ok ? '' : r.errors.join('\n')).toBe(true);
    }
  });
});

describe('replay accepts what selection accepted', () => {
  const round = 200;
  const state = {
    ...newRun(deps, ['A', 'B', 'C', 'D']),
    round,
    step: 'shop',
    leg: 'pve',
  } as unknown as Parameters<typeof selectGhostHandler.handle>[0]['state'];

  function replay(chosen: unknown) {
    return selectGhostHandler.handle({
      state,
      player: state.host,
      deps,
      replay: true,
      intent: {
        type: 'select_ghost',
        n: 1,
        index: 0,
        chosen,
        hash: 'h',
        chosenHash: hashJson(chosen),
      } as never,
    });
  }

  function atRound200(extraStash: number): GhostSnapshot {
    const snap = JSON.parse(JSON.stringify(base4())) as GhostSnapshot & {
      round: number;
      pvpRecord: { wins: number; losses: number };
      team: { stash: unknown[]; nextId: number };
    };
    snap.round = round;
    snap.pvpRecord = { wins: round - 1, losses: 0 };
    snap.team.nextId = 2_000_000;
    for (let i = 0; i < extraStash; i++) {
      snap.team.stash.push({
        id: 1_000_000 + i,
        def: 'bld_wall',
        tier: 1,
        owner: 0,
      });
    }
    return snap;
  }

  test('a snapshot selection accepted at round 200 is accepted on replay', () => {
    const snap = atRound200(0);
    const live = validateGhostSnapshot(JSON.parse(JSON.stringify(snap)), ctx);
    expect(live.ok, live.ok ? '' : live.errors.join('\n')).toBe(true);
    const r = replay(JSON.parse(JSON.stringify(snap)));
    expect(r.ok ? '' : (r.detail ?? r.reason)).toBe('');
  });

  /** Stash padding until the canonical JSON is at least `bytes` long. */
  function paddedTo(bytes: number): GhostSnapshot {
    const per =
      (canonicalJson(atRound200(1000)).length -
        canonicalJson(atRound200(0)).length) /
      1000;
    return atRound200(
      Math.ceil((bytes - canonicalJson(atRound200(0)).length) / per) + 1,
    );
  }

  test('replay uses the fixed cap, not the economy-derived selection limit', () => {
    const full = ghostMaxSerializedSize(4, round, ctx);
    expect(full).toBeLessThan(GHOST_MAX_SERIALIZED_BYTES);
    // Between the selection limit and the fixed cap: selection refuses it for
    // size, replay (and restore) no longer does.
    const snap = paddedTo(full + 1000);
    const size = canonicalJson(snap).length;
    expect(size).toBeGreaterThan(full);
    expect(size).toBeLessThan(GHOST_MAX_SERIALIZED_BYTES);
    const live = validateGhostSnapshot(JSON.parse(JSON.stringify(snap)), ctx);
    expect(live.ok ? '' : live.errors.join(' ')).toContain('larger than');
    const r = replay(JSON.parse(JSON.stringify(snap)));
    expect(r.ok ? '' : (r.detail ?? r.reason)).not.toContain('larger than');
  });

  test('a logged snapshot over the fixed cap is rejected on replay', () => {
    const snap = paddedTo(GHOST_MAX_SERIALIZED_BYTES + 1000);
    expect(canonicalJson(snap).length).toBeGreaterThan(
      GHOST_MAX_SERIALIZED_BYTES,
    );
    const r = replay(JSON.parse(JSON.stringify(snap)));
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : (r.detail ?? '')).toContain('larger than');
  });

  test('a round above the maximum is rejected on replay', () => {
    const snap = {
      ...(JSON.parse(JSON.stringify(atRound200(0))) as GhostSnapshot),
      round: GHOST_MAX_ROUND + 1,
    };
    const r = replay(snap);
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : (r.detail ?? '')).toContain('round: must be');
  });
});

describe('the fixed size cap and the round limit', () => {
  test('the derived limit never exceeds the cap, at the maximum round', () => {
    expect(GHOST_MAX_ROUND).toBe(200);
    for (const n of [1, 2, 3, 4]) {
      const limit = ghostMaxSerializedSize(n, GHOST_MAX_ROUND, ctx);
      // Strictly below: equal would mean the clamp, not the economy, bounds it.
      expect(limit, `party ${String(n)}`).toBeLessThan(
        GHOST_MAX_SERIALIZED_BYTES,
      );
    }
  });

  test('the cap clamps a limit that would be larger', () => {
    expect(ghostMaxSerializedSize(4, 1000, ctx)).toBe(
      GHOST_MAX_SERIALIZED_BYTES,
    );
  });
});

describe('escaped characters count at their JSON length', () => {
  test('strings that escape to more than their length are measured as written', () => {
    const snap = base4();
    const limit = ghostMaxSerializedSize(4, snap.round, ctx);
    const baseLen = canonicalJson(snap).length;
    const make = (ch: string): unknown => {
      // Each element is 130 characters as written when ch is plain.
      const unit = ch.repeat(128);
      const n = Math.floor((limit - baseLen - 100) / 131);
      return { ...snap, pad: new Array<string>(n).fill(unit) };
    };
    const sizeErrors = (v: unknown): string => {
      const r = validateGhostSnapshot(JSON.parse(JSON.stringify(v)), ctx);
      return r.ok ? '' : r.errors.join(' ');
    };
    // Plain characters: just under the limit, not a size error.
    expect(sizeErrors(make('a'))).not.toContain('larger than');
    // Quotes, backslashes, newlines (two characters each) and other control
    // characters (six each) push the same string count over the limit.
    for (const ch of ['"', '\\', '\n', '\u0001']) {
      const v = make(ch);
      expect(canonicalJson(v).length).toBeGreaterThan(limit);
      expect(sizeErrors(v)).toContain('larger than');
    }
  });
});
