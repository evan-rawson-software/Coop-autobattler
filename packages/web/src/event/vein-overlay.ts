/**
 * Canvas overlay of the Rich vein picker: the cells of the acting player's
 * plot where the node may go (green), the cell under the pointer and the cell
 * chosen (a diamond in the resource's colour). Other plots are dimmed. It draws
 * what the view model decided; nothing here checks a rule.
 */
import type { Cell, TeamState } from '@game/core';
import type { OverlayContext } from '../board/BoardView.js';
import { cellToView } from '../board/layout.js';

export interface VeinOverlayData {
  readonly team: TeamState;
  readonly acting: number;
  /** Legal cells of the acting player, by `y * width + x`. */
  readonly legal: ReadonlySet<number>;
  readonly hover: Cell | null;
  readonly chosen: Cell | null;
  /** The colour of the resource being added. */
  readonly color: string;
}

export function drawVeinOverlay(
  ctx: CanvasRenderingContext2D,
  o: OverlayContext,
  d: VeinOverlayData,
): void {
  const frame = o.scene.layout.own;
  const z = o.camera.zoom;
  const ox = o.viewport.w / 2 - o.camera.cx * z;
  const oy = o.viewport.h / 2 - o.camera.cy * z;
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, fallback: string): string =>
    cs.getPropertyValue(n).trim() || fallback;
  const ok = v('--ok', '#1f8a4c');
  const ink = v('--ink', '#111');
  const surface = v('--surface', '#fff');
  const accent = v('--accent', '#c27400');
  const topLeft = (c: Cell): { x: number; y: number } => {
    const p = cellToView(frame, c.x, c.y);
    return { x: p.x * z + ox, y: p.y * z + oy };
  };
  const { width, height, plotWidth } = d.team.map;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = topLeft({ x, y });
      if (Math.floor(x / plotWidth) !== d.acting) {
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = surface;
        ctx.fillRect(p.x, p.y, z, z);
        continue;
      }
      if (!d.legal.has(y * width + x)) continue;
      // Legal: the resource's colour as a wash with a dot, so it reads on
      // the green ground as well as on the dim plots.
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = d.color;
      ctx.fillRect(p.x, p.y, z, z);
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.arc(p.x + z / 2, p.y + z / 2, Math.max(2, z * 0.11), 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = ink;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  const diamond = (c: Cell, alpha: number): void => {
    const p = topLeft(c);
    const cx = p.x + z / 2;
    const cy = p.y + z / 2;
    const r = z * 0.38;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = d.color;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };
  const ring = (c: Cell, color: string, w: number): void => {
    const p = topLeft(c);
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.strokeRect(p.x + 1, p.y + 1, z - 2, z - 2);
  };

  if (d.hover !== null && d.legal.has(d.hover.y * width + d.hover.x)) {
    diamond(d.hover, 0.45);
    ring(d.hover, ok, 2.5);
  }
  if (d.chosen !== null) {
    diamond(d.chosen, 1);
    ring(d.chosen, accent, 3);
  }
}
