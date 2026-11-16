/**
 * Rich vein (RS-4i4): availability by round and by free cells, the offer's
 * resource, the per-player cell follow-up (legal and illegal cells, stale
 * picks dropped as skips), 1 to 4 players through save and reload, the
 * run-state check, and ghost validation of a team that holds added nodes.
 */
import { describe, expect, test } from 'vitest';
import {
  Rng,
  addNode,
  addableNodeCells,
  allNodes,
  canonicalJson,
  validateGhostSnapshot,
  type GhostSnapshot,
  type TeamState,
} from '@game/core';
import { fixedBattle } from './defaults.js';
import { RICH_VEIN_PROMPT, eventHooks, richVeinChoice } from './events.js';
import { createGameDeps } from './game-deps.js';
import { ghostContext } from './ghosts.js';
import { applyIntent, createRun } from './machine.js';
import { botRun } from '../testing/ghost-test-support.js';
import {
  content,
  gameConfigs,
  makeGameDeps,
  mapgenConfig,
  placeCoreAll,
  readyAll,
  runArgs,
  voteAll,
} from '../testing/test-support.js';
import type { CreateRunArgs, Json, RunDeps, RunState } from './types.js';
import { validateRunState } from './validate.js';

const deps: RunDeps = createGameDeps(content, gameConfigs, {
  battle: fixedBattle(true),
});
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
type Opt = Record<string, Json>;
type Offer = { type: string; id: string; [k: string]: Json | undefined };
const pend = (s: RunState) => s.pending as Record<string, Json>;
const followUp = (s: RunState) => pend(s)['followUp'] as Record<string, Json>;
const cellsOf = (s: RunState, p: number): [number, number][] =>
  ((followUp(s)['options'] as Opt[]).find((o) => o['player'] === p)?.[
    'cells'
  ] ?? []) as [number, number][];
const choose = (s: RunState, p: number, choice: string) =>
  applyIntent(s, p, { type: 'event_choose', choice }, deps);
const hooks = eventHooks(content, gameConfigs.events, undefined, mapgenConfig);
const offersAt = (s: RunState, round: number, seed: number): Offer[] =>
  hooks.eventOffers({ ...s, round }, Rng.fromSeed(seed)) as unknown as Offer[];

function atEvents(players: readonly string[]): RunState {
  const r = createRun(runArgs(players, 7), deps);
  if (!r.ok) throw new Error(r.detail);
  let s = placeCoreAll(r.state, deps);
  for (let i = 0; i < 20 && s.step !== 'event_choice'; i++) {
    s = s.step === 'pve_choice' ? voteAll(s, 'easy', deps) : readyAll(s, deps);
  }
  return s;
}

/** The event step with a Rich vein of `resource` and a Windfall on offer, taken. */
function veinStep(players: readonly string[], resource = 'res_b'): RunState {
  const s = atEvents(players);
  const forced: RunState = {
    ...s,
    pending: {
      options: [
        {
          id: 'evt_rich_vein',
          event: 'evt_rich_vein',
          type: 'rich_vein',
          resource,
        },
        {
          id: 'evt_windfall',
          event: 'evt_windfall',
          type: 'windfall',
          gold: 4,
        },
      ],
    },
  };
  return voteAll(forced, 'evt_rich_vein', deps);
}

const withTeam = (s: RunState, team: TeamState): RunState => ({ ...s, team });
function fill(team: TeamState, owner: number, n: number): TeamState {
  let t = team;
  for (let i = 0; i < n; i++) {
    const c = addableNodeCells(t, content, mapgenConfig, owner)[i * 7];
    if (c === undefined) throw new Error('no cell');
    const r = addNode(t, content, mapgenConfig, {
      owner,
      x: c.x,
      y: c.y,
      resource: 'res_a',
      round: 3,
    });
    if (!r.ok) throw new Error(r.reason);
    t = r.state;
  }
  return t;
}

describe('Rich vein: definition and availability', () => {
  const s = atEvents(['Ann']);

  test('the definition is from round 3 and weights Ore and Power over Flux', () => {
    const d = gameConfigs.events.events.find((e) => e.id === 'evt_rich_vein');
    expect(d).toMatchObject({
      type: 'rich_vein',
      fromRound: 3,
      resourceWeights: { res_a: 3, res_b: 3, res_c: 1 },
    });
  });

  test('never offered before round 3, offered from round 3', () => {
    const seen = (round: number) =>
      Array.from({ length: 40 }, (_, i) => i + 1).some((seed) =>
        offersAt(s, round, seed).some((o) => o.type === 'rich_vein'),
      );
    expect(seen(1)).toBe(false);
    expect(seen(2)).toBe(false);
    expect(seen(3)).toBe(true);
  });

  test('not offered when hooks have no map rules', () => {
    const bare = eventHooks(content, gameConfigs.events);
    for (let seed = 1; seed <= 40; seed++) {
      const o = bare.eventOffers({ ...s, round: 5 }, Rng.fromSeed(seed));
      expect(
        (o as unknown as Offer[]).some((x) => x.type === 'rich_vein'),
      ).toBe(false);
    }
  });

  test('not offered when every player is at the cap', () => {
    const full = withTeam(
      s,
      fill(s.team, 0, mapgenConfig.maxAddedNodesPerPlot),
    );
    for (let seed = 1; seed <= 60; seed++) {
      expect(offersAt(full, 5, seed).some((o) => o.type === 'rich_vein')).toBe(
        false,
      );
    }
  });

  test('offered while only one of two players is at the cap', () => {
    const two = atEvents(['Ann', 'Bo']);
    const half = withTeam(
      two,
      fill(two.team, 0, mapgenConfig.maxAddedNodesPerPlot),
    );
    expect(
      Array.from({ length: 60 }, (_, i) => i + 1).some((seed) =>
        offersAt(half, 5, seed).some((o) => o.type === 'rich_vein'),
      ),
    ).toBe(true);
  });

  test('the offer names a base resource with weight, the same on every draw of a seed', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) {
      const o = offersAt(s, 5, seed).find((x) => x.type === 'rich_vein');
      if (o === undefined) continue;
      seen.add(o['resource'] as string);
      expect(offersAt(s, 5, seed)).toEqual(offersAt(s, 5, seed));
    }
    expect([...seen].sort()).toEqual(['res_a', 'res_b', 'res_c']);
  });

  test('other events keep their offers on the same stream (no other stream moves)', () => {
    // Windfall data is drawn from its own child stream, so adding a Rich vein
    // to the pool changes which events are picked, never what one holds.
    for (let seed = 1; seed <= 30; seed++) {
      const w = offersAt(s, 5, seed).find((x) => x.type === 'windfall');
      if (w !== undefined) expect(w['gold']).toBe(4);
    }
  });
});

describe('Rich vein: the follow-up', () => {
  test('one option per player with their legal cells, all of them in their own plot', () => {
    const s = veinStep(['Ann', 'Bo']);
    expect(s.step).toBe('event_resolve');
    const fu = followUp(s);
    expect(fu['prompt']).toBe(RICH_VEIN_PROMPT);
    expect(fu['perPlayer']).toBe(true);
    expect((pend(s)['offer'] as Opt)['resource']).toBe('res_b');
    for (const p of [0, 1]) {
      const legal = addableNodeCells(s.team, content, mapgenConfig, p);
      expect(cellsOf(s, p)).toEqual(legal.map((c) => [c.x, c.y]));
      for (const [x] of cellsOf(s, p)) {
        expect(Math.floor(x / s.team.map.plotWidth)).toBe(p);
      }
    }
    expect(validateRunState(clone(s), deps).ok).toBe(true);
  });

  test('a player with no legal cell starts on skip', () => {
    const base = atEvents(['Ann', 'Bo']);
    const full = withTeam(
      base,
      fill(base.team, 1, mapgenConfig.maxAddedNodesPerPlot),
    );
    const forced: RunState = {
      ...full,
      pending: {
        options: [
          {
            id: 'evt_rich_vein',
            event: 'evt_rich_vein',
            type: 'rich_vein',
            resource: 'res_a',
          },
        ],
      },
    };
    const s = voteAll(forced, 'evt_rich_vein', deps);
    expect(s.step).toBe('event_resolve');
    expect(followUp(s)['votes']).toEqual([null, 'skip']);
    expect((followUp(s)['options'] as Opt[]).map((o) => o['player'])).toEqual([
      0,
    ]);
  });

  test('nobody has a cell: the step is skipped and nothing is added', () => {
    const base = atEvents(['Ann']);
    const full = withTeam(
      base,
      fill(base.team, 0, mapgenConfig.maxAddedNodesPerPlot),
    );
    const forced: RunState = {
      ...full,
      pending: {
        options: [
          {
            id: 'evt_rich_vein',
            event: 'evt_rich_vein',
            type: 'rich_vein',
            resource: 'res_a',
          },
        ],
      },
    };
    const s = voteAll(forced, 'evt_rich_vein', deps);
    expect(s.step).not.toBe('event_resolve');
    expect(s.team.addedNodes).toHaveLength(mapgenConfig.maxAddedNodesPerPlot);
  });

  test('illegal cells are refused with a reason', () => {
    const s = veinStep(['Ann', 'Bo']);
    const w = s.team.map.plotWidth;
    const front = richVeinChoice(1, s.team.map.height - 1);
    const feature = s.team.map.features.find((f) => f.x < w);
    const node = s.team.map.nodes.find((n) => n.x < w);
    const other = cellsOf(s, 1)[0] ?? [w, 0];
    const cases: [string, string, string][] = [
      ['front row', front, 'front_row'],
      [
        'feature',
        richVeinChoice(feature?.x ?? 0, feature?.y ?? 0),
        'blocked_by_feature',
      ],
      [
        'generated node',
        richVeinChoice(node?.x ?? 0, node?.y ?? 0),
        'node_here',
      ],
      ['other plot', richVeinChoice(other[0], other[1]), 'outside_own_plot'],
      ['off the board', richVeinChoice(900, 2), 'out_of_bounds'],
    ];
    for (const [name, choice, reason] of cases) {
      const r = choose(s, 0, choice);
      expect(r.ok, name).toBe(false);
      if (!r.ok) expect(r.reason, name).toBe(reason);
    }
    for (const bad of ['c1', 'c-1_2', 'cx_y', 'b1', '']) {
      const r = choose(s, 0, bad);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.reason).toBe('invalid_choice');
    }
  });

  test('the choice is stored and can be changed until the last player chooses', () => {
    const s = veinStep(['Ann', 'Bo']);
    const [a, b] = cellsOf(s, 0);
    const r1 = choose(s, 0, richVeinChoice(a?.[0] ?? 0, a?.[1] ?? 0));
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.state.step).toBe('event_resolve');
    expect(r1.state.team.addedNodes).toBeUndefined();
    expect(validateRunState(clone(r1.state), deps).ok).toBe(true);
    const r2 = choose(r1.state, 0, richVeinChoice(b?.[0] ?? 0, b?.[1] ?? 0));
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    const r3 = choose(r2.state, 1, 'skip');
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;
    expect(r3.state.team.addedNodes).toEqual([
      { x: b?.[0], y: b?.[1], resource: 'res_b', owner: 0, round: 1 },
    ]);
  });

  test('a stored pick that is no longer legal is applied as a skip', () => {
    const s = veinStep(['Ann', 'Bo']);
    const [a] = cellsOf(s, 0);
    const r1 = choose(s, 0, richVeinChoice(a?.[0] ?? 0, a?.[1] ?? 0));
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    // A wall appears on the chosen cell before the last choice lands.
    const stash = clone(r1.state.team);
    const withWall = {
      ...stash,
      buildings: [
        ...stash.buildings,
        {
          id: stash.nextId,
          def: 'bld_wall_block',
          tier: 1,
          x: a?.[0] ?? 0,
          y: a?.[1] ?? 0,
          rotation: 0 as const,
          owner: 0,
        },
      ],
      nextId: stash.nextId + 1,
    };
    const r2 = choose(clone({ ...r1.state, team: withWall }), 1, 'skip');
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.state.team.addedNodes).toBeUndefined();
    const fx = r2.effects.find(
      (e) => e.type === 'custom' && e.name === 'event_resolved',
    ) as unknown as { data: { applied: Opt[] } };
    expect(fx.data.applied[0]).toMatchObject({
      player: 0,
      result: 'skip',
      dropped: true,
      reason: 'overlaps_building',
    });
  });

  test('a forged follow-up with an illegal cell is rejected by validateRunState', () => {
    const s = veinStep(['Ann']);
    const bad = clone(s);
    const opt = (followUp(bad)['options'] as Opt[])[0] as Opt;
    (opt['cells'] as Json[]).push([0, s.team.map.height - 1]);
    expect(validateRunState(bad, deps).ok).toBe(false);
    const forgedVote = clone(s);
    (followUp(forgedVote)['votes'] as Json[])[0] = richVeinChoice(
      0,
      s.team.map.height - 1,
    );
    expect(validateRunState(forgedVote, deps).ok).toBe(false);
  });

  test.each([1, 2, 3, 4])(
    '%i player(s): each adds a node to their own plot, through save and reload',
    (n) => {
      const names = ['Ann', 'Bo', 'Cy', 'Di'].slice(0, n);
      let s = veinStep(names, 'res_c');
      const picks: [number, number][] = [];
      for (let p = 0; p < n; p++) {
        const c = cellsOf(s, p)[5] as [number, number];
        picks.push(c);
        const r = choose(clone(s), p, richVeinChoice(c[0], c[1]));
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        s = clone(r.state);
        expect(validateRunState(s, deps).ok).toBe(true);
      }
      expect(s.step).not.toBe('event_resolve');
      expect(s.team.addedNodes).toEqual(
        picks.map((c, p) => ({
          x: c[0],
          y: c[1],
          resource: 'res_c',
          owner: p,
          round: 1,
        })),
      );
      for (const [x, y] of picks) {
        expect(allNodes(s.team).filter((m) => m.x === x && m.y === y)).toEqual([
          { x, y, resource: 'res_c' },
        ]);
      }
      expect(validateRunState(clone(s), deps).ok).toBe(true);
      expect(canonicalJson(clone(s).team)).toBe(canonicalJson(s.team));
    },
  );

  test('skipping everywhere leaves the team (and its hash) unchanged', () => {
    const before = atEvents(['Ann', 'Bo']);
    let s = veinStep(['Ann', 'Bo']);
    for (const p of [0, 1]) {
      const r = choose(s, p, 'skip');
      if (!r.ok) throw new Error(r.reason);
      s = r.state;
    }
    expect('addedNodes' in s.team).toBe(false);
    expect(s.team).toEqual(before.team);
  });
});

describe('Rich vein: ghosts', () => {
  const RULES = { startingLives: 99, pvpLossLifeCost: 1 };
  const ghostRunDeps = makeGameDeps({
    ghosts: { ownerId: 'dev-a' },
    battle: fixedBattle(true),
    rules: RULES,
  });
  const args: CreateRunArgs = {
    runId: 'vein-ghost',
    runVersion: '0.1',
    seed: 7,
    players: ['A'],
    host: 0,
  };
  const run = botRun(
    ghostRunDeps,
    args,
    1,
    (st) => st.round >= 4 && st.step === 'pvp_summary',
  );
  const good = run.snapshots.find((x) => x.round === 4) as GhostSnapshot;
  const ctx = ghostContext(ghostRunDeps);
  if (ctx === null) throw new Error('ghosts are on');
  const withNodes = (
    nodes: Record<string, unknown>[],
    round = good.round,
  ): unknown => ({
    ...clone(good),
    round,
    team: { ...clone(good).team, addedNodes: nodes },
  });
  const legal = addableNodeCells(good.team, content, mapgenConfig, 0);
  const node = (i: number, extra: Record<string, unknown> = {}) => ({
    x: legal[i]?.x,
    y: legal[i]?.y,
    resource: 'res_a',
    owner: 0,
    round: 3,
    ...extra,
  });

  test('the control snapshot validates, with and without valid added nodes', () => {
    expect(validateGhostSnapshot(clone(good), ctx).ok).toBe(true);
    const r = validateGhostSnapshot(withNodes([node(0), node(9)]), ctx);
    expect(r.ok).toBe(true);
  });

  test('a node outside the rules is rejected', () => {
    const feature = good.team.map.features[0];
    const bads: [string, unknown][] = [
      ['on a feature', withNodes([node(0, { x: feature?.x, y: feature?.y })])],
      [
        'on the front row',
        withNodes([node(0, { y: good.team.map.height - 1 })]),
      ],
      ['over the cap', withNodes([0, 5, 11, 17].map((i) => node(i)))],
      [
        'from a round before Rich vein exists',
        withNodes([node(0, { round: 2 })]),
      ],
      ['from a round after the snapshot', withNodes([node(0, { round: 5 })])],
      [
        'a refined resource',
        withNodes([node(0, { resource: 'res_ab_refined' })]),
      ],
    ];
    for (const [name, snap] of bads) {
      expect(validateGhostSnapshot(snap, ctx).ok, name).toBe(false);
    }
  });

  test('a forged map is still rejected, added nodes or not', () => {
    const forged = clone(good) as unknown as {
      team: { map: { nodes: unknown[] } };
    };
    forged.team.map.nodes.pop();
    expect(validateGhostSnapshot(forged, ctx).ok).toBe(false);
    const hidden = clone(good) as unknown as {
      team: { map: { nodes: unknown[] } };
    };
    // A node smuggled into the map itself instead of `addedNodes`.
    hidden.team.map.nodes.push({
      x: legal[0]?.x,
      y: legal[0]?.y,
      resource: 'res_a',
    });
    expect(validateGhostSnapshot(hidden, ctx).ok).toBe(false);
  });

  test('without a Rich vein event in content, added nodes are refused', () => {
    const noVein = {
      ...ctx,
      events: {
        ...ctx.events,
        events: ctx.events.events.filter((e) => e.type !== 'rich_vein'),
      },
    };
    expect(validateGhostSnapshot(withNodes([node(0)]), noVein).ok).toBe(false);
  });
});
