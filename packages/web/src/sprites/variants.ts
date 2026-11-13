/**
 * Deterministic per-cell sprite variants (pure): a hash of the cell and a map
 * salt, never `Math.random`, so a board looks the same every time it is drawn.
 */

/** A small integer hash of a cell and a salt. */
export function cellHash(x: number, y: number, salt = 0): number {
  let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ salt;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * A salt that depends on a map's size and party and, through `marks` (the
 * map's feature and node cells), on the map itself. A map is a pure function
 * of its seed, so the seed is folded in without the map having to carry it:
 * the salt is stable across reloads and the same wherever the run's map is
 * drawn (Build, Battle).
 */
export function mapSalt(
  width: number,
  height: number,
  partySize: number,
  plotWidth: number,
  marks: readonly { x: number; y: number }[] = [],
): number {
  let h = cellHash(width * 64 + height, partySize * 64 + plotWidth, 0x9e3779b1);
  for (const m of marks) h = cellHash(m.x + (h & 0xffff), m.y, h);
  return h | 0;
}

// Sixteen weighted slots: ground 1-2 are common, 5 and 6 rare. Neutral 4
// (cracks) is rare.
const GROUND_PICK = [1, 2, 3, 1, 2, 4, 1, 3, 2, 1, 4, 2, 1, 5, 3, 6];
const NEUTRAL_PICK = [1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3, 4];

export function groundName(x: number, y: number, salt = 0): string {
  const i = cellHash(x, y, salt) % GROUND_PICK.length;
  return `ground_${String(GROUND_PICK[i])}`;
}

export function neutralName(x: number, y: number, salt = 0): string {
  const i = cellHash(x, y, salt ^ 7) % NEUTRAL_PICK.length;
  return `neutral_${String(NEUTRAL_PICK[i])}`;
}

/** Number of `ter_lake_fill` variants (frames) in the atlas. */
export const LAKE_FILL_VARIANTS = 4;

/** Which `ter_lake_fill` frame a fully surrounded lake cell uses. */
export function lakeFillFrame(x: number, y: number, salt = 0): number {
  return cellHash(x, y, salt ^ 0x5bd1) % LAKE_FILL_VARIANTS;
}
