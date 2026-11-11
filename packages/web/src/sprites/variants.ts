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

/** A salt that depends on a map's size and party, so maps differ. */
export function mapSalt(
  width: number,
  height: number,
  partySize: number,
  plotWidth: number,
): number {
  return cellHash(width * 64 + height, partySize * 64 + plotWidth, 0x9e3779b1);
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
