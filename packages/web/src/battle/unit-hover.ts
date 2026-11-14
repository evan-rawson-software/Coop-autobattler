/** The hover tooltip of a unit on the battle board (issue #308). */

import { CELL_UNITS, formatText, type UnitSim } from '@game/core';
import type { HoverInfo } from '../board/hover-info.js';
import type { WebContent } from '../content.js';
import { screenText, screenTexts } from '../build/texts.js';
import type { Geometry } from './derive.js';

/** The slice of the playback this needs. */
export interface UnitSource {
  readonly sim: { readonly units: readonly UnitSim[] };
  displayPos(u: UnitSim, out: { x: number; y: number }): void;
}

/** The unit under the view-space point `v`, nearest centre first; null if none. */
export function describeUnitAt(
  pb: UnitSource,
  geo: Geometry,
  content: WebContent,
  v: { x: number; y: number },
): HoverInfo | null {
  const pos = { x: 0, y: 0 };
  let best: UnitSim | null = null;
  let bestD = Infinity;
  for (const u of pb.sim.units) {
    pb.displayPos(u, pos);
    const dx = pos.x - v.x;
    const dy = geo.height - pos.y - v.y;
    const d = Math.hypot(dx, dy);
    const reach = Math.max(
      0.3,
      (content.units.get(u.def)?.radius ?? 72) / CELL_UNITS,
    );
    if (d <= reach && d < bestD) {
      best = u;
      bestD = d;
    }
  }
  if (best === null) return null;
  const def = content.units.get(best.def);
  const entry = content.presentation.get(best.def);
  const own = best.side === 0;
  return {
    title: entry?.name ?? best.def,
    lines: [
      ...(entry === undefined
        ? []
        : [formatText(entry.description, content.resources)]),
      screenText(screenTexts, own ? 'hoverUnitOwn' : 'hoverUnitFoe', {
        health: String(Math.max(0, Math.ceil(best.hp))),
        max: String(def?.health ?? best.hp),
      }),
    ],
    tone: 'unit',
    color: null,
    owner: best.owner,
    board: own ? 'own' : 'enemy',
  };
}
