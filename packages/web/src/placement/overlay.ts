/**
 * Canvas overlay of the Core placement screen: which positions are legal
 * (green) and which are not (red), the candidate under the pointer or chosen,
 * and the routes enemy units would take to it. It draws what the view model
 * already decided.
 */
import type { Cell, EnemyPath, TeamState } from '@game/core';
import type { OverlayContext } from '../board/BoardView.js';
import { cellToView } from '../board/layout.js';
import { shortProblem, type Verdict } from './view-model.js';

export interface Candidate {
  readonly pos: Cell;
  readonly verdict: Verdict;
}

export interface CoreOverlayData {
  readonly team: TeamState;
  /** Legal positions by `y * width + x`. */
  readonly legal: ReadonlySet<number>;
  readonly hover: Candidate | null;
  readonly selected: Candidate | null;
  readonly paths: readonly EnemyPath[] | null;
}

interface Colors {
  ok: string;
  bad: string;
  path: string;
  ink: string;
  surface: string;
  accent: string;
}

const cache = new WeakMap<object, Colors>();

function colors(o: OverlayContext): Colors {
  const hit = cache.get(o.theme);
  if (hit !== undefined) return hit;
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, d: string): string =>
    cs.getPropertyValue(n).trim() || d;
  const c: Colors = {
    ok: v('--ok', '#1f8a4c'),
    bad: v('--bad', '#c62828'),
    path: v('--path-line', '#c0392b'),
    ink: v('--ink', '#111'),
    surface: v('--surface', '#fff'),
    accent: v('--accent', '#c27400'),
  };
  cache.set(o.theme, c);
  return c;
}

export function drawCoreOverlay(
  ctx: CanvasRenderingContext2D,
  o: OverlayContext,
  d: CoreOverlayData,
): void {
  const frame = o.scene.layout.own;
  const z = o.camera.zoom;
  const ox = o.viewport.w / 2 - o.camera.cx * z;
  const oy = o.viewport.h / 2 - o.camera.cy * z;
  const col = colors(o);
  const topLeft = (c: Cell): { x: number; y: number } => {
    const v = cellToView(frame, c.x, c.y);
    return { x: v.x * z + ox, y: v.y * z + oy };
  };
  const centre = (c: Cell): { x: number; y: number } => {
    const p = topLeft(c);
    return { x: p.x + z / 2, y: p.y + z / 2 };
  };
  const { width, height } = d.team.map;

  // Every position: green where the Core fits, faint red where it does not.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const legal = d.legal.has(y * width + x);
      const p = topLeft({ x, y });
      ctx.globalAlpha = legal ? 0.2 : 0.09;
      ctx.fillStyle = legal ? col.ok : col.bad;
      ctx.fillRect(p.x, p.y, z, z);
    }
  }
  ctx.globalAlpha = 1;

  // Enemy routes to the candidate.
  const shown = d.hover?.verdict.ok === true ? d.hover : d.selected;
  if (d.paths !== null && shown !== null && shown.verdict.ok) {
    const lw = Math.max(2.5, Math.min(7, z * 0.16));
    // The shortest route is the one that matters: strong and solid. The
    // others are faint and dashed.
    let shortest = 0;
    d.paths.forEach((p, i) => {
      if (p.cells.length < (d.paths?.[shortest]?.cells.length ?? Infinity)) {
        shortest = i;
      }
    });
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = col.path;
    const trace = (cells: readonly Cell[]): void => {
      ctx.beginPath();
      cells.forEach((c, i) => {
        const q = centre(c);
        if (i === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      });
      ctx.stroke();
    };
    ctx.setLineDash([lw * 1.6, lw * 1.2]);
    ctx.lineWidth = Math.max(2, lw * 0.5);
    ctx.globalAlpha = 0.22;
    d.paths.forEach((p, i) => {
      if (i !== shortest) trace(p.cells);
    });
    const best = d.paths[shortest];
    if (best !== undefined) {
      ctx.setLineDash([]);
      ctx.lineWidth = Math.max(3, lw * 0.9);
      ctx.globalAlpha = 0.9;
      trace(best.cells);
    }
    ctx.restore();
    ctx.fillStyle = col.path;
    d.paths.forEach((p, i) => {
      const e = centre(p.entry);
      ctx.globalAlpha = i === shortest ? 1 : 0.3;
      ctx.beginPath();
      ctx.moveTo(e.x - z * 0.22, e.y - z * 0.3);
      ctx.lineTo(e.x + z * 0.22, e.y - z * 0.3);
      ctx.lineTo(e.x, e.y - z * 0.02);
      ctx.closePath();
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  const ring = (cells: readonly Cell[], color: string, w: number): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    for (const c of cells) {
      const p = topLeft(c);
      ctx.strokeRect(p.x + 1, p.y + 1, z - 2, z - 2);
    }
  };
  const font = `600 ${String(Math.max(11, Math.min(14, z * 0.42)))}px ui-monospace, Menlo, Consolas, monospace`;
  const label = (cells: readonly Cell[], text: string, color: string): void => {
    const top = cells.reduce(
      (best, c) => (topLeft(c).y < topLeft(best).y ? c : best),
      cells[0] as Cell,
    );
    const p = topLeft(top);
    ctx.font = font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 14;
    const h = 22;
    const x = Math.max(4, Math.min(p.x, o.viewport.w - 4 - w));
    let y = p.y - h / 2 - 5;
    if (y - h / 2 < 2) y = p.y + z * 2 + h / 2 + 5;
    ctx.fillStyle = col.surface;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x, y - h / 2, w, h, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = col.ink;
    ctx.fillText(text, x + 7, y + 0.5);
  };

  // The chosen position, then the one under the pointer.
  if (d.selected !== null) {
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = col.accent;
    for (const c of d.selected.verdict.cells) {
      const p = topLeft(c);
      ctx.fillRect(p.x, p.y, z, z);
    }
    ctx.globalAlpha = 1;
    ring(d.selected.verdict.cells, col.accent, 3);
    label(d.selected.verdict.cells, 'Core goes here', col.accent);
  }
  if (d.hover !== null) {
    const v = d.hover.verdict;
    const color = v.ok ? col.ok : col.bad;
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = color;
    for (const c of v.cells) {
      const p = topLeft(c);
      ctx.fillRect(p.x, p.y, z, z);
    }
    ctx.globalAlpha = 1;
    ring(v.cells, color, 2.5);
    if (!v.ok && v.problem !== null) {
      label(v.cells, shortProblem(v.problem), col.bad);
    }
  }
}
