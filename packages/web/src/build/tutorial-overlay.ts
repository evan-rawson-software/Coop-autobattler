/**
 * The tutorial's highlights on the board (issue #309): pulsing rings on the
 * Ore nodes to use (step 2) and a dashed suggested conduit path (step 3).
 * No dark overlay: the board stays fully visible. It draws what
 * `tutorialMarks` decided; nothing here changes the game.
 */
import { occupancy, type Cell, type TeamState } from '@game/core';
import type { OverlayContext } from '../board/BoardView.js';
import { cellToView } from '../board/layout.js';
import type { WebContent } from '../content.js';
import {
  freeNodes,
  tutorialDefs,
  type StepNo,
  type TutorialFacts,
} from '../tutorial/steps.js';
import { proposePath } from './autoroute.js';

export interface TutorialMarks {
  /** Cells to ring. */
  readonly rings: readonly Cell[];
  /** A suggested conduit path, cell by cell; empty when none. */
  readonly path: readonly Cell[];
}

export function tutorialMarks(
  team: TeamState,
  content: WebContent,
  player: number,
  n: StepNo | null,
  facts: TutorialFacts,
): TutorialMarks | null {
  if (n === 2) return { rings: freeNodes(team, content), path: [] };
  if (n === 3 && facts.barracksPlaced && team.conduits.length === 0) {
    const defs = tutorialDefs(content);
    const mine = team.buildings.filter((b) => b.owner === player);
    const from = mine.find(
      (b) =>
        b.def === defs.extractor &&
        team.map.nodes.some((k) => k.x === b.x && k.y === b.y),
    );
    const to = mine.find((b) => b.def === defs.barracks);
    if (from === undefined || to === undefined) return null;
    const occ = occupancy(team, content);
    const out = occ.absoluteSides(from).outputs[0];
    const inp = occ.absoluteSides(to).inputs[0]?.side;
    if (out === undefined || inp === undefined) return null;
    const path = proposePath(
      team,
      content,
      { building: from.id, side: out },
      { building: to.id, side: inp },
      [],
      player,
    );
    return { rings: [], path: path ?? [] };
  }
  return null;
}

export function drawTutorialMarks(
  ctx: CanvasRenderingContext2D,
  o: OverlayContext,
  marks: TutorialMarks,
): void {
  const frame = o.scene.layout.own;
  const z = o.camera.zoom;
  const ox = o.viewport.w / 2 - o.camera.cx * z;
  const oy = o.viewport.h / 2 - o.camera.cy * z;
  const centre = (c: Cell): { x: number; y: number } => {
    const v = cellToView(frame, c.x, c.y);
    return { x: (v.x + 0.5) * z + ox, y: (v.y + 0.5) * z + oy };
  };
  const accent =
    getComputedStyle(document.documentElement)
      .getPropertyValue('--accent')
      .trim() || '#c27400';
  const phase = (o.time % 1400) / 1400;
  ctx.save();
  ctx.strokeStyle = accent;
  for (const c of marks.rings) {
    const p = centre(c);
    // A solid ring, and a second one that swells and fades.
    ctx.globalAlpha = 1;
    ctx.lineWidth = Math.max(2.5, z * 0.1);
    ctx.beginPath();
    ctx.arc(p.x, p.y, z * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1 - phase;
    ctx.lineWidth = Math.max(2, z * 0.07);
    ctx.beginPath();
    ctx.arc(p.x, p.y, z * (0.62 + 0.5 * phase), 0, Math.PI * 2);
    ctx.stroke();
  }
  if (marks.path.length > 0) {
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = Math.max(3, z * 0.14);
    ctx.lineCap = 'round';
    ctx.setLineDash([z * 0.3, z * 0.3]);
    ctx.lineDashOffset = -phase * z * 0.6;
    ctx.beginPath();
    marks.path.forEach((c, i) => {
      const p = centre(c);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
  }
  ctx.restore();
}
