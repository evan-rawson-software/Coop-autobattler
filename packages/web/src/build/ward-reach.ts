/**
 * What the Build screen shows about a Rune Ward (issue #474, CB-53), as plain
 * data: while a Ward is being placed, moved or selected, the cells that share
 * an edge with it (the walls and gates standing there are the ones it strikes
 * back for), and which of those cells already hold a wall or gate of the
 * acting player. Pure: the cells and the owner rule come from `core`.
 */

import { occupancy, type Cell, type TeamState } from '@game/core';
import type { WebContent } from '../content.js';
import { cellKeyOf, SIDES, STEP } from './geometry.js';

export interface WardReach {
  /** The cells that share an edge with the Ward, inside the map. */
  readonly reach: readonly Cell[];
  /** Of those, the cells that hold a wall or gate of `owner`. */
  readonly covered: readonly Cell[];
}

/** Whether a building definition is a Rune Ward. */
export function isWardDef(content: WebContent, defId: string): boolean {
  const d = content.buildings.get(defId);
  return d !== undefined && d.kind === 'defense' && d.defenseType === 'ward';
}

/**
 * The reach of a Ward of `owner` standing at `at`, or null when `defId` is no
 * Ward. `ignore`, a building being moved, does not count as a wall.
 */
export function wardReach(
  team: TeamState,
  content: WebContent,
  defId: string,
  at: Cell,
  owner: number,
  ignore: number | null = null,
): WardReach | null {
  if (!isWardDef(content, defId)) return null;
  const { width, height } = team.map;
  const reach: Cell[] = [];
  for (const side of SIDES) {
    const step = STEP[side];
    const c = { x: at.x + step.x, y: at.y + step.y };
    if (c.x >= 0 && c.x < width && c.y >= 0 && c.y < height) reach.push(c);
  }
  const occ = occupancy(team, content);
  const walls = new Set<string>();
  for (const b of team.buildings) {
    if (b.id === ignore || b.owner !== owner) continue;
    const d = content.buildings.get(b.def);
    if (
      d === undefined ||
      d.kind !== 'defense' ||
      (d.defenseType !== 'wall' && d.defenseType !== 'gate')
    ) {
      continue;
    }
    for (const c of occ.cellsOf(b)) walls.add(cellKeyOf(c));
  }
  return {
    reach,
    covered: reach.filter((c) => walls.has(cellKeyOf(c))),
  };
}
