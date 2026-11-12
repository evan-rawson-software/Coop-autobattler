/**
 * A sample team state for the debug screen. Every placement goes through
 * `core`: this helper only proposes positions and keeps whatever `core`
 * accepts, skipping the rest. Best effort by design.
 */

import {
  ROTATIONS,
  Rng,
  addConduit,
  addToStash,
  createTeamState,
  corePlayerAt,
  listLegalCorePositionsAnyPlot,
  occupancy,
  placeCore,
  placeFromStash,
  queryMap,
  type BuildingDef,
  type GameMap,
  type PlacedBuilding,
  type Side,
  type TeamState,
} from '@game/core';
import type { WebContent } from './content.js';

export interface SampleOptions {
  /** Many more buildings and conduits, for performance checks. */
  readonly dense?: boolean;
}

type Cell = { x: number; y: number };

const STEP: Readonly<Record<Side, Cell>> = {
  north: { x: 0, y: 1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: -1 },
  west: { x: -1, y: 0 },
};

/** The cells just outside a building on one side (one per edge cell). */
function outsideCells(cells: readonly Cell[], side: Side): Cell[] {
  const have = new Set(cells.map((c) => `${String(c.x)},${String(c.y)}`));
  const step = STEP[side];
  const out: Cell[] = [];
  for (const c of cells) {
    const n = { x: c.x + step.x, y: c.y + step.y };
    if (!have.has(`${String(n.x)},${String(n.y)}`)) out.push(n);
  }
  return out;
}

function line(a: Cell, b: Cell): Cell[] {
  const out: Cell[] = [];
  const dx = Math.sign(b.x - a.x);
  const dy = Math.sign(b.y - a.y);
  let x = a.x;
  let y = a.y;
  out.push({ x, y });
  while (x !== b.x || y !== b.y) {
    if (x !== b.x) x += dx;
    else y += dy;
    out.push({ x, y });
  }
  return out;
}

/** Candidate paths from cell `a` to cell `b`: straight or an L shape. */
function candidatePaths(a: Cell, b: Cell): Cell[][] {
  if (a.x === b.x || a.y === b.y) return [line(a, b)];
  const via1 = { x: b.x, y: a.y };
  const via2 = { x: a.x, y: b.y };
  return [
    [...line(a, via1), ...line(via1, b).slice(1)],
    [...line(a, via2), ...line(via2, b).slice(1)],
  ];
}

function tryPlace(
  state: TeamState,
  content: WebContent,
  def: BuildingDef,
  owner: number,
  tier: number,
  x: number,
  y: number,
  rotation: number,
): TeamState {
  const stashed = addToStash(state, content, { def: def.id, tier, owner });
  if (!stashed.ok) return state;
  const placed = placeFromStash(stashed.state, content, {
    actor: owner,
    id: stashed.id,
    x,
    y,
    rotation,
  });
  // A rejected placement leaves the original state, stash entry and all.
  return placed.ok ? placed.state : state;
}

export function buildSampleTeam(
  map: GameMap,
  content: WebContent,
  seed: number,
  options: SampleOptions = {},
): TeamState {
  const dense = options.dense === true;
  const rng = Rng.fromSeed(((seed >>> 0) ^ 0x9e3779b1) >>> 0);
  const q = queryMap(map, content.terrain);
  let state = createTeamState(map);

  const legal = listLegalCorePositionsAnyPlot(map, content, content.mapgen);
  const corePos = legal[0];
  if (corePos) {
    const r = placeCore(
      state,
      content,
      content.mapgen,
      corePlayerAt(map, content, corePos.x),
      corePos,
    );
    if (r.ok) state = r.state;
  }

  const defs = content.buildings.list();
  const sources = defs.filter((d) => d.kind === 'source');
  const walls = defs.filter(
    (d) => d.kind === 'defense' && d.defenseType === 'wall',
  );
  const others = defs.filter(
    (d) => d.kind !== 'source' && d.kind !== 'core' && !walls.includes(d),
  );
  const tier = (): number => 1 + rng.nextInt(3);
  const rot = (): number => rng.pick(ROTATIONS);

  // Extractors on the resource nodes, each with a consumer that wants what
  // the node yields, placed close by.
  const sourceDef = sources[0];
  if (sourceDef) {
    for (const [index, node] of map.nodes.entries()) {
      // Leave some nodes free so they stay visible on the board.
      if (!dense && index % 3 === 2) continue;
      state = tryPlace(
        state,
        content,
        sourceDef,
        q.plotOf(node.x),
        tier(),
        node.x,
        node.y,
        0,
      );
      const wanted = defs.find(
        (d) =>
          d.kind !== 'source' &&
          d.kind !== 'core' &&
          d.inputs.some((i) => i.resource === node.resource),
      );
      if (!wanted) continue;
      for (let t = 0; t < 40; t++) {
        // Clamped into the node's own plot: buildings stay with their owner.
        const plot = q.plotOf(node.x);
        const x = Math.min(
          (plot + 1) * map.plotWidth - 1,
          Math.max(plot * map.plotWidth, node.x + rng.nextInt(9) - 4),
        );
        const y = node.y + 2 + rng.nextInt(6);
        const before = state;
        state = tryPlace(
          state,
          content,
          wanted,
          q.plotOf(node.x),
          tier(),
          x,
          y,
          rot(),
        );
        if (state !== before) break;
      }
    }
  }

  // Walls along the front, then a scatter of everything else.
  const plots = map.partySize;
  const wallDef = walls[0];
  for (let p = 0; p < plots; p++) {
    const x0 = p * map.plotWidth;
    if (wallDef) {
      const n = dense ? 40 : 8;
      for (let i = 0; i < n; i++) {
        const x = x0 + rng.nextInt(map.plotWidth);
        const y = map.height - 2 - rng.nextInt(dense ? 3 : 1);
        state = tryPlace(state, content, wallDef, p, tier(), x, y, 0);
      }
    }
    const attempts = dense ? 500 : 16;
    for (let i = 0; i < attempts && others.length > 0; i++) {
      const def = rng.pick(others);
      const x = x0 + rng.nextInt(map.plotWidth);
      const y = rng.nextInt(map.height - 2);
      state = tryPlace(state, content, def, p, tier(), x, y, rot());
    }
  }

  // Conduits: for each output side of each building, try the nearest inputs
  // until core accepts one.
  const occ = occupancy(state, content);
  const info = state.buildings.map((b) => ({
    b,
    cells: occ.cellsOf(b),
    sides: occ.absoluteSides(b),
  }));
  const dist = (a: PlacedBuilding, b: PlacedBuilding): number =>
    Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const maxLen = dense ? 18 : 24;
  const nearest = dense ? 10 : 8;

  const connect = (
    from: (typeof info)[number],
    out: Side,
    to: (typeof info)[number],
    inSide: Side,
  ): TeamState | null => {
    for (const o of outsideCells(from.cells, out)) {
      for (const i of outsideCells(to.cells, inSide)) {
        const direct = to.cells.some((c) => c.x === o.x && c.y === o.y);
        const paths: Cell[][] = direct
          ? [[]]
          : candidatePaths(o, i).filter((p) => p.length <= maxLen);
        for (const cells of paths) {
          const r = addConduit(state, content, {
            actor: from.b.owner,
            from: { building: from.b.id, side: out },
            to: { building: to.b.id, side: inSide },
            cells,
          });
          if (r.ok) return r.state;
        }
      }
    }
    return null;
  };

  for (const from of info) {
    if (from.sides.outputs.length === 0) continue;
    const targets = info
      .filter(
        (t) =>
          t.b.id !== from.b.id &&
          t.b.owner === from.b.owner &&
          t.sides.inputs.length > 0,
      )
      .sort((a, b) => dist(from.b, a.b) - dist(from.b, b.b))
      .slice(0, nearest);
    for (const out of from.sides.outputs) {
      let linked = false;
      for (const to of targets) {
        for (const inp of to.sides.inputs) {
          const next = connect(from, out, to, inp.side);
          if (next) {
            state = next;
            linked = true;
            break;
          }
        }
        if (linked) break;
      }
    }
  }
  return state;
}
