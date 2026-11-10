/**
 * The debug screen: generate a map with `core`, fill a sample team, and look
 * at it through the board view. Shows what is under the cursor and the
 * selected building, and a legend generated from the content.
 */

import {
  formatText,
  generateMap,
  type GameMap,
  type PlacedBuilding,
  type TeamState,
} from '@game/core';
import { useEffect, useMemo } from 'preact/hooks';
import { useStore } from '../app-state.js';
import { BoardView } from '../board/BoardView.js';
import { CameraController } from '../board/controller.js';
import { conduitDash } from '../board/render.js';
import type { Hit } from '../board/scene.js';
import { content } from '../content.js';
import { registerDebug } from '../debug-hook.js';
import { buildSampleTeam } from '../sample-team.js';
import { AppShell, Panel } from '../shell/AppShell.js';
import { debugStore, patchDebug } from './debug-state.js';

const controller = new CameraController();
const NEUTRAL_HEIGHT = 6;

function humanize(id: string): string {
  const s = id.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function name(id: string): string {
  return content.presentation.get(id)?.name ?? id;
}

function makeSample(
  seed: number,
  partySize: number,
  dense: boolean,
): TeamState | null {
  try {
    const map: GameMap = generateMap(
      seed >>> 0,
      partySize,
      content,
      content.mapgen,
    );
    return buildSampleTeam(map, content, seed, { dense });
  } catch (e) {
    console.error(e);
    return null;
  }
}

function findBuilding(
  state: TeamState,
  id: number,
): PlacedBuilding | undefined {
  return state.buildings.find((b) => b.id === id);
}

function Dash(props: { pattern: number; color: string | null }) {
  const lw = 3;
  const dash = conduitDash(props.pattern).map((d) => d * lw);
  return (
    <svg class="legend-line" width="44" height="10" aria-hidden="true">
      <line
        x1="0"
        y1="5"
        x2="44"
        y2="5"
        stroke={props.color ?? 'var(--conduit-unknown)'}
        stroke-width={lw}
        stroke-dasharray={dash.length > 0 ? dash.join(' ') : undefined}
      />
    </svg>
  );
}

function SetupPanel() {
  const s = useStore(debugStore);
  const sizes = Array.from(
    { length: content.mapgen.maxPartySize },
    (_, i) => i + 1,
  );
  return (
    <Panel title="Setup" id="panel-setup">
      <div class="form-grid">
        <label>
          Seed
          <input
            type="number"
            id="seed-input"
            min="0"
            max="4294967295"
            step="1"
            value={s.seed}
            onChange={(e) => {
              const v = Math.floor(Number(e.currentTarget.value));
              if (Number.isFinite(v) && v >= 0 && v <= 0xffffffff) {
                patchDebug({ seed: v, selection: null, hover: null });
              }
            }}
          />
        </label>
        <button
          type="button"
          id="seed-random"
          onClick={() => {
            patchDebug({
              seed: Math.floor(Math.random() * 0x100000000),
              selection: null,
              hover: null,
            });
          }}
        >
          Random
        </button>
        <label>
          Party size
          <select
            id="party-size"
            value={s.partySize}
            onChange={(e) => {
              patchDebug({
                partySize: Number(e.currentTarget.value),
                selection: null,
                hover: null,
              });
            }}
          >
            {sizes.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label class="check">
          <input
            type="checkbox"
            id="show-enemy"
            checked={s.showEnemy}
            onChange={(e) => {
              patchDebug({
                showEnemy: e.currentTarget.checked,
                selection: null,
                hover: null,
              });
            }}
          />
          Show enemy board
        </label>
      </div>
    </Panel>
  );
}

function LegendPanel() {
  const resources = content.resources.list();
  const kinds = Array.from(
    new Set(content.buildings.list().map((b) => b.kind)),
  );
  return (
    <Panel title="Legend" id="panel-legend">
      <div class="legend">
        <div class="legend-group">
          <h3>Resources and conduits</h3>
          <ul>
            {resources.map((r, i) => (
              <li key={r.id}>
                <span
                  class="diamond"
                  style={{ background: r.color ?? 'var(--conduit-unknown)' }}
                >
                  {Array.from(r.name)[0]?.toUpperCase()}
                </span>
                <Dash pattern={i} color={r.color ?? null} />
                {r.name}
              </li>
            ))}
            <li>
              <span class="diamond none" />
              <Dash pattern={-1} color={null} />
              Not yet determined
            </li>
          </ul>
        </div>
        <div class="legend-group">
          <h3>Buildings</h3>
          <ul>
            {kinds.map((k) => (
              <li key={k}>
                <span
                  class="swatch"
                  style={{ background: `var(--kind-${k.replace('_', '-')})` }}
                />
                {humanize(k)}
              </li>
            ))}
            <li>
              <span class="swatch wall" />
              Wall (solid block)
            </li>
          </ul>
        </div>
        <div class="legend-group">
          <h3>Terrain</h3>
          <ul>
            {content.terrain.list().map((t, i) => (
              <li key={t.id}>
                <span
                  class={`swatch feature-${String(i % 3)}`}
                  style={{ background: `var(--feature-${String(i % 3)})` }}
                />
                {name(t.id)}
              </li>
            ))}
          </ul>
        </div>
        <div class="legend-group">
          <h3>Marks</h3>
          <ul>
            <li>
              <span class="mark">&#9654;</span> Input side (resource colour)
            </li>
            <li>
              <span class="mark out">&#9654;</span> Output side
            </li>
            <li>
              <span class="swatch owner owner-0" /> Frame colour is the owner
            </li>
          </ul>
        </div>
      </div>
    </Panel>
  );
}

function describe(hit: Hit, own: TeamState, enemy: TeamState | null): string[] {
  const state = hit.board === 'own' ? own : enemy;
  if (!state) return [];
  const lines: string[] = [];
  const feature = state.map.features.find(
    (f) => f.x === hit.x && f.y === hit.y,
  );
  if (feature) lines.push(`Terrain: ${name(feature.feature)}`);
  const node = state.map.nodes.find((n) => n.x === hit.x && n.y === hit.y);
  if (node)
    lines.push(
      `Resource node: ${content.resources.displayName(node.resource)}`,
    );
  if (hit.building === 'core') {
    lines.push('Building: Core');
  } else if (hit.building) {
    lines.push(`Building: ${name(hit.building.def)}`);
  }
  const conduit = state.conduits.find((c) =>
    c.cells.some((p) => p.x === hit.x && p.y === hit.y),
  );
  if (conduit) lines.push(`Conduit #${String(conduit.id)}`);
  if (lines.length === 0) lines.push('Open ground');
  return lines;
}

function InspectorPanel(props: {
  own: TeamState | null;
  enemy: TeamState | null;
}) {
  const s = useStore(debugStore);
  const { own, enemy } = props;
  const sel = s.selection;
  let detail = null;
  if (sel && own) {
    const state = sel.board === 'own' ? own : enemy;
    if (state) {
      if (sel.building === 'core') {
        const def = content.buildings.list().find((d) => d.kind === 'core');
        const entry = def ? content.presentation.get(def.id) : undefined;
        detail = (
          <dl class="props">
            <dt>Name</dt>
            <dd data-field="name">{entry?.name ?? 'Core'}</dd>
            <dt>Description</dt>
            <dd>
              {entry ? formatText(entry.description, content.resources) : ''}
            </dd>
            <dt>Kind</dt>
            <dd>{humanize('core')}</dd>
          </dl>
        );
      } else if (typeof sel.building === 'number') {
        const b = findBuilding(state, sel.building);
        const def = b ? content.buildings.get(b.def) : undefined;
        const entry = b ? content.presentation.get(b.def) : undefined;
        if (b && def && entry) {
          detail = (
            <dl class="props">
              <dt>Name</dt>
              <dd data-field="name">{entry.name}</dd>
              <dt>Description</dt>
              <dd>{formatText(entry.description, content.resources)}</dd>
              <dt>Kind</dt>
              <dd>{humanize(def.kind)}</dd>
              <dt>Tier</dt>
              <dd>{b.tier}</dd>
              <dt>Rotation</dt>
              <dd>{b.rotation}&deg;</dd>
              <dt>Owner</dt>
              <dd>Player {b.owner + 1}</dd>
              <dt>Position</dt>
              <dd>
                {b.x}, {b.y}
              </dd>
            </dl>
          );
        }
      } else {
        detail = (
          <p class="muted">
            Empty cell {sel.x}, {sel.y}
          </p>
        );
      }
    }
  }
  const hoverLines = s.hover && own ? describe(s.hover, own, enemy) : [];
  return (
    <>
      <Panel title="Under the cursor" id="panel-hover">
        {s.hover ? (
          <>
            <p class="muted" data-field="hover-cell">
              {s.hover.board === 'own' ? 'Your board' : 'Enemy board'} ·{' '}
              {s.hover.x}, {s.hover.y}
            </p>
            <ul class="plain">
              {hoverLines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </>
        ) : (
          <p class="muted">Move the pointer over the board.</p>
        )}
      </Panel>
      <Panel title="Selected" id="panel-selected">
        {detail ?? <p class="muted">Click a building or a cell.</p>}
      </Panel>
    </>
  );
}

export function DebugScreen() {
  const s = useStore(debugStore);
  // The enemy sample is only built when it is shown.
  const own = useMemo(
    () => makeSample(s.seed, s.partySize, s.dense),
    [s.seed, s.partySize, s.dense],
  );
  const enemy = useMemo(
    () => (s.showEnemy ? makeSample(s.seed + 1, s.partySize, s.dense) : null),
    [s.showEnemy, s.seed, s.partySize, s.dense],
  );

  useEffect(() => {
    registerDebug({
      setDense: (dense) => {
        patchDebug({ dense, selection: null, hover: null });
      },
      counts: () => {
        return {
          buildings: own?.buildings.length ?? 0,
          conduits: own?.conduits.length ?? 0,
          conduitCells:
            own?.conduits.reduce((n, c) => n + c.cells.length, 0) ?? 0,
        };
      },
    });
  }, [own]);

  const resetKey = `${String(s.seed)}:${String(s.partySize)}:${String(s.showEnemy)}:${String(s.dense)}`;

  return (
    <AppShell
      title="Debug"
      status={`Seed ${String(s.seed)} · Party of ${String(s.partySize)}${s.dense ? ' · dense' : ''}`}
      right={<InspectorPanel own={own} enemy={enemy} />}
      bottom={
        <>
          <SetupPanel />
          <LegendPanel />
        </>
      }
    >
      {own ? (
        <BoardView
          content={content}
          own={own}
          enemy={enemy}
          neutralHeight={NEUTRAL_HEIGHT}
          controller={controller}
          resetKey={resetKey}
          selection={s.selection}
          onHover={(hit) => {
            patchDebug({ hover: hit });
          }}
          onSelect={(selection) => {
            patchDebug({ selection });
          }}
        />
      ) : (
        <p class="error">Could not generate a map for this seed.</p>
      )}
    </AppShell>
  );
}
