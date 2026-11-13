/**
 * Teams for the performance benchmark (docs/performance-budget.md): the
 * legal dense four-plot board (`legalDenseTeam`, a board a party could build)
 * and the stress board (`denseFourPlotTeam`, which no party could build).
 * Both use the ordinary team state operations.
 */
import {
  addConduit,
  addToStash,
  createTeamState,
  generateMap,
  placeCore,
  placeFromStash,
  type GameMap,
  type Side,
  type TeamState,
} from '@game/core';
import type { SimContext } from './context.js';
import {
  STAGE_MAP_SEED,
  fillStagePlot,
  stageCore,
  stageSpec,
  type StageBoardName,
} from './stage-command.js';

/**
 * The legal dense four-plot board: every plot is a copy of the `full1` or
 * `full3` board of `pnpm sim stage` (all three Ore and all three Power nodes
 * of the plot used, one consumer per collector: 3 Barracks, 3 turrets, 7
 * walls), with a Core in every plot. The map is the generated map of seed 5
 * (plot 24 x 16, 3 Ore, 3 Power and 1 Flux node, no Flux consumer on the stage
 * boards) repeated four times side by side, so each plot is exactly the stage
 * plot and the party has four players with a Core each.
 */
export function legalDenseTeam(ctx: SimContext, tier: 1 | 3): TeamState {
  const name: StageBoardName = tier === 1 ? 'full1' : 'full3';
  const spec = stageSpec(name);
  const solo = generateMap(STAGE_MAP_SEED, 1, ctx.content, ctx.mapgen);
  const w = solo.plotWidth;
  const map: GameMap = {
    width: w * 4,
    height: solo.height,
    partySize: 4,
    plotWidth: w,
    features: [0, 1, 2, 3]
      .flatMap((p) => solo.features.map((f) => ({ ...f, x: f.x + p * w })))
      .sort((a, b) => a.y - b.y || a.x - b.x),
    nodes: [0, 1, 2, 3]
      .flatMap((p) => solo.nodes.map((n) => ({ ...n, x: n.x + p * w })))
      .sort((a, b) => a.y - b.y || a.x - b.x),
  };
  const core = stageCore(ctx);
  let state = createTeamState(map);
  for (let p = 0; p < 4; p++) {
    const c = placeCore(state, ctx.content, ctx.mapgen, p, {
      x: core.x + p * w,
      y: core.y,
    });
    if (!c.ok)
      throw new Error(`legal dense team: core ${String(p)}: ${c.reason}`);
    state = fillStagePlot(
      ctx,
      c.state,
      spec,
      p,
      p * w,
      `legal dense team plot ${String(p)}`,
    ).state;
  }
  return state;
}

/**
 * STRESS BOARD, not buildable by a player: 48 modules of an extractor, a
 * splitter and two barracks each (96 barracks, 48 sources, on a hand-made flat
 * 96 x 16 map with 48 Ore nodes, where a real plot has 3 Ore and 3 Power).
 * Every building but the splitters has `tier`. `producer` swaps the Barracks
 * for another 2x2 unit producer (for example `bld_range`). `cores` is 4 (the
 * default: a party of four, a Core per plot at (24 p + 16, 6)) or 1 (a party of one
 * that owns the whole map and has one Core, to compare the per-Core field cost).
 */
export function denseFourPlotTeam(
  ctx: SimContext,
  tier: number,
  producer = 'bld_barracks',
  cores: 1 | 4 = 4,
): TeamState {
  const nodes: { x: number; y: number; resource: string }[] = [];
  for (let col = 0; col < 24; col++) {
    for (const y0 of [0, 8])
      nodes.push({ x: col * 4, y: y0, resource: 'res_a' });
  }
  const map: GameMap = {
    width: 96,
    height: 16,
    partySize: cores,
    plotWidth: 96 / cores,
    features: [],
    nodes: nodes.sort((p, q) => p.y - q.y || p.x - q.x),
  };
  let state = createTeamState(map);
  const fail = (what: string, reason: string): never => {
    throw new Error(`dense team: ${what}: ${reason}`);
  };
  const put = (def: string, x: number, y: number, rotation = 0): number => {
    const t = def === 'bld_splitter' ? 1 : tier;
    // The board's four plots are 24 columns wide; owner = plot of the cell.
    const owner = Math.floor(x / (96 / cores));
    const s = addToStash(state, ctx.content, { def, tier: t, owner });
    if (!s.ok) return fail(def, s.reason);
    const p = placeFromStash(s.state, ctx.content, {
      actor: owner,
      id: s.id,
      x,
      y,
      rotation,
    });
    if (!p.ok) return fail(def, p.reason);
    state = p.state;
    return s.id;
  };
  const link = (
    from: number,
    fromSide: Side,
    to: number,
    toSide: Side,
    cells: readonly (readonly [number, number])[] = [],
  ): void => {
    const r = addConduit(state, ctx.content, {
      actor: state.buildings.find((b) => b.id === from)?.owner ?? 0,
      from: { building: from, side: fromSide },
      to: { building: to, side: toSide },
      cells: cells.map(([x, y]) => ({ x, y })),
    });
    if (!r.ok) return fail('conduit', r.reason);
    state = r.state;
  };
  for (let col = 0; col < 24; col++) {
    for (const y0 of [0, 8]) {
      const x0 = col * 4;
      const src = put('bld_extractor', x0, y0);
      const sp = put('bld_splitter', x0, y0 + 3);
      const a = put(producer, x0, y0 + 4);
      const b = put(producer, x0 + 2, y0 + 2, 90);
      link(src, 'north', sp, 'south', [
        [x0, y0 + 1],
        [x0, y0 + 2],
      ]);
      link(sp, 'north', a, 'south');
      link(sp, 'east', b, 'west', [[x0 + 1, y0 + 3]]);
    }
  }
  // A Core per player, at the same spot of each plot.
  for (let p = 0; p < cores; p++) {
    const c = placeCore(state, ctx.content, ctx.mapgen, p, {
      x: p * 24 + 16,
      y: 6,
    });
    if (!c.ok) return fail('core', c.reason);
    state = c.state;
  }
  return state;
}
