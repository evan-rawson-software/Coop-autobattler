/** A mock 12x8 board patch composed from the sprites, to judge the style in context. */

import { getAtlas, drawFrame, spriteOf, type Sheets } from './atlas.js';
import { blobFrame } from './autotile.js';
import { groundName, neutralName } from './variants.js';

export const MOCK_COLS = 12;
export const MOCK_ROWS = 8;

const T = 16;
const NEUTRAL_ROWS = 2;

const LAKE = new Set(['0,2', '1,2', '0,3', '1,3', '0,4']);
const CLIFF = new Set(['11,2', '11,3', '11,4', '10,3']);

type Rot = 0 | 1 | 2 | 3;
interface Conduit {
  x: number;
  y: number;
  kind: 'straight' | 'corner' | 't' | 'cross' | 'end';
  rot: Rot;
  res: string;
}

const CONDUITS: Conduit[] = [
  { x: 9, y: 5, kind: 'straight', rot: 0, res: 'res_a' },
  { x: 8, y: 4, kind: 'straight', rot: 1, res: 'res_a' },
  { x: 7, y: 4, kind: 'corner', rot: 1, res: 'res_a' },
  { x: 7, y: 5, kind: 'straight', rot: 0, res: 'res_a' },
  { x: 7, y: 6, kind: 'corner', rot: 3, res: 'res_a' },
  { x: 6, y: 6, kind: 'straight', rot: 1, res: 'res_a' },
  { x: 9, y: 3, kind: 'straight', rot: 0, res: 'res_a' },
  { x: 9, y: 2, kind: 'end', rot: 2, res: 'res_a' },
  { x: 10, y: 4, kind: 'corner', rot: 2, res: 'res_a' },
  { x: 10, y: 5, kind: 'straight', rot: 0, res: 'res_b' },
  { x: 8, y: 7, kind: 't', rot: 0, res: 'res_c' },
  { x: 9, y: 7, kind: 'cross', rot: 0, res: 'res_c' },
];

interface Obj {
  name: string;
  x: number;
  y: number;
  tier?: number;
}

const OBJECTS: Obj[] = [
  { name: 'bld_core', x: 1, y: 6 },
  { name: 'bld_barracks', x: 4, y: 5, tier: 2 },
  { name: 'bld_extractor', x: 9, y: 6, tier: 1 },
  { name: 'bld_splitter', x: 9, y: 4 },
  { name: 'bld_merger', x: 7, y: 7 },
  { name: 'bld_crossover', x: 10, y: 7 },
  { name: 'bld_turret', x: 3, y: 3, tier: 3 },
  { name: 'bld_turret', x: 7, y: 2 },
  { name: 'bld_wall', x: 4, y: 3 },
  { name: 'bld_gate', x: 5, y: 3 },
  { name: 'bld_wall', x: 6, y: 3 },
  { name: 'bld_armory', x: 2, y: 5, tier: 2 },
  { name: 'bld_overclocker', x: 8, y: 2, tier: 3 },
];

const NODES: [string, number, number][] = [
  ['node_res_a', 9, 6],
  ['node_res_b', 10, 6],
  ['node_res_c', 11, 6],
  ['node_res_a', 2, 2],
];

/** 8-neighbour mask: N1 NE2 E4 SE8 S16 SW32 W64 NW128 for same-terrain neighbours. */
function mask(set: Set<string>, x: number, y: number): number {
  const has = (cx: number, cy: number): boolean =>
    set.has(String(cx) + ',' + String(cy));
  return (
    (has(x, y - 1) ? 1 : 0) |
    (has(x + 1, y - 1) ? 2 : 0) |
    (has(x + 1, y) ? 4 : 0) |
    (has(x + 1, y + 1) ? 8 : 0) |
    (has(x, y + 1) ? 16 : 0) |
    (has(x - 1, y + 1) ? 32 : 0) |
    (has(x - 1, y) ? 64 : 0) |
    (has(x - 1, y - 1) ? 128 : 0)
  );
}

export const pickGround = (x: number, y: number): string => groundName(x, y);
export const pickNeutral = (x: number, y: number): string => neutralName(x, y);

/** The ground sprite for a cell: a random variant, neutral rows on top. */
export function groundAt(x: number, y: number): string {
  return y < NEUTRAL_ROWS ? pickNeutral(x, y) : pickGround(x, y);
}

function ramp(res: string): readonly string[] | undefined {
  return getAtlas().tint.resources[res];
}

/** Draw the patch at integer `scale` (pixels per sprite pixel); `t` in ms. */
export function drawMockBoard(
  ctx: CanvasRenderingContext2D,
  sheets: Sheets,
  scale: number,
  t: number,
): void {
  const px = T * scale;
  ctx.clearRect(0, 0, MOCK_COLS * px, MOCK_ROWS * px);
  // Ground and neutral zone: a random variant per cell.
  for (let y = 0; y < MOCK_ROWS; y++)
    for (let x = 0; x < MOCK_COLS; x++)
      drawFrame(ctx, sheets, groundAt(x, y), 0, x * px, y * px, scale);
  // Lake and cliffs through their blob autotiles.
  for (const [set, name] of [
    [LAKE, 'ter_lake_auto'],
    [CLIFF, 'ter_cliff_auto'],
  ] as const)
    for (const key of set) {
      const [x, y] = key.split(',').map(Number) as [number, number];
      drawFrame(
        ctx,
        sheets,
        name,
        blobFrame(mask(set, x, y)),
        x * px,
        y * px,
        scale,
      );
    }
  for (const [name, x, y] of NODES) {
    const frame = Math.floor(t / 500) % 2;
    drawFrame(ctx, sheets, name, frame, x * px, y * px, scale);
  }
  // Conduits with an item each.
  for (const c of CONDUITS) {
    const r = ramp(c.res);
    const o = r ? { ramp: r, rot: c.rot } : { rot: c.rot };
    drawFrame(
      ctx,
      sheets,
      `conduit_${c.kind}`,
      0,
      c.x * px,
      c.y * px,
      scale,
      o,
    );
    if (c.kind !== 'cross' && c.kind !== 't') {
      const o2 = r ? { ramp: r } : {};
      drawFrame(ctx, sheets, 'conduit_item', 0, c.x * px, c.y * px, scale, o2);
    }
  }
  for (const o of OBJECTS) {
    drawFrame(ctx, sheets, o.name, 0, o.x * px, o.y * px, scale);
    if (o.tier) {
      const sp = spriteOf(o.name);
      if (o.tier >= 2) {
        const trim = sp.w > T ? 'tier_trim_2x2' : 'tier_trim_1x1';
        drawFrame(ctx, sheets, trim, o.tier - 2, o.x * px, o.y * px, scale);
      }
      const bottom = o.y * px + (sp.h - T) * scale;
      drawFrame(ctx, sheets, 'tier_pips', o.tier - 1, o.x * px, bottom, scale);
    }
  }
  // Units: party (side A) marching up, enemies (side B) coming down.
  const step = Math.floor(t / 160) % 2;
  const unit = (
    id: string,
    side: 'a' | 'b',
    cx: number,
    cy: number,
    anim: string,
  ): void => {
    const name = `${id}@${side}${anim}`;
    const frame = anim === '' ? 0 : step;
    drawFrame(
      ctx,
      sheets,
      name,
      frame,
      cx * scale - 8 * scale,
      cy * scale - 8 * scale,
      scale,
    );
  };
  unit('unit_soldier', 'a', 52, 76, '.walk');
  unit('unit_soldier', 'a', 72, 66, '.walk');
  unit('unit_raider', 'a', 92, 60, '.walk');
  unit('unit_archer', 'a', 36, 62, '.walk');
  unit('unit_soldier', 'b', 56, 22, '.walk');
  unit('unit_raider', 'b', 104, 26, '.walk');
  unit('unit_archer', 'b', 22, 22, '.walk');
  unit('unit_soldier', 'b', 82, 38, '.attack');
  unit('unit_soldier', 'a', 82, 54, '.attack');
  unit('unit_raider', 'a', 120, 62, '');
  unit('unit_raider', 'b', 120, 38, '');
  // A flyer with its shadow.
  const bob = Math.sin(t / 300) * 1.5;
  drawFrame(
    ctx,
    sheets,
    'fx_shadow',
    0,
    138 * scale - 8 * scale,
    (30 + 7) * scale - 8 * scale,
    scale,
  );
  unit('unit_drone', 'b', 138, 30 + bob, '.walk');
  // Effects.
  const fx = Math.floor(t / 110);
  drawFrame(ctx, sheets, 'fx_hit_spark', fx % 3, 66 * scale, 40 * scale, scale);
  drawFrame(
    ctx,
    sheets,
    'fx_spawn_puff',
    fx % 3,
    5 * px + 4 * scale,
    7 * px - 2 * scale,
    scale,
  );
  drawFrame(
    ctx,
    sheets,
    'fx_explosion',
    Math.floor(t / 150) % 4,
    150 * scale,
    8 * scale,
    scale,
  );
  const shotY = 62 - ((t / 40) % 40);
  drawFrame(
    ctx,
    sheets,
    'fx_turret_shot',
    0,
    7 * px + 4 * scale,
    shotY * scale,
    scale,
  );
}
