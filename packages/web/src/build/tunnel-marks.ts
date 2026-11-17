/**
 * What the Build screen shows about Tunnels (CB-9g), as plain data: the line
 * under the board between the ends of each pair, the ends that have no
 * partner, and, while an end is being placed or is selected, where its
 * partner can go. Pure: the pairing and its range come from `core`.
 */

import {
  oppositeSide,
  rotateBuilding,
  tunnelPairs,
  unpairedTunnelEnds,
  type BuildingDef,
  type Cell,
  type Rotation,
  type Side,
  type TeamState,
} from '@game/core';
import type { WebContent } from '../content.js';
import { STEP } from './geometry.js';

export interface TunnelMarks {
  /** The two cells of each pair, entrance first. */
  readonly pairs: readonly { readonly from: Cell; readonly to: Cell }[];
  /** The cell of each end that has no partner. */
  readonly unpaired: readonly Cell[];
}

/** The cell of a placed 1x1 building. */
function cellOf(team: TeamState, id: number): Cell | null {
  const b = team.buildings.find((x) => x.id === id);
  return b === undefined ? null : { x: b.x, y: b.y };
}

export function tunnelMarks(team: TeamState, content: WebContent): TunnelMarks {
  const pairs: { from: Cell; to: Cell }[] = [];
  for (const p of tunnelPairs(team, content)) {
    const from = cellOf(team, p.entrance);
    const to = cellOf(team, p.exit);
    if (from !== null && to !== null) pairs.push({ from, to });
  }
  const unpaired: Cell[] = [];
  for (const id of unpairedTunnelEnds(team, content)) {
    const c = cellOf(team, id);
    if (c !== null) unpaired.push(c);
  }
  return { pairs, unpaired };
}

/** Where the partner of a Tunnel end being placed can stand. */
export interface PartnerHint {
  /** Whether the end is the entrance (its partner is the exit). */
  readonly entrance: boolean;
  /** The most cells between the two ends. */
  readonly span: number;
  /** Every cell in range in line (an entrance's), to tint. */
  readonly range: readonly Cell[];
  /** Ends of the player already standing in range: they would pair. */
  readonly partners: readonly Cell[];
}

function tunnelDef(
  content: WebContent,
  defId: string,
): (BuildingDef & { kind: 'route' }) | null {
  const d = content.buildings.get(defId);
  return d !== undefined &&
    d.kind === 'route' &&
    (d.routeType === 'tunnel_in' || d.routeType === 'tunnel_out')
    ? d
    : null;
}

/**
 * The partners an end of `defId` would have at `at` with `rotation`, among
 * the buildings `owner` already placed (`ignore`, the end being moved, is not
 * among them). Null when the building is no Tunnel end. This only names the
 * cells; whether the pair is formed, and whether it is legal, is `core`'s.
 */
export function partnerHint(
  team: TeamState,
  content: WebContent,
  defId: string,
  at: Cell,
  rotation: Rotation,
  owner: number,
  ignore: number | null = null,
): PartnerHint | null {
  const def = tunnelDef(content, defId);
  if (def === null) return null;
  const r = rotateBuilding(def, rotation);
  const stands = (cell: Cell, wantExit: boolean): boolean =>
    team.buildings.some((b) => {
      if (b.id === ignore || b.owner !== owner || b.x !== cell.x) return false;
      if (b.y !== cell.y) return false;
      const d = tunnelDef(content, b.def);
      return d !== null && (d.routeType === 'tunnel_out') === wantExit;
    });
  const inPlot = (cell: Cell): boolean =>
    cell.x >= 0 &&
    cell.y >= 0 &&
    cell.x < team.map.width &&
    cell.y < team.map.height &&
    Math.floor(cell.x / team.map.plotWidth) === owner;
  if (def.routeType === 'tunnel_in') {
    const facing = oppositeSide(r.inputs[0]?.side ?? 'south');
    const span = def.maxSpanCells ?? 0;
    const range: Cell[] = [];
    for (let d = 1; d <= span + 1; d++) {
      const cell = along(at, facing, d);
      if (inPlot(cell)) range.push(cell);
    }
    return {
      entrance: true,
      span,
      range,
      partners: range.filter((c) => stands(c, true)),
    };
  }
  // An exit: the entrances of the player that face it from within their range.
  const partners: Cell[] = [];
  let span = 0;
  for (const b of team.buildings) {
    if (b.id === ignore || b.owner !== owner) continue;
    const d = tunnelDef(content, b.def);
    if (d === null || d.routeType !== 'tunnel_in') continue;
    const facing = oppositeSide(
      rotateBuilding(d, b.rotation).inputs[0]?.side ?? 'south',
    );
    const reach = d.maxSpanCells ?? 0;
    span = Math.max(span, reach);
    for (let k = 1; k <= reach + 1; k++) {
      const cell = along({ x: b.x, y: b.y }, facing, k);
      if (cell.x === at.x && cell.y === at.y && inPlot(at)) {
        partners.push({ x: b.x, y: b.y });
      }
    }
  }
  return {
    entrance: false,
    span: span === 0 ? (tunnelEntranceSpan(content) ?? 0) : span,
    range: [],
    partners,
  };
}

/** The span of the Tunnel entrance of the content (for the hint's number). */
function tunnelEntranceSpan(content: WebContent): number | null {
  for (const d of content.buildings.list()) {
    if (d.kind === 'route' && d.routeType === 'tunnel_in') {
      return d.maxSpanCells ?? null;
    }
  }
  return null;
}

function along(c: Cell, side: Side, n: number): Cell {
  return { x: c.x + STEP[side].x * n, y: c.y + STEP[side].y * n };
}
