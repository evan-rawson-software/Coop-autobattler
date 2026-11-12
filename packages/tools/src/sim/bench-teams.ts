/**
 * Teams for the performance benchmark: a dense four-plot board that is the
 * stress case of docs/performance-budget.md. Built with the ordinary team
 * state operations on a hand-made flat map (no terrain), 96 x 16 cells.
 */
import {
  addConduit,
  addToStash,
  createTeamState,
  placeCore,
  placeFromStash,
  corePlayerAt,
  type GameMap,
  type Side,
  type TeamState,
} from '@game/core';
import type { SimContext } from './context.js';

/**
 * 48 modules of an extractor, a splitter and two barracks each (96 barracks,
 * 48 sources), Core at (40, 6); every building but the splitters has `tier`.
 */
export function denseFourPlotTeam(ctx: SimContext, tier: number): TeamState {
  const nodes: { x: number; y: number; resource: string }[] = [];
  for (let col = 0; col < 24; col++) {
    for (const y0 of [0, 8])
      nodes.push({ x: col * 4, y: y0, resource: 'res_a' });
  }
  const map: GameMap = {
    width: 96,
    height: 16,
    partySize: 4,
    plotWidth: 24,
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
    const owner = Math.floor(x / 24);
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
      const a = put('bld_barracks', x0, y0 + 4);
      const b = put('bld_barracks', x0 + 2, y0 + 2, 90);
      link(src, 'north', sp, 'south', [
        [x0, y0 + 1],
        [x0, y0 + 2],
      ]);
      link(sp, 'north', a, 'south');
      link(sp, 'east', b, 'west', [[x0 + 1, y0 + 3]]);
    }
  }
  const c = placeCore(
    state,
    ctx.content,
    ctx.mapgen,
    corePlayerAt(state.map, ctx.content, 40),
    { x: 40, y: 6 },
  );
  if (!c.ok) return fail('core', c.reason);
  return c.state;
}
