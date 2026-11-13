/**
 * The bots under the per-player design (issue #140): each bot builds only in
 * its own plot with its own buildings, feeds only what its collectors can
 * feed, shares one collector through a Splitter, and draws border links.
 */
import { describe, expect, test, vi } from 'vitest';
import {
  buildFlowGraph,
  collectorRatePer1000,
  isBorderEnd,
  needPer1000,
  validateGhostSnapshot,
  validateTeamState,
  type BuildingId,
  type TeamState,
} from '@game/core';
import { BOT_STRATEGIES, playBotRun, type BotRunResult } from './bot.js';
import { feeds, makeEnv } from './bot-layout.js';
import { ghostContext } from './ghosts.js';
import { Rng } from '@game/core';
import { planLayout } from './bot-layout.js';
import {
  content,
  makeGameDeps,
  mapgenConfig,
  newRun,
  ok,
  placeCoreAll,
} from './test-support.js';
import type { CreateRunArgs, Intent, RunState } from './types.js';

// Whole bot runs: far over the default 5 s on a loaded machine.
vi.setConfig({ testTimeout: 120_000 });

const NAMES = ['Ann', 'Bo', 'Cy', 'Di'];
const deps = makeGameDeps({ ghosts: { ownerId: 'bot-test' } });

function play(
  strategy: (typeof BOT_STRATEGIES)[number],
  party: number,
  seed: number,
  maxRounds = 4,
): BotRunResult {
  const args: CreateRunArgs = {
    runId: 'bot',
    runVersion: '1.0',
    seed,
    players: NAMES.slice(0, party),
    host: 0,
  };
  return playBotRun(deps, args, {
    strategy,
    seed,
    rerollCost: 1,
    maxRounds,
  });
}

/** Number of joined links: a sending and a receiving half at one spot. */
function joined(team: TeamState): number {
  const sending = new Set<string>();
  let n = 0;
  for (const c of team.conduits) {
    if (isBorderEnd(c.to))
      sending.add(`${String(c.to.border)}:${String(c.to.y)}`);
  }
  for (const c of team.conduits) {
    if (
      isBorderEnd(c.from) &&
      sending.has(`${String(c.from.border)}:${String(c.from.y)}`)
    )
      n++;
  }
  return n;
}

describe('bots build per player', () => {
  for (const strategy of BOT_STRATEGIES) {
    for (const party of [1, 2, 3, 4]) {
      test(`${strategy}, party of ${String(party)}: no rejected action, own plot, own buildings, valid snapshots`, () => {
        const r = play(strategy, party, 3);
        expect(r.rejected).toEqual([]);
        const team = r.state.team;
        const pw = team.map.plotWidth;
        // Every building lies in its owner's plot; every Core in its owner's.
        for (const b of team.buildings) {
          expect(b.x).toBeGreaterThanOrEqual(b.owner * pw);
          expect(b.x).toBeLessThan((b.owner + 1) * pw);
        }
        team.cores.forEach((core, p) => {
          expect(core).not.toBeNull();
          expect(Math.floor((core?.x ?? -1) / pw)).toBe(p);
        });
        expect(validateTeamState(team, content, mapgenConfig)).toMatchObject({
          ok: true,
        });
        const vctx = ghostContext(deps);
        expect(vctx).not.toBeNull();
        for (const snap of r.snapshots) {
          const v = validateGhostSnapshot(snap, vctx as never);
          expect(v.ok, v.ok ? '' : v.errors.join('; ')).toBe(true);
        }
      }, 120_000);
    }
  }

  test('rush forms working border links at party sizes 2 to 4', () => {
    for (const party of [2, 3, 4]) {
      let links = 0;
      for (let seed = 1; seed <= 3; seed++) {
        const r = play('rush', party, seed);
        expect(r.rejected).toEqual([]);
        links += joined(r.state.team);
      }
      expect(links, `party ${String(party)}`).toBeGreaterThan(0);
    }
  }, 300_000);

  test('a party of one never draws a border half', () => {
    const r = play('rush', 1, 3);
    expect(r.linkHalves).toBe(0);
  });

  test('the strategies without links draw none', () => {
    for (const strategy of ['fortify', 'weak'] as const) {
      const r = play(strategy, 2, 3);
      expect(
        r.state.team.conduits.some(
          (c) => isBorderEnd(c.from) || isBorderEnd(c.to),
        ),
      ).toBe(false);
    }
  });

  /**
   * What reaches each consumer on the board, read off the flow graph and not
   * off the bot's own rule: every collector upstream of it (through
   * Splitters, over border links) gives its rate divided by the number of
   * consumers it ends up in. Percent of the consumer's need, per consumer.
   */
  function coverageOnBoard(team: TeamState): number[] {
    const graph = buildFlowGraph(team, content);
    const kindOf = new Map(graph.nodes.map((n) => [n.key, n.kind]));
    const into = new Map<string, string[]>();
    const out = new Map<string, string[]>();
    for (const e of graph.edges) {
      into.set(e.to, [...(into.get(e.to) ?? []), e.from]);
      out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
    }
    const reach = (from: string, next: Map<string, string[]>): Set<string> => {
      const seen = new Set<string>();
      const todo = [from];
      for (let k = todo.pop(); k !== undefined; k = todo.pop()) {
        for (const n of next.get(k) ?? []) {
          if (seen.has(n)) continue;
          seen.add(n);
          todo.push(n);
        }
      }
      return seen;
    };
    const result: number[] = [];
    for (const node of graph.nodes) {
      if (node.kind !== 'consumer') continue;
      const b = team.buildings.find((x) => x.id === node.building);
      const def = b === undefined ? undefined : content.buildings.get(b.def);
      if (b === undefined || def === undefined) continue;
      let supply = 0;
      for (const key of reach(node.key, into)) {
        if (kindOf.get(key) !== 'source') continue;
        const src = graph.nodes.find((x) => x.key === key);
        const sb = team.buildings.find((x) => x.id === src?.building);
        const sd = sb === undefined ? undefined : content.buildings.get(sb.def);
        if (sb === undefined || sd === undefined || sd.kind !== 'source') {
          continue;
        }
        const takers = [...reach(key, out)].filter(
          (k) => kindOf.get(k) === 'consumer',
        ).length;
        supply += Math.floor(
          collectorRatePer1000(sd, sb.tier) / Math.max(1, takers),
        );
      }
      result.push(Math.floor((100 * supply) / needPer1000(def, b.tier)));
    }
    return result;
  }

  test('a connecting bot places no consumer its collectors cannot feed', () => {
    for (const strategy of ['rush', 'fortify', 'siege'] as const) {
      let checked = 0;
      for (const seed of [4, 5, 6]) {
        const r = play(strategy, 2, seed);
        for (const cover of coverageOnBoard(r.state.team)) {
          expect(
            cover,
            `${strategy} seed ${String(seed)}`,
          ).toBeGreaterThanOrEqual(20);
          checked++;
        }
      }
      // Not vacuous: consumers were on the boards to be checked.
      expect(checked, strategy).toBeGreaterThan(0);
    }
  }, 300_000);

  test('a rush bot places a Range on some of 12 seeds', () => {
    let placed = 0;
    for (let seed = 1; seed <= 12; seed++) {
      placed += play('rush', 1, seed, 8).state.team.buildings.filter(
        (b) => b.def === 'bld_range',
      ).length;
    }
    expect(placed).toBeGreaterThan(0);
  }, 600_000);

  test('layout places and feeds a Range and a Hangar from their collectors', () => {
    for (const def of ['bld_range', 'bld_hangar']) {
      const team = withStash(['bld_extractor', 'bld_extractor', def]);
      const id = team.stash[2]?.id;
      const plan = planLayout(
        team,
        0,
        content,
        team.map.plotWidth,
        { ...style, priority: [def] },
        Rng.fromSeed(1),
      );
      expect(
        plan.some((i) => i.type === 'place_building' && i.id === id),
        def,
      ).toBe(true);
    }
  });

  // Since the rebalance (#145) every tier-1 consumer needs what one tier-1
  // collector gives and a plot has few nodes, so sharing a collector through
  // a Splitter is how the bot gets past the node count (#178). Over 20 fixed
  // seeds, at least MIN_SPLITTER_SEEDS solo rush runs hold a Splitter with
  // two outputs.
  const MIN_SPLITTER_SEEDS = 17; // measured: 18 (3 before #178)
  test('most solo rush runs share a collector through a two-output Splitter (#178)', () => {
    let seeds = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const team = play('rush', 1, seed).state.team;
      const shares = team.buildings.some(
        (sp) =>
          sp.def === 'bld_splitter' &&
          team.conduits.filter(
            (c) => !isBorderEnd(c.from) && c.from.building === sp.id,
          ).length >= 2,
      );
      if (shares) seeds++;
    }
    expect(seeds).toBeGreaterThanOrEqual(MIN_SPLITTER_SEEDS);
  }, 600_000);

  const style = {
    connect: true,
    walls: true,
    placeLeftovers: true,
    priority: ['bld_barracks', 'bld_armory'],
  };

  /** The party-of-one build state with a clean stash of the given items. */
  function withStash(defs: readonly string[]) {
    const run = placeCoreAll(newRun(makeGameDeps(), ['Ann']), makeGameDeps());
    const base = run.team;
    const stash = defs.map((def, i) => ({
      id: base.nextId + i,
      def,
      tier: 1,
      owner: 0,
    }));
    return {
      ...base,
      buildings: [],
      conduits: [],
      stash,
      nextId: base.nextId + defs.length,
    };
  }

  test('layout leaves a consumer in the stash when one collector cannot feed it enough', () => {
    const team = withStash(['bld_extractor', 'bld_armory']);
    const armory = team.stash[1]?.id;
    // No shipped consumer needs more than four times a tier 1 collector any
    // more (one collector feeds one producer of its tier, #145), so the test
    // makes an Armory that costs ten times as much per step: its need is 500
    // against a supply of 50 (10 percent, under the 20 percent minimum).
    const base = content.buildings.get('bld_armory');
    if (base?.kind !== 'economy') throw new Error('no armory');
    const armoryDef = {
      ...base,
      tiers: base.tiers.map((t) => ({
        ...t,
        costPerStep: 10 * t.costPerStep,
      })),
    } as unknown as typeof base;
    const hungry = {
      ...content,
      buildings: {
        get: (id: BuildingId) =>
          id === 'bld_armory' ? armoryDef : content.buildings.get(id),
        list: () => content.buildings.list(),
      },
    };
    const plan = planLayout(
      team,
      0,
      hungry,
      team.map.plotWidth,
      style,
      Rng.fromSeed(1),
    );
    expect(
      plan.some((i) => i.type === 'place_building' && i.id === armory),
    ).toBe(false);
  });

  test('layout feeds a barracks from one collector', () => {
    const team = withStash(['bld_extractor', 'bld_barracks']);
    const barracks = team.stash[1]?.id;
    const plan = planLayout(
      team,
      0,
      content,
      team.map.plotWidth,
      style,
      Rng.fromSeed(1),
    );
    expect(
      plan.some((i) => i.type === 'place_building' && i.id === barracks),
    ).toBe(true);
    expect(plan.some((i) => i.type === 'add_conduit')).toBe(true);
  });

  test('layout puts one collector and a Splitter in front of two barracks', () => {
    const team = withStash([
      'bld_extractor',
      'bld_splitter',
      'bld_barracks',
      'bld_barracks',
    ]);
    const plan = planLayout(
      team,
      0,
      content,
      team.map.plotWidth,
      style,
      Rng.fromSeed(1),
    );
    expect(plan.filter((i) => i.type === 'place_building')).toHaveLength(4);
    expect(plan.filter((i) => i.type === 'add_conduit')).toHaveLength(3);
  });

  test('layout shares a placed collector with a new consumer and rewires every conduit (#178)', () => {
    const g = makeGameDeps();
    const rng = (): Rng => Rng.fromSeed(1);
    const apply = (state: RunState, intents: readonly Intent[]): RunState =>
      intents.reduce((st, i) => ok(st, 0, i, g).state, state);
    const base = placeCoreAll(newRun(g, ['Ann']), g);
    const first = withStash(['bld_extractor', 'bld_barracks']);
    const lay1 = planLayout(
      first,
      0,
      content,
      first.map.plotWidth,
      style,
      rng(),
    );
    let state = apply({ ...base, team: first }, lay1);
    expect(state.team.conduits).toHaveLength(1);
    const direct = state.team.buildings.find((b) => b.def === 'bld_barracks');
    // A second Barracks and a Splitter arrive; no free collector is left.
    const nextId = state.team.nextId;
    state = {
      ...state,
      team: {
        ...state.team,
        stash: [
          { id: nextId, def: 'bld_splitter', tier: 1, owner: 0 },
          { id: nextId + 1, def: 'bld_barracks', tier: 1, owner: 0 },
        ],
        nextId: nextId + 2,
      },
    };
    const lay2 = planLayout(
      state.team,
      0,
      content,
      state.team.map.plotWidth,
      style,
      rng(),
    );
    expect(
      lay2.some((i) => i.type === 'return_building' && i.id === direct?.id),
    ).toBe(true);
    state = apply(state, lay2);
    const t = state.team;
    expect(t.stash).toHaveLength(0);
    const barracks = t.buildings.filter((b) => b.def === 'bld_barracks');
    expect(barracks).toHaveLength(2);
    // The collector feeds the Splitter; the Splitter feeds both Barracks.
    expect(t.conduits).toHaveLength(3);
    for (const b of barracks) {
      expect(
        t.conduits.some((c) => !isBorderEnd(c.to) && c.to.building === b.id),
        `barracks ${String(b.id)} is fed`,
      ).toBe(true);
    }
  });

  /** The state of the share test just before the second Barracks arrives. */
  function sharePending() {
    const g = makeGameDeps();
    const base = placeCoreAll(newRun(g, ['Ann']), g);
    const first = withStash(['bld_extractor', 'bld_barracks']);
    const lay1 = planLayout(
      first,
      0,
      content,
      first.map.plotWidth,
      style,
      Rng.fromSeed(1),
    );
    let state: RunState = { ...base, team: first };
    for (const i of lay1) state = ok(state, 0, i, g).state;
    const nextId = state.team.nextId;
    return {
      ...state.team,
      stash: [
        { id: nextId, def: 'bld_splitter', tier: 1, owner: 0 },
        { id: nextId + 1, def: 'bld_barracks', tier: 1, owner: 0 },
      ],
      nextId: nextId + 2,
    };
  }

  test('an unrelated border link elsewhere does not stop a share (#178)', () => {
    const team = sharePending();
    const ext = team.buildings.find((b) => b.def === 'bld_extractor');
    if (ext === undefined) throw new Error('no extractor');
    // A half of a link that ends at the extractor: nothing to do with the
    // Barracks that would be taken back.
    const withLink = {
      ...team,
      conduits: [
        ...team.conduits,
        {
          id: 9000,
          owner: 0,
          from: { border: 0, y: 3 },
          to: { building: ext.id, side: 'west' as const },
          cells: [],
        },
      ],
    };
    const lay = planLayout(
      withLink,
      0,
      content,
      withLink.map.plotWidth,
      style,
      Rng.fromSeed(1),
    );
    expect(lay.some((i) => i.type === 'return_building')).toBe(true);
    expect(lay.filter((i) => i.type === 'add_conduit')).toHaveLength(3);
  });

  test('a consumer with another conduit that cannot be rebuilt is left alone (#178)', () => {
    const team = sharePending();
    const barracks = team.buildings.find((b) => b.def === 'bld_barracks');
    const ext = team.buildings.find((b) => b.def === 'bld_extractor');
    if (barracks === undefined || ext === undefined) throw new Error('setup');
    // A second collector also feeds the Barracks, on a side it has no input
    // on: taking the Barracks back would drop that conduit for good.
    const second = { ...ext, id: 9100, x: ext.x + 4 };
    const withSecond = {
      ...team,
      buildings: [...team.buildings, second],
      conduits: [
        ...team.conduits,
        {
          id: 9001,
          owner: 0,
          from: { building: second.id, side: 'north' as const },
          to: { building: barracks.id, side: 'west' as const },
          cells: [],
        },
      ],
    };
    const lay = planLayout(
      withSecond,
      0,
      content,
      withSecond.map.plotWidth,
      style,
      Rng.fromSeed(1),
    );
    expect(lay.some((i) => i.type === 'return_building')).toBe(false);
  });

  test('feeds checks the collector being split, not the best one owned (#178)', () => {
    // An Armory that costs three times as much per step: need 150 per 1000
    // ticks. Two halves of a tier 3 collector (100) cover 33 percent of it,
    // two halves of a tier 1 collector (50) only 16 (under the 20 minimum).
    const base = content.buildings.get('bld_armory');
    if (base?.kind !== 'economy') throw new Error('no armory');
    const armoryDef = {
      ...base,
      tiers: base.tiers.map((t) => ({ ...t, costPerStep: 3 * t.costPerStep })),
    } as unknown as typeof base;
    const hungry = {
      ...content,
      buildings: {
        get: (id: BuildingId) =>
          id === 'bld_armory' ? armoryDef : content.buildings.get(id),
        list: () => content.buildings.list(),
      },
    };
    const team = withStash(['bld_extractor', 'bld_armory']);
    const owned = {
      ...team,
      stash: [
        ...team.stash,
        { id: 99, def: 'bld_extractor', tier: 3, owner: 0 },
      ],
    };
    const env = makeEnv(
      owned,
      0,
      hungry,
      owned.map.plotWidth,
      style,
      Rng.fromSeed(1),
    );
    const armory = { def: 'bld_armory', tier: 1 };
    const strong = { def: 'bld_extractor', tier: 3 };
    const weak = { def: 'bld_extractor', tier: 1 };
    // Asked of the collector being used: a strong one in the stash does not
    // help a consumer that is to be fed by the weak one.
    expect(feeds(env, armory, 2, strong)).toBe(true);
    expect(feeds(env, armory, 2, weak)).toBe(false);
    expect(feeds(env, armory, 1, weak)).toBe(true);
  });
});
