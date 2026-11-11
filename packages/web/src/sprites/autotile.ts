/**
 * Blob-47 autotile masks (pure). Bit values: N1 NE2 E4 SE8 S16 SW32 W64 NW128.
 * A corner bit only counts when both of its side neighbours are present, which
 * leaves 47 distinct masks. The frame index of a cell is the position of its
 * normalised mask in the ascending list of all 47 (`BLOB_MASKS`); that list is
 * the same as `atlas.autotile.blob47.masks` (a test checks it).
 */

export const N = 1;
export const NE = 2;
export const E = 4;
export const SE = 8;
export const S = 16;
export const SW = 32;
export const W = 64;
export const NW = 128;

/** Clear every corner bit whose two side neighbours are not both set. */
export function normalizeMask(mask: number): number {
  let m = mask & 255;
  if (!(m & N && m & E)) m &= ~NE;
  if (!(m & S && m & E)) m &= ~SE;
  if (!(m & S && m & W)) m &= ~SW;
  if (!(m & N && m & W)) m &= ~NW;
  return m;
}

/** The 47 distinct normalised masks, ascending. */
export const BLOB_MASKS: readonly number[] = (() => {
  const set = new Set<number>();
  for (let m = 0; m < 256; m++) set.add(normalizeMask(m));
  return [...set].sort((a, b) => a - b);
})();

const FRAME_OF = new Map(BLOB_MASKS.map((m, i) => [m, i] as const));

/** Autotile frame for a raw 8-neighbour mask. */
export function blobFrame(mask: number): number {
  return FRAME_OF.get(normalizeMask(mask)) ?? 0;
}

/**
 * The raw mask of cell (x, y): a neighbour counts when `has` says it is the
 * same terrain. y grows downward (north is y - 1).
 */
export function blobMask(
  has: (x: number, y: number) => boolean,
  x: number,
  y: number,
): number {
  return (
    (has(x, y - 1) ? N : 0) |
    (has(x + 1, y - 1) ? NE : 0) |
    (has(x + 1, y) ? E : 0) |
    (has(x + 1, y + 1) ? SE : 0) |
    (has(x, y + 1) ? S : 0) |
    (has(x - 1, y + 1) ? SW : 0) |
    (has(x - 1, y) ? W : 0) |
    (has(x - 1, y - 1) ? NW : 0)
  );
}
