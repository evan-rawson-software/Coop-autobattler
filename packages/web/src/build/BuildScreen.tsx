/**
 * The Build screen (W2-6): lay out the factory between battles. It is one tab
 * of the Shop + Build step. A dev entry (`#build`) starts a solo run, with a
 * minimal Core placement first. All rules come from `core` and `session`.
 */

import {
  hashJson,
  previewEnemyPaths,
  sellValue,
  type Cell,
  type EnemyPath,
} from '@game/core';
import type { RunState } from '@game/session';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';
import { useStore } from '../app-state.js';
import { BoardView, type OverlayContext } from '../board/BoardView.js';
import { CameraController } from '../board/controller.js';
import { cellToView } from '../board/layout.js';
import type { Selection } from '../board/render.js';
import { content } from '../content.js';
import { registerDebug, unregisterDebug } from '../debug-hook.js';
import { NotSavedNote, RestartButton } from '../run/RunGate.js';
import type { RunHandle } from '../run/handle.js';
import { Panel } from '../shell/AppShell.js';
import { GameFrame, KeyHints } from '../shell/GameFrame.js';
import type { MapRailProps } from '../shell/MapRail.js';
import { ActingSwitch } from '../shell/ActingSwitch.js';
import { useFading, useNoticeTimeout } from '../shell/status.js';
import { heldBonuses } from '../event/view-model.js';
import {
  SellControl,
  SellStrip,
  ShopPanel,
  ShopToggle,
  type SellTarget,
} from '../shop/ShopPanel.js';
import {
  buildShopView,
  nextBattleView,
  readyLabel,
  type ShopView,
} from '../shop/view-model.js';
import './build.css';
import { BuildController } from './build-controller.js';
import { drawBuildOverlay } from './overlay-draw.js';
import {
  ChecklistPanel,
  DryRunTable,
  InspectorPanel,
  InventoryTray,
  NextFightPanel,
  OverlayLegend,
  BorderLinksPanel,
  PartyPanel,
  ToolsTray,
  groupStash,
} from './panels.js';
import { deriveChecklist } from './checklist.js';
import { newStashIds } from './new-items.js';
import { nextFight } from './next-fight.js';
import { readyPrimary } from './ready-primary.js';
import { halfAlpha, halfStatuses } from './border-links.js';
import { gateFor, READY_LOCK_TEXT, SEALED_HINT, type Gate } from './lock.js';
import { SpriteIcon } from '../sprites/SpriteIcon.js';
import { ME, isEditStep } from './session.js';
import { DEFAULT_SEED, economy, gameConfigs, simConfig } from './setup.js';
import { layoutHash } from './undo.js';
import { screenText, screenTexts } from './texts.js';
import {
  buildingName,
  computeFlowView,
  deriveProblems,
  type FlowView,
  type Problem,
  type ProblemScope,
} from './view-model.js';

/** How long a slot keeps its "just bought" highlight. */
const FLASH_MS = 1200;

/** Counts mounts of the Build screen, so the smoke script can wait for a new one. */
let mountCount = 0;

const shopCtx = { content, economy, sim: simConfig };

const camera = new CameraController();
camera.resetPreset = 'fit';
camera.refitOnResize = true;
const ctl = new BuildController();
let started = false;

const fmtSecs = (n: number): string =>
  Number.isInteger(n) ? String(n) : n.toFixed(1);

const plain = (v: unknown): unknown => JSON.parse(JSON.stringify(v)) as unknown;

/**
 * The Build screen. On its own (`#build`) it starts a dev run. Given a
 * `shared` run (the Build tab of the Shop step) it works on that run, so the
 * Shop and Build tabs see the same stash, gold, offers and board.
 */
/** The problems list is scoped to the acting player only in a party. */
function problemScope(
  run: RunState | null,
  acting: number,
): ProblemScope | undefined {
  if (run === null || run.players.length < 2) return undefined;
  return {
    acting,
    names: run.players.map((p) => p.name),
  };
}

export function BuildScreen() {
  return <BuildView shared={undefined} />;
}

export function BuildView(props: {
  shared: RunHandle | undefined;
  /** Opened on its own (`#shop`), outside the run bar: show the switcher. */
  standalone?: boolean;
}) {
  const shared = props.shared;
  const model = useStore(ctl.model);
  const { ui, view } = model;
  // A result message ('ok') times out like the shop's; hints and errors stay.
  const shownStatus = useFading(ui.status, ['ok']);
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

  // A message about a step does not outlive it.
  useEffect(() => {
    ctl.clearStaleStatus(step);
  }, [step, ui.status.step]);

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

  // A drag from the stash that ends off the board. (Keys go through the
  // frame's one key listener: `onKey` below.)
  useEffect(() => {
    const onUp = (e: PointerEvent): void => {
      // A press on the stash that ended off the board cancels the drag.
      const t = e.target as HTMLElement | null;
      if (t?.closest('canvas') || t?.closest('.stash-item')) return;
      ctl.dropOutside();
    };
    window.addEventListener('pointerup', onUp);
    return () => {
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
        ? deriveProblems(team, content, flow, problemScope(run, acting))
        : [],
    [team, step, flow, run, acting],
  );

  const checklist = useMemo(
    () =>
      team === null || !isEditStep(step)
        ? { items: [], okHidden: 0 }
        : deriveChecklist(team, content, problems, flow, acting),
    [team, step, problems, flow, acting],
  );
  const fresh = useMemo(
    () => (run === null ? new Set<number>() : newStashIds(run)),
    [run],
  );
  const next = useMemo(
    () =>
      shared === undefined || run === null || !isEditStep(step)
        ? null
        : nextFight(run, shared.deps),
    [run, step, shared],
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

  // ---- The shop (issue #302): offers in the info rail, in the shop step ----
  const inShop = shared !== undefined && step === 'shop';
  const [shopOpen, setShopOpen] = useState(false);
  const [shopSeen, setShopSeen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [sellAsk, setSellAsk] = useState(false);
  const [mountId] = useState(() => ++mountCount);
  const stepKey = `${String(run?.round ?? 0)}:${run?.leg ?? ''}:${step}`;
  // Each round's shop starts closed, with its offer count on the button.
  useEffect(() => {
    setShopOpen(false);
    setShopSeen(false);
  }, [stepKey]);
  useEffect(() => {
    if (flash === null) return undefined;
    const id = setTimeout(() => {
      setFlash(null);
    }, FLASH_MS);
    return () => {
      clearTimeout(id);
    };
  }, [flash]);
  const dismissNotice = useCallback(() => {
    (shared?.session ?? ctl.session)?.dismissNotice();
  }, [shared?.session]);
  useNoticeTimeout(view?.notice ?? null, dismissNotice);
  const open = inShop && shopOpen;
  const sv: ShopView | null = useMemo(
    () =>
      inShop && run !== null
        ? buildShopView(run, acting, shopCtx, shared.deps)
        : null,
    [inShop, run, acting, shared],
  );
  const bonuses = useMemo(
    () => (inShop && run !== null ? heldBonuses(run, gameConfigs.events) : []),
    [inShop, run],
  );
  // What Sell would remove: the selected building, or the picked slot.
  const sellTarget: SellTarget | null = useMemo(() => {
    if (!inShop || team === null) return null;
    const sel = ui.selection;
    const item =
      sel?.kind === 'building'
        ? team.buildings.find((x) => x.id === sel.id)
        : sel === null && ui.held !== null
          ? team.stash.find((x) => x.id === ui.held?.id)
          : undefined;
    if (item === undefined || item.owner !== acting) return null;
    return {
      id: item.id,
      name: buildingName(content, item.def),
      tier: item.tier,
      refund: sellValue(content, economy, item.def, item.tier),
    };
  }, [inShop, team, ui.selection, ui.held, acting]);
  const sellId = sellTarget?.id ?? null;
  useEffect(() => {
    setSellAsk(false);
  }, [sellId]);
  const onBuy = (slot: number): void => {
    const o = sv?.offers[slot]?.offer;
    if (o == null) return;
    setFlash(null);
    void ctl.buy(slot, o.name).then((ok) => {
      if (ok) setFlash(`${o.def}:${String(o.tier)}`);
    });
  };
  const sellControl =
    sellTarget === null || sv === null
      ? null
      : {
          target: sellTarget,
          asking: sellAsk,
          blocked: sv.sellBlock,
          onAsk: () => {
            setSellAsk(true);
          },
          onConfirm: () => {
            void ctl
              .sell(sellTarget.id, sellTarget.name, sellTarget.refund)
              .then(() => {
                setSellAsk(false);
              });
          },
          onCancel: () => {
            setSellAsk(false);
          },
        };
  const offersOnSale =
    sv === null ? 0 : sv.offers.filter((c) => c.offer !== null).length;

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
        links: () => {
          const t = ctl.team();
          return t === null
            ? []
            : halfStatuses(t, content).map((h) => ({
                conduit: h.conduit,
                owner: h.owner,
                kind: h.kind,
                state: h.state,
                alpha: halfAlpha(h, ctl.session?.acting ?? ME),
              }));
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
            : deriveProblems(
                data.current.team,
                content,
                data.current.flow,
                problemScope(ctl.session?.run ?? null, data.current.acting),
              ).map((p) => ({ id: p.id, kind: p.kind, text: p.text })),
        legalCore: () => [...ctl.legalCorePositions],
        acting: () => data.current.acting,
        partnerCores: () => [...ctl.partnerCores()],
        sealed: () => [...data.current.sealed],
        enemyPathCount: () => data.current.paths?.length ?? 0,
        dry: () => data.current.flow?.dry ?? null,
      },
    });
  }, []);

  // The shop's debug hook (the smoke scripts read it): the state of the
  // offers, the inventory and the run. It belongs to this mount.
  useEffect(() => {
    if (!inShop || run === null || sv === null) {
      return undefined;
    }
    const nb = nextBattleView(run, shared.deps);
    registerDebug({
      shop: {
        mounts: () => mountId,
        state: () =>
          plain({
            step: run.step,
            round: run.round,
            leg: run.leg,
            gold: sv.gold,
            offers: sv.offers.map((c) => c.offer?.def ?? null),
            offerPrices: sv.offers.map((c) => c.offer?.price ?? null),
            stash: run.team.stash.map((x) => ({
              id: x.id,
              def: x.def,
              tier: x.tier,
            })),
            placed: run.team.buildings.length,
            ready: sv.ready,
            actions: run.actionLog.length,
            undo: view?.undoCount ?? 0,
            runId: run.runId,
            next: nb === null ? null : nb.kind,
          }),
      },
    });
    return () => {
      unregisterDebug('shop');
    };
  }, [inShop, run, sv, shared, view?.undoCount, mountId]);

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
    if (p.pick !== undefined && gate?.ready !== true) ctl.pickFromStash(p.pick);
    if (p.focus !== null) ctl.focusCell(p.focus);
  };

  const readyText = run === null ? null : readyLabel(run);
  // On the run screen the run bar has the acting-player switcher; the
  // standalone dev routes have no run bar, so their dev strip carries one.
  const switcher =
    run !== null && (shared === undefined || props.standalone === true) ? (
      <ActingSwitch
        run={run}
        acting={acting}
        onActing={(p) => {
          (shared?.session ?? ctl.session)?.setActing(p);
        }}
      />
    ) : null;
  const devStrip = shared ? (
    run === null ? null : (
      <>
        <span class="muted" data-field="run-info">
          <SpriteIcon name="ui_icon_heart" scale={1} class="bar-icon" />
          Lives {run.lives}
          {readyText === null ? '' : ` · ${readyText}`}
        </span>
        {switcher}
        <NotSavedNote run={shared} />
      </>
    )
  ) : (
    <span class="dev-strip">
      {switcher}
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
          <SpriteIcon name="ui_icon_heart" scale={1} class="bar-icon" />
          Lives {run.lives}
          {readyText === null ? '' : ` · ${readyText}`}
        </span>
      ) : null}
    </span>
  );

  // One Build screen: a lone phase label (the shop is a button, not a tab).
  const tabs = [{ id: 'build', label: 'Build' }];

  // The frame's map rail: the same buttons in every phase. Flow, enemy paths
  // and the test run belong to the factory, so they are on while editing.
  const editing = run !== null && isEditStep(step);
  const toggle = (
    key: 'flow' | 'paths' | 'dry',
    label: string,
  ): NonNullable<MapRailProps['flow']> => ({
    on: ui.overlays[key],
    label,
    onToggle: () => {
      ctl.setOverlay(key, !ui.overlays[key]);
    },
  });
  const rail: MapRailProps = {
    camera,
    ...(editing
      ? {
          flow: toggle('flow', screenText(screenTexts, 'uiOverlayFlow')),
          paths: toggle('paths', screenText(screenTexts, 'uiOverlayPaths')),
          testRun: toggle(
            'dry',
            screenText(screenTexts, 'uiOverlayDry', {
              secs: fmtSecs(ui.dryTicks / simConfig.ticksPerSecond),
            }),
          ),
        }
      : {}),
  };

  // Keys of the Build phase (Space is the frame's): 1-9 pick a stash slot,
  // R rotates, C is the conduit tool, Esc cancels, closes the test run, or
  // deselects.
  const onKey = (e: KeyboardEvent): boolean => {
    if (
      /^[1-9]$/.test(e.key) &&
      !e.ctrlKey &&
      !e.metaKey &&
      team !== null &&
      isEditStep(step)
    ) {
      const group = groupStash(team, acting)[Number(e.key) - 1];
      return ctl.pickSlot(group?.ids[0]);
    }
    if (e.key === 'Escape' && sellAsk) {
      setSellAsk(false);
      return true;
    }
    if (e.key === 'Escape') {
      const u = ctl.model.get().ui;
      // Esc closes the shop unless a piece is in hand (that is cancelled first).
      if (open && u.held === null && u.moving === null && u.draft === null) {
        setShopOpen(false);
        return true;
      }
      if (
        u.overlays.dry &&
        u.held === null &&
        u.moving === null &&
        u.draft === null &&
        u.selection === null
      ) {
        ctl.setOverlay('dry', false);
        return true;
      }
    }
    return ctl.key(e);
  };

  // ---- Other steps: a placeholder ----------------------------------------
  if (run !== null && !isEditStep(step) && step !== 'core_placement') {
    return (
      <GameFrame
        phase="other"
        title={`Round ${String(run.round)} · ${step}`}
        status={devStrip}
        rail={rail}
        primary={null}
        onKey={onKey}
        board={
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
        }
      />
    );
  }

  const boardArea =
    team === null ? (
      <p class="muted pad">{screenText(screenTexts, 'uiStartingRun')}</p>
    ) : (
      <div class="build-board" ref={canvasWrap}>
        <div class="build-canvas">
          <BoardView
            content={content}
            own={team}
            controller={camera}
            resetKey={`${run?.runId ?? ''}:${step}`}
            selection={selection}
            frontLabel="FRONT EDGE"
            cursor={cursor}
            hoverInfo={
              ui.held === null && ui.moving === null && ui.draft === null
            }
            controls={false}
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
        </div>
        {gate?.sealed.reason == null ? null : (
          <div class="status-line error" id="sealed-warning" role="alert">
            <strong>{gate.sealed.labels.join(', ')}</strong> — {SEALED_HINT}
          </div>
        )}
        {gate?.ready === true ? (
          <div class="status-line info" id="ready-lock" role="status">
            <SpriteIcon name="ui_icon_lock" scale={1} class="bar-icon" />
            {READY_LOCK_TEXT}
          </div>
        ) : null}
        {view?.notice == null ? null : (
          <div
            class="status-line ok"
            id="shop-notice"
            role="status"
            data-field="notice"
          >
            <span>{view.notice}</span>
          </div>
        )}
        <div
          class={`status-line ${shownStatus.kind}`}
          id="status-line"
          role="status"
          data-kind={shownStatus.kind}
        >
          {shownStatus.text}
        </div>
      </div>
    );

  if (step === 'core_placement') {
    return (
      <GameFrame
        phase="core"
        title={screenText(screenTexts, 'uiCoreTitle')}
        status={devStrip}
        rail={rail}
        primary={null}
        onKey={onKey}
        board={boardArea}
        tray={<p class="tray-text">{screenText(screenTexts, 'uiCoreClick')}</p>}
        info={
          <Panel title={screenText(screenTexts, 'uiCoreTitle')} id="panel-core">
            <p>{screenText(screenTexts, 'uiCoreClick')}</p>
          </Panel>
        }
      />
    );
  }

  const tray =
    run === null || team === null ? null : (
      <>
        <ToolsTray model={model} ctl={ctl} locked={gate?.ready === true} />
        <InventoryTray
          team={team}
          model={model}
          ctl={ctl}
          player={acting}
          locked={gate?.ready === true}
          fresh={fresh}
          flash={flash}
        />
      </>
    );

  const sellNode =
    sellControl === null ? null : <SellControl {...sellControl} />;
  const info =
    run === null || team === null ? null : open && sv !== null ? (
      // The shop replaces the checklist and Selected; the rest of the screen
      // stays as it is, so pieces can be placed while it is open.
      <ShopPanel
        sv={sv}
        bonuses={bonuses}
        onBuy={onBuy}
        onReroll={() => {
          void ctl.reroll();
        }}
        onClose={() => {
          setShopOpen(false);
        }}
      >
        {sellControl === null ? null : <SellStrip {...sellControl} />}
      </ShopPanel>
    ) : (
      <>
        <ChecklistPanel list={checklist} onPick={onPick} />
        <InspectorPanel
          run={run}
          model={model}
          dry={flow?.dry ?? null}
          flow={flow}
          ctl={ctl}
          sealed={sealedIds}
          acting={acting}
          sell={ui.selection?.kind === 'building' ? sellNode : null}
        />
        {sellTarget !== null && ui.selection === null && ui.held !== null ? (
          <Panel
            title={screenText(screenTexts, 'uiPanelSelected')}
            id="panel-inspector"
          >
            <h3 class="insp-name" data-field="name">
              {sellTarget.name}
              {sellTarget.tier > 1 ? ` · T${String(sellTarget.tier)}` : ''}
            </h3>
            {sellNode}
          </Panel>
        ) : null}
        {ui.overlays.dry && flow !== null ? (
          // The test run is a table in the info rail: it never covers the board.
          <DryRunTable
            team={team}
            flow={flow}
            onClose={() => {
              ctl.setOverlay('dry', false);
            }}
            onHover={(id) => {
              ctl.setHighlight(id === null ? null : { kind: 'building', id });
            }}
            ticks={ui.dryTicks}
            onTicks={(n) => {
              ctl.setDryTicks(n);
              return ctl.model.get().ui.dryTicks;
            }}
          />
        ) : null}
        <OverlayLegend model={model} />
        <BorderLinksPanel
          run={run}
          ctl={ctl}
          acting={acting}
          locked={gate?.ready === true}
          flow={flow}
        />
        <PartyPanel run={run} ctl={ctl} gate={gate} acting={acting} />
        <div class="info-spacer" />
        <KeyHints />
        {next === null ? null : <NextFightPanel fight={next} />}
      </>
    );

  return (
    <GameFrame
      phase="build"
      title={run === null ? 'Build' : `Round ${String(run.round)}`}
      tabs={tabs}
      activeTab="build"
      status={
        <>
          {inShop && sv !== null ? (
            <ShopToggle
              open={open}
              badge={shopSeen || offersOnSale === 0 ? null : offersOnSale}
              onToggle={() => {
                setShopOpen(!shopOpen);
                setShopSeen(true);
              }}
            />
          ) : null}
          {devStrip}
        </>
      }
      rail={rail}
      board={boardArea}
      tray={tray}
      primary={run === null ? null : readyPrimary(run, ctl, gate, acting)}
      info={info}
      onKey={onKey}
    />
  );
}
