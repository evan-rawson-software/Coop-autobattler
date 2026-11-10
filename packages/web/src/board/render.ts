/**
 * Canvas drawing of a scene. All sizes are CSS pixels; the caller sets the
 * context transform to the device pixel ratio. Placeholder shapes only.
 */

import type { Camera, Viewport } from './camera.js';
import { cellToView } from './layout.js';
import type { BoardScene, Scene, ViewRect } from './scene.js';
import type { Hit } from './scene.js';

/** Colours read from the page's CSS custom properties (light and dark). */
export interface Theme {
  readonly boardBg: string;
  readonly gridLine: string;
  readonly features: readonly string[];
  readonly kinds: Readonly<Record<string, string>>;
  readonly wall: string;
  readonly core: string;
  readonly coreInk: string;
  readonly owners: readonly string[];
  readonly ink: string;
  readonly inkMuted: string;
  readonly front: string;
  readonly neutralFill: string;
  readonly neutralLine: string;
  readonly hover: string;
  readonly select: string;
  readonly conduitUnknown: string;
  readonly outline: string;
}

/** Dash patterns, in multiples of the line width, one per resource position. */
export const CONDUIT_DASHES: readonly (readonly number[])[] = [
  [],
  [3, 2],
  [0.2, 2],
  [3, 1.5, 0.2, 1.5],
  [5, 2],
  [1, 1],
];

export function conduitDash(pattern: number): readonly number[] {
  if (pattern < 0) return [];
  return CONDUIT_DASHES[pattern % CONDUIT_DASHES.length] ?? [];
}

export interface Selection {
  readonly board: 'own' | 'enemy';
  /** Building instance ID, 'core', or null for a plain cell. */
  readonly building: number | 'core' | null;
  readonly x: number;
  readonly y: number;
}

export interface RenderArgs {
  readonly scene: Scene;
  readonly camera: Camera;
  readonly viewport: Viewport;
  readonly theme: Theme;
  readonly hover: Hit | null;
  readonly selection: Selection | null;
  readonly neutralLabel: string;
  readonly frontLabel: string;
}

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0.5;
  const n = parseInt(m[1] ?? '808080', 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export function contrastInk(bg: string): string {
  return luminance(bg) > 0.55 ? '#111111' : '#ffffff';
}

const FONT = '600 {s}px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const font = (size: number): string => FONT.replace('{s}', size.toFixed(1));

export function render(ctx: CanvasRenderingContext2D, a: RenderArgs): void {
  const { camera: cam, viewport: vp, theme } = a;
  const z = cam.zoom;
  const ox = vp.w / 2 - cam.cx * z;
  const oy = vp.h / 2 - cam.cy * z;
  const sx = (vx: number): number => vx * z + ox;
  const sy = (vy: number): number => vy * z + oy;
  const visible = (r: ViewRect): boolean =>
    sx(r.x + r.w) >= 0 &&
    sx(r.x) <= vp.w &&
    sy(r.y + r.h) >= 0 &&
    sy(r.y) <= vp.h;

  ctx.clearRect(0, 0, vp.w, vp.h);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const layout = a.scene.layout;

  // Neutral strip: empty, outlined.
  if (layout.neutral) {
    const n = layout.neutral;
    ctx.fillStyle = theme.neutralFill;
    ctx.fillRect(sx(n.x0), sy(n.y0), (n.x1 - n.x0) * z, (n.y1 - n.y0) * z);
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = theme.neutralLine;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(sx(n.x0), sy(n.y0), (n.x1 - n.x0) * z, (n.y1 - n.y0) * z);
    ctx.setLineDash([]);
    if (z >= 6) {
      ctx.fillStyle = theme.inkMuted;
      ctx.font = font(Math.min(14, Math.max(10, z * 0.5)));
      ctx.fillText(
        a.neutralLabel,
        sx((n.x0 + n.x1) / 2),
        sy((n.y0 + n.y1) / 2),
      );
    }
  }

  for (const board of a.scene.boards) {
    drawBoard(ctx, board, a, sx, sy, visible);
  }

  // Hover and selection outlines.
  const rectFor = (
    board: BoardScene,
    building: number | 'core' | null,
    x: number,
    y: number,
  ): ViewRect | null => {
    if (building === 'core') return board.core?.rect ?? null;
    if (typeof building === 'number') {
      return (
        board.buildings.find((b) => b.instance.id === building)?.rect ?? null
      );
    }
    const v = cellToView(board.frame, x, y);
    return { x: v.x, y: v.y, w: 1, h: 1 };
  };
  const outline = (r: ViewRect | null, color: string, width: number): void => {
    if (!r) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.strokeRect(sx(r.x) - 1, sy(r.y) - 1, r.w * z + 2, r.h * z + 2);
  };
  if (a.hover) {
    const h = a.hover;
    const board = a.scene.boards.find((b) => b.frame.id === h.board);
    if (board) {
      const id =
        h.building === null
          ? null
          : h.building === 'core'
            ? 'core'
            : h.building.id;
      outline(rectFor(board, id, h.x, h.y), theme.hover, 2);
    }
  }
  if (a.selection) {
    const s = a.selection;
    const board = a.scene.boards.find((b) => b.frame.id === s.board);
    if (board) outline(rectFor(board, s.building, s.x, s.y), theme.select, 3);
  }
}

function drawBoard(
  ctx: CanvasRenderingContext2D,
  board: BoardScene,
  a: RenderArgs,
  sx: (v: number) => number,
  sy: (v: number) => number,
  visible: (r: ViewRect) => boolean,
): void {
  const { theme, camera } = a;
  const z = camera.zoom;
  const f = board.frame;

  // Ground.
  ctx.fillStyle = theme.boardBg;
  ctx.fillRect(sx(f.ox), sy(f.oy), f.w * z, f.h * z);

  // Grid, as one path.
  if (z >= 5) {
    ctx.beginPath();
    for (let i = 0; i <= f.w; i++) {
      const x = Math.round(sx(f.ox + i)) + 0.5;
      ctx.moveTo(x, sy(f.oy));
      ctx.lineTo(x, sy(f.oy + f.h));
    }
    for (let j = 0; j <= f.h; j++) {
      const y = Math.round(sy(f.oy + j)) + 0.5;
      ctx.moveTo(sx(f.ox), y);
      ctx.lineTo(sx(f.ox + f.w), y);
    }
    ctx.strokeStyle = theme.gridLine;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Terrain.
  for (const t of board.features) {
    const r = { x: t.x, y: t.y, w: 1, h: 1 };
    if (!visible(r)) continue;
    const fill =
      theme.features[t.style % theme.features.length] ?? theme.gridLine;
    ctx.fillStyle = fill;
    ctx.fillRect(sx(t.x), sy(t.y), z + 0.5, z + 0.5);
    if (t.style % 2 === 1 && z >= 8) {
      // Second cue besides colour: hatching.
      ctx.save();
      ctx.beginPath();
      ctx.rect(sx(t.x), sy(t.y), z, z);
      ctx.clip();
      ctx.beginPath();
      for (let k = -z; k < z; k += 6) {
        ctx.moveTo(sx(t.x) + k, sy(t.y) + z);
        ctx.lineTo(sx(t.x) + k + z, sy(t.y));
      }
      ctx.strokeStyle = theme.outline;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
  }

  // Front edge marker.
  {
    const y = f.turned ? f.oy + f.h : f.oy;
    const th = Math.max(3, z * 0.18);
    ctx.fillStyle = theme.front;
    ctx.fillRect(sx(f.ox), sy(y) - th / 2, f.w * z, th);
    if (z >= 6) {
      ctx.fillStyle = theme.inkMuted;
      ctx.font = font(Math.min(13, Math.max(10, z * 0.45)));
      const ty = f.turned ? sy(y) + th + 8 : sy(y) - th - 8;
      if (!(f.turned && a.scene.layout.neutral === null)) {
        ctx.fillText(a.frontLabel, sx(f.ox + f.w / 2), ty);
      }
    }
  }

  // Resource nodes: diamonds with a letter.
  for (const n of board.nodes) {
    const r = { x: n.x - 0.5, y: n.y - 0.5, w: 1, h: 1 };
    if (!visible(r)) continue;
    const cx = sx(n.x);
    const cy = sy(n.y);
    const d = z * 0.42;
    ctx.beginPath();
    ctx.moveTo(cx, cy - d);
    ctx.lineTo(cx + d, cy);
    ctx.lineTo(cx, cy + d);
    ctx.lineTo(cx - d, cy);
    ctx.closePath();
    ctx.fillStyle = n.color;
    ctx.fill();
    ctx.strokeStyle = theme.outline;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (z >= 14) {
      ctx.fillStyle = contrastInk(n.color);
      ctx.font = font(Math.max(9, z * 0.4));
      ctx.fillText(n.letter, cx, cy + 0.5);
    }
  }

  // Conduits (under buildings' notches, over the ground).
  const lw = Math.max(2, Math.min(6, z * 0.16));
  for (const c of board.conduits) {
    if (c.points.length < 2) continue;
    ctx.beginPath();
    c.points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(sx(p.x), sy(p.y));
      else ctx.lineTo(sx(p.x), sy(p.y));
    });
    const dash = conduitDash(c.pattern).map((d) => d * lw);
    ctx.setLineDash(dash);
    ctx.lineWidth = lw;
    ctx.strokeStyle = c.color ?? theme.conduitUnknown;
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Buildings.
  const owner = (i: number): string =>
    theme.owners[i % theme.owners.length] ?? theme.ink;
  for (const b of board.buildings) {
    if (!visible(b.rect)) continue;
    const inset = Math.max(1, z * 0.07);
    const x = sx(b.rect.x) + inset;
    const y = sy(b.rect.y) + inset;
    const w = b.rect.w * z - 2 * inset;
    const h = b.rect.h * z - 2 * inset;
    if (b.solid) {
      ctx.fillStyle = theme.wall;
      ctx.fillRect(sx(b.rect.x), sy(b.rect.y), b.rect.w * z, b.rect.h * z);
    } else {
      ctx.fillStyle = theme.kinds[b.def.kind] ?? theme.boardBg;
      ctx.fillRect(x, y, w, h);
    }
    // Owner tint: a coloured frame.
    ctx.strokeStyle = owner(b.instance.owner);
    ctx.lineWidth = Math.max(2, z * 0.09);
    ctx.strokeRect(x, y, w, h);
    if (!b.solid && z >= 14) {
      ctx.fillStyle = theme.ink;
      ctx.font = font(Math.min(22, Math.max(9, z * 0.42)));
      ctx.fillText(b.label, x + w / 2, y + h / 2 + 0.5);
    }
    // Rotation, as input and output sides.
    for (const n of b.notches) {
      const u = Math.min(z, 40);
      const cx = sx(n.x);
      const cy = sy(n.y);
      const px = -n.dy;
      const py = n.dx;
      const edgeX = cx + n.dx * z * 0.5;
      const edgeY = cy + n.dy * z * 0.5;
      const half = u * 0.2;
      ctx.beginPath();
      if (n.kind === 'in') {
        // Triangle pointing into the building.
        ctx.moveTo(edgeX + px * half + n.dx * 0, edgeY + py * half);
        ctx.lineTo(edgeX - px * half, edgeY - py * half);
        ctx.lineTo(edgeX - n.dx * u * 0.26, edgeY - n.dy * u * 0.26);
        ctx.closePath();
        ctx.fillStyle = n.color ?? theme.boardBg;
        ctx.fill();
        ctx.strokeStyle = theme.outline;
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        // Arrow pointing out of the building.
        ctx.moveTo(
          edgeX + px * half - n.dx * u * 0.04,
          edgeY + py * half - n.dy * u * 0.04,
        );
        ctx.lineTo(
          edgeX - px * half - n.dx * u * 0.04,
          edgeY - py * half - n.dy * u * 0.04,
        );
        ctx.lineTo(edgeX + n.dx * u * 0.3, edgeY + n.dy * u * 0.3);
        ctx.closePath();
        ctx.fillStyle = theme.ink;
        ctx.fill();
        ctx.strokeStyle = theme.boardBg;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  // Core.
  if (board.core && visible(board.core.rect)) {
    const r = board.core.rect;
    const x = sx(r.x) + 1;
    const y = sy(r.y) + 1;
    const w = r.w * z - 2;
    const h = r.h * z - 2;
    ctx.fillStyle = theme.core;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = Math.max(3, z * 0.12);
    ctx.strokeRect(x, y, w, h);
    if (z >= 10) {
      ctx.fillStyle = theme.coreInk;
      ctx.font = font(Math.min(20, Math.max(9, z * 0.4)));
      ctx.fillText(board.core.label, x + w / 2, y + h / 2 + 0.5);
    }
  }
}
