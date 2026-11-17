/**
 * Points of interest on the battle screen (CB-8c to CB-8g): what each point is
 * doing at the shown tick, and the words for it. Pure presentation: everything
 * is read off the visual simulation state, the up-front event log and the
 * summary; nothing here decides an outcome (TA-7).
 */

import {
  CELL_UNITS,
  pointStrengthBonus,
  type ArenaEvent,
  type ArenaSim,
  type BattleSummary,
  type NeutralZone,
  type PointBuffEffect,
} from '@game/core';
import { screenText, screenTexts } from '../build/texts.js';
import type { WebContent } from '../content.js';
import { count } from '../plural.js';

const t = (key: string, values: Record<string, string> = {}): string =>
  screenText(screenTexts, key, values);

export type PointStatus =
  'guarded' | 'contested' | 'capturing' | 'held' | 'open';

/** One point of interest at one moment of the battle. */
export interface PointNow {
  readonly id: number;
  /** The id counted from 1, for the player. */
  readonly number: number;
  /** View-space centre of the point, in cells (arena x, arena y). */
  readonly x: number;
  readonly y: number;
  readonly buff: PointBuffEffect | null;
  /** The side that holds it: 0, 1, or -1 for nobody. */
  readonly controller: number;
  /** The side whose capture progress is shown, or -1. */
  readonly progressSide: number;
  /** Capture progress of `progressSide`, 0 to 1. */
  readonly progress: number;
  /** Neutral guards still alive at the point. */
  readonly guards: number;
  /** Units of both sides are within the capture radius and no guard lives. */
  readonly contested: boolean;
  readonly status: PointStatus;
  /** The capture radius, in cells. */
  readonly captureRadius: number;
}

/** The part of the arena state the point views read. */
export type PointsSource = Pick<ArenaSim, 'units'> &
  Partial<Pick<ArenaSim, 'points' | 'guards'>>;

/**
 * Every point of the battle at the state's tick, in `id` order; empty when the
 * zone has none (an older record, or a battle without points).
 */
export function pointsNow(sim: PointsSource): readonly PointNow[] {
  const points = sim.points;
  const guards = sim.guards;
  if (points === undefined || guards === undefined || points.length === 0) {
    return [];
  }
  const rules = guards.capture;
  const r2 = (rules.captureRadiusCells * CELL_UNITS) ** 2;
  const out: PointNow[] = [];
  for (let k = 0; k < points.length; k++) {
    const p = points[k];
    const post = guards.posts[k];
    if (p === undefined || post === undefined) continue;
    const cx = post.x * CELL_UNITS + CELL_UNITS / 2;
    const cy = post.y * CELL_UNITS + CELL_UNITS / 2;
    let alive = 0;
    let near0 = 0;
    let near1 = 0;
    for (const u of sim.units) {
      if (u.side === 2) {
        if (u.post === p.id) alive += 1;
        continue;
      }
      const dx = cx - u.px;
      const dy = cy - u.py;
      if (dx * dx + dy * dy > r2) continue;
      if (u.side === 0) near0 += 1;
      else near1 += 1;
    }
    const contested = alive === 0 && near0 > 0 && near1 > 0;
    const progress =
      p.progressSide >= 0
        ? Math.min(1, p.progress / Math.max(1, rules.captureTicks))
        : 0;
    const status: PointStatus =
      alive > 0
        ? 'guarded'
        : contested
          ? 'contested'
          : p.progressSide >= 0 && p.progress > 0
            ? 'capturing'
            : p.controller >= 0
              ? 'held'
              : 'open';
    out.push({
      id: p.id,
      number: p.id + 1,
      x: post.x + 0.5,
      y: post.y + 0.5,
      buff: p.buff ?? null,
      controller: p.controller,
      progressSide: p.progressSide,
      progress,
      guards: alive,
      contested,
      status,
      captureRadius: rules.captureRadiusCells,
    });
  }
  return out;
}

/** The name of a buff kind: "Strength point", "Healing point". */
export function buffName(buff: PointBuffEffect | null): string {
  return t(buff?.kind === 'heal' ? 'pointNameHeal' : 'pointNameStrength');
}

/** Seconds as a short number: "0.5", "1", "2.5". */
function seconds(ticks: number, tps: number): string {
  return String(Math.round((ticks / tps) * 10) / 10);
}

/** What a point gives its holder, in plain words. */
export function buffText(buff: PointBuffEffect | null, tps: number): string {
  if (buff === null) return '';
  if (buff.kind === 'heal') {
    return t('pointBuffHeal', {
      radius: String(buff.healRadiusCells),
      amount: String(buff.healAmount),
      seconds: seconds(buff.healIntervalTicks, tps),
    });
  }
  return t('pointBuffStrength', { percent: String(buff.strengthPercent) });
}

/** The short effect of a buff, for the capture notice. */
export function effectText(buff: PointBuffEffect | null): string {
  return t(buff?.kind === 'heal' ? 'pointEffectHeal' : 'pointEffectStrength');
}

/** What the point is doing now, from the viewer's side (side 0 is "you"). */
export function statusText(p: PointNow): string {
  switch (p.status) {
    case 'guarded':
      return t('pointStatusGuarded', {
        guards: count(p.guards, 'guard'),
      });
    case 'contested':
      return t('pointStatusContested');
    case 'capturing':
      return t(
        p.progressSide === 0
          ? 'pointStatusCapturingYou'
          : 'pointStatusCapturingThem',
        { percent: String(Math.floor(p.progress * 100)) },
      );
    case 'held':
      return t(
        p.controller === 0 ? 'pointStatusHeldYou' : 'pointStatusHeldThem',
      );
    case 'open':
      return t('pointStatusOpen');
  }
}

/** One line of the points list: "Point 2, Healing point: held by you". */
export function pointRow(p: PointNow): string {
  return t('battlePointRow', {
    number: String(p.number),
    name: buffName(p.buff),
    status: statusText(p),
  });
}

/**
 * The bonuses a side has now: the summed strength of its held strength points
 * (capped as the rules cap it) and a line per held healing point. Empty when
 * it has none.
 */
export function bonusLines(
  sim: ArenaSim,
  side: 0 | 1,
  tps: number,
): readonly string[] {
  const lines: string[] = [];
  const strength = pointStrengthBonus(sim, side);
  if (strength > 0) {
    lines.push(t('battleBonusStrength', { percent: String(strength) }));
  }
  for (const p of pointsNow(sim)) {
    if (p.controller !== side || p.buff?.kind !== 'heal') continue;
    lines.push(
      t('battleBonusHeal', {
        number: String(p.number),
        radius: String(p.buff.healRadiusCells),
        amount: String(p.buff.healAmount),
        seconds: seconds(p.buff.healIntervalTicks, tps),
      }),
    );
  }
  return lines;
}

/** The buff numbers of point `id` of a zone, from the content; null if unknown. */
export function zoneBuff(
  content: WebContent,
  zone: NeutralZone,
  id: number,
): PointBuffEffect | null {
  const buffId = zone.pointsOfInterest.find((p) => p.id === id)?.buff;
  const buff =
    buffId === undefined ? undefined : content.points.buff.get(buffId);
  return buff ?? null;
}

/** The notice of a capture event: "Your side took point 2: stronger new units". */
export function captureNotice(
  e: Extract<ArenaEvent, { type: 'point_captured' }>,
  buff: PointBuffEffect | null,
): string {
  return t(e.side === 0 ? 'battleLogPointYou' : 'battleLogPointThem', {
    number: String(e.point + 1),
    effect: effectText(buff),
  });
}

/** One point in the summary, ready to show. */
export interface PointSummaryRow {
  readonly number: number;
  readonly name: string;
  /** What the buff does, in words. */
  readonly buff: string;
  readonly line: string;
}

/** The summary's lines for each point: holder at the end and how long each side held it. */
export function summaryRows(
  summary: BattleSummary,
  content: WebContent,
  zone: NeutralZone,
  tps: number,
  clock: (ticks: number, tps: number) => string,
): readonly PointSummaryRow[] {
  return (summary.points ?? []).map((p) => {
    const buff = zoneBuff(content, zone, p.id);
    const name = buffName(buff);
    const holder = t(
      p.controller === 0
        ? 'battleSumPointHolderYou'
        : p.controller === 1
          ? 'battleSumPointHolderThem'
          : 'battleSumPointHolderNone',
    );
    return {
      number: p.id + 1,
      name,
      buff: buffText(buff, tps),
      line: t('battleSumPointRow', {
        number: String(p.id + 1),
        name,
        holder,
        own: clock(p.pointHeldTicks[0], tps),
        foe: clock(p.pointHeldTicks[1], tps),
      }),
    };
  });
}

/** Guards killed and health healed per side, as two summary lines. */
export function guardAndHealLines(summary: BattleSummary): readonly string[] {
  const [a, b] = summary.sides;
  return [
    t('battleSumGuards', {
      own: String(a.guardsKilled),
      foe: String(b.guardsKilled),
    }),
    t('battleSumHealed', {
      own: String(a.healedHp),
      foe: String(b.healedHp),
    }),
  ];
}
