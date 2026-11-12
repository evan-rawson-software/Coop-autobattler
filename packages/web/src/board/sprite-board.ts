/**
 * The sprite look of the board. The board is static between edits, so the
 * static part (ground, lakes and cliffs, resource nodes, conduits, buildings)
 * is drawn once per scene into an offscreen canvas at the sprites' native size
 * (16 px a cell) and then blitted, scaled with nearest-neighbour, every frame.
 * One layer serves every zoom: the scale is applied by the blit, never by
 * redrawing. A new scene (a build edit) makes a new layer; the old one is
 * garbage. Dynamic things (grid, front edge, selection, overlays) are drawn on
 * top by the caller.
 */

import {
  drawSprite,
  findSprite,
  frameCanvas,
  spriteSet,
  type Ramp,
  type SpriteSet,
} from '../sprites/atlas.js';
import { blobFrame, blobMask } from '../sprites/autotile.js';
import {
  conduitPiece,
  sideBit,
  type ConduitKind,
} from '../sprites/conduit-piece.js';
import { groundName, neutralName } from '../sprites/variants.js';
import type {
  BoardScene,
  Scene,
  SceneBuilding,
  SceneFeature,
} from './scene.js';
import type { Theme } from './render.js';

/** Below this many CSS pixels a cell, sprites turn to mush: draw flat. */
export const SPRITE_MIN_ZOOM = 12;

/** Sprite size in the atlas, in pixels a cell. */
const T = 16;

export const layerStats = { builds: 0 };

interface Layer {
  readonly canvas: HTMLCanvasElement;
  /** Size in cells. */
  readonly cw: number;
  readonly ch: number;
  readonly theme: Theme;
}

const boardLayers = new WeakMap<BoardScene, Layer>();
const stripLayers = new WeakMap<Scene, Layer>();

/** True when the sheets the board needs have loaded. */
export function boardSpritesReady(): boolean {
  const s = spriteSet();
  return (
    s !== null && !!s.sheets.images['tiles'] && !!s.sheets.images['buildings']
  );
}

const occupiedCache = new WeakMap<BoardScene, Uint8Array>();

/**
 * Which cells of a board (view-local, row by row) a building, the Core or a
 * lake or cliff covers. The grid is not drawn over them, so it never cuts a
 * sprite in two.
 */
export function occupiedCells(board: BoardScene): Uint8Array {
  const hit = occupiedCache.get(board);
  if (hit) return hit;
  const f = board.frame;
  const occ = new Uint8Array(f.w * f.h);
  const mark = (r: { x: number; y: number; w: number; h: number }): void => {
    for (let j = 0; j < r.h; j++)
      for (let i = 0; i < r.w; i++) {
        const cx = Math.round(r.x - f.ox) + i;
        const cy = Math.round(r.y - f.oy) + j;
        if (cx >= 0 && cy >= 0 && cx < f.w && cy < f.h) occ[cy * f.w + cx] = 1;
      }
  };
  for (const b of board.buildings) mark(b.rect);
  for (const c of board.cores) if (c) mark(c.rect);
  for (const t of board.features) mark({ x: t.x, y: t.y, w: 1, h: 1 });
  occupiedCache.set(board, occ);
  return occ;
}

function makeCanvas(cw: number, ch: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, cw * T);
  c.height = Math.max(1, ch * T);
  return c;
}

const LAKE = 'ter_lake';
const CLIFF = 'ter_cliff';

/** Draw ground, then lakes and cliffs through their blob autotiles. */
function drawTerrain(
  lc: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  features: readonly { x: number; y: number; feature: string }[],
  neutralGround: boolean,
  salt: number,
  theme: Theme,
): void {
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const name = neutralGround
        ? neutralName(x, y, salt)
        : groundName(x, y, salt);
      drawSprite(lc, name, x * T, y * T, 1);
    }
  const byFeature = new Map<string, Set<string>>();
  for (const f of features) {
    let s = byFeature.get(f.feature);
    if (!s) byFeature.set(f.feature, (s = new Set()));
    s.add(`${String(f.x)},${String(f.y)}`);
  }
  for (const [id, cells] of byFeature) {
    const sprite =
      id === LAKE ? 'ter_lake_auto' : id === CLIFF ? 'ter_cliff_auto' : null;
    // Outside the board counts as the same terrain, so shores and lips are
    // not drawn along the board's own edge.
    const has = (x: number, y: number): boolean =>
      x < 0 ||
      y < 0 ||
      x >= cw ||
      y >= ch ||
      cells.has(`${String(x)},${String(y)}`);
    for (const key of cells) {
      const [x, y] = key.split(',').map(Number) as [number, number];
      if (sprite !== null && findSprite(sprite)) {
        drawSprite(lc, sprite, x * T, y * T, 1, {
          frame: blobFrame(blobMask(has, x, y)),
        });
      } else {
        lc.fillStyle = theme.features[0] ?? '#557';
        lc.fillRect(x * T, y * T, T, T);
      }
    }
  }
}

/** Side bits of each conduit cell, keyed by board-local cell, from its point list. */
export function conduitCells(
  board: BoardScene,
): { x: number; y: number; sides: number; resource: string | null }[] {
  const out: {
    x: number;
    y: number;
    sides: number;
    resource: string | null;
  }[] = [];
  for (const c of board.conduits) {
    const pts = c.points;
    const first = c.cells[0];
    if (first === undefined) continue;
    const p0 = pts[0];
    const offset =
      p0 !== undefined && p0.x === first.x && p0.y === first.y ? 0 : 1;
    c.cells.forEach((cell, i) => {
      const k = i + offset;
      let sides = 0;
      for (const q of [pts[k - 1], pts[k + 1]]) {
        if (q === undefined) continue;
        sides |= sideBit(q.x - cell.x, q.y - cell.y);
      }
      out.push({
        x: Math.floor(cell.x - board.frame.ox),
        y: Math.floor(cell.y - board.frame.oy),
        sides,
        resource: c.resource,
      });
    });
  }
  return out;
}

function rampOf(set: SpriteSet, resource: string | null): Ramp | undefined {
  return resource === null ? undefined : set.atlas.tint.resources[resource];
}

function isTurret(b: Pick<SceneBuilding, 'def'>): boolean {
  return b.def.kind === 'defense' && b.def.defenseType === 'turret';
}

/**
 * Quarter turns (clockwise, as core `rotateSide`) the sprite of a building is
 * drawn with: its placed rotation plus half a turn on the turned enemy board.
 * Walls, gates and the Core keep their light direction (0); a turret's base
 * turns with the building because its input port is part of the art.
 */
export function buildingSpriteRot(
  b: Pick<SceneBuilding, 'def' | 'instance'>,
  turned: boolean,
): 0 | 1 | 2 | 3 {
  const upright = b.def.kind === 'defense' || b.def.kind === 'core';
  if (upright && !isTurret(b)) return 0;
  return ((b.instance.rotation / 90 + (turned ? 2 : 0)) % 4) as 0 | 1 | 2 | 3;
}

/**
 * Tier pips for tier 2 and 3 (tier 1 has none): a tiny cluster of gold dots
 * in the top-left corner, inside the trim bracket and clear of the ports and
 * notches (which sit mid-edge): two across the top and the third below the
 * first. Each pip is one gold pixel with a one-pixel dark outline, so the
 * whole cluster covers about 5x5 of a 16x16 cell (#85).
 */
function drawTierPips(
  lc: CanvasRenderingContext2D,
  px: number,
  py: number,
  tier: number,
): void {
  const spots: readonly (readonly [number, number])[] = [
    [2, 2],
    [4, 2],
    [2, 4],
  ];
  const n = tier >= 3 ? 3 : 2;
  const pips = spots.slice(0, n);
  lc.fillStyle = '#1a1410';
  for (const [x, y] of pips) lc.fillRect(px + x - 1, py + y - 1, 3, 3);
  lc.fillStyle = '#f0c040';
  for (const [x, y] of pips) lc.fillRect(px + x, py + y, 1, 1);
}

function drawBuildings(
  lc: CanvasRenderingContext2D,
  set: SpriteSet,
  board: BoardScene,
  theme: Theme,
): void {
  const f = board.frame;
  const turned = f.turned ? 2 : 0;
  const owners = new Set(board.buildings.map((b) => b.instance.owner));
  const multi = owners.size > 1;
  for (const b of board.buildings) {
    const px = (b.rect.x - f.ox) * T;
    const py = (b.rect.y - f.oy) * T;
    const pw = b.rect.w * T;
    const ph = b.rect.h * T;
    const sp = findSprite(b.def.id);
    const fits = sp !== undefined && sp.w === pw && sp.h === ph;
    if (isTurret(b) && findSprite('bld_turret_base') && b.rect.w === 1) {
      const baseRot = buildingSpriteRot(b, f.turned);
      drawSprite(
        lc,
        'bld_turret_base',
        px,
        py,
        1,
        baseRot ? { rot: baseRot } : {},
      );
      const head = set.atlas.sprites['bld_turret_head'];
      const src = head ? frameCanvas(set, 'bld_turret_head', 0) : null;
      if (head && src) {
        lc.save();
        lc.translate(px + T / 2, py + T / 2);
        lc.rotate(turned * (Math.PI / 2));
        lc.drawImage(src, -head.anchor[0], -head.anchor[1]);
        lc.restore();
      }
    } else if (fits) {
      const rot = buildingSpriteRot(b, f.turned);
      drawSprite(lc, b.def.id, px, py, 1, rot ? { rot } : {});
    } else {
      // No sprite for this building: the flat block.
      lc.fillStyle = b.solid ? theme.wall : (theme.kinds[b.def.kind] ?? '#888');
      lc.fillRect(px + 1, py + 1, pw - 2, ph - 2);
      lc.strokeStyle = theme.outline;
      lc.lineWidth = 1;
      lc.strokeRect(px + 1.5, py + 1.5, pw - 3, ph - 3);
    }
    const tier = b.instance.tier;
    if (tier >= 2) {
      drawSprite(lc, pw > T ? 'tier_trim_2x2' : 'tier_trim_1x1', px, py, 1, {
        frame: tier - 2,
      });
    }
    if (tier >= 2) drawTierPips(lc, px, py, tier);
    if (multi) {
      // Several owners: a thin frame in the owner's colour.
      lc.strokeStyle =
        theme.owners[b.instance.owner % theme.owners.length] ?? theme.ink;
      lc.lineWidth = 1;
      lc.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
    }
  }
  for (const core of board.cores) {
    if (core === null) continue;
    const r = core.rect;
    const px = (r.x - f.ox) * T;
    const py = (r.y - f.oy) * T;
    if (!drawSprite(lc, 'bld_core', px, py, 1)) {
      lc.fillStyle = theme.core;
      lc.fillRect(px + 1, py + 1, r.w * T - 2, r.h * T - 2);
    }
  }
}

function buildBoardLayer(
  board: BoardScene,
  set: SpriteSet,
  theme: Theme,
): Layer {
  layerStats.builds += 1;
  const f = board.frame;
  const canvas = makeCanvas(f.w, f.h);
  const lc = canvas.getContext('2d');
  if (!lc) return { canvas, cw: f.w, ch: f.h, theme };
  lc.imageSmoothingEnabled = false;
  const local = board.features.map((t) => ({
    x: t.x - f.ox,
    y: t.y - f.oy,
    feature: t.feature,
  }));
  drawTerrain(lc, f.w, f.h, local, false, board.salt, theme);
  for (const n of board.nodes) {
    const name = `node_${n.resource}`;
    if (findSprite(name)) {
      drawSprite(
        lc,
        name,
        Math.floor(n.x - f.ox) * T,
        Math.floor(n.y - f.oy) * T,
        1,
      );
    }
  }
  for (const c of conduitCells(board)) {
    const piece = conduitPiece(c.sides);
    const ramp = rampOf(set, c.resource);
    const name: `conduit_${ConduitKind}` = `conduit_${piece.kind}`;
    const opts = ramp ? { rot: piece.rot, ramp } : { rot: piece.rot };
    drawSprite(lc, name, c.x * T, c.y * T, 1, opts);
  }
  drawBuildings(lc, set, board, theme);
  return { canvas, cw: f.w, ch: f.h, theme };
}

/**
 * Blit the visible part of a layer: `ox, oy` is the screen position of the
 * layer's top-left, `z` the CSS pixels per cell.
 */
function blitLayer(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  ox: number,
  oy: number,
  z: number,
  vw: number,
  vh: number,
): void {
  const i0 = Math.max(0, Math.floor(-ox / z));
  const j0 = Math.max(0, Math.floor(-oy / z));
  const i1 = Math.min(layer.cw, Math.ceil((vw - ox) / z));
  const j1 = Math.min(layer.ch, Math.ceil((vh - oy) / z));
  if (i1 <= i0 || j1 <= j0) return;
  const dx0 = Math.round(ox + i0 * z);
  const dy0 = Math.round(oy + j0 * z);
  const dx1 = Math.round(ox + i1 * z);
  const dy1 = Math.round(oy + j1 * z);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    layer.canvas,
    i0 * T,
    j0 * T,
    (i1 - i0) * T,
    (j1 - j0) * T,
    dx0,
    dy0,
    dx1 - dx0,
    dy1 - dy0,
  );
}

/** Draw a board's static layer. False when the sprites are not ready. */
export function drawBoardLayer(
  ctx: CanvasRenderingContext2D,
  board: BoardScene,
  theme: Theme,
  ox: number,
  oy: number,
  z: number,
  vw: number,
  vh: number,
): boolean {
  const set = spriteSet();
  if (!set || !boardSpritesReady()) return false;
  let layer = boardLayers.get(board);
  if (layer?.theme !== theme) {
    layer = buildBoardLayer(board, set, theme);
    boardLayers.set(board, layer);
  }
  blitLayer(ctx, layer, ox, oy, z, vw, vh);
  return true;
}

/** Draw the neutral strip's ground and terrain. False when not ready. */
export function drawStripLayer(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  theme: Theme,
  ox: number,
  oy: number,
  z: number,
  vw: number,
  vh: number,
): boolean {
  const set = spriteSet();
  const n = scene.layout.neutral;
  if (!set || !boardSpritesReady() || !n) return false;
  let layer = stripLayers.get(scene);
  if (layer?.theme !== theme) {
    const cw = n.x1 - n.x0;
    const ch = n.y1 - n.y0;
    layerStats.builds += 1;
    const canvas = makeCanvas(cw, ch);
    const lc = canvas.getContext('2d');
    if (lc) {
      lc.imageSmoothingEnabled = false;
      const feats = scene.neutralFeatures.map((t: SceneFeature) => ({
        x: t.x - n.x0,
        y: t.y - n.y0,
        feature: t.feature,
      }));
      const salt = scene.boards[0]?.salt ?? 0;
      drawTerrain(lc, cw, ch, feats, true, salt, theme);
    }
    layer = { canvas, cw, ch, theme };
    stripLayers.set(scene, layer);
  }
  blitLayer(ctx, layer, ox + n.x0 * z, oy + n.y0 * z, z, vw, vh);
  return true;
}
