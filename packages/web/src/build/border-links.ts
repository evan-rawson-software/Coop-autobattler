/**
 * Border links for the Build screen (PP-4): read-only helpers over the team
 * state. `core` decides what is legal (`addConduit`); this only finds the
 * border cells of one player's plot and names the state of each half so that
 * the board can show it (joined, open, or two of the same kind).
 */

import {
  isBorderEnd,
  type BorderEnd,
  type Cell,
  type Conduit,
  type TeamState,
} from '@game/core';

/** A half sends when its building end is the `from`; else it receives. */
export type HalfKind = 'send' | 'receive';

/**
 * - `joined`: the neighbour has a half of the opposite kind at the same spot.
 * - `open`: no neighbour half (not drawn yet, or removed): unconnected.
 * - `same_kind`: the neighbour's half is of the same kind; they cannot join.
 */
export type LinkState = 'joined' | 'open' | 'same_kind';

export interface Half {
  readonly conduit: number;
  readonly owner: number;
  readonly spot: BorderEnd;
  readonly kind: HalfKind;
}

export interface HalfStatus extends Half {
  readonly state: LinkState;
  /** The neighbour who owns the other half, when there is one. */
  readonly neighbour: number | null;
}

/** One own-plot border spot: where the owner's border cell is. */
export interface OwnSpot {
  readonly spot: BorderEnd;
  readonly cell: Cell;
}

export function halfOf(c: Conduit): Half | null {
  if (isBorderEnd(c.to)) {
    return { conduit: c.id, owner: c.owner, spot: c.to, kind: 'send' };
  }
  if (isBorderEnd(c.from)) {
    return { conduit: c.id, owner: c.owner, spot: c.from, kind: 'receive' };
  }
  return null;
}

/** Every half on the board with its link state, in conduit order. */
export function halfStatuses(team: TeamState): HalfStatus[] {
  const halves: Half[] = [];
  for (const c of team.conduits) {
    const h = halfOf(c);
    if (h !== null) halves.push(h);
  }
  return halves.map((h) => {
    const others = halves.filter(
      (o) =>
        o.owner !== h.owner &&
        o.spot.border === h.spot.border &&
        o.spot.y === h.spot.y,
    );
    const mate = others.find((o) => o.kind !== h.kind);
    const clash = others.find((o) => o.kind === h.kind);
    const state: LinkState =
      mate !== undefined
        ? 'joined'
        : clash !== undefined
          ? 'same_kind'
          : 'open';
    return { ...h, state, neighbour: (mate ?? clash)?.owner ?? null };
  });
}

/**
 * The rows of the player's own border columns: border `p` on the right of
 * plot `p`, border `p - 1` on the left. Empty for a solo run (no neighbour).
 */
export function ownSpots(team: TeamState, player: number): OwnSpot[] {
  const { partySize, plotWidth, height } = team.map;
  const out: OwnSpot[] = [];
  const columns: { border: number; x: number }[] = [];
  if (player >= 0 && player <= partySize - 2) {
    columns.push({ border: player, x: (player + 1) * plotWidth - 1 });
  }
  if (player >= 1 && player <= partySize - 1) {
    columns.push({ border: player - 1, x: player * plotWidth });
  }
  for (const col of columns) {
    for (let y = 0; y < height; y++) {
      out.push({ spot: { border: col.border, y }, cell: { x: col.x, y } });
    }
  }
  return out;
}

/** The own border spot under a cell, or null. */
export function ownSpotAt(
  team: TeamState,
  player: number,
  cell: Cell,
): BorderEnd | null {
  return (
    ownSpots(team, player).find(
      (s) => s.cell.x === cell.x && s.cell.y === cell.y,
    )?.spot ?? null
  );
}

/** The player's own half at a spot, if any (`core` allows one per spot). */
export function ownHalfAt(
  team: TeamState,
  player: number,
  spot: BorderEnd,
): Conduit | undefined {
  return team.conduits.find((c) => {
    const h = halfOf(c);
    return (
      h !== null &&
      h.owner === player &&
      h.spot.border === spot.border &&
      h.spot.y === spot.y
    );
  });
}

/** Display text for one half's state; the same words are used on the board. */
export function linkText(h: HalfStatus, nameOf: (p: number) => string): string {
  const verb = h.kind === 'send' ? 'sending' : 'receiving';
  switch (h.state) {
    case 'joined':
      return `Linked with ${nameOf(h.neighbour ?? h.owner)} (${verb})`;
    case 'same_kind':
      return `Cannot join: ${nameOf(h.neighbour ?? h.owner)} is also ${verb}`;
    case 'open':
      return `Not connected: waiting for your neighbour (${verb})`;
  }
}

/** Opacity of a half on the board: a neighbour's half is dimmed (owner decision). */
export const NEIGHBOUR_ALPHA = 0.4;

export function halfAlpha(h: Pick<Half, 'owner'>, acting: number): number {
  return h.owner === acting ? 1 : NEIGHBOUR_ALPHA;
}

/**
 * The board cell of a half's border spot, on its owner's side: border `b`
 * lies between plot `b` (left) and plot `b + 1` (right).
 */
export function halfCell(
  team: TeamState,
  h: Pick<Half, 'owner' | 'spot'>,
): Cell {
  const edge = (h.spot.border + 1) * team.map.plotWidth;
  return { x: h.owner === h.spot.border ? edge - 1 : edge, y: h.spot.y };
}
