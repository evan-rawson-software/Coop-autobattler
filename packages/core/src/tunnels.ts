/**
 * Tunnels (CB-9g): which entrance carries a conduit to which exit.
 *
 * A Tunnel is two 1x1 route buildings, an entrance (`tunnel_in`) and an exit
 * (`tunnel_out`), bought as one item. Pairing is never stored: it is derived
 * from where the ends stand, so moving or removing either end re-pairs or
 * unpairs them. All functions are pure. See docs/rules-reference.md,
 * "Tunnels".
 */

import { oppositeSide, rotateBuilding, type Side } from './buildings.js';
import { queryTeamMap } from './map.js';
import type { TeamContent, TeamState } from './team-state.js';

/** One end of a Tunnel as the pairing rule sees it. */
export interface TunnelEnd {
  /** The placed building's instance ID. */
  readonly id: number;
  readonly role: 'in' | 'out';
  readonly owner: number;
  readonly x: number;
  readonly y: number;
  /**
   * An entrance: the side it faces (opposite its input side), the direction
   * the conduit travels. An exit: the side of its output (carrying on in the
   * same direction when it stands as the entrance faces).
   */
  readonly side: Side;
  /** Entrance only: the most cells between the two ends. */
  readonly maxSpanCells: number;
}

/** A paired entrance and exit. */
export interface TunnelPair {
  readonly entrance: number;
  readonly exit: number;
  /** Cells from the entrance to the exit (cells between + 1), at least 1. */
  readonly distance: number;
  /** The direction the entrance faces (and the pair runs in). */
  readonly facing: Side;
  /** The virtual side of the exit the pair arrives on (opposite its output). */
  readonly exitFront: Side;
}

/**
 * The ID of the flow edge a pair makes: minus the entrance's building ID.
 * Conduit IDs are positive, so it never collides with one.
 */
export function tunnelEdgeId(entrance: number): number {
  return -entrance;
}

/** The cell `n` steps from `(x, y)` in the direction `side` (north is +y). */
function stepFrom(
  x: number,
  y: number,
  side: Side,
  n: number,
): { x: number; y: number } {
  switch (side) {
    case 'north':
      return { x, y: y + n };
    case 'south':
      return { x, y: y - n };
    case 'east':
      return { x: x + n, y };
    case 'west':
      return { x: x - n, y };
  }
}

/**
 * Pair the ends. Rules (CB-9g):
 * - an entrance looks along the line it faces for an exit of the same owner,
 *   with at most `maxSpanCells` cells between them, both ends in the owner's
 *   plot (`plotOf` is the plot of a column);
 * - it takes the nearest such exit (buildings or conduits between do not
 *   matter);
 * - an exit takes at most one entrance: when several would take it the
 *   nearest wins, the lowest building ID on a tie, and the others stay
 *   unpaired (they do not look further).
 * The result is sorted by entrance ID.
 */
export function pairTunnelEnds(
  ends: readonly TunnelEnd[],
  plotOf: (x: number) => number | undefined,
): TunnelPair[] {
  const exits = new Map<string, TunnelEnd>();
  for (const e of ends) {
    if (e.role === 'out') exits.set(`${String(e.x)},${String(e.y)}`, e);
  }
  // The exit each entrance would take.
  const wants: { entrance: TunnelEnd; exit: TunnelEnd; distance: number }[] =
    [];
  for (const e of ends) {
    if (e.role !== 'in' || plotOf(e.x) !== e.owner) continue;
    for (let d = 1; d <= e.maxSpanCells + 1; d++) {
      const at = stepFrom(e.x, e.y, e.side, d);
      const x = exits.get(`${String(at.x)},${String(at.y)}`);
      if (x === undefined || x.owner !== e.owner) continue;
      if (plotOf(x.x) !== e.owner) continue;
      wants.push({ entrance: e, exit: x, distance: d });
      break;
    }
  }
  // Each exit goes to the nearest entrance that wants it.
  const best = new Map<number, (typeof wants)[number]>();
  for (const w of wants) {
    const held = best.get(w.exit.id);
    if (
      held === undefined ||
      w.distance < held.distance ||
      (w.distance === held.distance && w.entrance.id < held.entrance.id)
    ) {
      best.set(w.exit.id, w);
    }
  }
  return wants
    .filter((w) => best.get(w.exit.id) === w)
    .map((w): TunnelPair => ({
      entrance: w.entrance.id,
      exit: w.exit.id,
      distance: w.distance,
      facing: w.entrance.side,
      exitFront: oppositeSide(w.exit.side),
    }))
    .sort((a, b) => a.entrance - b.entrance);
}

/** The tunnel ends of a state, in building order (never throws). */
export function tunnelEnds(
  state: Pick<TeamState, 'buildings'>,
  content: Pick<TeamContent, 'buildings'>,
): TunnelEnd[] {
  const out: TunnelEnd[] = [];
  for (const b of state.buildings) {
    const def = content.buildings.get(b.def);
    if (def === undefined || def.kind !== 'route') continue;
    if (def.routeType !== 'tunnel_in' && def.routeType !== 'tunnel_out') {
      continue;
    }
    const r = rotateBuilding(def, b.rotation);
    const entrance = def.routeType === 'tunnel_in';
    const base = entrance ? r.inputs[0]?.side : r.outputs[0];
    if (base === undefined) continue;
    out.push({
      id: b.id,
      role: entrance ? 'in' : 'out',
      owner: b.owner,
      x: b.x,
      y: b.y,
      side: entrance ? oppositeSide(base) : base,
      maxSpanCells: def.maxSpanCells ?? 0,
    });
  }
  return out;
}

/**
 * The pairs of a state (never throws: a building with an unknown definition
 * is left out).
 */
export function tunnelPairs(
  state: TeamState,
  content: Pick<TeamContent, 'buildings' | 'terrain'>,
): TunnelPair[] {
  const ends = tunnelEnds(state, content);
  if (ends.length === 0) return [];
  const q = queryTeamMap(state, content.terrain);
  return pairTunnelEnds(ends, (x) => q.plotOf(x));
}

/**
 * The unpaired tunnel ends of a state, ascending: what the build checklist
 * flags (an unpaired end does nothing).
 */
export function unpairedTunnelEnds(
  state: TeamState,
  content: Pick<TeamContent, 'buildings' | 'terrain'>,
): number[] {
  const paired = new Set<number>();
  for (const p of tunnelPairs(state, content)) {
    paired.add(p.entrance);
    paired.add(p.exit);
  }
  return tunnelEnds(state, content)
    .map((e) => e.id)
    .filter((id) => !paired.has(id))
    .sort((a, b) => a - b);
}
