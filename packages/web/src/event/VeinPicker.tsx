/**
 * The Rich vein board: the acting player's own plot with every legal cell for
 * the new node highlighted. A click chooses a cell (the screen's button then
 * confirms it); the pointer shows a preview of the node.
 */
import type { Cell } from '@game/core';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { BoardView, type OverlayContext } from '../board/BoardView.js';
import { CameraController } from '../board/controller.js';
import { cellToView } from '../board/layout.js';
import { content } from '../content.js';
import { registerDebug, unregisterDebug } from '../debug-hook.js';
import { drawVeinOverlay, type VeinOverlayData } from './vein-overlay.js';
import type { VeinView } from './view-model.js';
import type { RunState } from '@game/session';

const camera = new CameraController();
camera.resetPreset = 'fit';
camera.refitOnResize = true;

const FALLBACK_COLOR = '#888888';

export function VeinPicker(props: {
  readonly run: RunState;
  readonly acting: number;
  readonly vein: VeinView;
  /** The cell the player has marked (confirmed or not), or null. */
  readonly marked: Cell | null;
  readonly onMark: (cell: Cell) => void;
}) {
  const { run, acting, vein, marked } = props;
  const team = run.team;
  const [hover, setHover] = useState<Cell | null>(null);
  const legal = useMemo(
    () => new Set(vein.cells.map((c) => c.y * team.map.width + c.x)),
    [vein.cells, team.map.width],
  );
  const color = content.resources.get(vein.resource)?.color ?? FALLBACK_COLOR;
  const data = useRef<VeinOverlayData>({
    team,
    acting,
    legal,
    hover,
    chosen: marked,
    color,
  });
  data.current = { team, acting, legal, hover, chosen: marked, color };
  const wrap = useRef<HTMLDivElement>(null);
  // The smoke script reads the legal cells and clicks one (the Core screen's
  // hook, same shape).
  useEffect(() => {
    registerDebug({
      placement: {
        legal: () =>
          [...data.current.legal].map((k) => ({
            x: k % data.current.team.map.width,
            y: Math.floor(k / data.current.team.map.width),
          })),
        cellToScreen: (x, y) => {
          const el = wrap.current?.querySelector('canvas');
          if (!el) return null;
          const r = el.getBoundingClientRect();
          const t = data.current.team;
          const frame = {
            id: 'own' as const,
            w: t.map.width,
            h: t.map.height,
            ox: 0,
            oy: 0,
            turned: false,
          };
          const v = cellToView(frame, x, y);
          const cam = camera.camera;
          const vp = camera.viewport;
          return {
            x: r.left + (v.x + 0.5 - cam.cx) * cam.zoom + vp.w / 2,
            y: r.top + (v.y + 0.5 - cam.cy) * cam.zoom + vp.h / 2,
          };
        },
        selected: () => data.current.chosen,
        pathCount: () => 0,
        plotWidth: () => data.current.team.map.plotWidth,
      },
    });
    return () => {
      unregisterDebug('placement');
    };
  }, []);
  const draw = useRef((ctx: CanvasRenderingContext2D, o: OverlayContext) => {
    drawVeinOverlay(ctx, o, data.current);
  });
  return (
    <div class="core-board" id="vein-board" ref={wrap}>
      <p class="core-hint" data-field="vein-hint" role="status">
        {marked === null
          ? `Click a green cell to add a ${vein.resourceName} node.`
          : `${vein.resourceName} node at (${String(marked.x)}, ${String(marked.y)}). Confirm, or click another cell.`}
      </p>
      <BoardView
        content={content}
        own={team}
        controller={camera}
        resetKey={`${run.runId}:vein`}
        cursor="crosshair"
        controls={false}
        drawOverlay={draw.current}
        overlayKey={`${String(acting)}:${String(hover?.x)},${String(hover?.y)}|${String(marked?.x)},${String(marked?.y)}|${String(vein.cells.length)}`}
        onHover={(hit) => {
          const next =
            hit === null || hit.board !== 'own' ? null : { x: hit.x, y: hit.y };
          setHover((prev) =>
            prev?.x === next?.x && prev?.y === next?.y ? prev : next,
          );
        }}
        onSelect={(s) => {
          if (
            s !== null &&
            s.board === 'own' &&
            legal.has(s.y * team.map.width + s.x)
          ) {
            props.onMark({ x: s.x, y: s.y });
          }
        }}
      />
    </div>
  );
}
