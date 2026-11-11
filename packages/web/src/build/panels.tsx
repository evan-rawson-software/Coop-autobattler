/** Panels of the Build screen: stash, tools, inspector, overlays, problems, party. */

import {
  conduitResource,
  formatText,
  type DryRunResult,
  type TeamState,
} from '@game/core';
import type { RunState } from '@game/session';
import { content } from '../content.js';
import { Panel } from '../shell/AppShell.js';
import type { BuildController, Model, Tool } from './build-controller.js';
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

const fmt = (n: number): string =>
  Number.isInteger(n) ? String(n) : n.toFixed(1);

// ---------------------------------------------------------------------------
// Stash

interface StashGroup {
  readonly def: string;
  readonly tier: number;
  readonly ids: readonly number[];
}

export function groupStash(team: TeamState): StashGroup[] {
  const order = new Map(content.buildings.list().map((d, i) => [d.id, i]));
  const groups = new Map<
    string,
    { def: string; tier: number; ids: number[] }
  >();
  for (const s of team.stash) {
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
  /** The player is Ready: no board changes until Unready. */
  locked?: boolean;
}) {
  const { team, model, ctl } = props;
  const locked = props.locked === true;
  const groups = groupStash(team);
  const held = model.ui.held;
  return (
    <Panel title="Stash · drag onto the board" id="panel-stash">
      {groups.length === 0 ? (
        <p class="muted">Empty. Everything you own is on the board.</p>
      ) : (
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
                  <span class="stash-tier">T{g.tier}</span>
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
  const tool = (id: Tool, label: string, key: string) => (
    <button
      type="button"
      class={ui.tool === id ? 'tool active' : 'tool'}
      data-tool={id}
      aria-pressed={ui.tool === id}
      disabled={locked && id !== 'select'}
      title={locked && id !== 'select' ? READY_LOCK_TEXT : `${label} (${key})`}
      onClick={() => {
        ctl.setTool(id);
      }}
    >
      {label}
    </button>
  );
  return (
    <Panel title="Tools" id="panel-tools" class="fixed">
      <div class="tool-grid">
        {tool('select', 'Select / move', 'V')}
        {tool('conduit', 'Conduit · free', 'C')}
        {tool('erase', 'Erase conduit', 'E')}
        <button
          type="button"
          data-action="rotate"
          disabled={locked}
          title="Rotate (R). Rotating detaches the building's conduits."
          onClick={() => void ctl.rotate()}
        >
          Rotate (R)
        </button>
        <button
          type="button"
          data-action="to-stash"
          disabled={locked || ui.selection?.kind !== 'building'}
          onClick={() => void ctl.returnSelected()}
        >
          To stash
        </button>
        <span />
        <button
          type="button"
          data-action="undo"
          disabled={(view?.undoCount ?? 0) === 0}
          title="Undo (Ctrl+Z). Layout changes only."
          onClick={() => void ctl.undo()}
        >
          Undo
          {view !== null && view.undoCount > 0
            ? ` (${String(view.undoCount)})`
            : ''}
        </button>
        <button
          type="button"
          data-action="redo"
          disabled={(view?.redoCount ?? 0) === 0}
          title="Redo (Ctrl+Shift+Z)"
          onClick={() => void ctl.redo()}
        >
          Redo
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
  ctl: BuildController;
  /** Ids of the unit producers with no route to the front row. */
  sealed?: readonly number[];
}) {
  const { run, model, dry, ctl } = props;
  const team = run.team;
  const sel = model.ui.selection;
  let body = <p class="muted">Click a building or a conduit to inspect it.</p>;

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
          <dt>Health</dt>
          <dd>{def?.tiers[0]?.health ?? '-'}</dd>
        </dl>
        <p class="notice">The Core cannot be moved.</p>
      </div>
    );
  } else if (sel?.kind === 'conduit') {
    const c = team.conduits.find((x) => x.id === sel.id);
    if (c !== undefined) {
      const res = conduitResource(team, content, c.id);
      body = (
        <div data-inspector="conduit">
          <h3 class="insp-name" data-field="name">
            Conduit
          </h3>
          <dl class="props">
            <dt>Carries</dt>
            <dd>
              {res === null ? 'Not determined yet' : resourceName(content, res)}
            </dd>
            <dt>Length</dt>
            <dd>
              {c.cells.length} {c.cells.length === 1 ? 'cell' : 'cells'}
              {c.cells.length === 0 ? ' (direct)' : ''}
            </dd>
          </dl>
          <div class="insp-buttons">
            <button
              type="button"
              data-action="erase"
              onClick={() => void ctl.eraseConduit(c.id)}
            >
              Erase
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
      const figs = inspectorFigures(team, content, simConfig, dry, b);
      const owner =
        run.players[b.owner]?.name ?? `Player ${String(b.owner + 1)}`;
      const attached = team.conduits.filter(
        (c) => c.from.building === b.id || c.to.building === b.id,
      );
      body = (
        <div data-inspector="building">
          <h3 class="insp-name">
            <span data-field="name">{entry?.name ?? b.def}</span>
            <span class="insp-meta">
              {humanize(def.kind)} · tier {b.tier} · bought by {owner}
            </span>
          </h3>
          {props.sealed?.includes(b.id) === true ? (
            <p class="notice sealed-note" data-field="sealed" role="alert">
              Walled in. {SEALED_HINT}
            </p>
          ) : null}
          <p class="muted insp-desc">
            {entry === undefined
              ? ''
              : formatText(entry.description, content.resources)}
          </p>
          <dl class="props">
            {figs?.inputs.map((i) => (
              <>
                <dt>Needs</dt>
                <dd>
                  {resourceName(content, i.resource)}
                  {i.needsPerSec === null
                    ? ''
                    : ` ${fmt(i.needsPerSec)} / sec at full fire`}
                </dd>
                <dt>Receiving</dt>
                <dd data-field="receiving">
                  {i.connected
                    ? `${resourceName(content, i.resource)} ${fmt(i.arrivesPerSec)} / sec (estimate)`
                    : 'nothing: no conduit on this input'}
                </dd>
              </>
            ))}
            {figs?.produces != null ? (
              <>
                <dt>Mines</dt>
                <dd>
                  {figs.produces.resource === null
                    ? '-'
                    : resourceName(content, figs.produces.resource)}{' '}
                  {fmt(figs.produces.perSec)} / sec
                  {figs.produces.lostPerSec > 0
                    ? `, ${fmt(figs.produces.lostPerSec)} / sec lost (no conduit)`
                    : ''}
                </dd>
              </>
            ) : null}
            {figs?.derived != null ? (
              <>
                <dt>
                  {figs.derived.kind === 'units'
                    ? 'Produces'
                    : figs.derived.kind === 'shots'
                      ? 'Fires'
                      : 'Steps'}
                </dt>
                <dd data-field="derived">
                  {fmt(figs.derived.perMin)}{' '}
                  {figs.derived.kind === 'units'
                    ? 'units'
                    : figs.derived.kind === 'shots'
                      ? 'shots'
                      : 'steps'}{' '}
                  / min (estimate; costs {figs.derived.cost} per{' '}
                  {figs.derived.kind === 'units'
                    ? 'unit'
                    : figs.derived.kind === 'shots'
                      ? 'shot'
                      : 'step'}
                  {figs.derived.maxPerMin === null
                    ? ''
                    : `, at most ${fmt(figs.derived.maxPerMin)}`}
                  )
                </dd>
              </>
            ) : null}
            <dt>Health</dt>
            <dd>{def.tiers[b.tier - 1]?.health ?? '-'}</dd>
            {attached.length > 0 ? (
              <>
                <dt>Conduits</dt>
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
              onClick={() => void ctl.rotate()}
            >
              Rotate
            </button>
            <button
              type="button"
              data-action="to-stash"
              onClick={() => void ctl.returnSelected()}
            >
              Return to stash
            </button>
          </div>
        </div>
      );
    }
  }
  return (
    <Panel title="Selected" id="panel-inspector">
      {body}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Overlays and problems

export function OverlaysPanel(props: { model: Model; ctl: BuildController }) {
  const { model, ctl } = props;
  const o = model.ui.overlays;
  const toggle = (key: 'flow' | 'paths' | 'dry', label: string) => (
    <button
      type="button"
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
    <Panel title="Overlays" id="panel-overlays" class="fixed">
      <div class="overlay-row">
        {toggle('flow', 'Resource flow')}
        {toggle('paths', 'Enemy paths')}
        {toggle(
          'dry',
          `Dry run ${String(Math.round(model.ui.dryTicks / simConfig.ticksPerSecond))}s`,
        )}
      </div>
      <label class="inline-field">
        Dry run ticks
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
        <span class="muted">{simConfig.ticksPerSecond} ticks = 1 s</span>
      </label>
    </Panel>
  );
}

export function ProblemsPanel(props: {
  problems: readonly Problem[];
  onPick: (p: Problem) => void;
}) {
  return (
    <Panel title="Problems" id="panel-problems">
      {props.problems.length === 0 ? (
        <p class="ok-text" data-field="no-problems">
          ✓ No problems
        </p>
      ) : (
        <ul class="problems">
          {props.problems.map((p) => (
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
          ))}
        </ul>
      )}
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
    <div class="dry-table" id="dry-table" role="region" aria-label="Dry run">
      <div class="dry-head">
        <strong>
          Dry run · {dry.ticks} ticks ({fmt(secs)} s)
        </strong>
        <button
          type="button"
          onClick={props.onClose}
          aria-label="Close dry run"
        >
          ×
        </button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Source</th>
            <th>Resource</th>
            <th>Produced</th>
            <th>Lost</th>
          </tr>
        </thead>
        <tbody>
          {dry.sources.length === 0 ? (
            <tr>
              <td colSpan={4} class="muted">
                No sources placed.
              </td>
            </tr>
          ) : (
            dry.sources.map((s) => (
              <tr key={s.building}>
                <td>{name(s.building)}</td>
                <td>{resourceName(content, s.resource)}</td>
                <td data-field="produced">{s.produced}</td>
                <td>{s.lost}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <table>
        <thead>
          <tr>
            <th>Consumer</th>
            <th>Needs</th>
            <th>Delivered</th>
            <th>Per sec</th>
          </tr>
        </thead>
        <tbody>
          {dry.consumers.length === 0 ? (
            <tr>
              <td colSpan={4} class="muted">
                No consumers placed.
              </td>
            </tr>
          ) : (
            dry.consumers.map((c) => (
              <tr
                key={`${String(c.building)}${c.side}`}
                class={c.delivered === 0 ? 'bad' : ''}
              >
                <td>{name(c.building)}</td>
                <td>{resourceName(content, c.resource)}</td>
                <td data-field="delivered">{c.delivered}</td>
                <td>
                  {fmt(
                    Math.round(
                      (c.ratePer1000 * simConfig.ticksPerSecond) / 100,
                    ) / 10,
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Party and ready

export function PartyPanel(props: {
  run: RunState;
  ctl: BuildController;
  gate?: Gate | null;
}) {
  const { run, ctl } = props;
  const me = run.perPlayer[0];
  const ready = me?.ready === true;
  const readyCount = run.perPlayer.filter((p) => p.ready).length;
  const block = props.gate?.readyBlock ?? null;
  return (
    <Panel title="Party · solo" id="panel-party">
      <div class="party-row">
        <span>{run.players[0]?.name ?? 'You'}</span>
        <span class="muted">editing the board</span>
        <span data-field="ready-state">ready: {ready ? 'yes' : 'no'}</span>
      </div>
      <p class="muted party-next">
        Next: {run.step === 'shop' && run.leg === 'pve' ? 'PvP' : 'PvE'} ·{' '}
        {readyCount} of {run.players.length} ready
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
        {ready ? 'Unready' : 'Ready'}
      </button>
      {block !== null ? (
        <p class="error" data-field="ready-blocked" role="alert">
          {block}
        </p>
      ) : ready ? (
        <p class="muted" data-field="ready-locked">
          {READY_LOCK_TEXT}
        </p>
      ) : null}
    </Panel>
  );
}
