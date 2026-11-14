/** Panels of the Build screen: stash, tools, inspector, overlays, problems, party. */

import {
  conduitResource,
  formatText,
  type Conduit,
  type DryRunResult,
  type TeamState,
  buildingEnd,
  conduitTouches,
} from '@game/core';
import type { ComponentChildren } from 'preact';
import type { RunState } from '@game/session';
import { content } from '../content.js';
import { Panel } from '../shell/AppShell.js';
import { Kbd } from '../shell/GameFrame.js';
import {
  DRY_TICKS_MAX,
  DRY_TICKS_MIN,
  DRY_TICKS_STEP,
  type BuildController,
  type Model,
  type Tool,
} from './build-controller.js';
import { halfStatuses, linkText } from './border-links.js';
import type { CheckState, Checklist } from './checklist.js';
import type { NextFight } from './next-fight.js';
import { halfFlow } from './overlay-marks.js';
import { buildingRate, formatHundredths } from './rates.js';
import { cardStats } from './card-stats.js';
import { playerName, screenText, screenTexts } from './texts.js';
import { useEffect } from 'preact/hooks';
import { SpriteIcon } from '../sprites/SpriteIcon.js';
import { READY_LOCK_TEXT, SEALED_HINT, type Gate } from './lock.js';
import { simConfig } from './setup.js';
import {
  buildingName,
  inspectorFigures,
  resourceName,
  type FlowView,
  type Problem,
} from './view-model.js';

const t = (key: string, values: Record<string, string> = {}): string =>
  screenText(screenTexts, key, values);

const fmt = (n: number): string =>
  Number.isInteger(n) ? String(n) : n.toFixed(1);

/** A rate per second, always two decimals ("0.50"). */
/** One row of an overlay key: a 28x16 sample of the mark, then its name. */
function LegendItem(props: { label: string; children: ComponentChildren }) {
  return (
    <li>
      <svg width="28" height="16" viewBox="0 0 28 16" aria-hidden="true">
        {props.children}
      </svg>
      <span>{props.label}</span>
    </li>
  );
}

const fmtRate = (n: number): string => n.toFixed(2);

// ---------------------------------------------------------------------------
// Stash

interface StashGroup {
  readonly def: string;
  readonly tier: number;
  readonly ids: readonly number[];
}

/** The acting player's stash only: other players' buildings are not shown. */
export function groupStash(team: TeamState, player: number): StashGroup[] {
  const order = new Map(content.buildings.list().map((d, i) => [d.id, i]));
  const groups = new Map<
    string,
    { def: string; tier: number; ids: number[] }
  >();
  for (const s of team.stash) {
    if (s.owner !== player) continue;
    const k = `${s.def}:${String(s.tier)}`;
    const g = groups.get(k) ?? { def: s.def, tier: s.tier, ids: [] };
    g.ids.push(s.id);
    groups.set(k, g);
  }
  return [...groups.values()].sort(
    (a, b) =>
      (order.get(a.def) ?? 0) - (order.get(b.def) ?? 0) || a.tier - b.tier,
  );
}

/** How many slots the tray row shows at least: the rest are dashed, empty. */
const MIN_SLOTS = 6;

/** The inventory: one slot per building type, 1-9 for the keys. */
export function InventoryTray(props: {
  team: TeamState;
  model: Model;
  ctl: BuildController;
  /** The player whose inventory this is. */
  player: number;
  /** The player is Ready: no board changes until Unready. */
  locked?: boolean;
  /** Stash ids that arrived this round: they get the NEW badge. */
  fresh?: ReadonlySet<number>;
  /** The slot (`def:tier`) that just received a bought building. */
  flash?: string | null;
}) {
  const { team, model, ctl } = props;
  const locked = props.locked === true;
  const groups = groupStash(team, props.player);
  const held = model.ui.held;
  const empties = Math.max(1, MIN_SLOTS - groups.length);
  return (
    <div class="tray-stash" id="panel-stash">
      <span class="tray-label">{t('uiTrayInventoryLabel')}</span>
      <ul class="tray-slots stash-list">
        {groups.map((g, i) => {
          const def = content.buildings.get(g.def);
          const first = g.ids[0] as number;
          const active = held !== null && g.ids.includes(held.id);
          const name = buildingName(content, g.def);
          const isNew = g.ids.some((id) => props.fresh?.has(id) === true);
          const flashing = props.flash === `${g.def}:${String(g.tier)}`;
          return (
            <li key={`${g.def}:${String(g.tier)}`}>
              <button
                type="button"
                class={`slot stash-item${active ? ' active' : ''}${flashing ? ' flash' : ''}`}
                data-stash-def={g.def}
                data-stash-tier={g.tier}
                data-count={g.ids.length}
                aria-pressed={active}
                aria-keyshortcuts={i < 9 ? String(i + 1) : undefined}
                disabled={locked}
                title={
                  locked
                    ? READY_LOCK_TEXT
                    : content.presentation.get(g.def) === undefined
                      ? name
                      : formatText(
                          content.presentation.get(g.def)?.description ?? '',
                          content.resources,
                        )
                }
                onPointerDown={(e) => {
                  if (e.pointerType === 'mouse' && e.button !== 0) return;
                  (e.currentTarget as HTMLElement).releasePointerCapture(
                    e.pointerId,
                  );
                  ctl.beginDrag(first);
                }}
                onPointerUp={() => {
                  ctl.stickHeld();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    ctl.pickFromStash(first);
                  }
                }}
              >
                {i < 9 ? (
                  <span class="slot-key" data-field="slot-key">
                    {i + 1}
                  </span>
                ) : null}
                <span class="slot-count stash-count">
                  {t('uiSlotCount', { count: String(g.ids.length) })}
                </span>
                <span
                  class="swatch"
                  style={{
                    background: `var(--kind-${(def?.kind ?? 'core').replace('_', '-')})`,
                  }}
                >
                  <SpriteIcon name={g.def} size={32} />
                </span>
                <span class="slot-name stash-name">{name}</span>
                {g.tier > 1 ? (
                  <span
                    class="slot-meta stash-tier"
                    title={t('uiTierTip', { tier: String(g.tier) })}
                  >
                    T{g.tier}
                  </span>
                ) : null}
                {isNew ? (
                  <span class="slot-new" data-field="slot-new">
                    {t(flashing ? 'uiSlotJustBought' : 'uiSlotNew')}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
        {Array.from({ length: empties }, (_, i) => (
          <li key={`empty:${String(i)}`} class="slot-empty-cell">
            <span
              class="slot slot-empty"
              data-field="slot-empty"
              title={t('uiSlotEmpty')}
              aria-hidden="true"
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tools

const ICON_PROPS = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 2,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  'aria-hidden': true,
} as const;

const TOOL_ICONS: Readonly<Record<string, ComponentChildren>> = {
  select: <path d="M5 3l14 8-6 2-3 6z" />,
  conduit: (
    <>
      <path d="M4 18h6V8h10" />
      <circle cx="4" cy="18" r="1.5" />
      <circle cx="20" cy="8" r="1.5" />
    </>
  ),
  undo: (
    <>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </>
  ),
  redo: (
    <>
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H10a6 6 0 0 0 0 12h3" />
    </>
  ),
};

/** Select, Conduit, Undo, Redo: a 2 x 2 group of icon buttons. */
export function ToolsTray(props: {
  model: Model;
  ctl: BuildController;
  locked?: boolean;
}) {
  const { model, ctl } = props;
  const locked = props.locked === true;
  const { ui, view } = model;
  const tool = (id: Tool, label: string, key: string) => (
    <button
      type="button"
      class={ui.tool === id ? 'tool active' : 'tool'}
      data-tool={id}
      aria-pressed={ui.tool === id}
      aria-label={label}
      aria-keyshortcuts={key}
      disabled={locked && id !== 'select'}
      title={locked && id !== 'select' ? READY_LOCK_TEXT : label}
      onClick={() => {
        ctl.setTool(id);
      }}
    >
      <svg {...ICON_PROPS}>{TOOL_ICONS[id]}</svg>
    </button>
  );
  return (
    <div class="tray-tools" id="panel-tools">
      {tool('select', t('uiToolSelectAria'), 'V')}
      {tool('conduit', t('uiToolConduitAria'), 'C')}
      <button
        type="button"
        data-action="undo"
        aria-label={t('uiToolUndo')}
        disabled={locked || (view?.undoCount ?? 0) === 0}
        title={t('uiToolUndoTip')}
        onClick={() => void ctl.undo()}
      >
        <svg {...ICON_PROPS}>{TOOL_ICONS['undo']}</svg>
      </button>
      <button
        type="button"
        data-action="redo"
        aria-label={t('uiToolRedo')}
        disabled={locked || (view?.redoCount ?? 0) === 0}
        title={t('uiToolRedoTip')}
        onClick={() => void ctl.redo()}
      >
        <svg {...ICON_PROPS}>{TOOL_ICONS['redo']}</svg>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inspector

/** "Conduit to Barracks": a conduit of building `at`, named by its far end. */
function conduitLabel(team: TeamState, at: number, c: Conduit): string {
  const f = buildingEnd(c.from);
  const outgoing = f !== null && f.building === at;
  const far = buildingEnd(outgoing ? c.to : c.from);
  const farDef =
    far === null
      ? undefined
      : team.buildings.find((x) => x.id === far.building)?.def;
  if (farDef === undefined) {
    return t(outgoing ? 'uiConduitToBorder' : 'uiConduitFromBorder');
  }
  return t(outgoing ? 'uiConduitTo' : 'uiConduitFrom', {
    name: buildingName(content, farDef),
  });
}

export function InspectorPanel(props: {
  run: RunState;
  model: Model;
  dry: DryRunResult | null;
  /** For the supplied / under-supplied line of a consumer. */
  flow?: FlowView | null;
  ctl: BuildController;
  /** Ids of the unit producers with no route to the front row. */
  sealed?: readonly number[];
  /** The acting player: a partner's source shows no backed-up line. */
  acting?: number;
  /** The Sell control of a selected building (shop step only). */
  sell?: ComponentChildren;
}) {
  const { run, model, dry, ctl } = props;
  const team = run.team;
  const draft = model.ui.draft;
  // With the conduit tool, the picked source is what the panel shows.
  const source =
    model.ui.tool === 'conduit' &&
    draft !== null &&
    draft.building >= 0 &&
    team.buildings.some((x) => x.id === draft.building)
      ? ({ kind: 'building', id: draft.building } as const)
      : null;
  const sel = source ?? model.ui.selection;
  let body: ComponentChildren = null;

  if (sel?.kind === 'core') {
    const def = content.buildings.list().find((d) => d.kind === 'core');
    const entry =
      def === undefined ? undefined : content.presentation.get(def.id);
    body = (
      <div data-inspector="core">
        <h3 class="insp-name" data-field="name">
          {entry?.name ?? 'Core'}
        </h3>
        <p class="muted">
          {entry === undefined
            ? ''
            : formatText(entry.description, content.resources)}
        </p>
        <p class="insp-health" data-field="health">
          {screenText(screenTexts, 'uiShopHealth', {
            health: String(def?.tiers[0]?.health ?? '-'),
          })}
        </p>
        <p class="notice">{screenText(screenTexts, 'uiInspectorCoreFixed')}</p>
      </div>
    );
  } else if (sel?.kind === 'conduit') {
    const c = team.conduits.find((x) => x.id === sel.id);
    if (c !== undefined) {
      const res = conduitResource(team, content, c.id);
      body = (
        <div data-inspector="conduit">
          <h3 class="insp-name" data-field="name">
            {t('uiConduitName')}
          </h3>
          <dl class="props">
            <dt>{t('uiLblCarries')}</dt>
            <dd>
              {res === null
                ? screenText(screenTexts, 'uiInspectorCarriesUnknown')
                : resourceName(content, res)}
            </dd>
            {halfStatuses(team, content)
              .filter((h) => h.conduit === c.id)
              .map((h) => (
                <>
                  <dt>{t('uiLblBorderLink')}</dt>
                  <dd data-field="link-state">
                    {linkText(h, (p) =>
                      playerName(
                        screenTexts,
                        run.players.map((x) => x.name),
                        p,
                      ),
                    )}
                  </dd>
                </>
              ))}
            <dt>{t('uiLblLength')}</dt>
            <dd>
              {t(c.cells.length === 1 ? 'uiCellsOne' : 'uiCellsMany', {
                count: String(c.cells.length),
              })}
              {c.cells.length === 0 ? t('uiCellsDirect') : ''}
            </dd>
          </dl>
          <div class="insp-buttons">
            <button
              type="button"
              data-action="erase"
              onClick={() => void ctl.eraseConduit(c.id)}
            >
              {t('uiLblErase')}
            </button>
          </div>
        </div>
      );
    }
  } else if (sel?.kind === 'building') {
    const b = team.buildings.find((x) => x.id === sel.id);
    const def = b === undefined ? undefined : content.buildings.get(b.def);
    if (b !== undefined && def !== undefined) {
      const entry = content.presentation.get(b.def);
      const figs = inspectorFigures(
        team,
        content,
        simConfig,
        dry,
        b,
        props.acting,
      );
      const owner = playerName(
        screenTexts,
        run.players.map((x) => x.name),
        b.owner,
      );
      const attached = team.conduits.filter((c) => conduitTouches(c, b.id));
      const stats = cardStats(content, simConfig, def, b.tier);
      const collectRate = buildingRate(
        def,
        b.tier,
        simConfig.ticksPerSecond,
      ).collects;
      const supply = props.flow?.supply.find((x) => x.building === b.id);
      body = (
        <div data-inspector="building">
          <h3 class="insp-name">
            <span data-field="name">{entry?.name ?? b.def}</span>
            <span class="insp-meta" data-field="tier">
              {t('uiInspectorTier', { tier: String(b.tier) })}
              {(props.acting ?? b.owner) === b.owner
                ? ''
                : t('uiInspectorOwnedBy', { owner })}
            </span>
          </h3>
          {props.sealed?.includes(b.id) === true ? (
            <p class="notice sealed-note" data-field="sealed" role="alert">
              {screenText(screenTexts, 'uiInspectorSealed', {
                hint: SEALED_HINT,
              })}
            </p>
          ) : null}
          <div class="insp-stats">
            {stats.uses !== null ? (
              <p data-field="uses">
                {stats.uses}
                {supply === undefined
                  ? ''
                  : screenText(
                      screenTexts,
                      supply.state === 'full'
                        ? 'inspectorSupplied'
                        : 'inspectorUnderSupplied',
                      { gets: formatHundredths(supply.gets) },
                    )}
              </p>
            ) : null}
            {stats.collects !== null ? (
              <p data-field="collects">
                {figs?.produces?.resource != null && collectRate !== null
                  ? screenText(screenTexts, 'collectsResource', {
                      resource: resourceName(content, figs.produces.resource),
                      rate: formatHundredths(collectRate),
                    })
                  : stats.collects}
                {figs?.produces != null && figs.produces.lostPerSec > 0
                  ? screenText(screenTexts, 'uiInspectorMinesLost', {
                      rate: fmtRate(figs.produces.lostPerSec),
                    })
                  : ''}
              </p>
            ) : null}
            {stats.effect !== '' ? (
              <p data-field="effect">{stats.effect}</p>
            ) : null}
            {figs?.derived != null ? (
              <p class="muted" data-field="derived">
                {screenText(screenTexts, 'uiInspectorDerived', {
                  rate: fmt(figs.derived.perMin),
                  things: screenText(
                    screenTexts,
                    figs.derived.kind === 'units'
                      ? 'unitsWord'
                      : figs.derived.kind === 'shots'
                        ? 'shotsWord'
                        : 'stepsWord',
                  ),
                  cost: String(figs.derived.cost),
                  resource:
                    figs.inputs[0] === undefined
                      ? '-'
                      : resourceName(content, figs.inputs[0].resource),
                  limit:
                    figs.derived.maxPerMin === null
                      ? ''
                      : screenText(screenTexts, 'uiInspectorDerivedAtMost', {
                          max: fmt(figs.derived.maxPerMin),
                        }),
                })}
              </p>
            ) : null}
            <p data-field="health">{stats.health}</p>
          </div>
          <dl class="props">
            {figs?.produces != null && figs.produces.stalledPercent !== null ? (
              <>
                <dt>{screenText(screenTexts, 'uiInspectorBackedUp')}</dt>
                <dd data-field="stalled">
                  {screenText(screenTexts, 'inspectorStalled', {
                    percent: String(figs.produces.stalledPercent),
                  })}
                </dd>
              </>
            ) : null}
            {attached.length > 0 ? (
              <>
                <dt>{t('uiLblConduits')}</dt>
                <dd>
                  {attached.map((c) => (
                    <button
                      type="button"
                      class="link"
                      key={c.id}
                      data-conduit={c.id}
                      onClick={() => {
                        ctl.select({ kind: 'conduit', id: c.id });
                      }}
                      onMouseEnter={() => {
                        ctl.setHighlight({ kind: 'conduit', id: c.id });
                      }}
                      onMouseLeave={() => {
                        ctl.setHighlight(null);
                      }}
                      onFocus={() => {
                        ctl.setHighlight({ kind: 'conduit', id: c.id });
                      }}
                      onBlur={() => {
                        ctl.setHighlight(null);
                      }}
                    >
                      {conduitLabel(team, b.id, c)}
                    </button>
                  ))}
                </dd>
              </>
            ) : null}
          </dl>
          <div class="insp-buttons">
            <button
              type="button"
              data-action="rotate"
              title={t('uiToolRotateTip')}
              onClick={() => void ctl.rotate()}
            >
              {t('uiToolRotateButton')} <Kbd>R</Kbd>
            </button>
            <button
              type="button"
              data-action="to-stash"
              onClick={() => void ctl.returnSelected()}
            >
              {t('uiToolPickUp')}
            </button>
          </div>
          {props.sell}
        </div>
      );
    }
  }
  // Only while something is selected.
  if (body === null) return null;
  return (
    <Panel title={t('uiPanelSelected')} id="panel-inspector">
      {body}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Overlays and problems

export function OverlayLegend(props: { model: Model }) {
  const o = props.model.ui.overlays;
  if (!o.flow && !o.paths) return null;
  return (
    <Panel title={t('uiPanelLegend')} id="panel-overlay-legend" class="fixed">
      <div class="overlay-legend muted" data-field="overlay-legend">
        {o.paths ? (
          <ul data-legend="paths">
            <LegendItem label={t('uiLegendPathRoute')}>
              <line
                x1="2"
                y1="8"
                x2="26"
                y2="8"
                stroke="var(--path-line)"
                stroke-width="2.5"
                stroke-dasharray="5 3.5"
                opacity="0.7"
              />
            </LegendItem>
            <LegendItem label={t('uiLegendPathStart')}>
              <polygon points="8,4 20,4 14,13" fill="var(--path-line)" />
            </LegendItem>
            <LegendItem label={t('uiLegendPathDetour')}>
              <line
                x1="14"
                y1="14"
                x2="14"
                y2="3"
                stroke="var(--path-line)"
                stroke-width="2.5"
                stroke-dasharray="5 3.5"
                opacity="0.7"
              />
            </LegendItem>
            <LegendItem label={t('uiLegendPathTarget')}>
              <circle
                cx="14"
                cy="8"
                r="6"
                fill="none"
                stroke="var(--path-line)"
                stroke-width="2"
              />
              <path
                d="M11 5 L17 11 M17 5 L11 11"
                stroke="var(--path-line)"
                stroke-width="2"
              />
            </LegendItem>
          </ul>
        ) : null}
        {o.flow ? (
          <ul data-legend="flow">
            <LegendItem label={t('uiLegendFlowMoving')}>
              <g fill="var(--accent)" stroke="var(--ink)" stroke-width="1">
                <circle cx="5" cy="8" r="2.2" />
                <circle cx="14" cy="8" r="2.2" />
                <circle cx="23" cy="8" r="2.2" />
              </g>
            </LegendItem>
            <LegendItem label={t('uiLegendFlowNone')}>
              <line
                x1="2"
                y1="8"
                x2="26"
                y2="8"
                stroke="var(--bad)"
                stroke-width="2"
                stroke-dasharray="4 4"
                stroke-linecap="round"
              />
            </LegendItem>
            <LegendItem label={t('uiLegendFlowStarved')}>
              <rect
                x="4"
                y="2.5"
                width="20"
                height="11"
                fill="none"
                stroke="var(--bad)"
                stroke-width="2"
                stroke-dasharray="5 3"
              />
            </LegendItem>
            <LegendItem label={t('uiLegendFlowLow')}>
              <text
                x="14"
                y="12"
                text-anchor="middle"
                font-size="9"
                font-weight="700"
                fill="var(--warn)"
              >
                LOW
              </text>
            </LegendItem>
          </ul>
        ) : null}
      </div>
    </Panel>
  );
}

const WARNING_TITLE = 'Warning: something is wrong with your factory';
const HINT_TITLE = 'Reminder: something is not used yet (not an error)';

const TICK = <path d="M5 12l5 5 9-10" />;
const WARN = (
  <>
    <path d="M12 3l10 18H2z" />
    <path d="M12 10v5M12 18v.5" />
  </>
);

function CheckMark(props: { state: CheckState }) {
  const s = props.state;
  return (
    <svg
      class={`check-mark ${s}`}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={s === 'ok' ? 3 : 2}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <title>
        {s === 'warn' ? WARNING_TITLE : s === 'hint' ? HINT_TITLE : ''}
      </title>
      {s === 'ok' ? TICK : WARN}
    </svg>
  );
}

/** "Before you fight": warnings with a fix, then what is already fine. */
export function ChecklistPanel(props: {
  list: Checklist;
  onPick: (p: Problem) => void;
}) {
  const { items, okHidden } = props.list;
  return (
    <Panel title={t('uiPanelChecklist')} id="panel-problems">
      {items.length === 0 ? (
        <p class="muted" data-field="no-checks">
          {t('uiCheckNothingYet')}
        </p>
      ) : (
        <ul class="checklist">
          {items.map((it) => {
            const body = (
              <>
                <CheckMark state={it.state} />
                <span class="check-text">
                  <strong>{it.text}</strong>
                  {it.fix === null ? null : (
                    <span class="check-fix"> {it.fix}</span>
                  )}
                </span>
              </>
            );
            const p = it.problem;
            return (
              <li key={it.id} data-check={it.state}>
                {p === null ||
                (p.focus === null &&
                  p.building === null &&
                  p.pick === undefined) ? (
                  // Satisfied, or nothing to jump to (a partner's summary).
                  <span
                    class={it.state === 'ok' ? 'check' : 'check problem'}
                    data-problem={p?.kind}
                  >
                    {body}
                  </span>
                ) : (
                  <button
                    type="button"
                    class="check problem"
                    data-problem={p.kind}
                    onClick={() => {
                      props.onPick(p);
                    }}
                  >
                    {body}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {okHidden > 0 ? (
        <p class="muted check-more" data-field="checks-more">
          {t('uiCheckMore', { n: String(okHidden) })}
        </p>
      ) : null}
    </Panel>
  );
}

/** The dry-run table: production per source, deliveries per consumer. */
export function DryRunTable(props: {
  team: TeamState;
  flow: FlowView;
  onClose: () => void;
  /** The building of the row under the pointer, or null. */
  onHover?: (building: number | null) => void;
  /** The test run's length; `onTicks` sets it and returns the value in use. */
  ticks?: number;
  onTicks?: (n: number) => number;
}) {
  const { team, flow } = props;
  const dry = flow.dry;
  const hover = props.onHover;
  // Two buildings can share a name: the row under the pointer lights up its
  // building on the board instead of showing an internal number.
  const name = (id: number): string => {
    const b = team.buildings.find((x) => x.id === id);
    return b === undefined ? '' : buildingName(content, b.def);
  };
  const rowHover = (id: number) =>
    hover === undefined
      ? {}
      : {
          onMouseEnter: () => {
            hover(id);
          },
          onMouseLeave: () => {
            hover(null);
          },
        };
  useEffect(
    () => () => {
      hover?.(null);
    },
    [],
  );
  const secs = dry.ticks / simConfig.ticksPerSecond;
  return (
    <div
      class="dry-table"
      id="dry-table"
      role="region"
      aria-label={screenText(screenTexts, 'uiDryRunRegion')}
    >
      <div class="dry-head">
        <strong>
          {screenText(screenTexts, 'uiDryRunTitle', {
            secs: fmt(secs),
          })}
        </strong>
        <button
          type="button"
          onClick={props.onClose}
          aria-label={screenText(screenTexts, 'uiDryRunClose')}
        >
          ×
        </button>
      </div>
      <table>
        <thead>
          <tr>
            <th>{screenText(screenTexts, 'uiDryRunSource')}</th>
            <th>{screenText(screenTexts, 'uiDryRunResource')}</th>
            <th>{screenText(screenTexts, 'uiDryRunProduced')}</th>
            <th>{screenText(screenTexts, 'uiDryRunLost')}</th>
            <th>{screenText(screenTexts, 'uiDryRunRate')}</th>
          </tr>
        </thead>
        <tbody>
          {dry.sources.length === 0 ? (
            <tr>
              <td colSpan={5} class="muted">
                {screenText(screenTexts, 'uiDryRunNoSources')}
              </td>
            </tr>
          ) : (
            dry.sources.map((s) => {
              const sb = team.buildings.find((x) => x.id === s.building);
              const sd =
                sb === undefined ? undefined : content.buildings.get(sb.def);
              const r =
                sb === undefined || sd === undefined
                  ? null
                  : buildingRate(sd, sb.tier, simConfig.ticksPerSecond);
              return (
                <tr key={s.building} {...rowHover(s.building)}>
                  <td>{name(s.building)}</td>
                  <td>{resourceName(content, s.resource)}</td>
                  <td data-field="produced">{s.produced}</td>
                  <td>{s.lost}</td>
                  <td data-field="collect-rate">
                    {r?.collects == null ? '-' : formatHundredths(r.collects)}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      <table>
        <thead>
          <tr>
            <th>{screenText(screenTexts, 'uiDryRunConsumer')}</th>
            <th>{screenText(screenTexts, 'uiDryRunResource')}</th>
            <th>{screenText(screenTexts, 'uiDryRunDelivered')}</th>
            <th>{screenText(screenTexts, 'uiDryRunPerSec')}</th>
            <th>{screenText(screenTexts, 'uiDryRunNeed')}</th>
            <th>{screenText(screenTexts, 'uiDryRunSupply')}</th>
          </tr>
        </thead>
        <tbody>
          {dry.consumers.length === 0 ? (
            <tr>
              <td colSpan={6} class="muted">
                {screenText(screenTexts, 'uiDryRunNoConsumers')}
              </td>
            </tr>
          ) : (
            dry.consumers.map((c) => {
              const sup = flow.supply.find((x) => x.building === c.building);
              return (
                <tr
                  key={`${String(c.building)}${c.side}`}
                  class={c.delivered === 0 ? 'bad' : ''}
                  {...rowHover(c.building)}
                >
                  <td>{name(c.building)}</td>
                  <td>{resourceName(content, c.resource)}</td>
                  <td data-field="delivered">{c.delivered}</td>
                  <td data-field="per-sec">
                    {formatHundredths(
                      Math.floor(
                        (c.ratePer1000 * simConfig.ticksPerSecond) / 10,
                      ),
                    )}
                  </td>
                  <td data-field="need-rate">
                    {sup === undefined ? '-' : formatHundredths(sup.needs)}
                  </td>
                  <td data-field="supply">
                    {sup === undefined
                      ? '-'
                      : screenText(
                          screenTexts,
                          sup.state === 'full'
                            ? 'tableSupplied'
                            : 'tableUnderSupplied',
                        )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      {props.onTicks === undefined ? null : (
        <label class="inline-field">
          {t('uiOverlayDryTicks')}
          <input
            type="number"
            id="dry-ticks"
            min={DRY_TICKS_MIN}
            max={DRY_TICKS_MAX}
            step={DRY_TICKS_STEP}
            value={props.ticks}
            onChange={(e) => {
              const input = e.currentTarget;
              // Show the value in use, also when it did not change.
              input.value = String(props.onTicks?.(Number(input.value)));
            }}
          />
          <span class="muted">
            {t('uiOverlayTicksPerSecond', {
              ticks: String(simConfig.ticksPerSecond),
            })}
          </span>
        </label>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Border links (keyboard and screen reader route to what the board draws)

/**
 * The acting player's own border halves as a list: state in words, the
 * resource the half carries, and a Remove button. A neighbour's half is not
 * listed (it cannot be removed from here). Nothing for a solo run.
 */
export function BorderLinksPanel(props: {
  run: RunState;
  ctl: BuildController;
  acting: number;
  locked: boolean;
  /** For the active / idle word of each half. */
  flow?: FlowView | null;
}) {
  const { run, ctl, acting } = props;
  const team = run.team;
  if (run.players.length < 2) return null;
  const nameOf = (p: number): string =>
    playerName(
      screenTexts,
      run.players.map((x) => x.name),
      p,
    );
  const mine = halfStatuses(team, content).filter((h) => h.owner === acting);
  return (
    <Panel title={screenText(screenTexts, 'uiLinksTitle')} id="panel-links">
      <ul class="link-list" data-field="links" aria-live="polite">
        {mine.length === 0 ? (
          <li class="muted" data-field="links-empty">
            {screenText(screenTexts, 'uiLinksEmpty')}
          </li>
        ) : (
          mine.map((h) => {
            const res = conduitResource(team, content, h.conduit);
            return (
              <li key={h.conduit} data-link-state={h.state}>
                <span data-field="link-text">
                  {linkText(h, nameOf)}
                  {res === null
                    ? ''
                    : screenText(screenTexts, 'uiLinksCarries', {
                        resource: resourceName(content, res),
                      })}
                  {props.flow == null
                    ? ''
                    : ` · ${screenText(
                        screenTexts,
                        halfFlow(h, props.flow.activeConduits).active
                          ? 'linkActive'
                          : 'linkIdle',
                      )}`}
                </span>
                <button
                  type="button"
                  data-action="remove-link"
                  disabled={props.locked}
                  onClick={() => void ctl.eraseConduit(h.conduit)}
                >
                  {screenText(screenTexts, 'uiLinksRemove')}
                </button>
              </li>
            );
          })
        )}
      </ul>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Party and ready

export function PartyPanel(props: {
  run: RunState;
  ctl: BuildController;
  gate?: Gate | null;
  /** The player this device acts as. */
  acting: number;
}) {
  const { run, acting } = props;
  const me = run.perPlayer[acting];
  const multi = run.players.length > 1;
  const ready = me?.ready === true;
  const readyCount = run.perPlayer.filter((p) => p.ready).length;
  const block = props.gate?.readyBlock ?? null;
  const note =
    block !== null ? (
      <p class="error" data-field="ready-blocked" role="alert">
        {block}
      </p>
    ) : ready ? (
      <p class="muted" data-field="ready-locked">
        <SpriteIcon name="ui_icon_lock" scale={1} class="bar-icon" />
        {READY_LOCK_TEXT}
      </p>
    ) : null;
  // Solo has no party: only why Ready is off, when it is.
  if (!multi) return note;
  return (
    <Panel title={t('uiPanelParty')} id="panel-party">
      <div class="party-row">
        <span>{run.players[acting]?.name ?? 'You'}</span>
        <span class="muted">{screenText(screenTexts, 'uiPartyEditing')}</span>
        <span data-field="ready-state">
          {screenText(
            screenTexts,
            ready ? 'uiPartyReadyYes' : 'uiPartyReadyNo',
          )}
        </span>
      </div>
      <p class="muted party-next">
        {t('uiPartyNext', {
          leg:
            run.step === 'shop' && run.leg === 'pve'
              ? 'Rival party'
              : 'Stronghold',
          ready: String(readyCount),
          total: String(run.players.length),
        })}
      </p>
      {note}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Next fight

/** Pinned to the bottom of the info rail. */
export function NextFightPanel(props: { fight: NextFight }) {
  return (
    <Panel title={t('uiPanelNextFight')} id="panel-next-fight" class="pinned">
      <p class="next-title" data-field="next-title">
        {props.fight.title}
      </p>
      <p class="muted next-stakes" data-field="next-stakes">
        {props.fight.stakes}
      </p>
    </Panel>
  );
}
