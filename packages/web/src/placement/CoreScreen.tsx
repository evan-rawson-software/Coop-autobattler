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
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { SpriteIcon } from '../sprites/SpriteIcon.js';
import { useStore } from '../app-state.js';
import { BoardView, type OverlayContext } from '../board/BoardView.js';
import { CameraController } from '../board/controller.js';
import { cellToView } from '../board/layout.js';
import { economy, simConfig } from '../build/setup.js';
import { reasonMessage } from '../build/reasons.js';
import { content } from '../content.js';
import { registerDebug, unregisterDebug } from '../debug-hook.js';
import type { RunHandle } from '../run/handle.js';
import { Panel } from '../shell/AppShell.js';
import { GameFrame } from '../shell/GameFrame.js';
import { screenText, screenTexts } from '../build/texts.js';
import { drawCoreOverlay, type Candidate } from './overlay.js';
import {
  choiceAnnouncement,
  hintText,
  isRepeatClick,
  visibleProblem,
  type StoredProblem,
  kitSlots,
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
  const [stored, setStored] = useState<StoredProblem | null>(null);
  const problem = visibleProblem(stored, acting);
  const setProblem = (text: string | null): void => {
    setStored(text === null ? null : { acting, text });
  };
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

  const legal = useMemo(
    () => legalSet(team, content, acting, isReady),
    [team, acting, isReady],
  );
  const hoverCand: Candidate | null = useMemo(
    () =>
      hover === null || isReady
        ? null
        : { pos: hover, verdict: verdictAt(team, content, hover, acting) },
    [team, hover, acting, isReady],
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
    // A repeat click on the chosen spot changes nothing: send nothing.
    if (isRepeatClick(selectedRef.current, cell)) {
      setProblem(isReady ? reasonMessage('locked_ready') : null);
      return;
    }
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

  const kit = kitSlots(economy, content);
  const routeCount = paths?.length ?? 0;

  const primary = isReady
    ? {
        id: 'core-unready',
        label: (
          <>
            <SpriteIcon name="ui_icon_ready" scale={1} class="ready-icon" />
            Unready
          </>
        ),
        class: 'on',
        disabled: busy,
        onPress: () => {
          setReady(false);
        },
      }
    : {
        id: 'core-confirm',
        label: (
          <>
            {screenText(screenTexts, 'uiPrimaryPlaceCore')}
            <span class="primary-sub">
              {screenText(screenTexts, 'uiPrimaryPlaceCoreSub')}
            </span>
          </>
        ),
        disabled: selected === null || busy,
        onPress: () => {
          setReady(true);
        },
      };

  return (
    <GameFrame
      phase="core"
      title="New run · Place the Core"
      rail={{ camera }}
      primary={primary}
      tray={
        <div class="tray-kit" id="starting-kit">
          <div class="tray-kit-head">
            <span class="tray-label">
              {screenText(screenTexts, 'uiTrayKitLabel')}
            </span>
            <span class="tray-kit-sub">
              {screenText(screenTexts, 'uiTrayKitPlace')}
            </span>
          </div>
          <ul class="tray-slots kit-slots">
            {kit.map((k) => (
              <li key={k.key}>
                <div
                  class="slot kit-slot"
                  data-kit-def={k.def ?? 'random-wall'}
                  title={
                    k.def === null
                      ? screenText(screenTexts, 'uiKitRandomWallTip')
                      : undefined
                  }
                >
                  <span
                    class="swatch"
                    style={{
                      background: `var(--kind-${(content.buildings.get(k.def ?? 'bld_wall_o')?.kind ?? 'core').replace('_', '-')})`,
                    }}
                  >
                    {k.def === null ? (
                      <span aria-hidden="true">?</span>
                    ) : (
                      <SpriteIcon name={k.def} size={32} />
                    )}
                  </span>
                  <span class="slot-name">
                    {k.name ?? screenText(screenTexts, 'uiKitRandomWall')}
                  </span>
                  <span class="slot-meta">
                    T{k.tier} × {k.count}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      }
      info={
        <Panel
          title={screenText(screenTexts, 'coreTitle')}
          id="panel-core"
          class="core-panel"
        >
          <p>{screenText(screenTexts, 'coreAbout')}</p>
          <p>
            {screenText(screenTexts, 'coreClickPre')}
            <strong class="green-word">
              {screenText(screenTexts, 'coreClickGreen')}
            </strong>
            {screenText(screenTexts, 'coreClickPost')}
          </p>
          {previewPos === null ? null : (
            <p class="muted" data-field="route-count">
              {routeCount === 0
                ? 'No enemy route reaches here.'
                : `Enemies have ${count(routeCount, 'way')} to reach this spot. Walls can block ${routeCount === 1 ? 'it' : 'some'}.`}
            </p>
          )}
          <div class="core-next" data-field="core-next">
            <h3 class="core-next-label">
              {screenText(screenTexts, 'coreNextLabel')}
            </h3>
            <p>
              {screenText(screenTexts, 'coreNextPre')}
              <strong>{screenText(screenTexts, 'coreNextBuild')}</strong>
              {screenText(screenTexts, 'coreNextPost')}
            </p>
          </div>
        </Panel>
      }
      board={
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

          <p class="sr-only" aria-live="polite" data-field="core-choice">
            {choiceAnnouncement(selected, isReady)}
          </p>

          <BoardView
            content={content}
            own={team}
            controller={camera}
            resetKey={`${view.run.runId}:core`}
            frontLabel={screenText(screenTexts, 'coreFrontLabel')}
            cursor="crosshair"
            controls={false}
            drawOverlay={drawOverlay.current}
            overlayKey={`${String(acting)}:${String(partners.length)}:${String(hover?.x)},${String(hover?.y)}|${String(selected?.x)},${String(selected?.y)}|${String(paths?.length)}`}
            onHover={(hit) => {
              const next =
                hit === null || hit.board !== 'own'
                  ? null
                  : { x: hit.x, y: hit.y };
              setHover((prev) => {
                if (prev?.x !== next?.x || prev?.y !== next?.y)
                  setProblem(null);
                return next;
              });
            }}
            onSelect={(s) => {
              if (s !== null && s.board === 'own') onSelect({ x: s.x, y: s.y });
            }}
          />
        </div>
      }
    />
  );
}
