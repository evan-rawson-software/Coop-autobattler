/** Panels of the Build screen: stash, tools, inspector, overlays, problems, party. */

import {
  conduitResource,
  formatText,
  type DryRunResult,
  type TeamState,
  conduitTouches,
} from '@game/core';
import type { RunState } from '@game/session';
import { content } from '../content.js';
import { Panel } from '../shell/AppShell.js';
import type { BuildController, Model, Tool } from './build-controller.js';
import { halfStatuses, linkText } from './border-links.js';
import { halfFlow } from './overlay-marks.js';
import { buildingRate, formatHundredths, topSpeedWord } from './rates.js';
import { playerName, screenText, screenTexts } from './texts.js';
import { useEffect, useRef, useState } from 'preact/hooks';
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

function humanize(id: string): string {
  const s = id.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const t = (key: string, values: Record<string, string> = {}): string =>
  screenText(screenTexts, key, values);

const fmt = (n: number): string =>
  Number.isInteger(n) ? String(n) : n.toFixed(1);

/** A rate per second, always two decimals ("0.50"). */
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

export function StashPanel(props: {
  team: TeamState;
  model: Model;
  ctl: BuildController;
  /** The player whose stash this is. */
  player: number;
  /** The player is Ready: no board changes until Unready. */
  locked?: boolean;
}) {
  const { team, model, ctl } = props;
  const locked = props.locked === true;
  const groups = groupStash(team, props.player);
  const held = model.ui.held;
  return (
    <Panel title={t('uiPanelStash')} id="panel-stash">
      {groups.length === 0 ? null : (
        <ul class="stash-list">
          {groups.map((g) => {
            const def = content.buildings.get(g.def);
            const first = g.ids[0] as number;
            const active = held !== null && g.ids.includes(held.id);
            const name = buildingName(content, g.def);
            return (
              <li key={`${g.def}:${String(g.tier)}`}>
                <button
                  type="button"
                  class={active ? 'stash-item active' : 'stash-item'}
                  data-stash-def={g.def}
                  data-stash-tier={g.tier}
                  aria-pressed={active}
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
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      ctl.pickFromStash(first);
                    }
                  }}
                >
                  <span
                    class="swatch"
                    style={{
                      background: `var(--kind-${(def?.kind ?? 'core').replace('_', '-')})`,
                    }}
                  >
                    <SpriteIcon name={g.def} size={32} />
                  </span>
                  <span class="stash-name">{name}</span>
                  <span
                    class="stash-tier"
                    title={t('uiTierTip', { tier: String(g.tier) })}
                  >
                    T{g.tier}
                  </span>
                  <span class="stash-count">× {g.ids.length}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Tools

export function ToolsPanel(props: {
  model: Model;
  ctl: BuildController;
  locked?: boolean;
}) {
  const { model, ctl } = props;
  const locked = props.locked === true;
  const { ui, view } = model;
  const tool = (id: Tool, label: string, key: string, tip?: string) => (
    <button
      type="button"
      class={ui.tool === id ? 'tool active' : 'tool'}
      data-tool={id}
      aria-pressed={ui.tool === id}
      disabled={locked && id !== 'select'}
      title={
        locked && id !== 'select' ? READY_LOCK_TEXT : `${tip ?? label} (${key})`
      }
      onClick={() => {
        ctl.setTool(id);
      }}
    >
      {label}
    </button>
  );
  return (
    <Panel title={t('uiPanelTools')} id="panel-tools" class="fixed">
      <div class="tool-grid">
        {tool('select', t('uiToolSelect'), 'V')}
        {tool('conduit', t('uiToolConduit'), 'C', t('uiToolConduitTip'))}
        {tool('erase', t('uiToolErase'), 'E')}
        <button
          type="button"
          data-action="undo"
          disabled={locked || (view?.undoCount ?? 0) === 0}
          title={t('uiToolUndoTip')}
          onClick={() => void ctl.undo()}
        >
          {t('uiToolUndo')}
          {view !== null && view.undoCount > 0
            ? ` (${String(view.undoCount)})`
            : ''}
        </button>
        <button
          type="button"
          data-action="redo"
          disabled={locked || (view?.redoCount ?? 0) === 0}
          title={t('uiToolRedoTip')}
          onClick={() => void ctl.redo()}
        >
          {t('uiToolRedo')}
          {view !== null && view.redoCount > 0
            ? ` (${String(view.redoCount)})`
            : ''}
        </button>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Inspector

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
}) {
  const { run, model, dry, ctl } = props;
  const team = run.team;
  const sel = model.ui.selection;
  let body = <p class="muted">{screenText(screenTexts, 'uiInspectorHint')}</p>;

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
        <dl class="props">
          <dt>{t('uiLblHealth')}</dt>
          <dd>{def?.tiers[0]?.health ?? '-'}</dd>
        </dl>
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
      const rate = buildingRate(def, b.tier, simConfig.ticksPerSecond);
      const supply = props.flow?.supply.find((x) => x.building === b.id);
      body = (
        <div data-inspector="building">
          <h3 class="insp-name">
            <span data-field="name">{entry?.name ?? b.def}</span>
            <span class="insp-meta">
              {t('uiInspectorMeta', {
                kind: humanize(def.kind),
                tier: String(b.tier),
              })}
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
          <p class="muted insp-desc">
            {entry === undefined
              ? ''
              : formatText(entry.description, content.resources)}
          </p>
          <dl class="props">
            {rate.collects !== null ? (
              <>
                <dt>{t('uiLblCollects')}</dt>
                <dd data-field="collects">
                  {screenText(screenTexts, 'inspectorCollects', {
                    rate: formatHundredths(rate.collects),
                  })}
                </dd>
              </>
            ) : null}
            {rate.needs !== null && rate.topSpeed !== null ? (
              <>
                <dt>{t('uiLblTopSpeed')}</dt>
                <dd data-field="top-speed">
                  {screenText(screenTexts, 'inspectorTopSpeed', {
                    speed: formatHundredths(rate.topSpeed),
                    unit: topSpeedWord(def),
                  })}
                </dd>
                <dt>{t('uiLblNeeds')}</dt>
                <dd data-field="needs-rate">
                  {screenText(screenTexts, 'inspectorNeeds', {
                    rate: formatHundredths(rate.needs),
                  })}
                  {supply === undefined
                    ? ''
                    : screenText(
                        screenTexts,
                        supply.state === 'full'
                          ? 'inspectorSupplied'
                          : 'inspectorUnderSupplied',
                        { gets: formatHundredths(supply.gets) },
                      )}
                </dd>
              </>
            ) : null}
            {figs?.inputs.map((i) => (
              <>
                <dt>{screenText(screenTexts, 'uiInspectorInput')}</dt>
                <dd>{resourceName(content, i.resource)}</dd>
                <dt>{screenText(screenTexts, 'uiInspectorReceiving')}</dt>
                <dd data-field="receiving">
                  {i.connected
                    ? screenText(screenTexts, 'uiInspectorReceivingEstimate', {
                        resource: resourceName(content, i.resource),
                        rate: fmtRate(i.arrivesPerSec),
                      })
                    : screenText(screenTexts, 'uiInspectorReceivingNothing')}
                </dd>
              </>
            ))}
            {figs?.produces != null ? (
              <>
                <dt>{screenText(screenTexts, 'uiInspectorMines')}</dt>
                <dd>
                  {screenText(screenTexts, 'uiInspectorMinesRate', {
                    resource:
                      figs.produces.resource === null
                        ? '-'
                        : resourceName(content, figs.produces.resource),
                    rate: fmtRate(figs.produces.perSec),
                  })}
                  {figs.produces.lostPerSec > 0
                    ? screenText(screenTexts, 'uiInspectorMinesLost', {
                        rate: fmtRate(figs.produces.lostPerSec),
                      })
                    : ''}
                </dd>
                {figs.produces.stalledPercent !== null ? (
                  <>
                    <dt>{screenText(screenTexts, 'uiInspectorBackedUp')}</dt>
                    <dd data-field="stalled">
                      {screenText(screenTexts, 'inspectorStalled', {
                        percent: String(figs.produces.stalledPercent),
                      })}
                    </dd>
                  </>
                ) : null}
              </>
            ) : null}
            {figs?.derived != null ? (
              <>
                <dt>
                  {screenText(
                    screenTexts,
                    figs.derived.kind === 'units'
                      ? 'uiInspectorProduces'
                      : figs.derived.kind === 'shots'
                        ? 'uiInspectorFires'
                        : 'uiInspectorSteps',
                  )}
                </dt>
                <dd data-field="derived">
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
                </dd>
              </>
            ) : null}
            <dt>{t('uiLblHealth')}</dt>
            <dd>{def.tiers[b.tier - 1]?.health ?? '-'}</dd>
            {attached.length > 0 ? (
              <>
                <dt>{t('uiLblConduits')}</dt>
                <dd>
                  {attached.map((c) => (
                    <button
                      type="button"
                      class="link"
                      key={c.id}
                      onClick={() => {
                        ctl.select({ kind: 'conduit', id: c.id });
                      }}
                    >
                      #{c.id}
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
              {t('uiToolRotateKey')}
            </button>
            <button
              type="button"
              data-action="to-stash"
              onClick={() => void ctl.returnSelected()}
            >
              {t('uiToolReturnToStash')}
            </button>
          </div>
        </div>
      );
    }
  }
  return (
    <Panel title={t('uiPanelSelected')} id="panel-inspector">
      {body}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Overlays and problems

export function OverlaysPanel(props: { model: Model; ctl: BuildController }) {
  const { model, ctl } = props;
  const o = model.ui.overlays;
  const toggle = (
    key: 'flow' | 'paths' | 'dry',
    label: string,
    tip?: string,
  ) => (
    <button
      type="button"
      title={tip}
      class={o[key] ? 'toggle active' : 'toggle'}
      data-overlay={key}
      aria-pressed={o[key]}
      onClick={() => {
        ctl.setOverlay(key, !o[key]);
      }}
    >
      {label}
    </button>
  );
  return (
    <Panel title={t('uiPanelOverlays')} id="panel-overlays" class="fixed">
      <div class="overlay-row">
        {toggle('flow', t('uiOverlayFlow'))}
        {toggle('paths', t('uiOverlayPaths'))}
        {toggle(
          'dry',
          t('uiOverlayDry', {
            secs: fmt(model.ui.dryTicks / simConfig.ticksPerSecond),
          }),
          t('uiOverlayDryTip'),
        )}
      </div>
      <details class="overlay-advanced">
        <summary>{t('uiOverlayAdvanced')}</summary>
        <label class="inline-field">
          {t('uiOverlayDryTicks')}
          <input
            type="number"
            id="dry-ticks"
            min="0"
            max="100000"
            step="50"
            value={model.ui.dryTicks}
            onChange={(e) => {
              ctl.setDryTicks(Math.floor(Number(e.currentTarget.value)));
            }}
          />
          <span class="muted">
            {t('uiOverlayTicksPerSecond', {
              ticks: String(simConfig.ticksPerSecond),
            })}
          </span>
        </label>
      </details>
    </Panel>
  );
}

/**
 * "N more below" while the Problems list is scrolled short of its end. It
 * measures the panel body that holds it; nothing shows when all fit.
 */
function ProblemsMore(props: { problems: readonly Problem[] }) {
  const root = useRef<HTMLDivElement | null>(null);
  const [below, setBelow] = useState(0);
  useEffect(() => {
    const scroller = root.current?.closest('.panel-body');
    if (scroller === null || scroller === undefined) return;
    const measure = (): void => {
      const bottom = scroller.getBoundingClientRect().bottom;
      let hidden = 0;
      scroller.querySelectorAll('li').forEach((li) => {
        const r = li.getBoundingClientRect();
        if (r.top + r.height / 2 > bottom) hidden++;
      });
      setBelow(hidden);
    };
    measure();
    scroller.addEventListener('scroll', measure);
    const ro =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(measure);
    ro?.observe(scroller);
    return () => {
      scroller.removeEventListener('scroll', measure);
      ro?.disconnect();
    };
  }, [props.problems]);
  return (
    <div ref={root} class="problems-more-slot">
      {below > 0 ? (
        <div class="problems-more" data-field="problems-more">
          {t('uiProblemsMore', { n: String(below) })}
        </div>
      ) : null}
    </div>
  );
}

export function ProblemsPanel(props: {
  problems: readonly Problem[];
  onPick: (p: Problem) => void;
}) {
  return (
    <Panel title={t('uiPanelProblems')} id="panel-problems">
      {props.problems.length === 0 ? (
        <p class="ok-text" data-field="no-problems">
          {t('uiNoProblems')}
        </p>
      ) : (
        <ul class="problems">
          {props.problems.map((p) =>
            p.focus === null && p.building === null ? (
              // Nothing to jump to (a partner's summary): plain text, still read out.
              <li key={p.id}>
                <span class="problem" data-problem={p.kind}>
                  <span class="problem-mark" aria-hidden="true">
                    {p.kind === 'stash' ? '△' : '⚠'}
                  </span>
                  {p.text}
                </span>
              </li>
            ) : (
              <li key={p.id}>
                <button
                  type="button"
                  class="problem"
                  data-problem={p.kind}
                  onClick={() => {
                    props.onPick(p);
                  }}
                >
                  <span class="problem-mark" aria-hidden="true">
                    {p.kind === 'stash' || p.kind === 'free_nodes' ? '△' : '⚠'}
                  </span>
                  {p.text}
                </button>
              </li>
            ),
          )}
        </ul>
      )}
      <ProblemsMore problems={props.problems} />
    </Panel>
  );
}

/** The dry-run table: production per source, deliveries per consumer. */
export function DryRunTable(props: {
  team: TeamState;
  flow: FlowView;
  onClose: () => void;
}) {
  const { team, flow } = props;
  const dry = flow.dry;
  const name = (id: number): string => {
    const b = team.buildings.find((x) => x.id === id);
    return b === undefined
      ? `#${String(id)}`
      : `${buildingName(content, b.def)} #${String(id)}`;
  };
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
                <tr key={s.building}>
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
  const { run, ctl, acting } = props;
  const me = run.perPlayer[acting];
  const multi = run.players.length > 1;
  const ready = me?.ready === true;
  const readyCount = run.perPlayer.filter((p) => p.ready).length;
  const block = props.gate?.readyBlock ?? null;
  return (
    <Panel
      title={t(multi ? 'uiPanelParty' : 'uiPanelPartySolo')}
      id="panel-party"
    >
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
      <button
        type="button"
        class={ready ? 'ready-btn on' : 'ready-btn'}
        id="ready-button"
        data-action="ready"
        disabled={block !== null}
        title={block ?? undefined}
        onClick={() => void ctl.toggleReady()}
      >
        {ready ? (
          <SpriteIcon name="ui_icon_ready" scale={1} class="ready-icon" />
        ) : null}
        {t(ready ? 'uiPartyUnready' : 'uiPartyReady')}
      </button>
      {block !== null ? (
        <p class="error" data-field="ready-blocked" role="alert">
          {block}
        </p>
      ) : ready ? (
        <p class="muted" data-field="ready-locked">
          <SpriteIcon name="ui_icon_lock" scale={1} class="bar-icon" />
          {READY_LOCK_TEXT}
        </p>
      ) : null}
    </Panel>
  );
}
