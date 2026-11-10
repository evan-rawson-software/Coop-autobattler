/**
 * The board view: a canvas showing one or two boards through a pan-and-zoom
 * camera. It renders from `core` team states only and reports hover and
 * selection through callbacks.
 */

import type { TeamState } from '@game/core';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import type { WebContent } from '../content.js';
import { registerDebug } from '../debug-hook.js';
import { screenToWorld } from './camera.js';
import type { CameraController } from './controller.js';
import {
  gestureReduce,
  initialGesture,
  type GestureEffect,
} from './gestures.js';
import { render, type Selection } from './render.js';
import { buildScene, hitTest, ownCoreCentre, type Hit } from './scene.js';
import { readTheme } from './theme.js';
import { CameraControls } from './CameraControls.js';

export type { Selection } from './render.js';

export interface BoardViewProps {
  readonly content: WebContent;
  readonly own: TeamState;
  /** A second board drawn above ours, turned to face it. */
  readonly enemy?: TeamState | null;
  /** Height in cells of the empty strip between the boards. */
  readonly neutralHeight?: number;
  readonly controller: CameraController;
  /** Changing this puts the camera back at Center (new map, new screen). */
  readonly resetKey?: unknown;
  readonly selection?: Selection | null;
  readonly onHover?: (hit: Hit | null) => void;
  readonly onSelect?: (selection: Selection | null) => void;
  readonly neutralLabel?: string;
  readonly frontLabel?: string;
}

function sameHit(a: Hit | null, b: Hit | null): boolean {
  if (a === null || b === null) return a === b;
  return a.board === b.board && a.x === b.x && a.y === b.y;
}

export function BoardView(props: BoardViewProps) {
  const {
    content,
    own,
    enemy = null,
    neutralHeight = 0,
    controller,
    resetKey,
    selection = null,
  } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  const scene = useMemo(
    () => buildScene(own, enemy, neutralHeight, content),
    [own, enemy, neutralHeight, content],
  );

  // Mutable view state, read by the draw loop without re-rendering.
  const live = useRef({
    scene,
    selection,
    hover: null as Hit | null,
    gesture: initialGesture,
    dpr: 1,
    theme: null as ReturnType<typeof readTheme> | null,
    dirty: false,
    frame: 0,
    draws: 0,
    drawMs: 0,
    drawMax: 0,
    props,
  });
  live.current.scene = scene;
  live.current.selection = selection;
  live.current.props = props;

  const requestDraw = useRef(() => {});
  requestDraw.current = () => {
    const s = live.current;
    if (s.dirty) return;
    s.dirty = true;
    s.frame = requestAnimationFrame(() => {
      s.dirty = false;
      const cv = canvas.current;
      const ctx = cv?.getContext('2d');
      if (!cv || !ctx) return;
      s.theme ??= readTheme(document.documentElement);
      const vp = controller.viewport;
      if (vp.w === 0 || vp.h === 0) return;
      const t0 = performance.now();
      ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
      render(ctx, {
        scene: s.scene,
        camera: controller.camera,
        viewport: vp,
        theme: s.theme,
        hover: s.hover,
        selection: s.selection,
        neutralLabel: s.props.neutralLabel ?? 'Neutral zone',
        frontLabel: s.props.frontLabel ?? 'Front edge',
      });
      const dt = performance.now() - t0;
      s.draws += 1;
      s.drawMs += dt;
      s.drawMax = Math.max(s.drawMax, dt);
    });
  };

  // Layout and camera reset.
  useEffect(() => {
    controller.setLayout(
      scene.layout.bounds,
      ownCoreCentre(scene),
      resetKey ?? JSON.stringify(scene.layout.bounds),
    );
    requestDraw.current();
  }, [scene, resetKey, controller]);

  // Redraw on selection change.
  useEffect(() => {
    requestDraw.current();
  }, [selection, scene]);

  // Canvas size, device pixel ratio, theme changes.
  useEffect(() => {
    const el = wrap.current;
    const cv = canvas.current;
    if (!el || !cv) return;
    const s = live.current;
    const resize = (): void => {
      const w = Math.max(0, Math.floor(el.clientWidth));
      const h = Math.max(0, Math.floor(el.clientHeight));
      const dpr = window.devicePixelRatio || 1;
      s.dpr = dpr;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cv.style.width = `${String(w)}px`;
      cv.style.height = `${String(h)}px`;
      controller.setViewport({ w, h });
      requestDraw.current();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    const unsub = controller.subscribe(() => {
      requestDraw.current();
    });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onTheme = (): void => {
      s.theme = null;
      requestDraw.current();
    };
    mq.addEventListener('change', onTheme);
    const mo = new MutationObserver(onTheme);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => {
      ro.disconnect();
      unsub();
      mq.removeEventListener('change', onTheme);
      mo.disconnect();
      cancelAnimationFrame(s.frame);
      s.dirty = false;
    };
  }, [controller]);

  // Wheel needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const k = e.ctrlKey ? 0.01 : 0.0015;
      const r = cv.getBoundingClientRect();
      controller.zoomAt(
        { x: e.clientX - r.left, y: e.clientY - r.top },
        Math.exp(-e.deltaY * unit * k),
      );
    };
    cv.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      cv.removeEventListener('wheel', onWheel);
    };
  }, [controller]);

  useEffect(() => {
    registerDebug({
      camera: () => controller.camera,
      viewport: () => controller.viewport,
      hovered: () => live.current.hover,
      selection: () => live.current.selection,
      drawStats: () => {
        const s = live.current;
        return {
          count: s.draws,
          meanMs: s.draws === 0 ? 0 : s.drawMs / s.draws,
          maxMs: s.drawMax,
        };
      },
      resetDrawStats: () => {
        const s = live.current;
        s.draws = 0;
        s.drawMs = 0;
        s.drawMax = 0;
      },
    });
  }, [controller]);

  const localPoint = (e: PointerEvent): { x: number; y: number } => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const hitAt = (p: { x: number; y: number }): Hit | null => {
    const w = screenToWorld(controller.camera, controller.viewport, p);
    return hitTest(live.current.scene, w.x, w.y);
  };

  const setHover = (hit: Hit | null): void => {
    const s = live.current;
    if (sameHit(s.hover, hit)) return;
    s.hover = hit;
    requestDraw.current();
    s.props.onHover?.(hit);
  };

  const apply = (effects: readonly GestureEffect[]): void => {
    for (const fx of effects) {
      if (fx.type === 'pan') controller.pan(fx.dx, fx.dy);
      else if (fx.type === 'zoom') controller.zoomAt(fx.at, fx.factor);
      else {
        const hit = hitAt(fx.at);
        live.current.props.onSelect?.(
          hit === null
            ? null
            : {
                board: hit.board,
                building:
                  hit.building === null
                    ? null
                    : hit.building === 'core'
                      ? 'core'
                      : hit.building.id,
                x: hit.x,
                y: hit.y,
              },
        );
      }
    }
  };

  const feed = (ev: Parameters<typeof gestureReduce>[1]): void => {
    const r = gestureReduce(live.current.gesture, ev);
    live.current.gesture = r.state;
    apply(r.effects);
  };

  return (
    <div class="board-view" ref={wrap}>
      <canvas
        ref={canvas}
        class="board-canvas"
        data-testid="board-canvas"
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          const p = localPoint(e);
          feed({ type: 'down', id: e.pointerId, x: p.x, y: p.y });
        }}
        onPointerMove={(e) => {
          const p = localPoint(e);
          feed({ type: 'move', id: e.pointerId, x: p.x, y: p.y });
          if (e.pointerType === 'mouse') setHover(hitAt(p));
        }}
        onPointerUp={(e) => {
          const p = localPoint(e);
          feed({ type: 'up', id: e.pointerId, x: p.x, y: p.y });
        }}
        onPointerCancel={(e) => {
          feed({ type: 'cancel', id: e.pointerId });
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') setHover(null);
        }}
      />
      <CameraControls controller={controller} />
    </div>
  );
}
