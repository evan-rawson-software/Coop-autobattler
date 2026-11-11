/**
 * The "blob" autotile scheme with 47 frames (the 8-neighbour mask with the
 * corner bits cleared unless both adjacent side bits are set).
 *
 * Mask bits: N 1, NE 2, E 4, SE 8, S 16, SW 32, W 64, NW 128. A bit is set
 * when the neighbour in that direction is the same terrain. A diagonal bit
 * only matters when both of its side neighbours are present, so `canonical`
 * clears the others; 47 distinct canonical masks remain. Frame `i` of an
 * autotile set draws the i-th canonical mask in ascending order (`BLOB47`).
 */

export const N = 1;
export const NE = 2;
export const E = 4;
export const SE = 8;
export const S = 16;
export const SW = 32;
export const W = 64;
export const NW = 128;

export function canonical(mask: number): number {
  let m = mask & 0xff;
  const drop = (diag: number, a: number, b: number): void => {
    if ((m & a) === 0 || (m & b) === 0) m &= ~diag;
  };
  drop(NE, N, E);
  drop(SE, S, E);
  drop(SW, S, W);
  drop(NW, N, W);
  return m;
}

/** The 47 canonical masks in ascending order; frame index = position. */
export const BLOB47: readonly number[] = (() => {
  const set = new Set<number>();
  for (let m = 0; m < 256; m++) set.add(canonical(m));
  return [...set].sort((a, b) => a - b);
})();

/** Frame index for any 8-bit neighbour mask. */
export function blobFrame(mask: number): number {
  return BLOB47.indexOf(canonical(mask));
}
