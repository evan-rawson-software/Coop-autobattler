/**
 * The Build screen (W2-6): lay out the factory between battles. It is one tab
 * of the Shop + Build step. A dev entry (`#build`) starts a solo run, with a
 * minimal Core placement first. All rules come from `core` and `session`.
 */

import {
  hashJson,
  previewEnemyPaths,
  type Cell,
  type EnemyPath,
} from '@game/core';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useStore } from '../app-state.js';
import { BoardView, type OverlayContext } from '../board/BoardView.js';
import { CameraController } from '../board/controller.js';
import { cellToView } from '../board/layout.js';
import type { Selection } from '../board/render.js';
import { content } from '../content.js';
import { registerDebug } from '../debug-hook.js';
import { NotSavedNote, RestartButton } from '../run/RunGate.js';
import type { RunHandle } from '../run/handle.js';
import { AppShell, Panel } from '../shell/AppShell.js';
import { BUILD_TAB_SCREEN, onStepTab, stepTabs } from '../shop/tabs.js';
import { readyLabel } from '../shop/view-model.js';
import './build.css';
import { BuildController } from './build-controller.js';
import { drawBuildOverlay } from './overlay-draw.js';
import {
  DryRunTable,
  InspectorPanel,
  OverlaysPanel,
  PartyPanel,
  ProblemsPanel,
  StashPanel,
  ToolsPanel,
} from './panels.js';
import { ActingSwitch } from '../shell/ActingSwitch.js';
import { gateFor, READY_LOCK_TEXT, SEALED_HINT, type Gate } from './lock.js';
import { ME, isEditStep } from './session.js';
import { DEFAULT_SEED, simConfig } from './setup.js';
import { layoutHash } from './undo.js';
import {
  computeFlowView,
  deriveProblems,
  type FlowView,
  type Problem,
} from './view-model.js';

const camera = new CameraController();
camera.resetPreset = 'fit';
camera.refitOnResize = true;
const ctl = new BuildController();
let started = false;

const plain = (v: unknown): unknown => JSON.parse(JSON.stringify(v)) as unknown;

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  const tag = el?.tagName ?? '';
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
}

/**
 * The Build screen. On its own (`#build`) it starts a dev run. Given a
 * `shared` run (the Build tab of the Shop step) it works on that run, so the
 * Shop and Build tabs see the same stash, gold, offers and board.
 */
export function BuildScreen() {
  return <BuildView shared={undefined} />;
}

export function BuildView(props: { shared: RunHandle | undefined }) {
  const shared = props.shared;
  const model = useStore(ctl.model);
  const { ui, view } = model;
  const run = view?.run ?? null;
  const team = run?.team ?? null;
  const step = run?.step ?? 'none';
  const acting = view?.acting ?? ME;
  const canvasWrap = useRef<HTMLDivElement>(null);
  const [seedText, setSeedText] = useState(String(DEFAULT_SEED));

  // Start the first run on first load, or attach to the shared run.
  useEffect(() => {
    if (shared !== undefined) {
      started = true;
      if (ctl.session !== shared.session) ctl.attach(shared.session, true);
    } else if (!started || ctl.shared) {
      started = true;
      void ctl.enterDev(DEFAULT_SEED);
    }
  }, [shared?.session]);

  // Camera focus for the problems list.
  useEffect(() => {
    ctl.focusCell = (c: Cell) => {
      const t = ctl.team();
      if (t === null) return;
      const frame = {
        id: 'own' as const,
        w: t.map.width,
        h: t.map.height,
        ox: 0,
        oy: 0,
        turned: false,
      };
      const v = cellToView(frame, c.x, c.y);
      camera.focusAt({ x: v.x + 0.5, y: v.y + 0.5 });
    };
  }, []);

  // Keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTyping(e.target) && e.key !== 'Escape') return;
      if (ctl.key(e)) e.preventDefault();
    };
    const onUp = (e: PointerEvent): void => {
      // A press on the stash that ended off the board cancels the drag.
      const t = e.target as HTMLElement | null;
      if (t?.closest('canvas') || t?.closest('.stash-item')) return;
      ctl.dropOutside();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  // Derived overlays: pure functions of the team state.
  const flow: FlowView | null = useMemo(
    () =>
      team !== null && isEditStep(step)
        ? computeFlowView(team, content, simConfig, ui.dryTicks)
        : null,
    [team, step, ui.dryTicks],
  );
  const paths: EnemyPath[] | null = useMemo(() => {
    if (
      team === null ||
      team.cores.every((c) => c === null) ||
      !isEditStep(step)
    )
      return null;
    try {
      return previewEnemyPaths(team, content, simConfig);
    } catch {
      return null;
    }
  }, [team, step]);
  const problems: Problem[] = useMemo(
    () =>
      team !== null && isEditStep(step)
        ? deriveProblems(team, content, flow)
        : [],
    [team, step, flow],
  );

  // What the session allows now: Ready lock and sealed unit producers. Only
  // on the shared run (the dev route has no rules deps).
  const gate: Gate | null = useMemo(
    () =>
      shared === undefined || run === null || !isEditStep(step)
        ? null
        : gateFor(run, acting, shared.deps, content),
    [run, step, shared, acting],
  );
  const sealedIds = gate?.sealed.ids ?? [];
  const sealedKey = sealedIds.join(',');

  // Latest data for the overlay drawer and the debug hook.
  const data = useRef({
    ui,
    team,
    step,
    flow,
    paths,
    sealed: sealedIds,
    acting,
  });
  data.current = { ui, team, step, flow, paths, sealed: sealedIds, acting };
  const overlayKey = useMemo(
    () => ({ ui, sealedKey, acting, run }),
    [ui, sealedKey, acting, run],
  );

  const drawOverlay = useRef(
    (ctx: CanvasRenderingContext2D, o: OverlayContext) => {
      const d = data.current;
      if (d.team === null) return;
      drawBuildOverlay(ctx, o, {
        ui: d.ui,
        team: d.team,
        step: d.step,
        flow: d.flow,
        paths: d.paths,
        sealed: d.sealed,
        legalCore: ctl.legalCorePositions,
        acting: d.acting,
        partnerCores: ctl.partnerCores(),
        content,
      });
    },
  );

  useEffect(() => {
    registerDebug({
      build: {
        step: () => ctl.session?.run.step ?? 'none',
        hash: () => {
          const t = ctl.team();
          return t === null ? '' : layoutHash(t);
        },
        team: () => {
          const t = ctl.team();
          return t === null
            ? null
            : plain({
                cores: t.cores,
                buildings: t.buildings,
                stash: t.stash,
                conduits: t.conduits,
                nodes: t.map.nodes,
                features: t.map.features,
                width: t.map.width,
                height: t.map.height,
                hashAll: hashJson(t),
              });
        },
        status: () => ctl.model.get().ui.status,
        ui: () => {
          const u = ctl.model.get().ui;
          return plain({
            tool: u.tool,
            selection: u.selection,
            held: u.held,
            overlays: u.overlays,
            ghost: u.ghost,
            draftView: u.draftView,
            attempt: u.attempt,
            coreGhost: u.coreGhost,
          });
        },
        counts: () => {
          const v = ctl.model.get().view;
          return {
            undo: v?.undoCount ?? 0,
            redo: v?.redoCount ?? 0,
            actions: v?.run.actionLog.length ?? 0,
          };
        },
        cellToScreen: (x, y) => {
          const el = canvasWrap.current?.querySelector('canvas');
          const t = ctl.team();
          if (!el || t === null) return null;
          const r = el.getBoundingClientRect();
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
        problems: () =>
          data.current.team === null
            ? []
            : deriveProblems(data.current.team, content, data.current.flow).map(
                (p) => ({ id: p.id, kind: p.kind, text: p.text }),
              ),
        legalCore: () => [...ctl.legalCorePositions],
        acting: () => data.current.acting,
        partnerCores: () => [...ctl.partnerCores()],
        sealed: () => [...data.current.sealed],
        enemyPathCount: () => data.current.paths?.length ?? 0,
        dry: () => data.current.flow?.dry ?? null,
      },
    });
  }, []);

  const selection: Selection | null = useMemo(() => {
    const s = ui.selection;
    if (s === null || s.kind === 'conduit') return null;
    return {
      board: 'own',
      building: s.kind === 'core' ? 'core' : s.id,
      x: 0,
      y: 0,
    };
  }, [ui.selection]);

  const cursor =
    ui.held !== null || ui.moving?.started === true
      ? 'copy'
      : ui.tool === 'conduit'
        ? 'crosshair'
        : ui.tool === 'erase'
          ? 'not-allowed'
          : step === 'core_placement'
            ? 'crosshair'
            : undefined;

  const onPick = (p: Problem): void => {
    if (p.building !== null) ctl.select({ kind: 'building', id: p.building });
    if (p.focus !== null) ctl.focusCell(p.focus);
  };

  const readyText = run === null ? null : readyLabel(run);
  const devStrip = shared ? (
    run === null ? null : (
      <>
        <span class="muted" data-field="run-info">
          Round {run.round} · Lives {run.lives}
          {readyText === null ? '' : ` · ${readyText}`}
        </span>
        <NotSavedNote run={shared} />
      </>
    )
  ) : (
    <span class="dev-strip">
      <label>
        Seed{' '}
        <input
          type="number"
          id="seed-input"
          min="0"
          max="4294967295"
          value={seedText}
          onInput={(e) => {
            setSeedText(e.currentTarget.value);
          }}
        />
      </label>
      <button
        type="button"
        id="new-run"
        onClick={() => {
          const n = Math.floor(Number(seedText));
          if (Number.isFinite(n) && n >= 0 && n <= 0xffffffff)
            void ctl.newRun(n);
        }}
      >
        New run (seed)
      </button>
      {run !== null ? (
        <span class="muted" data-field="run-info">
          Round {run.round} · Lives {run.lives}
          {readyText === null ? '' : ` · ${readyText}`}
        </span>
      ) : null}
    </span>
  );

  // The first Build (before the first battle) has no shop to go with it.
  const tabs = shared
    ? step === 'build'
      ? [{ id: BUILD_TAB_SCREEN, label: 'Build' }]
      : stepTabs()
    : [
        { id: 'shop', label: 'Shop', disabled: true, hint: 'Coming soon' },
        { id: 'build', label: 'Build' },
      ];

  // ---- Other steps: a placeholder ----------------------------------------
  if (run !== null && !isEditStep(step) && step !== 'core_placement') {
    return (
      <AppShell
        title={`Round ${String(run.round)} · ${step}`}
        status={devStrip}
      >
        <div class="placeholder" id="step-placeholder">
          <Panel title="Next step" id="panel-next-step">
            <p>
              The run is now in step <strong data-field="step">{step}</strong>{' '}
              (round {run.round}). There is no screen for it yet.
            </p>
            <p class="muted" data-field="status-line">
              {ui.status.text}
            </p>
            {shared !== undefined ? (
              <RestartButton />
            ) : (
              <button
                type="button"
                id="dev-new-run"
                onClick={() => {
                  void ctl.newRun(model.seed);
                }}
              >
                {`Start a new run (seed ${String(model.seed)})`}
              </button>
            )}
          </Panel>
        </div>
      </AppShell>
    );
  }

  const boardArea =
    team === null ? (
      <p class="muted pad">Starting a run.</p>
    ) : (
      <div class="build-board" ref={canvasWrap}>
        <div class="build-canvas">
          <BoardView
            content={content}
            own={team}
            controller={camera}
            resetKey={`${run?.runId ?? ''}:${step}`}
            selection={selection}
            frontLabel="FRONT EDGE · enemy units enter here"
            cursor={cursor}
            drawOverlay={drawOverlay.current}
            overlayKey={overlayKey}
            animate={ui.overlays.flow}
            onHover={(hit) => {
              ctl.hover(hit === null ? null : { x: hit.x, y: hit.y });
            }}
            onSelect={(s) => {
              if (
                isEditStep(step) &&
                ui.tool === 'select' &&
                s?.building === null
              ) {
                ctl.select(null);
              }
            }}
            onBoardPointer={(ev) => ctl.onBoardPointer(ev)}
          />
          {ui.overlays.dry && flow !== null ? (
            <DryRunTable
              team={team}
              flow={flow}
              onClose={() => {
                ctl.setOverlay('dry', false);
              }}
            />
          ) : null}
        </div>
        {gate?.sealed.reason == null ? null : (
          <div class="status-line error" id="sealed-warning" role="alert">
            <strong>{gate.sealed.labels.join(', ')}</strong> — {SEALED_HINT}{' '}
            Ready is disabled until a route to the front is open.
          </div>
        )}
        {gate?.ready === true ? (
          <div class="status-line info" id="ready-lock" role="status">
            {READY_LOCK_TEXT}
          </div>
        ) : null}
        <div
          class={`status-line ${ui.status.kind}`}
          id="status-line"
          role="status"
          data-kind={ui.status.kind}
        >
          {ui.status.text}
        </div>
      </div>
    );

  if (step === 'core_placement') {
    return (
      <AppShell
        title="Core placement"
        status={devStrip}
        tallBottom
        bottom={
          <Panel title="Core placement" id="panel-core">
            <p>
              Click a green-dotted cell in your own area to place the Core (its
              lowest-left cell). Your starting kit then appears in the stash.{' '}
              {ctl.legalCorePositions.length} legal positions.
            </p>
            <p class="muted">
              Every player places their own Core in their own area. Choosing a
              position confirms it.
            </p>
            {run === null ? null : (
              <ActingSwitch
                run={run}
                acting={acting}
                onActing={(p) => {
                  ctl.session?.setActing(p);
                }}
              />
            )}
          </Panel>
        }
      >
        {boardArea}
      </AppShell>
    );
  }

  const bottom =
    run === null || team === null ? null : (
      <>
        <div class="dock-col">
          <StashPanel
            team={team}
            model={model}
            ctl={ctl}
            player={acting}
            locked={gate?.ready === true}
          />
          <ToolsPanel model={model} ctl={ctl} locked={gate?.ready === true} />
        </div>
        <div class="dock-col">
          <InspectorPanel
            run={run}
            model={model}
            dry={flow?.dry ?? null}
            ctl={ctl}
            sealed={sealedIds}
          />
        </div>
        <div class="dock-col">
          <OverlaysPanel model={model} ctl={ctl} />
          <ProblemsPanel problems={problems} onPick={onPick} />
        </div>
        <div class="dock-col">
          <PartyPanel
            run={run}
            ctl={ctl}
            gate={gate}
            acting={acting}
            onActing={
              shared === undefined
                ? (p) => {
                    ctl.session?.setActing(p);
                  }
                : undefined
            }
          />
        </div>
      </>
    );

  return (
    <AppShell
      title={
        run === null
          ? 'Build'
          : `Round ${String(run.round)} · ${step === 'build' ? 'Build' : 'Shop + Build'}`
      }
      tabs={tabs}
      activeTab={shared ? 'shop-build' : 'build'}
      {...(shared ? { onTab: onStepTab } : {})}
      status={devStrip}
      bottom={bottom}
      tallBottom
    >
      {boardArea}
    </AppShell>
  );
}
