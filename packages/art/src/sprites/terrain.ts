/** Ground, water, cliff and resource-node sprites. */

import { loadResources } from '../content.js';
import { colorsWithRamp, rampFromColor } from '../palette.js';
import { Pix, rng } from '../pix.js';
import { sprite, wset, type SpriteDef } from '../model.js';
import { BLOB47, N, NE, E, SE, S, SW, W, NW } from '../autotile.js';
import { halfSqrtCeil, halfSqrtFloor } from '../trig.js';

const T = 16;

/**
 * Scatter single-pixel specks, no two within `gap` pixels (wrapping), so the
 * tile has no clumps that would show up as a repeating pattern when tiled.
 */
function scatter(
  p: Pix,
  r: () => number,
  count: number,
  key: string,
  taken: [number, number][],
  gap = 3,
): void {
  for (let n = 0; n < count; n++) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = Math.floor(r() * T);
      const y = Math.floor(r() * T);
      const near = taken.some(([tx, ty]) => {
        const dx = Math.min(Math.abs(tx - x), T - Math.abs(tx - x));
        const dy = Math.min(Math.abs(ty - y), T - Math.abs(ty - y));
        return Math.max(dx, dy) < gap;
      });
      if (near) continue;
      taken.push([x, y]);
      wset(p, x, y, key);
      break;
    }
  }
}

/**
 * Buildable ground: a flat green-slate base with a few single-pixel specks,
 * deliberately low contrast (only the neighbouring shades of the ground
 * ramp), so tiles can be placed at random without a visible pattern. Variants
 * 4 and 5 add a short two-pixel blade of grass; none has a landmark.
 */
function groundTile(seed: number, variant: number): Pix {
  const p = new Pix(T, T);
  const r = rng(seed);
  p.rect(0, 0, T, T, 'c');
  const taken: [number, number][] = [];
  scatter(p, r, 6, 'b', taken);
  scatter(p, r, 5, 'd', taken);
  if (variant >= 3) {
    for (let i = 0; i < 2; i++) {
      const x = Math.floor(r() * T);
      const y = Math.floor(r() * T);
      wset(p, x, y, 'd');
      wset(p, x + 1, y, 'd');
      wset(p, x, y + 1, 'b');
    }
  }
  return p;
}

/** Neutral-zone ground: a dusty violet-brown, a touch rougher. */
function neutralTile(seed: number, variant: number): Pix {
  const p = new Pix(T, T);
  const r = rng(seed);
  p.rect(0, 0, T, T, 'f');
  const taken: [number, number][] = [];
  scatter(p, r, 9, 'g', taken, 2);
  scatter(p, r, 4, 'a', taken, 3);
  if (variant === 3) {
    // A short hairline crack that wraps.
    let x = Math.floor(r() * T);
    const y0 = Math.floor(r() * 8);
    for (let y = y0; y < y0 + 5; y++) {
      wset(p, x, y, 'g');
      if (r() < 0.5) x += r() < 0.5 ? -1 : 1;
    }
  }
  return p;
}

/** Water colour at a pixel for a frame; tileable over the 16x16 tile. */
function waterAt(x: number, y: number, frame: number): string {
  const wx = ((x % T) + T) % T;
  const wy = ((y % T) + T) % T;
  // Wave strokes: short light runs on three rows, shifted per frame.
  const shift = frame * 3;
  const rows = [2, 7, 12];
  for (const [i, row] of rows.entries()) {
    if (wy === row && ((wx + shift + i * 5) % T) % 16 < 4) return 'v';
    if (wy === row + 1 && ((wx + shift + i * 5) % T) % 16 === 1) return 'u';
  }
  if ((wx * 5 + wy * 3) % 13 === 0) return 'W';
  return 'w';
}

function waterTile(frame: number): Pix {
  const p = new Pix(T, T);
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) p.set(x, y, waterAt(x, y, frame));
  return p;
}

type Dir = 'n' | 'e' | 's' | 'w' | 'ne' | 'se' | 'sw' | 'nw';
/** Notches are concave corners: the diagonal neighbour is missing. */
type Kind = 'side' | 'corner' | 'notch';

interface Depth {
  /** Pixels inside the shape's edge: below 0 is outside, 0 the outline. */
  depth: number;
  dir: Dir;
  kind: Kind;
}

/**
 * How far inside the shape a pixel is, for a canonical blob mask (see
 * autotile.ts), and which edge is nearest. Missing sides get an edge, two
 * missing sides a rounded outer corner of radius `rad`, and a missing
 * diagonal between two present sides a concave notch of the same radius.
 * Integer arithmetic only.
 */
function depthAt(x: number, y: number, mask: number, rad: number): Depth {
  const none = (m: number): boolean => (mask & m) === 0;
  let best: Depth = { depth: 99, dir: 'n', kind: 'side' };
  const offer = (depth: number, dir: Dir, kind: Kind): void => {
    if (depth < best.depth) best = { depth, dir, kind };
  };
  const dN = none(N) ? y : 99;
  const dS = none(S) ? T - 1 - y : 99;
  const dW = none(W) ? x : 99;
  const dE = none(E) ? T - 1 - x : 99;
  offer(dS, 's', 'side');
  offer(dE, 'e', 'side');
  offer(dN, 'n', 'side');
  offer(dW, 'w', 'side');
  const outer = (da: number, db: number, dir: Dir): void => {
    if (da < rad && db < rad) {
      const a = 2 * rad - 2 * da - 1;
      const b = 2 * rad - 2 * db - 1;
      offer(rad - halfSqrtCeil(a * a + b * b), dir, 'corner');
    }
  };
  outer(dN, dW, 'nw');
  outer(dN, dE, 'ne');
  outer(dS, dW, 'sw');
  outer(dS, dE, 'se');
  // Concave notch around a tile corner point (cx, cy) in pixel corners.
  const notch = (bit: number, cx: number, cy: number, dir: Dir): void => {
    if (mask & bit) return;
    const a = 2 * Math.abs(cx - x) - (cx > x ? 1 : -1);
    const b = 2 * Math.abs(cy - y) - (cy > y ? 1 : -1);
    offer(halfSqrtFloor(a * a + b * b) - rad, dir, 'notch');
  };
  // Only where both side neighbours are present (canonical masks guarantee
  // the bit is clear otherwise, so check the sides explicitly).
  const sides = (a: number, b: number): boolean =>
    (mask & a) !== 0 && (mask & b) !== 0;
  if (sides(N, E)) notch(NE, T, 0, 'ne');
  if (sides(S, E)) notch(SE, T, T, 'se');
  if (sides(S, W)) notch(SW, 0, T, 'sw');
  if (sides(N, W)) notch(NW, 0, 0, 'nw');
  return best;
}

function lakeAuto(mask: number): Pix {
  const p = new Pix(T, T);
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const d = depthAt(x, y, mask, 3).depth;
      if (d < 0) continue;
      if (d === 0) p.set(x, y, 'W');
      else if (d === 1) p.set(x, y, (x + y) % 3 === 0 ? 'u' : 'v');
      else if (d === 2) p.set(x, y, 'v');
      else p.set(x, y, waterAt(x, y, 0));
    }
  return p;
}

function plateauAt(x: number, y: number): string {
  const h = (x * 7 + y * 13 + ((x * y) % 5)) % 13;
  if (h === 0) return 'r';
  if (h === 6) return 'p';
  return 'q';
}

/** Rows of south face under a plateau edge. */
const FACE = 3;

/**
 * A raised rock slab seen from above and slightly south: a light top with a
 * bright lip along its north and west edges, and a dark three-pixel face
 * wherever the south (or a notch's south side) is open, with stone
 * strata cracks. Outer corners are rounded, inner corners carved.
 */
function cliffAuto(mask: number): Pix {
  const p = new Pix(T, T);
  const southOpen = (mask & S) === 0;
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const { depth, dir, kind } = depthAt(x, y, mask, 2);
      if (depth < 0) continue;
      if (depth === 0) {
        p.set(x, y, 'K');
        continue;
      }
      const dS = T - 1 - y;
      const southFacing = dir === 's' || dir === 'se' || dir === 'sw';
      const inFace =
        (southOpen && dS >= 1 && dS <= FACE) ||
        (kind !== 'side' && southFacing && depth <= FACE);
      if (inFace) {
        // Top of the face a shade lighter, the rest dark, with strata cracks.
        const top = southFacing ? depth === FACE : dS === FACE;
        const crack = (x * 5 + dS * 3) % 9 === 0;
        p.set(x, y, top ? 'r' : crack ? 'K' : 'R');
        continue;
      }
      if (southOpen && dS === FACE + 1) {
        // The lip where the top meets the face.
        p.set(x, y, 'p');
        continue;
      }
      if (depth === 1) {
        const lit = dir === 'n' || dir === 'w' || dir === 'nw';
        p.set(x, y, lit ? 'p' : dir === 'e' || dir === 'ne' ? 'r' : 'q');
        continue;
      }
      p.set(x, y, plateauAt(x, y));
    }
  return p;
}

/** All 47 frames of a blob autotile, in `BLOB47` order. */
function blobSet(fn: (mask: number) => Pix): Pix[] {
  return BLOB47.map((m) => fn(m));
}

type Draw = (p: Pix) => void;

function rockBlob(
  p: Pix,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): void {
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      const d2 = dx * dx + dy * dy;
      if (d2 > 1) continue;
      const lx = (x + 0.5 - (cx - rx * 0.4)) / rx;
      const ly = (y + 0.5 - (cy - ry * 0.4)) / ry;
      const l = lx * lx + ly * ly;
      p.set(x, y, l < 0.35 ? 'Z' : l < 1.3 ? 'x' : 'X');
    }
}

function diamond(p: Pix, cx: number, cy: number, rx: number, ry: number): void {
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (Math.abs(dx) / rx + Math.abs(dy) / ry > 1) continue;
      const left = dx < 0;
      const top = dy < 0;
      p.set(x, y, left ? (top ? 'Z' : 'x') : top ? 'x' : 'X');
    }
}

const BOLT = [
  '.....ZZZZ.',
  '....ZZZxx.',
  '...ZZZxx..',
  '..ZZZxxx..',
  '.ZZZxxxxxx',
  '.xxxxxxXX.',
  '....xxXX..',
  '...xxXX...',
  '...xXX....',
  '..xXX.....',
  '..XX......',
];

const NODE_SHAPES: readonly Draw[] = [
  // Ore: a heap of three rounded lumps.
  (p) => {
    rockBlob(p, 6, 9.5, 4.5, 3.5);
    rockBlob(p, 10.5, 8, 3.5, 3);
    rockBlob(p, 8, 5.5, 3, 2.5);
  },
  // Power: a lightning bolt.
  (p) => {
    p.stamp(BOLT, 3, 2);
  },
  // Flux: a cluster of crystals.
  (p) => {
    diamond(p, 8, 7, 3.5, 6);
    diamond(p, 4, 10, 2, 3.5);
    diamond(p, 12, 10.5, 2, 3);
  },
];

function resourceNode(color: string, shape: number): Pix[] {
  const map = colorsWithRamp(rampFromColor(color));
  const frames: Pix[] = [];
  for (let f = 0; f < 2; f++) {
    const p = new Pix(T, T, map);
    // Dark pad so the node reads on any ground.
    p.ellipse(8, 11, 7, 4.2, 'a');
    p.ellipse(8, 11, 6, 3.4, 'R');
    const draw = NODE_SHAPES[shape % NODE_SHAPES.length];
    if (draw) draw(p);
    p.outline('K');
    // A glint that moves between frames.
    const gx = f === 0 ? 6 : 9;
    const gy = f === 0 ? 5 : 7;
    p.set(gx, gy, '6');
    frames.push(p);
  }
  return frames;
}

export const GROUND_VARIANTS = 6;
export const NEUTRAL_VARIANTS = 4;

export function terrainSprites(): SpriteDef[] {
  const out: SpriteDef[] = [];
  const add = (d: Parameters<typeof sprite>[0]): void => {
    out.push(sprite(d));
  };
  add({
    name: 'ter_lake_auto',
    sheet: 'tiles',
    category: 'terrain',
    frames: blobSet(lakeAuto),
    columns: 8,
    autotile: 'blob47',
    note: 'Shoreline autotile, 47 frames in 8 columns: frame = index of the canonical 8-neighbour mask in atlas.autotile.blob47.masks (bits N1 NE2 E4 SE8 S16 SW32 W64 NW128, a corner bit only counts when both its sides are set). Draw over ground.',
  });
  add({
    name: 'ter_cliff_auto',
    sheet: 'tiles',
    category: 'terrain',
    frames: blobSet(cliffAuto),
    columns: 8,
    autotile: 'blob47',
    note: 'Cliff autotile, same 47-frame mask scheme as the lake. The dark south face is part of the tile where the south side is open. Draw over ground.',
  });
  add({
    name: 'ter_lake',
    id: 'ter_lake',
    sheet: 'tiles',
    category: 'terrain',
    frames: [waterTile(0), waterTile(1)],
    fps: 2,
    note: 'Open water, 2 frames, tiles seamlessly.',
  });
  add({
    name: 'ter_cliff',
    id: 'ter_cliff',
    sheet: 'tiles',
    category: 'terrain',
    frames: cliffAuto(0),
    note: 'A lone cliff block.',
  });
  for (let i = 0; i < GROUND_VARIANTS; i++)
    add({
      name: `ground_${String(i + 1)}`,
      sheet: 'tiles',
      category: 'terrain',
      frames: groundTile(11 + i * 7, i),
      note: 'Buildable ground; tiles seamlessly. Pick a variant at random per cell.',
    });
  for (let i = 0; i < NEUTRAL_VARIANTS; i++)
    add({
      name: `neutral_${String(i + 1)}`,
      sheet: 'tiles',
      category: 'terrain',
      frames: neutralTile(101 + i * 9, i),
      note: 'Neutral-zone ground; tiles seamlessly. Pick a variant at random per cell.',
    });
  loadResources().forEach((r, i) => {
    add({
      name: `node_${r.id}`,
      id: r.id,
      sheet: 'tiles',
      category: 'node',
      frames: resourceNode(r.color, i),
      fps: 2,
      note: 'Resource node, pre-tinted from the resource colour; shape differs per resource.',
    });
  });
  return out;
}
