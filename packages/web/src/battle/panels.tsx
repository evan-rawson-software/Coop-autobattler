/** The panels of the battle screen (left, right) and its summary. */

import type { BattleReason } from '@game/core';
import { useMemo } from 'preact/hooks';
import { BoardView, type OverlayContext } from '../board/BoardView.js';
import { CameraController } from '../board/controller.js';
import { Panel } from '../shell/AppShell.js';
import type { WebContent } from '../content.js';
import { ChartLegend, LineChart, type ChartMarker } from './charts.js';
import {
  buildingRows,
  clock,
  destroyedOf,
  type Moment,
  type Side,
  type SideStats,
} from './derive.js';
import type { Playback, PlaybackSpeed } from './playback.js';
import { SPEEDS } from './playback.js';
import type { OpponentInfo } from './types.js';

export const KIND_LABEL: Readonly<Record<OpponentInfo['kind'], string>> = {
  ghost: 'Ghost',
  boss: 'Boss',
  pve: 'PvE threat',
};

export const opponentKindLabel = (o: OpponentInfo): string =>
  o.label ?? KIND_LABEL[o.kind];

export function CoreBar(props: {
  readonly label: string;
  readonly hp: number;
  readonly max: number;
  readonly side: Side;
}) {
  const pct = props.max <= 0 ? 0 : Math.round((props.hp / props.max) * 100);
  return (
    <div class="core-row">
      <span class="core-label">{props.label}</span>
      <div
        class="bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={props.max}
        aria-valuenow={props.hp}
        aria-label={`${props.label} health`}
      >
        <div
          class={`bar-fill side-${String(props.side)}`}
          style={{ width: `${String(pct)}%` }}
        />
      </div>
      <span class="core-num" data-field={`core-hp-${String(props.side)}`}>
        {props.hp} / {props.max}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Left dock

export interface ChartData {
  readonly own: readonly { x: number; y: number }[];
  readonly foe: readonly { x: number; y: number }[];
  readonly yMax: number;
}

/** The army-strength series up to `tick` (unit health summed per side). */
export function strengthSeries(pb: Playback, upTo: number): ChartData {
  const own: { x: number; y: number }[] = [];
  const foe: { x: number; y: number }[] = [];
  let yMax = 1;
  for (const s of pb.record.summary.timeline) {
    yMax = Math.max(yMax, s.sides[0].unitHealth, s.sides[1].unitHealth);
    if (s.tick > upTo) continue;
    own.push({ x: s.tick, y: s.sides[0].unitHealth });
    foe.push({ x: s.tick, y: s.sides[1].unitHealth });
  }
  return { own, foe, yMax };
}

export function LeftPanels(props: {
  readonly pb: Playback;
  readonly mine: SideStats;
  readonly theirs: SideStats;
  readonly content: WebContent;
  readonly foeName: string;
  readonly overloadTick: number | null;
  readonly tps: number;
}) {
  const { pb, mine, theirs, content } = props;
  const resName = (id: string): string => content.resources.get(id)?.name ?? id;
  const tick = pb.tick;
  const chart = strengthSeries(pb, tick);
  const live = {
    own: [...chart.own, { x: tick, y: sumHealth(pb, 0) }],
    foe: [...chart.foe, { x: tick, y: sumHealth(pb, 1) }],
  };
  const markers: ChartMarker[] =
    props.overloadTick !== null && props.overloadTick <= tick
      ? [{ x: props.overloadTick, label: 'O' }]
      : [];
  return (
    <>
      <Panel title="Your side" id="panel-your-side">
        <CoreBar label="Core" hp={mine.coreHp} max={mine.coreMax} side={0} />
        <p class="stat-line" data-field="walls-own">
          {mine.wallsTotal === 0
            ? 'No walls'
            : `Walls: ${String(mine.wallsStanding)} / ${String(mine.wallsTotal)} standing`}
        </p>
      </Panel>
      <Panel title="Production (per sec)" id="panel-production">
        <table class="stat-table">
          <tbody>
            {mine.production.map((p) => (
              <tr key={p.resource}>
                <th scope="row">{resName(p.resource)}</th>
                <td data-field={`prod-${p.resource}`}>
                  {p.perSecond.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {mine.rampSteps > 0 ? (
          <p class="stat-line">▲ ramp steps taken: {mine.rampSteps}</p>
        ) : null}
        <hr />
        <table class="stat-table">
          <thead>
            <tr>
              <th />
              <th>You</th>
              <th>Them</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Units alive</th>
              <td data-field="alive-own">{mine.unitsAlive}</td>
              <td data-field="alive-foe">{theirs.unitsAlive}</td>
            </tr>
            <tr>
              <th scope="row">Units lost</th>
              <td data-field="lost-own">{mine.unitsLost}</td>
              <td data-field="lost-foe">{theirs.unitsLost}</td>
            </tr>
          </tbody>
        </table>
      </Panel>
      <Panel title="Army strength" id="panel-strength">
        <LineChart
          series={[
            { side: 0, points: live.own },
            { side: 1, points: live.foe },
          ]}
          xMax={pb.endTick}
          yMax={chart.yMax}
          now={tick}
          markers={markers}
          height={130}
          ariaLabel="Army strength over time, you against the opponent"
          formatX={(x) => clock(x, props.tps)}
          testId="chart-strength-live"
        />
        <ChartLegend labels={['You', props.foeName]} />
        {markers.length > 0 ? (
          <p class="muted small">O: Overload begins</p>
        ) : null}
      </Panel>
    </>
  );
}

function sumHealth(pb: Playback, side: number): number {
  let n = 0;
  for (const u of pb.sim.units) if (u.side === side) n += u.hp;
  return n;
}

// ---------------------------------------------------------------------------
// Right dock

export function RightPanels(props: {
  readonly pb: Playback;
  readonly opponent: OpponentInfo;
  readonly foeWord: string;
  readonly theirs: SideStats;
  readonly moments: readonly Moment[];
  readonly tps: number;
  readonly revealed: boolean;
  readonly onSpeed: (s: PlaybackSpeed) => void;
  readonly onPause: () => void;
  readonly onSkip: () => void;
  readonly onFocus: (m: Moment) => void;
  readonly controller: CameraController;
  readonly onEnemyBase: () => void;
}) {
  const { pb, opponent, theirs } = props;
  const shown = props.moments
    .filter((m) => m.tick <= pb.tick && (m.kind !== 'zone' || props.revealed))
    .reverse();
  return (
    <>
      <Panel title={props.foeWord} id="panel-enemy">
        <p class="opp-name" data-field="opp-name">
          {opponent.name}
        </p>
        <p class="stat-line">
          <span class="kind-chip" data-field="opp-kind">
            {opponentKindLabel(opponent)}
          </span>
        </p>
        <CoreBar
          label="Core"
          hp={theirs.coreHp}
          max={theirs.coreMax}
          side={1}
        />
        <p class="stat-line" data-field="walls-foe">
          {theirs.wallsTotal === 0
            ? 'No walls'
            : `Walls: ${String(theirs.wallsStanding)} / ${String(theirs.wallsTotal)} standing`}
        </p>
      </Panel>
      <Panel title="Battle log" id="panel-log" class="grow">
        {shown.length === 0 ? (
          <p class="muted">Nothing yet.</p>
        ) : (
          <ol class="log" data-field="log">
            {shown.map((m, i) => (
              <li
                key={`${String(m.tick)}-${String(i)}`}
                class={`log-${m.kind}`}
              >
                <button
                  type="button"
                  class="link-button"
                  disabled={m.focus === null}
                  onClick={() => {
                    props.onFocus(m);
                  }}
                >
                  <span class="log-time">{clock(m.tick, props.tps)}</span>{' '}
                  {m.text}
                </button>
              </li>
            ))}
          </ol>
        )}
      </Panel>
      <Panel title="Speed" id="panel-speed">
        <div class="btn-row">
          {SPEEDS.map((s) => (
            <button
              type="button"
              key={s}
              id={`speed-${String(s)}`}
              class={pb.speed === s ? 'on' : ''}
              aria-pressed={pb.speed === s}
              onClick={() => {
                props.onSpeed(s);
              }}
            >
              {s}×
            </button>
          ))}
          <button type="button" id="skip" onClick={props.onSkip}>
            Skip
          </button>
        </div>
        <div class="btn-row">
          <button
            type="button"
            id="pause"
            aria-pressed={pb.paused}
            class={pb.paused ? 'on' : ''}
            onClick={props.onPause}
          >
            {pb.paused ? 'Play' : 'Pause'}
          </button>
        </div>
      </Panel>
      <Panel title="Camera" id="panel-camera">
        <div class="btn-row">
          <button
            type="button"
            onClick={() => {
              props.controller.preset('center');
            }}
          >
            Center
          </button>
          <button
            type="button"
            onClick={() => {
              props.controller.preset('base');
            }}
          >
            My base
          </button>
          <button type="button" onClick={props.onEnemyBase}>
            Their base
          </button>
          <button
            type="button"
            onClick={() => {
              props.controller.preset('fit');
            }}
          >
            Fit battle
          </button>
        </div>
        <p class="muted small">Drag to pan · scroll to zoom.</p>
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------------
// Summary

const REASON_TEXT: Readonly<Record<BattleReason, string>> = {
  core_destroyed: 'A Core was destroyed.',
  tiebreak_overkill:
    'Both Cores fell together; the side with less overkill damage wins.',
  tiebreak_defender: 'Both Cores fell together; the defender wins a tie.',
  time_limit: 'Time ran out; the Core with more health left wins.',
};

export interface SummaryProps {
  readonly pb: Playback;
  readonly content: WebContent;
  readonly opponent: OpponentInfo;
  readonly title: string;
  readonly moments: readonly Moment[];
  readonly rewardText: string;
  readonly tps: number;
  readonly ready: boolean;
  readonly onWatchAgain: () => void;
  readonly onReady: () => void;
}

export function BattleSummaryView(props: SummaryProps) {
  const { pb, content, opponent, moments } = props;
  const rec = pb.record;
  const won = rec.result.winner === 0;
  const own = rec.summary.sides[0];
  const foe = rec.summary.sides[1];
  const rows = useMemo(() => buildingRows(rec, content, 0), [rec, content]);
  const destroyed = useMemo(() => destroyedOf(rec, 0), [rec]);
  const marked = moments.filter(
    (m) =>
      m.kind !== 'zone' && m.kind !== 'core_half' && m.kind !== 'core_quarter',
  );
  const markers: ChartMarker[] = marked.map((m, i) => ({
    x: m.tick,
    label: String(i + 1),
  }));
  const chart = strengthSeries(pb, Number.POSITIVE_INFINITY);
  const breachMoments = moments.filter(
    (m) =>
      m.side === 0 &&
      (m.kind === 'breach' ||
        m.kind === 'junction' ||
        m.kind === 'production' ||
        m.kind === 'core_destroyed'),
  );
  const camera = useMemo(() => {
    const c = new CameraController();
    c.resetPreset = 'fit';
    c.refitOnResize = true;
    return c;
  }, []);

  const overlay = useMemo(
    () => (ctx: CanvasRenderingContext2D, o: OverlayContext) => {
      const board = o.scene.boards[0];
      if (board === undefined) return;
      const z = o.camera.zoom;
      const ox = o.viewport.w / 2 - o.camera.cx * z;
      const oy = o.viewport.h / 2 - o.camera.cy * z;
      ctx.strokeStyle = o.theme.hover;
      ctx.fillStyle = o.theme.hover;
      ctx.lineWidth = Math.max(2, z * 0.12);
      const gone = new Set(destroyed.buildings);
      for (const b of board.buildings) {
        if (!gone.has(b.instance.id)) continue;
        ctx.globalAlpha = 0.3;
        ctx.fillRect(
          ox + b.rect.x * z,
          oy + b.rect.y * z,
          b.rect.w * z,
          b.rect.h * z,
        );
        ctx.globalAlpha = 1;
        ctx.strokeRect(
          ox + b.rect.x * z - 2,
          oy + b.rect.y * z - 2,
          b.rect.w * z + 4,
          b.rect.h * z + 4,
        );
      }
      if (destroyed.core && board.core) {
        const r = board.core.rect;
        ctx.globalAlpha = 0.3;
        ctx.fillRect(ox + r.x * z, oy + r.y * z, r.w * z, r.h * z);
        ctx.globalAlpha = 1;
        ctx.strokeRect(
          ox + r.x * z - 2,
          oy + r.y * z - 2,
          r.w * z + 4,
          r.h * z + 4,
        );
      }
      const lostConduits = new Set(destroyed.conduits);
      for (const c of board.conduits) {
        if (!lostConduits.has(c.id) || c.points.length < 2) continue;
        ctx.beginPath();
        c.points.forEach((p, i) => {
          if (i === 0) ctx.moveTo(ox + p.x * z, oy + p.y * z);
          else ctx.lineTo(ox + p.x * z, oy + p.y * z);
        });
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    },
    [destroyed],
  );

  const showCol = (pick: (r: (typeof rows)[number]) => number): boolean =>
    rows.some((r) => pick(r) > 0);
  const cols = {
    produced: showCol((r) => r.produced),
    delivered: showCol((r) => r.delivered),
    trained: showCol((r) => r.trained),
    damage: showCol((r) => r.damage),
    upgrades: showCol((r) => r.upgrades),
  };

  return (
    <div class="summary" data-testid="battle-summary">
      <section
        class={`result-banner ${won ? 'won' : 'lost'}`}
        id="result-banner"
      >
        <h2 class="result-title">
          <span data-field="result-word">{won ? 'Victory' : 'Defeat'}</span>
          {' · vs. '}
          {opponent.name}
        </h2>
        <p class="result-reward" data-field="reward">
          {props.rewardText}
        </p>
        <p class="result-detail">
          {REASON_TEXT[rec.result.reason]} Battle time{' '}
          {clock(rec.result.endTick, props.tps)}. Your Core{' '}
          <strong data-field="final-core-own">
            {own.coreHealth} / {own.coreMaxHealth}
          </strong>
          , theirs{' '}
          <strong data-field="final-core-foe">
            {foe.coreHealth} / {foe.coreMaxHealth}
          </strong>
          .
        </p>
      </section>

      <Panel title="Army strength over time" id="panel-summary-chart">
        <LineChart
          series={[
            { side: 0, points: chart.own },
            { side: 1, points: chart.foe },
          ]}
          xMax={pb.endTick}
          yMax={chart.yMax}
          markers={markers}
          height={340}
          ariaLabel="Army strength over time, you against the opponent, with notable moments marked"
          formatX={(x) => clock(x, props.tps)}
          testId="chart-strength-summary"
        />
        <ChartLegend labels={['You', opponent.name]} />
        <ol class="marker-list">
          {marked.map((m, i) => (
            <li key={`${String(m.tick)}-${String(i)}`}>
              <span class="marker-n">{i + 1}</span>
              {clock(m.tick, props.tps)} {m.text}
            </li>
          ))}
        </ol>
      </Panel>

      <Panel title="Where you were breached" id="panel-breaches">
        <div class="mini-board">
          <BoardView
            content={content}
            own={rec.initialTeams[0]}
            controller={camera}
            resetKey={rec}
            drawOverlay={overlay}
            overlayKey={destroyed}
          />
        </div>
        {breachMoments.length === 0 ? (
          <p class="muted" data-field="no-breach">
            Nothing of yours was destroyed.
          </p>
        ) : (
          <ul class="plain breach-list" data-field="breach-list">
            {breachMoments.map((m, i) => (
              <li key={`${String(m.tick)}-${String(i)}`}>
                {clock(m.tick, props.tps)} {m.text}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Your buildings" id="panel-buildings">
        <table class="stat-table buildings-table" data-field="buildings">
          <thead>
            <tr>
              <th>Building</th>
              {cols.produced ? <th>Produced</th> : null}
              {cols.delivered ? <th>Received</th> : null}
              {cols.trained ? <th>Units</th> : null}
              {cols.damage ? <th>Damage</th> : null}
              {cols.upgrades ? <th>Upgrades</th> : null}
              <th>Lost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row">
                  {r.name}
                  {r.count > 1 ? ` ×${String(r.count)}` : ''}
                </th>
                {cols.produced ? <td>{r.produced || '–'}</td> : null}
                {cols.delivered ? <td>{r.delivered || '–'}</td> : null}
                {cols.trained ? <td>{r.trained || '–'}</td> : null}
                {cols.damage ? <td>{r.damage || '–'}</td> : null}
                {cols.upgrades ? <td>{r.upgrades || '–'}</td> : null}
                <td>
                  {r.lost === 0
                    ? '–'
                    : `${String(r.lost)} of ${String(r.count)}${
                        r.firstLostTick === null
                          ? ''
                          : ` (first ${clock(r.firstLostTick, props.tps)})`
                      }`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="Next" id="panel-ready" class="ready-panel">
        <div class="btn-col">
          <button
            type="button"
            id="watch-again"
            disabled={props.ready}
            onClick={props.onWatchAgain}
          >
            Watch again
          </button>
          <button
            type="button"
            id="battle-ready"
            class="primary"
            disabled={props.ready}
            onClick={props.onReady}
          >
            {props.ready ? 'Ready ✓' : 'Ready'}
          </button>
        </div>
        <p class="muted" data-field="ready-note">
          {props.ready ? 'You are ready.' : 'Ready continues the run.'}
        </p>
      </Panel>
    </div>
  );
}
