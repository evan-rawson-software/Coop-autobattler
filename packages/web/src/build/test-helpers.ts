/** Helpers shared by the Build screen's unit tests. Not part of the app. */

import { listLegalCorePositions, type Cell, type TeamState } from '@game/core';
import { content } from '../content.js';
import { previewPlace } from './ops.js';
import { BuildSession } from './session.js';

/** A solo run past Core placement, in the `build` step. */
export async function buildRun(seed = 7): Promise<BuildSession> {
  const s = await BuildSession.start(seed);
  const pos = listLegalCorePositions(
    s.run.team.map,
    content,
    content.mapgen,
  )[0] as Cell;
  const r = await s.dispatch({ type: 'propose_core', x: pos.x, y: pos.y });
  if (!r.ok) throw new Error(`core: ${r.reason}`);
  if (s.run.step !== 'build') throw new Error(`step ${s.run.step}`);
  return s;
}

/** Stash entries of a definition id. */
export function stashIds(team: TeamState, def: string): number[] {
  return team.stash.filter((x) => x.def === def).map((x) => x.id);
}

/** The first cell (scanning rows from the back) where a stash item fits. */
export function firstFit(
  team: TeamState,
  id: number,
  rotation = 0,
  skip: (c: Cell) => boolean = () => false,
): Cell {
  for (let y = 0; y < team.map.height; y++) {
    for (let x = 0; x < team.map.width; x++) {
      if (skip({ x, y })) continue;
      if (previewPlace(team, content, { id, x, y, rotation }).ok) {
        return { x, y };
      }
    }
  }
  throw new Error('no legal cell');
}
