/**
 * Debug option (issue #375): force a point of a chosen buff into the player's
 * own band for the next sample battle, for playtesting. Kept in `localStorage`
 * of this browser, outside every save.
 *
 * How it stays replay-safe. It only changes the sample battles of the `#battle`
 * route, which are simulated from a description built in the browser and
 * stored nowhere. A battle of a run is replayed from its stored detail and
 * must hash to the stored event log, so it never reads this setting; no run
 * state, saved format or result is touched.
 */
import {
  neutralZoneProblem,
  type NeutralZone,
  type NeutralZoneContent,
  type PointOfInterest,
  type PointBuffKind,
} from '@game/core';
import {
  browserStorage,
  type StorageLike,
} from '../run/local-storage-store.js';

export type ForcedPoint = 'off' | PointBuffKind;

export const FORCE_POINT_KEY = 'coop-autobattler:debug-force-point';

export function readForcedPoint(
  storage: StorageLike | null = browserStorage(),
): ForcedPoint {
  try {
    const v = storage?.getItem(FORCE_POINT_KEY);
    return v === 'unit_strength' || v === 'heal' ? v : 'off';
  } catch {
    return 'off';
  }
}

export function writeForcedPoint(
  mode: ForcedPoint,
  storage: StorageLike | null = browserStorage(),
): void {
  try {
    if (mode === 'off') storage?.removeItem(FORCE_POINT_KEY);
    else storage?.setItem(FORCE_POINT_KEY, mode);
  } catch {
    // Storage is blocked: the option stays off.
  }
}

/**
 * The zone with a point of buff kind `kind` in plot band `band`: the band's
 * own point gets that buff, or a point is added in the band's most central
 * free column when it has none. The zone unchanged when nothing fits.
 */
export function withForcedPoint(
  zone: NeutralZone,
  kind: PointBuffKind,
  band: number,
  content: NeutralZoneContent & { readonly plotWidth: number },
): NeutralZone {
  const buff = content.points.buffs.find((b) => b.kind === kind);
  if (buff === undefined) return zone;
  const existing = zone.pointsOfInterest.find((p) => p.band === band);
  let points: PointOfInterest[];
  if (existing !== undefined) {
    points = zone.pointsOfInterest.map((p) =>
      p === existing ? { ...p, buff: buff.id } : p,
    );
  } else {
    const y = (zone.depth - 1) / 2;
    if (!Number.isInteger(y)) return zone;
    const lo = band * content.plotWidth + content.points.bandMarginCells;
    const hi =
      Math.min((band + 1) * content.plotWidth - 1, zone.width - 1) -
      content.points.bandMarginCells;
    const blocked = new Set(
      zone.features
        .filter((f) => content.terrain.get(f.feature)?.blocksMovement === true)
        .map((f) => `${String(f.x)},${String(f.y)}`),
    );
    const free = (cx: number): boolean => {
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= zone.width || ny >= zone.depth)
            return false;
          if (blocked.has(`${String(nx)},${String(ny)}`)) return false;
        }
      return true;
    };
    const mid = Math.floor((lo + hi) / 2);
    let x = -1;
    for (let d = 0; d <= hi - lo && x < 0; d++) {
      for (const cx of [mid - d, mid + d]) {
        if (cx >= lo && cx <= hi && free(cx)) {
          x = cx;
          break;
        }
      }
    }
    if (x < 0) return zone;
    points = [...zone.pointsOfInterest, { id: -1, band, x, y, buff: buff.id }];
  }
  // Ids count from 0 in band order (CB-8d).
  points = points
    .slice()
    .sort((a, b) => a.band - b.band)
    .map((p, id) => ({ ...p, id }));
  const next: NeutralZone = { ...zone, pointsOfInterest: points };
  return neutralZoneProblem(next, content) === undefined ? next : zone;
}
