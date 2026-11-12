/**
 * The Core placement screen (wireframe 6): the whole map, the positions where
 * the Core fits, the reason it does not fit elsewhere, the routes enemy units
 * would take to the chosen position, and Ready. Each player places their own
 * Core in their own plot (other plots are dimmed). A click on a legal cell
 * sends `place_core`; the choice can be changed until the player is Ready
 * (Unready reopens it). The step ends when every player has placed and is
 * Ready; after that the Core cannot be moved. Legal positions and reasons
 * come from `core`.
 */
import type { Cell } from '@game/core';
import { coreFootprint } from '@game/core';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useStore } from '../app-state.js';
import { BoardView, type OverlayContext } from '../board/BoardView.js';
import { CameraController } from '../board/controller.js';
import { cellToView } from '../board/layout.js';
import { economy, simConfig } from '../build/setup.js';
import { reasonMessage } from '../build/reasons.js';
import { content } from '../content.js';
import { registerDebug, unregisterDebug } from '../debug-hook.js';
import type { RunHandle } from '../run/handle.js';
import { AppShell, Panel } from '../shell/AppShell.js';
import { drawCoreOverlay, type Candidate } from './overlay.js';
import {
  hintText,
  kitRows,
  coreCells,
  legalSet,
  routesFor,
  verdictAt,
} from './view-model.js';
import { pendingCoreSpots } from '../build/view-model.js';
import { count } from '../plural.js';

const camera = new CameraController();
camera.resetPreset = 'fit';
camera.refitOnResize = true;

export function CoreScreen(props: { run: RunHandle }) {
  const { session } = props.run;
  const view = useStore(session.store);
  const team = view.run.team;
  const acting = view.acting;
  const [hover, setHover] = useState<Cell | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  // The acting player's chosen spot is the one the run holds for them.
  const mine = useMemo(() => {
    const c = pendingCoreSpots(view.run.pending).find(
      (c) => c.player === acting,
    );
    return c === undefined ? null : { x: c.x, y: c.y };
  }, [view.run.pending, acting]);
  const selected = mine;
  const selectedRef = useRef<Cell | null>(null);
  selectedRef.current = selected;
  const isReady = view.run.perPlayer[acting]?.ready === true;
  const fp = useMemo(() => coreFootprint(content.buildings), []);

  const legal = useMemo(() => legalSet(team, content, acting), [team, acting]);
  const hoverCand: Candidate | null = useMemo(
    () =>
      hover === null
        ? null
        : { pos: hover, verdict: verdictAt(team, content, hover, acting) },
    [team, hover, acting],
  );
  const selectedCand: Candidate | null = useMemo(
    () =>
      selected === null
        ? null
        : {
            pos: selected,
            verdict: verdictAt(team, content, selected, acting),
          },
    [team, selected, acting],
  );
  // Routes follow the pointer while it is over a legal position, else the choice.
  const previewPos =
    hoverCand?.verdict.ok === true ? hoverCand.pos : (selected ?? null);
  const paths = useMemo(
    () =>
      previewPos === null
        ? null
        : routesFor(team, content, simConfig, previewPos, acting),
    [team, previewPos, acting],
  );

  const partners = useMemo(
    () =>
      pendingCoreSpots(view.run.pending)
        .filter((c) => c.player !== acting)
        .map((c) => ({ player: c.player, cells: coreCells(content, c) })),
    [view.run.pending, acting],
  );
  const data = useRef({
    legal,
    hoverCand,
    selectedCand,
    paths,
    team,
    partners,
    acting,
  });
  data.current = {
    legal,
    hoverCand,
    selectedCand,
    paths,
    team,
    partners,
    acting,
  };
  const drawOverlay = useRef(
    (ctx: CanvasRenderingContext2D, o: OverlayContext) => {
      const d = data.current;
      drawCoreOverlay(ctx, o, {
        team: d.team,
        legal: d.legal,
        hover: d.hoverCand,
        selected: d.selectedCand,
        paths: d.paths,
        partners: d.partners,
        acting: d.acting,
      });
    },
  );

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
          const frame = {
            id: 'own' as const,
            w: data.current.team.map.width,
            h: data.current.team.map.height,
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
        selected: () => selectedRef.current,
        pathCount: () => data.current.paths?.length ?? 0,
        plotWidth: () => data.current.team.map.plotWidth,
      },
    });
    return () => {
      unregisterDebug('placement');
    };
  }, []);
  const onSelect = (cell: Cell): void => {
    const v = verdictAt(team, content, cell, acting);
    if (!v.ok) {
      setProblem(v.text);
      return;
    }
    if (busy) return;
    setBusy(true);
    void session
      .dispatch({ type: 'place_core', x: cell.x, y: cell.y })
      .then((r) => {
        setBusy(false);
        setProblem(r.ok ? null : reasonMessage(r.reason, r.detail));
      });
  };

  const setReady = (ready: boolean): void => {
    if (busy || (ready && selected === null)) return;
    setBusy(true);
    void session.dispatch({ type: ready ? 'ready' : 'unready' }).then((r) => {
      setBusy(false);
      setProblem(r.ok ? null : reasonMessage(r.reason, r.detail));
    });
  };

  const kit = kitRows(economy, content);
  const routeCount = paths?.length ?? 0;

  return (
    <AppShell
      title="New run · Place the Core"
      right={
        <Panel title="The Core" id="panel-core">
          <p>
            Pick a {fp.width} × {fp.height} spot for your Core in your own area.
            You can change it until you are Ready; once everyone is Ready it
            cannot be moved for the rest of the run.
          </p>
          <p class="muted">
            Deep is safer. Forward shortens your supply lines.
          </p>
          <ul class="legend-list" aria-label="Map key">
            <li>
              <span class="swatch ok" aria-hidden="true" /> Green: the Core fits
              there
            </li>
            <li>
              <span class="swatch bad" aria-hidden="true" /> Red: it does not
              fit (point at a cell to see why)
            </li>
            <li>
              <span class="swatch path" aria-hidden="true" /> Solid line: the
              shortest route; faint dashes: other routes. Where enemy units walk
              to reach the Core
            </li>
          </ul>
          {previewPos === null ? null : (
            <p class="muted" data-field="route-count">
              {routeCount === 0
                ? 'No enemy route reaches this position.'
                : `${count(routeCount, 'enemy route')} shown for this position.`}
            </p>
          )}
          {isReady ? (
            <button
              type="button"
              id="core-unready"
              disabled={busy}
              onClick={() => {
                setReady(false);
              }}
            >
              Unready (change the Core)
            </button>
          ) : (
            <button
              type="button"
              id="core-confirm"
              class="primary"
              disabled={selected === null || busy}
              onClick={() => {
                setReady(true);
              }}
            >
              Ready
            </button>
          )}
        </Panel>
      }
      bottom={
        <Panel title="Starting kit · in your stash when the run begins">
          <ul class="kit-list" id="starting-kit">
            {kit.map((k) => (
              <li key={k.key}>{k.text}</li>
            ))}
          </ul>
          <p class="muted">
            When every player is Ready you go to the Build screen, then to the
            first PvE battle.
          </p>
        </Panel>
      }
    >
      <div class="core-board" ref={wrap}>
        <p
          class={
            hoverCand !== null && !hoverCand.verdict.ok
              ? 'core-hint bad'
              : 'core-hint'
          }
          id="core-hint"
          data-field="core-hint"
          role="status"
        >
          {hintText({
            hover: hoverCand?.verdict ?? null,
            selected,
            message: problem,
            ready: isReady,
          })}
        </p>

        <BoardView
          content={content}
          own={team}
          controller={camera}
          resetKey={`${view.run.runId}:core`}
          frontLabel="FRONT EDGE · enemy units enter here"
          cursor="crosshair"
          drawOverlay={drawOverlay.current}
          overlayKey={`${String(acting)}:${String(partners.length)}:${String(hover?.x)},${String(hover?.y)}|${String(selected?.x)},${String(selected?.y)}|${String(paths?.length)}`}
          onHover={(hit) => {
            const next =
              hit === null || hit.board !== 'own'
                ? null
                : { x: hit.x, y: hit.y };
            setHover((prev) => {
              if (prev?.x !== next?.x || prev?.y !== next?.y) setProblem(null);
              return next;
            });
          }}
          onSelect={(s) => {
            if (s !== null && s.board === 'own') onSelect({ x: s.x, y: s.y });
          }}
        />
      </div>
    </AppShell>
  );
}
