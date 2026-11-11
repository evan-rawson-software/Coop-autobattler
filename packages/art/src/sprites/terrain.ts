/** Ground, water, cliff and resource-node sprites. */

import { loadResources } from '../content.js';
import { colorsWithRamp, rampFromColor } from '../palette.js';
import { Pix, rng } from '../pix.js';
import { sprite, wset, type SpriteDef } from '../model.js';

const T = 16;

/** Buildable ground: a flat green-slate base with sparse speckles. */
function groundTile(seed: number, variant: 0 | 1 | 2): Pix {
  const p = new Pix(T, T);
  const r = rng(seed);
  p.rect(0, 0, T, T, 'c');
  const at = (): [number, number] => [Math.floor(r() * T), Math.floor(r() * T)];
  for (let i = 0; i < 16; i++) {
    const [x, y] = at();
    wset(p, x, y, 'b');
    if (i % 3 === 0) wset(p, x + 1, y, 'b');
  }
  for (let i = 0; i < 9; i++) {
    const [x, y] = at();
    wset(p, x, y, 'd');
  }
  if (variant === 1) {
    for (let i = 0; i < 5; i++) {
      const [x, y] = at();
      wset(p, x, y, 'd');
      wset(p, x - 1, y - 1, 'd');
      wset(p, x + 1, y - 1, 'd');
      wset(p, x, y + 1, 'b');
    }
  }
  if (variant === 2) {
    for (let i = 0; i < 2; i++) {
      const [x, y] = at();
      wset(p, x, y, '3');
      wset(p, x + 1, y, '2');
      wset(p, x, y + 1, '1');
      wset(p, x + 1, y + 1, '1');
    }
  }
  return p;
}

/** Neutral-zone ground: a dusty violet-brown, a touch rougher. */
function neutralTile(seed: number, variant: 0 | 1): Pix {
  const p = new Pix(T, T);
  const r = rng(seed);
  p.rect(0, 0, T, T, 'f');
  const at = (): [number, number] => [Math.floor(r() * T), Math.floor(r() * T)];
  for (let i = 0; i < 20; i++) {
    const [x, y] = at();
    wset(p, x, y, 'g');
    if (i % 2 === 0) wset(p, x + 1, y, 'g');
  }
  for (let i = 0; i < 10; i++) {
    const [x, y] = at();
    wset(p, x, y, 'a');
  }
  if (variant === 1) {
    // A hairline crack that wraps.
    let x = Math.floor(r() * T);
    const y0 = Math.floor(r() * 6);
    for (let y = y0; y < y0 + 9; y++) {
      wset(p, x, y, 'a');
      if (r() < 0.4) x += r() < 0.5 ? -1 : 1;
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

const N = 1;
const E = 2;
const S = 4;
const W = 8;

/**
 * How far inside the shape a pixel is, given which neighbours are the same
 * terrain (bit set = present). Negative means outside the shape (transparent).
 * Absent sides get a rounded edge band of radius `rad`.
 */
function depthAt(x: number, y: number, mask: number, rad: number): number {
  const dN = (mask & N) === 0 ? y : Infinity;
  const dS = (mask & S) === 0 ? T - 1 - y : Infinity;
  const dW = (mask & W) === 0 ? x : Infinity;
  const dE = (mask & E) === 0 ? T - 1 - x : Infinity;
  let depth = Math.min(dN, dS, dW, dE);
  const corner = (da: number, db: number): void => {
    if (da < rad && db < rad) {
      const rr = Math.hypot(rad - da - 0.5, rad - db - 0.5);
      depth = Math.min(depth, Math.floor(rad - rr));
    }
  };
  corner(dN, dW);
  corner(dN, dE);
  corner(dS, dW);
  corner(dS, dE);
  return depth;
}

function lakeAuto(mask: number): Pix {
  const p = new Pix(T, T);
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const d = depthAt(x, y, mask, 3);
      if (d < 0) continue;
      if (d === 0) p.set(x, y, 'W');
      else if (d === 1) p.set(x, y, (x + y) % 3 === 0 ? 'u' : 'v');
      else if (d === 2) p.set(x, y, 'v');
      else p.set(x, y, waterAt(x, y, 0));
    }
  return p;
}

function plateauAt(x: number, y: number): string {
  const h = (x * 7 + y * 13 + ((x * y) % 5)) % 11;
  if (h === 0) return 'p';
  if (h === 3 || h === 7) return 'r';
  return 'q';
}

function cliffAuto(mask: number): Pix {
  const p = new Pix(T, T);
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const d = depthAt(x, y, mask, 2);
      if (d < 0) continue;
      const dN = (mask & N) === 0 ? y : Infinity;
      const dS = (mask & S) === 0 ? T - 1 - y : Infinity;
      const dW = (mask & W) === 0 ? x : Infinity;
      const dE = (mask & E) === 0 ? T - 1 - x : Infinity;
      if (d === 0) {
        p.set(x, y, 'K');
        continue;
      }
      // South face: three rows of shaded rock below the plateau.
      if (dS <= 3 && dS === d) {
        p.set(x, y, (x * 3 + dS) % 5 === 0 ? 'R' : dS === 3 ? 'R' : 'r');
        continue;
      }
      if (d === 1 && dE === 1 && dS > 3) {
        p.set(x, y, 'r');
        continue;
      }
      if (d === 1 && (dN === 1 || dW === 1)) {
        p.set(x, y, 'p');
        continue;
      }
      p.set(x, y, plateauAt(x, y));
    }
  return p;
}

function autoSheet(fn: (mask: number) => Pix): Pix[] {
  return Array.from({ length: 16 }, (_, m) => fn(m));
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

export function terrainSprites(): SpriteDef[] {
  const out: SpriteDef[] = [];
  const add = (d: Parameters<typeof sprite>[0]): void => {
    out.push(sprite(d));
  };
  ([0, 1, 2] as const).forEach((v, i) => {
    add({
      name: `ground_${String(i + 1)}`,
      sheet: 'terrain',
      category: 'terrain',
      frames: groundTile(11 + i * 7, v),
      note: 'Buildable ground; tiles seamlessly.',
    });
  });
  ([0, 1] as const).forEach((v, i) => {
    add({
      name: `neutral_${String(i + 1)}`,
      sheet: 'terrain',
      category: 'terrain',
      frames: neutralTile(101 + i * 9, v),
      note: 'Neutral-zone ground; tiles seamlessly.',
    });
  });
  add({
    name: 'ter_lake',
    id: 'ter_lake',
    sheet: 'terrain',
    category: 'terrain',
    frames: [waterTile(0), waterTile(1)],
    fps: 2,
    note: 'Open water, 2 frames, tiles seamlessly.',
  });
  add({
    name: 'ter_lake_auto',
    sheet: 'terrain',
    category: 'terrain',
    frames: autoSheet(lakeAuto),
    note: 'Shoreline autotile: frame = N1 + E2 + S4 + W8 for neighbours that are also water. Draw over ground.',
  });
  add({
    name: 'ter_cliff',
    id: 'ter_cliff',
    sheet: 'terrain',
    category: 'terrain',
    frames: cliffAuto(0),
    note: 'A lone cliff block.',
  });
  add({
    name: 'ter_cliff_auto',
    sheet: 'terrain',
    category: 'terrain',
    frames: autoSheet(cliffAuto),
    note: 'Cliff autotile, same frame index rule as the lake. Draw over ground.',
  });
  loadResources().forEach((r, i) => {
    add({
      name: `node_${r.id}`,
      id: r.id,
      sheet: 'terrain',
      category: 'node',
      frames: resourceNode(r.color, i),
      fps: 2,
      note: 'Resource node, pre-tinted from the resource colour; shape differs per resource.',
    });
  });
  return out;
}
