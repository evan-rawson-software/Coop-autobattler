/** The hover tooltip of a unit on the battle board (issue #308). */

import { CELL_UNITS, formatText, type UnitSim } from '@game/core';
import type { HoverInfo } from '../board/hover-info.js';
import type { WebContent } from '../content.js';
import { screenText, screenTexts } from '../build/texts.js';
import type { Geometry } from './derive.js';
import {
  buffName,
  buffText,
  pointsNow,
  statusText,
  type PointsSource,
} from './points.js';

/** The slice of the playback this needs. */
export interface UnitSource {
  readonly sim: PointsSource;
  /** False while the neutral zone (its points and guards) is still hidden. */
  readonly revealed?: boolean;
  readonly ticksPerSecond?: number;
  displayPos(u: UnitSim, out: { x: number; y: number }): void;
}

/** How near a point's centre the pointer finds it, in cells. */
const POINT_REACH = 0.9;

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
  const hidden = pb.revealed === false;
  for (const u of pb.sim.units) {
    if (hidden && u.side === 2) continue;
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
  if (best === null) {
    return hidden ? null : describePointAt(pb, v, geo);
  }
  const def = content.units.get(best.def);
  const entry = content.presentation.get(best.def);
  const own = best.side === 0;
  if (best.side === 2) {
    // A neutral guard (CB-8e): not the enemy, it fights both sides.
    return {
      title: entry?.name ?? best.def,
      lines: [
        screenText(screenTexts, 'hoverUnitGuard', {
          health: String(Math.max(0, Math.ceil(best.hp))),
          max: String(def?.health ?? best.hp),
        }),
        screenText(screenTexts, 'hoverPointGuards'),
      ],
      tone: 'point',
      color: 'var(--guard)',
      owner: null,
      board: 'enemy',
    };
  }
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

/** The point under the view-space point `v`, as a tooltip: its buff and who holds it. */
function describePointAt(
  pb: UnitSource,
  v: { x: number; y: number },
  geo: Geometry,
): HoverInfo | null {
  let best: ReturnType<typeof pointsNow>[number] | null = null;
  let bestD = Infinity;
  for (const p of pointsNow(pb.sim)) {
    const d = Math.hypot(p.x - v.x, geo.height - p.y - v.y);
    if (d <= POINT_REACH && d < bestD) {
      best = p;
      bestD = d;
    }
  }
  if (best === null) return null;
  const owner = best.controller >= 0 ? best.controller : null;
  return {
    title: `${buffName(best.buff)} ${String(best.number)}`,
    lines: [buffText(best.buff, pb.ticksPerSecond ?? 20), statusText(best)],
    tone: 'point',
    color: owner === null ? 'var(--guard)' : `var(--owner-${String(owner)})`,
    owner,
    board: owner === 1 ? 'enemy' : 'own',
  };
}
