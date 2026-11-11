/**
 * Canvas drawing for the Build screen, over the board scene: overlays (flow,
 * enemy paths), side markers, the placement ghost and the conduit draft. It
 * draws what the controller and `core` already decided; it decides nothing.
 */

import type { Cell, EnemyPath, TeamState } from '@game/core';
import type { OverlayContext } from '../board/BoardView.js';
import { cellToView } from '../board/layout.js';
import type { WebContent } from '../content.js';
import type { Ui } from './build-controller.js';
import { pathSegments, pathStubs } from './path-segments.js';
import { isEditStep } from './session.js';
import { sideMarkers, type SideMarker } from './sides.js';
import type { FlowView } from './view-model.js';

export interface OverlayData {
  readonly ui: Ui;
  readonly team: TeamState;
  readonly step: string;
  readonly flow: FlowView | null;
  readonly paths: readonly EnemyPath[] | null;
  readonly legalCore: readonly Cell[];
  readonly content: WebContent;
  /** Placed unit producers with no walkable route to the front row. */
  readonly sealed?: readonly number[];
}

interface Colors {
  ok: string;
  bad: string;
  warn: string;
  path: string;
  ink: string;
  surface: string;
  accent: string;
}

const colorCache = new WeakMap<object, Colors>();

function colors(o: OverlayContext): Colors {
  const hit = colorCache.get(o.theme);
  if (hit !== undefined) return hit;
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, d: string): string =>
    cs.getPropertyValue(n).trim() || d;
  const c: Colors = {
    ok: v('--ok', '#1f9d55'),
    bad: v('--bad', '#d12d2d'),
    warn: v('--warn', '#c27400'),
    path: v('--path-line', '#c0392b'),
    ink: v('--ink', '#111'),
    surface: v('--surface', '#fff'),
    accent: v('--accent', '#c27400'),
  };
  colorCache.set(o.theme, c);
  return c;
}

export function drawBuildOverlay(
  ctx: CanvasRenderingContext2D,
  o: OverlayContext,
  d: OverlayData,
): void {
  const frame = o.scene.layout.own;
  const z = o.camera.zoom;
  const ox = o.viewport.w / 2 - o.camera.cx * z;
  const oy = o.viewport.h / 2 - o.camera.cy * z;
  const sx = (vx: number): number => vx * z + ox;
  const sy = (vy: number): number => vy * z + oy;
  const col = colors(o);
  const topLeft = (c: Cell): { x: number; y: number } => {
    const v = cellToView(frame, c.x, c.y);
    return { x: sx(v.x), y: sy(v.y) };
  };
  const centre = (c: Cell): { x: number; y: number } => {
    const p = topLeft(c);
    return { x: p.x + z / 2, y: p.y + z / 2 };
  };
  const fillCell = (c: Cell, color: string, alpha: number): void => {
    const p = topLeft(c);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(p.x, p.y, z, z);
    ctx.globalAlpha = 1;
  };
  const lw = Math.max(2.5, Math.min(7, z * 0.16));
  const font = `600 ${String(Math.max(11, Math.min(14, z * 0.42)))}px ui-monospace, Menlo, Consolas, monospace`;

  const label = (c: Cell, text: string, color: string): void => {
    const p = topLeft(c);
    ctx.font = font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + 14;
    const h = 22;
    let x = p.x;
    if (x + w > o.viewport.w - 4) x = o.viewport.w - 4 - w;
    x = Math.max(4, x);
    // Above the cell when there is room, else below it.
    let y = p.y - h / 2 - 5;
    if (y - h / 2 < 2) y = p.y + z + h / 2 + 5;
    y = Math.min(o.viewport.h - h / 2 - 2, y);
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

  const cross = (c: Cell, color: string): void => {
    const p = centre(c);
    const r = z * 0.32;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2.5, z * 0.12);
    ctx.beginPath();
    ctx.moveTo(p.x - r, p.y - r);
    ctx.lineTo(p.x + r, p.y + r);
    ctx.moveTo(p.x + r, p.y - r);
    ctx.lineTo(p.x - r, p.y + r);
    ctx.stroke();
  };

  const ring = (c: Cell[], color: string, width: number): void => {
    for (const cell of c) {
      const p = topLeft(cell);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.strokeRect(p.x + 1, p.y + 1, z - 2, z - 2);
    }
  };

  const ghostCells = (g: {
    cells: readonly Cell[];
    ok: boolean;
    message: string | null;
    warn: string | null;
  }): void => {
    const color = g.ok ? col.ok : col.bad;
    for (const c of g.cells) fillCell(c, color, 0.42);
    ring([...g.cells], color, 2.5);
    const anchor = g.cells[g.cells.length - 1];
    if (anchor !== undefined) {
      if (!g.ok && g.message !== null) label(anchor, g.message, col.bad);
      else if (g.warn !== null) label(anchor, g.warn, col.warn);
    }
  };

  // ---- Core placement ------------------------------------------------------
  if (d.step === 'core_placement') {
    for (const c of d.legalCore) {
      const p = centre(c);
      ctx.fillStyle = col.ok;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(2, z * 0.1), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (d.ui.coreGhost !== null) ghostCells(d.ui.coreGhost);
    return;
  }
  if (!isEditStep(d.step)) return;

  // ---- Enemy paths ---------------------------------------------------------
  if (d.ui.overlays.paths && d.paths !== null) {
    ctx.save();
    ctx.setLineDash([lw * 1.6, lw * 1.2]);
    ctx.lineWidth = Math.max(2, lw * 0.6);
    ctx.strokeStyle = col.path;
    ctx.globalAlpha = 0.5;
    ctx.lineJoin = 'round';
    for (const p of d.paths) {
      // One sub-path per run of adjacent cells: after an off-board detour
      // (`approach`) the next cell is not adjacent and no line crosses it.
      ctx.beginPath();
      for (const run of pathSegments(p.cells)) {
        run.forEach((c, i) => {
          const q = centre(c);
          if (i === 0) ctx.moveTo(q.x, q.y);
          else ctx.lineTo(q.x, q.y);
        });
      }
      // The detour itself: a short stub just outside the front edge at every
      // exit and re-entry, including a final exit when the walk ends off the
      // board.
      for (const stub of pathStubs(p.cells, p.approach)) {
        const a = centre(stub.cell);
        const b = centre({ x: stub.cell.x, y: stub.cell.y + 1 });
        ctx.moveTo(a.x, a.y);
        ctx.lineTo((a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      ctx.stroke();
    }
    ctx.restore();
    // Entry marks and breach points.
    for (const p of d.paths) {
      const e = centre(p.entry);
      ctx.fillStyle = col.path;
      ctx.beginPath();
      ctx.moveTo(e.x - z * 0.22, e.y - z * 0.3);
      ctx.lineTo(e.x + z * 0.22, e.y - z * 0.3);
      ctx.lineTo(e.x, e.y - z * 0.02);
      ctx.closePath();
      ctx.fill();
      if (p.breach !== null) {
        ring([p.breach.cell], col.path, 2.5);
        cross(p.breach.cell, col.path);
      }
    }
  }

  // ---- Resource flow -------------------------------------------------------
  const board = o.scene.boards.find((b) => b.frame.id === 'own');
  if (d.ui.overlays.flow && d.flow !== null && board !== undefined) {
    for (const c of board.conduits) {
      if (c.points.length < 2) continue;
      const active = d.flow.activeConduits.has(c.id);
      ctx.save();
      ctx.beginPath();
      c.points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(sx(p.x), sy(p.y));
        else ctx.lineTo(sx(p.x), sy(p.y));
      });
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (active) {
        ctx.setLineDash([lw * 0.2, lw * 2.4]);
        ctx.lineDashOffset = -(o.time / 55);
        ctx.lineWidth = lw * 1.5;
        ctx.strokeStyle = col.ink;
        ctx.stroke();
        ctx.setLineDash([lw * 0.2, lw * 2.4]);
        ctx.lineWidth = lw * 1.0;
        ctx.strokeStyle = c.color ?? col.accent;
        ctx.stroke();
      } else {
        ctx.setLineDash([lw, lw]);
        ctx.lineWidth = lw * 0.6;
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = col.bad;
        ctx.stroke();
      }
      ctx.restore();
    }
    for (const b of board.buildings) {
      if (!d.flow.starved.has(b.instance.id)) continue;
      const x = sx(b.rect.x);
      const y = sy(b.rect.y);
      ctx.strokeStyle = col.bad;
      ctx.lineWidth = 3;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(x - 2, y - 2, b.rect.w * z + 4, b.rect.h * z + 4);
      ctx.setLineDash([]);
      ctx.fillStyle = col.bad;
      ctx.beginPath();
      ctx.arc(
        x + b.rect.w * z - 2,
        y + 2,
        Math.max(7, z * 0.26),
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('!', x + b.rect.w * z - 2, y + 2.5);
    }
  }

  // ---- Sealed unit producers (Ready is refused while any) -----------------
  if (board !== undefined && d.sealed !== undefined && d.sealed.length > 0) {
    for (const b of board.buildings) {
      if (!d.sealed.includes(b.instance.id)) continue;
      const x = sx(b.rect.x);
      const y = sy(b.rect.y);
      const w = b.rect.w * z;
      const h = b.rect.h * z;
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = col.warn;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = col.warn;
      ctx.lineWidth = 4;
      ctx.setLineDash([8, 4]);
      ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
      ctx.setLineDash([]);
      // A warning triangle with "!" in the top-left corner.
      const r = Math.max(9, z * 0.32);
      const cx = x + r * 0.9;
      const cy = y + r * 0.9;
      ctx.fillStyle = col.warn;
      ctx.strokeStyle = col.surface;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy + r * 0.8);
      ctx.lineTo(cx - r, cy + r * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `800 ${String(Math.max(11, r * 1.1))}px ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('!', cx, cy + r * 0.2);
      ctx.restore();
    }
  }

  // ---- Selected conduit, erase hover ---------------------------------------
  const sel = d.ui.selection;
  const hov = d.ui.hover;
  const hotConduit =
    d.ui.tool === 'erase' && hov !== null
      ? d.team.conduits.find((c) =>
          c.cells.some((p) => p.x === hov.x && p.y === hov.y),
        )?.id
      : undefined;
  const highlight = (id: number, color: string): void => {
    const c = board?.conduits.find((x) => x.id === id);
    if (c === undefined || c.points.length < 2) return;
    ctx.save();
    ctx.beginPath();
    c.points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(sx(p.x), sy(p.y));
      else ctx.lineTo(sx(p.x), sy(p.y));
    });
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = lw * 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
  };
  if (sel?.kind === 'conduit') highlight(sel.id, col.accent);
  if (hotConduit !== undefined) highlight(hotConduit, col.bad);

  // ---- Side markers for the conduit tool -----------------------------------
  if (d.ui.tool === 'conduit') {
    const dr = d.ui.draft;
    let markers: SideMarker[];
    let kind: 'out' | 'in' = 'out';
    if (dr === null || dr.from === null) {
      markers = sideMarkers(d.team, d.content, 'out', dr?.building ?? null);
    } else {
      kind = 'in';
      markers = sideMarkers(d.team, d.content, 'in', null, dr.building);
    }
    for (const m of markers) {
      for (const c of m.cells) {
        const p = centre(c);
        const r = Math.max(5, z * 0.28);
        ctx.fillStyle = col.surface;
        ctx.strokeStyle = kind === 'out' ? col.accent : col.ok;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = kind === 'out' ? col.accent : col.ok;
        ctx.font = `700 ${String(Math.max(9, r * 1.3))}px ui-monospace, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(kind === 'out' ? '>' : '<', p.x, p.y + 0.5);
      }
    }
  }

  // ---- Draft path and last refused attempt ---------------------------------
  const dv = d.ui.draftView;
  if (dv !== null) {
    const color = dv.ok === null ? col.accent : dv.ok ? col.ok : col.bad;
    for (const c of dv.cells) fillCell(c, color, 0.4);
    ring([...dv.cells], color, 2);
    if (dv.offending !== null) {
      fillCell(dv.offending, col.bad, 0.55);
      cross(dv.offending, col.bad);
    }
    const last = dv.cells[dv.cells.length - 1];
    if (dv.message !== null && last !== undefined)
      label(dv.offending ?? last, dv.message, col.bad);
    else if (dv.ok === true && last !== undefined)
      label(last, 'Click to connect', col.ok);
  }
  if (d.ui.attempt !== null) {
    for (const c of d.ui.attempt.cells) fillCell(c, col.bad, 0.3);
    ring([...d.ui.attempt.cells], col.bad, 2);
    if (d.ui.attempt.offending !== null) {
      fillCell(d.ui.attempt.offending, col.bad, 0.6);
      cross(d.ui.attempt.offending, col.bad);
    }
  }

  // ---- Placement ghost -----------------------------------------------------
  if (d.ui.ghost !== null) ghostCells(d.ui.ghost);
}
