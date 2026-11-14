/** The panels of the battle screen (left, right) and its summary. */

import type { BattleReason, BattleSideSummary } from '@game/core';
import { useMemo } from 'preact/hooks';
import { BoardView, type OverlayContext } from '../board/BoardView.js';
import { CameraController } from '../board/controller.js';
import { Panel } from '../shell/AppShell.js';
import type { WebContent } from '../content.js';
import { screenNodes, screenText, screenTexts } from '../build/texts.js';
import { bossLabel } from '../run/display-text.js';
import { ChartLegend, LineChart, type ChartMarker } from './charts.js';
import {
  breachEntries,
  buildingRows,
  clock,
  coreNameOf,
  destroyedOf,
  liveAxisMaxTick,
  mergeMarkers,
  strengthSeries,
  wallsWord,
  type Moment,
  type Side,
  type SideStats,
  type CoreNow,
} from './derive.js';
import type { Playback, PlaybackSpeed } from './playback.js';
import { SPEEDS } from './playback.js';
import type { OpponentInfo } from './types.js';

const t = (key: string, values: Record<string, string> = {}): string =>
  screenText(screenTexts, key, values);

const wallsLine = (walls: string, standing: number, total: number): string =>
  total === 0
    ? t('battleWallsNone', { walls: walls.toLowerCase() })
    : t('battleWallsStanding', {
        walls,
        standing: String(standing),
        total: String(total),
      });

export const KIND_LABEL: Readonly<Record<OpponentInfo['kind'], string>> = {
  ghost: t('battleKindGhost'),
  boss: bossLabel(),
  pve: t('battleKindPve'),
};

export const opponentKindLabel = (o: OpponentInfo): string =>
  o.label ?? KIND_LABEL[o.kind];

/**
 * A side's Core health: one bar for a lone Core, as before; with several, one
 * bar per player (a fallen Core reads as fallen) under the total.
 */
export function CoreBars(props: {
  readonly label: string;
  readonly cores: readonly CoreNow[];
  readonly hp: number;
  readonly max: number;
  readonly side: Side;
}) {
  const { cores } = props;
  if (cores.length <= 1) {
    return (
      <CoreBar
        label={props.label}
        hp={props.hp}
        max={props.max}
        side={props.side}
      />
    );
  }
  const standing = cores.filter((c) => c.hp > 0).length;
  return (
    <div class="core-group" data-field={`cores-${String(props.side)}`}>
      <CoreBar
        label={t('battleCoresCount', {
          label: props.label,
          standing: String(standing),
          total: String(cores.length),
        })}
        hp={props.hp}
        max={props.max}
        side={props.side}
      />
      {cores.map((c) => (
        <div
          class={c.hp > 0 ? 'core-sub' : 'core-sub fallen'}
          key={c.player}
          data-field={`core-${String(props.side)}-${String(c.player)}`}
        >
          <CoreBar
            label={t(c.hp > 0 ? 'battleCoreStanding' : 'battleCoreFallen', {
              label: props.label,
              number: String(c.player + 1),
            })}
            hp={c.hp}
            max={c.max}
            side={props.side}
            field={`core-hp-${String(props.side)}-${String(c.player)}`}
          />
        </div>
      ))}
    </div>
  );
}

export function CoreBar(props: {
  readonly label: string;
  readonly hp: number;
  readonly max: number;
  readonly side: Side;
  /** The `data-field` of the number; per side by default. */
  readonly field?: string;
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
      <span
        class="core-num"
        data-field={props.field ?? `core-hp-${String(props.side)}`}
      >
        {props.hp} / {props.max}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Left dock

export function LeftPanels(props: {
  readonly pb: Playback;
  readonly mine: SideStats;
  readonly theirs: SideStats;
  readonly content: WebContent;
  readonly foeName: string;
  readonly overloadTick: number | null;
  /** PvE: which Core Overload destroys first; null against a ghost. */
  readonly overloadNote?: string | null;
  readonly tps: number;
}) {
  const { pb, mine, theirs, content } = props;
  const resName = (id: string): string => content.resources.get(id)?.name ?? id;
  const tick = pb.tick;
  const coreName = coreNameOf(content);
  const walls = wallsWord(content);
  // Only what has happened so far: the axes grow with the playback position.
  const chart = strengthSeries(pb.record.summary.timeline, tick);
  const nowOwn = sumHealth(pb, 0);
  const nowFoe = sumHealth(pb, 1);
  const live = {
    own: [...chart.own, { x: tick, y: nowOwn }],
    foe: [...chart.foe, { x: tick, y: nowFoe }],
  };
  const liveYMax = Math.max(chart.yMax, nowOwn, nowFoe);
  const markers: ChartMarker[] =
    props.overloadTick !== null && props.overloadTick <= tick
      ? [{ x: props.overloadTick, label: 'O' }]
      : [];
  return (
    <>
      <Panel title={t('battlePanelYourSide')} id="panel-your-side">
        <CoreBars
          label={coreName}
          cores={mine.cores}
          hp={mine.coreHp}
          max={mine.coreMax}
          side={0}
        />
        <p class="stat-line" data-field="walls-own">
          {wallsLine(walls, mine.wallsStanding, mine.wallsTotal)}
        </p>
      </Panel>
      <Panel title={t('battlePanelProduction')} id="panel-production">
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
          <p class="stat-line">
            {t('battleRampSteps', { count: String(mine.rampSteps) })}
          </p>
        ) : null}
        <hr />
        <table class="stat-table">
          <thead>
            <tr>
              <th />
              <th>{t('battleColYou')}</th>
              <th>{t('battleColThem')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">{t('battleRowUnitsAlive')}</th>
              <td data-field="alive-own">{mine.unitsAlive}</td>
              <td data-field="alive-foe">{theirs.unitsAlive}</td>
            </tr>
            <tr>
              <th scope="row">{t('battleRowUnitsLost')}</th>
              <td data-field="lost-own">{mine.unitsLost}</td>
              <td data-field="lost-foe">{theirs.unitsLost}</td>
            </tr>
          </tbody>
        </table>
      </Panel>
      <Panel title={t('battlePanelStrength')} id="panel-strength">
        <LineChart
          series={[
            { side: 0, points: live.own },
            { side: 1, points: live.foe },
          ]}
          xMax={liveAxisMaxTick(tick, props.tps)}
          yMax={liveYMax}
          now={tick}
          markers={markers}
          height={130}
          ariaLabel="Army strength over time, you against the opponent"
          formatX={(x) => clock(x, props.tps)}
          testId="chart-strength-live"
        />
        <ChartLegend labels={[t('battleColYou'), props.foeName]} />
        {markers.length > 0 ? (
          <p class="muted small">{t('battleOverloadKey')}</p>
        ) : null}
        {props.overloadNote === undefined ||
        props.overloadNote === null ? null : (
          <p class="muted small" data-field="overload-note">
            {props.overloadNote}
          </p>
        )}
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
  readonly content: WebContent;
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
  const { pb, opponent, theirs, content } = props;
  const coreName = coreNameOf(content);
  const walls = wallsWord(content);
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
        <CoreBars
          label={coreName}
          cores={theirs.cores}
          hp={theirs.coreHp}
          max={theirs.coreMax}
          side={1}
        />
        <p class="stat-line" data-field="walls-foe">
          {wallsLine(walls, theirs.wallsStanding, theirs.wallsTotal)}
        </p>
      </Panel>
      <Panel title={t('battlePanelLog')} id="panel-log" class="grow">
        {shown.length === 0 ? (
          <p class="muted">{t('battleLogEmpty')}</p>
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
      <Panel title={t('battlePanelSpeed')} id="panel-speed">
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
            {t('battleSkip')}
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
            {t(pb.paused ? 'battlePlay' : 'battlePause')}
          </button>
        </div>
      </Panel>
      <Panel title={t('uiCameraPanel')} id="panel-camera">
        <div class="btn-row">
          <button
            type="button"
            onClick={() => {
              props.controller.preset('center');
            }}
          >
            {t('uiCameraCenter')}
          </button>
          <button
            type="button"
            onClick={() => {
              props.controller.preset('base');
            }}
          >
            {t('uiCameraMyBase')}
          </button>
          <button type="button" onClick={props.onEnemyBase}>
            {t('uiCameraTheirBase')}
          </button>
          <button
            type="button"
            onClick={() => {
              props.controller.preset('fit');
            }}
          >
            {t('uiCameraFitBattle')}
          </button>
        </div>
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------------
// Summary

/**
 * Why the battle ended, worded after the rules of the core battle's end
 * check: a destroyed Core ends it; Cores destroyed in the same tick are
 * decided by the smaller overkill, then by more damage dealt to the enemy's
 * buildings, then by more enemy units killed, then for the attacker (the
 * party); at the time limit more Cores standing, then the larger share of total
 * Core health left, wins and
 * a tie there goes down the same last three steps. The defender wins no tie.
 */
export function reasonText(
  reason: BattleReason,
  coreName: string,
  sides?: readonly [StepSide, StepSide],
): string {
  if (sides !== undefined) {
    const detailed = stepText(reason, coreName, sides);
    if (detailed !== null) return detailed;
  }
  return genericReasonText(reason, coreName);
}

/** The figures of a battle summary that name the ladder step. */
export type StepSide = Pick<
  BattleSideSummary,
  'coresStanding' | 'coreHealth' | 'coreMaxHealth'
>;

/**
 * Which step decided a time-limit or double-fall result, from what the
 * summary exposes. `reason` already names the rung from overkill on; only
 * `time_limit` (Cores standing, or share of Core health) and where a tie came
 * from need the final figures: no Core standing on either side is the double
 * fall, anything else the time limit. The ladder is not recomputed.
 */
export function stepText(
  reason: BattleReason,
  core: string,
  [own, foe]: readonly [StepSide, StepSide],
): string | null {
  const tx = (key: string, values: Record<string, string> = {}): string =>
    screenText(screenTexts, key, { core, ...values });
  if (reason === 'time_limit') {
    return own.coresStanding !== foe.coresStanding
      ? tx('battleTimeMoreCores', {
          own: String(own.coresStanding),
          foe: String(foe.coresStanding),
        })
      : tx('battleTimeLargerShare', {
          ownhealth: String(own.coreHealth),
          ownmax: String(own.coreMaxHealth),
          foehealth: String(foe.coreHealth),
          foemax: String(foe.coreMaxHealth),
        });
  }
  if (reason === 'core_destroyed') return null;
  const doubleFall = own.coresStanding === 0 && foe.coresStanding === 0;
  const form = doubleFall ? 'Double' : 'Time';
  switch (reason) {
    case 'tiebreak_overkill':
      return doubleFall ? null : tx('battleTieOverkillTime');
    case 'tiebreak_building_damage':
      return tx(`battleTieBuildingDamage${form}`);
    case 'tiebreak_kills':
      return tx(`battleTieKills${form}`);
    case 'tiebreak_attacker':
      return tx(`battleTieAttacker${form}`);
  }
}

export function genericReasonText(reason: BattleReason, core: string): string {
  const key = {
    core_destroyed: 'battleGenericCoreDestroyed',
    tiebreak_overkill: 'battleGenericOverkill',
    tiebreak_building_damage: 'battleGenericBuildingDamage',
    tiebreak_kills: 'battleGenericKills',
    tiebreak_attacker: 'battleGenericAttacker',
    time_limit: 'battleGenericTimeLimit',
  }[reason];
  return screenText(screenTexts, key, { core });
}

export interface SummaryProps {
  readonly pb: Playback;
  readonly content: WebContent;
  readonly opponent: OpponentInfo;
  readonly title: string;
  readonly moments: readonly Moment[];
  readonly rewardText: string;
  /** The stored outcome, when the run state has one. */
  readonly won?: boolean | undefined;
  readonly tps: number;
  readonly ready: boolean;
  readonly onWatchAgain: () => void;
  readonly onReady: () => void;
}

export function BattleSummaryView(props: SummaryProps) {
  const { pb, content, opponent, moments } = props;
  const rec = pb.record;
  const won = props.won ?? rec.result.winner === 0;
  const own = rec.summary.sides[0];
  const foe = rec.summary.sides[1];
  const rows = useMemo(() => buildingRows(rec, content, 0), [rec, content]);
  const destroyed = useMemo(() => destroyedOf(rec, 0), [rec]);
  const marked = moments.filter(
    (m) =>
      m.kind !== 'zone' && m.kind !== 'core_half' && m.kind !== 'core_quarter',
  );
  const markers: readonly ChartMarker[] = mergeMarkers(
    marked.map((m) => m.tick),
  );
  const chart = strengthSeries(rec.summary.timeline, Number.POSITIVE_INFINITY);
  const coreName = coreNameOf(content);
  const breaches = useMemo(
    () => breachEntries(rec, content, moments, 0, props.tps),
    [rec, content, moments, props.tps],
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
      for (const player of destroyed.cores) {
        const r = board.cores[player]?.rect;
        if (r === undefined) continue;
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
          <span data-field="result-word">
            {t(won ? 'battleVictory' : 'battleDefeat')}
          </span>
          {t('battleVsOpponent', { name: opponent.name })}
        </h2>
        <p class="result-reward" data-field="reward">
          {props.rewardText}
        </p>
        <p class="result-detail">
          {screenNodes(screenTexts, 'battleSummaryDetail', {
            reason: reasonText(rec.result.reason, coreName, [own, foe]),
            time: clock(rec.result.endTick, props.tps),
            core: coreName,
            own: (
              <strong data-field="final-core-own">
                {own.coreHealth} / {own.coreMaxHealth}
              </strong>
            ),
            foe: (
              <strong data-field="final-core-foe">
                {foe.coreHealth} / {foe.coreMaxHealth}
              </strong>
            ),
          })}
        </p>
        {own.cores.length + foe.cores.length > 2 ? (
          <p class="muted" data-field="cores-standing">
            {screenNodes(screenTexts, 'battleSummaryCoresStanding', {
              core: coreName,
              own: (
                <strong data-field="standing-own">
                  {own.coresStanding} / {own.cores.length}
                </strong>
              ),
              foe: (
                <strong data-field="standing-foe">
                  {foe.coresStanding} / {foe.cores.length}
                </strong>
              ),
              fell: [
                ...own.cores.map((c) => [t('battleSideYour'), c] as const),
                ...foe.cores.map((c) => [t('battleSideTheir'), c] as const),
              ]
                .filter(([, c]) => c.destroyedTick !== null)
                .map(([who, c]) =>
                  t('battleSummaryCoreFell', {
                    who,
                    core: coreName,
                    number: String(c.player + 1),
                    time: clock(c.destroyedTick ?? 0, props.tps),
                  }),
                )
                .join(' '),
            })}
          </p>
        ) : null}
        <p class="muted" data-field="tiebreak-counters">
          {t('battleSummaryTiebreak', {
            ownbuild: String(own.buildingDamageDealt),
            foebuild: String(foe.buildingDamageDealt),
            ownkills: String(own.unitsKilled),
            foekills: String(foe.unitsKilled),
          })}
        </p>
      </section>

      <Panel title={t('battlePanelSummaryChart')} id="panel-summary-chart">
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
        <ChartLegend labels={[t('battleColYou'), opponent.name]} />
        <ol class="marker-list">
          {marked.map((m, i) => (
            <li key={`${String(m.tick)}-${String(i)}`}>
              <span class="marker-n">{i + 1}</span>
              {clock(m.tick, props.tps)} {m.text}
            </li>
          ))}
        </ol>
      </Panel>

      <Panel title={t('battlePanelBreaches')} id="panel-breaches">
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
        {breaches.length === 0 ? (
          <p class="muted" data-field="no-breach">
            {t('battleNoBreach')}
          </p>
        ) : (
          <ul class="plain breach-list" data-field="breach-list">
            {breaches.map((b, i) => (
              <li key={`${String(b.tick)}-${String(i)}`}>{b.text}</li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={t('battlePanelBuildings')} id="panel-buildings">
        <table class="stat-table buildings-table" data-field="buildings">
          <thead>
            <tr>
              <th>{t('battleColBuilding')}</th>
              {cols.produced ? <th>{t('battleColProduced')}</th> : null}
              {cols.delivered ? <th>{t('battleColReceived')}</th> : null}
              {cols.trained ? <th>{t('battleColUnits')}</th> : null}
              {cols.damage ? <th>{t('battleColDamage')}</th> : null}
              {cols.upgrades ? <th>{t('battleColUpgrades')}</th> : null}
              <th>{t('battleColLost')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row">
                  {r.name}
                  {r.count > 1
                    ? t('battleCountSuffix', { count: String(r.count) })
                    : ''}
                  {r.note === null ? null : (
                    <span class="muted fine" data-field="idle-note">
                      {' '}
                      · {r.note}
                    </span>
                  )}
                </th>
                {cols.produced ? <td>{r.produced || '–'}</td> : null}
                {cols.delivered ? <td>{r.delivered || '–'}</td> : null}
                {cols.trained ? <td>{r.trained || '–'}</td> : null}
                {cols.damage ? <td>{r.damage || '–'}</td> : null}
                {cols.upgrades ? <td>{r.upgrades || '–'}</td> : null}
                <td>
                  {r.lost === 0
                    ? '–'
                    : r.firstLostTick === null
                      ? t('battleLostOf', {
                          lost: String(r.lost),
                          count: String(r.count),
                        })
                      : t('battleLostOfFirst', {
                          lost: String(r.lost),
                          count: String(r.count),
                          time: clock(r.firstLostTick, props.tps),
                        })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title={t('battlePanelNext')} id="panel-ready" class="ready-panel">
        <div class="btn-col">
          <button type="button" id="watch-again" onClick={props.onWatchAgain}>
            {t('battleWatchAgain')}
          </button>
          <button
            type="button"
            id="battle-ready"
            class="primary"
            disabled={props.ready}
            onClick={props.onReady}
          >
            {t(props.ready ? 'battleReadyDone' : 'battleReady')}
          </button>
        </div>
      </Panel>
    </div>
  );
}
