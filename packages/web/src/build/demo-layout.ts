/**
 * A ready-made layout with both refining chains and a Foundry, for the Build
 * screen's dev strip and the smoke test (issue #385). It only proposes: every
 * placement and conduit goes through `core` (`previewPlace`, `previewConduit`)
 * and is kept only when `core` accepts it, so a map with no room leaves some
 * chains out instead of breaking anything.
 */
import {
  allNodes,
  addToStash,
  createTeamState,
  generateMap,
  listLegalCorePositions,
  placeCore,
  type Cell,
  type ConduitEnd,
  type KitEntry,
  type Side,
  type TeamState,
} from '@game/core';
import type { WebContent } from '../content.js';
import { proposePath } from './autoroute.js';
import { previewConduit, previewPlace } from './ops.js';
import type { LayoutAction } from './undo.js';

/** What the demo needs in the stash: one collector per input, and the buildings. */
export const REFINING_DEMO_KIT: readonly KitEntry[] = [
  { def: 'bld_extractor', tier: 1, count: 6 },
  { def: 'bld_refinery_ab', tier: 1, count: 1 },
  { def: 'bld_refinery_bc', tier: 1, count: 1 },
  { def: 'bld_golem_forge', tier: 1, count: 1 },
  { def: 'bld_spire', tier: 1, count: 1 },
  { def: 'bld_foundry', tier: 1, count: 1 },
];

interface Chain {
  /** The consumer, and the resource each of its input sides takes. */
  readonly def: string;
  readonly south: string;
  readonly west: string;
  /** What it feeds: a building that takes its output, placed to its north. */
  readonly then: string | null;
}

const CHAINS: readonly Chain[] = [
  {
    def: 'bld_refinery_ab',
    south: 'res_a',
    west: 'res_b',
    then: 'bld_golem_forge',
  },
  { def: 'bld_refinery_bc', south: 'res_b', west: 'res_c', then: 'bld_spire' },
  { def: 'bld_foundry', south: 'res_a', west: 'res_b', then: null },
];

interface Planned {
  readonly team: TeamState;
  readonly actions: readonly LayoutAction[];
}

const dist = (a: Cell, b: Cell): number =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

function stashId(
  team: TeamState,
  def: string,
  used: Set<number>,
): number | null {
  const s = team.stash.find((x) => x.def === def && !used.has(x.id));
  return s === undefined ? null : s.id;
}

/**
 * Try to place `def` at `at` with its inputs fed from collectors on nodes of
 * the right resources; the new state and actions, or null when `core` refuses
 * a step (so the caller can try another spot).
 */
function tryChain(
  team: TeamState,
  content: WebContent,
  chain: Chain,
  at: Cell,
  usedNodes: Set<string>,
  usedStash: Set<number>,
): (Planned & { id: number; nodes: string[]; stash: number[] }) | null {
  const actions: LayoutAction[] = [];
  const stash: number[] = [];
  const nodes: string[] = [];
  let state = team;
  const id = stashId(team, chain.def, usedStash);
  if (id === null) return null;
  stash.push(id);
  const put = (sid: number, x: number, y: number): boolean => {
    const v = previewPlace(state, content, { id: sid, x, y, rotation: 0 }, 0);
    if (!v.ok) return false;
    state = v.state;
    actions.push({ t: 'place', id: sid, x, y, rotation: 0 });
    return true;
  };
  if (!put(id, at.x, at.y)) return null;
  const inputs: readonly [Side, string][] = [
    ['south', chain.south],
    ['west', chain.west],
  ];
  for (const [side, resource] of inputs) {
    const free = allNodes(state)
      .filter(
        (n) =>
          n.resource === resource &&
          !usedNodes.has(`${String(n.x)},${String(n.y)}`) &&
          !nodes.includes(`${String(n.x)},${String(n.y)}`),
      )
      .sort((a, b) => dist(a, at) - dist(b, at) || a.x - b.x || a.y - b.y);
    let done = false;
    for (const node of free.slice(0, 3)) {
      const sid = stashId(
        team,
        'bld_extractor',
        new Set([...usedStash, ...stash]),
      );
      if (sid === null) return null;
      const before = state;
      const beforeActions = actions.length;
      if (put(sid, node.x, node.y)) {
        const from: ConduitEnd = { building: sid, side: 'north' };
        const to: ConduitEnd = { building: id, side };
        const cells = proposePath(state, content, from, to, [], 0);
        const v =
          cells === null
            ? null
            : previewConduit(state, content, from, to, cells, 0);
        if (v?.ok === true && cells !== null) {
          state = v.state;
          actions.push({ t: 'add', from, to, cells });
          stash.push(sid);
          nodes.push(`${String(node.x)},${String(node.y)}`);
          done = true;
          break;
        }
      }
      state = before;
      actions.length = beforeActions;
    }
    if (!done) return null;
  }
  return { team: state, actions, id, nodes, stash };
}

/**
 * Plan the demo on a team whose Core is placed and whose stash holds
 * `REFINING_DEMO_KIT`: the actions to apply, in order, and the resulting team.
 * Chains that cannot be fitted are left out.
 */
export function planRefiningDemo(
  team: TeamState,
  content: WebContent,
): Planned {
  let state = team;
  const actions: LayoutAction[] = [];
  const usedNodes = new Set<string>();
  const usedStash = new Set<number>();
  const centre: Cell = {
    x: Math.floor(team.map.width / 2),
    y: Math.floor(team.map.height / 2),
  };
  for (const chain of CHAINS) {
    const spots: Cell[] = [];
    for (let y = 2; y < state.map.height - 4; y++) {
      for (let x = 2; x < state.map.width - 2; x++) spots.push({ x, y });
    }
    spots.sort((a, b) => dist(a, centre) - dist(b, centre) || a.y - b.y);
    for (const at of spots.slice(0, 160)) {
      const got = tryChain(state, content, chain, at, usedNodes, usedStash);
      if (got === null) continue;
      let next = got;
      const extra: LayoutAction[] = [...got.actions];
      let forge: number[] = [];
      if (chain.then !== null) {
        const fid = stashId(
          got.team,
          chain.then,
          new Set([...usedStash, ...got.stash]),
        );
        const placed = fid;
        if (placed === null) continue;
        let done = false;
        for (let dy = 3; dy <= 6 && !done; dy++) {
          for (const dx of [0, -1, 1, -2, 2]) {
            const v = previewPlace(
              got.team,
              content,
              { id: placed, x: at.x + dx, y: at.y + dy, rotation: 0 },
              0,
            );
            if (!v.ok) continue;
            const from: ConduitEnd = { building: got.id, side: 'north' };
            const to: ConduitEnd = { building: placed, side: 'south' };
            const cells = proposePath(v.state, content, from, to, [], 0);
            const c =
              cells === null
                ? null
                : previewConduit(v.state, content, from, to, cells, 0);
            if (c?.ok === true && cells !== null) {
              next = { ...got, team: c.state };
              extra.push(
                {
                  t: 'place',
                  id: placed,
                  x: at.x + dx,
                  y: at.y + dy,
                  rotation: 0,
                },
                { t: 'add', from, to, cells },
              );
              forge = [placed];
              done = true;
              break;
            }
          }
        }
        if (!done) continue;
      }
      state = next.team;
      actions.push(...extra);
      for (const n of got.nodes) usedNodes.add(n);
      for (const s of [...got.stash, ...forge]) usedStash.add(s);
      break;
    }
  }
  return { team: state, actions };
}

/**
 * The demo as a finished team, built without a run (the battle sample route
 * `#battle?p=refine`): a generated map, the kit, a Core and the planned layout.
 */
export function refiningDemoTeam(seed: number, content: WebContent): TeamState {
  let team = createTeamState(generateMap(seed, 1, content, content.mapgen));
  for (const e of REFINING_DEMO_KIT) {
    for (let i = 0; i < e.count; i++) {
      const r = addToStash(team, content, {
        def: e.def ?? '',
        tier: e.tier,
        owner: 0,
      });
      if (r.ok) team = r.state;
    }
  }
  const pos = listLegalCorePositions(team.map, content, content.mapgen, 0)[0];
  if (pos !== undefined) {
    const r = placeCore(team, content, content.mapgen, 0, pos);
    if (r.ok) team = r.state;
  }
  return planRefiningDemo(team, content).team;
}
