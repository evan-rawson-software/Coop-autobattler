/**
 * Points of interest of the neutral zone (CB-8c, CB-8d): loaded from
 * content/points.json. See docs/rules-reference.md, "The neutral zone".
 */

import type { UnitConfig, UnitId } from './units.js';
import { addInt, divCeil, mulInt } from './int.js';
import {
  isRecord,
  readId,
  readInt,
  rejectUnknownKeys,
  show,
  unwrapOrThrow,
  type LoadResult,
} from './load-util.js';

/** What a held point gives (CB-8g). */
export const POINT_BUFF_KINDS = ['unit_strength', 'heal'] as const;
export type PointBuffKind = (typeof POINT_BUFF_KINDS)[number];

/** The numbers of a `unit_strength` point (CB-8g): new units are stronger. */
export interface UnitStrengthBuffNumbers {
  readonly kind: 'unit_strength';
  /** Percent of health and damage each held point of this kind adds. */
  readonly strengthPercent: number;
}

/** The numbers of a `heal` point (CB-8g): the holder's units near it heal. */
export interface HealBuffNumbers {
  readonly kind: 'heal';
  /** On ticks where `T mod healIntervalTicks = 0` the units are healed. */
  readonly healIntervalTicks: number;
  /** Units whose centre is within this many cells of the point are healed. */
  readonly healRadiusCells: number;
  /** Health regained per beat. */
  readonly healAmount: number;
}

/** What a buff does, by kind; the numbers copied into the arena state. */
export type PointBuffEffect = UnitStrengthBuffNumbers | HealBuffNumbers;

export type PointBuff = PointBuffEffect & {
  readonly id: string;
  readonly weight: number;
};

/** One kind of guard a point can have, with what it costs (CB-8e). */
export interface GuardUnit {
  readonly unit: UnitId;
  /** Budget the unit costs. */
  readonly cost: number;
  /** Weight of the draw. */
  readonly weight: number;
}

/**
 * The guards of a point (CB-8e): a budget that grows like the threat budget
 * (SC-1) buys units from a weighted list; what is left over becomes a
 * strength percent.
 */
export interface GuardsConfig {
  /** The budget of one point in round 1. */
  readonly baseBudget: number;
  /** Percent of the budget kept each round (125 = grows 25%). */
  readonly growthPercent: number;
  readonly maxGuardsPerPoint: number;
  /** A guard farther than this many cells from its post walks back. */
  readonly leashCells: number;
  /** The units a guard can be, in file order (the order of the draw). */
  readonly units: readonly GuardUnit[];
}

/**
 * The capture progress a side needs to take a point when its points of
 * interest capture `speedPercent` percent faster (issue #426):
 * `max(1, ceil(captureTicks * 100 / (100 + speedPercent)))`, integer math.
 * With 0 it is `captureTicks`; the progress added per tick is unchanged.
 */
export function captureTicksFor(
  captureTicks: number,
  speedPercent: number,
): number {
  return Math.max(
    1,
    divCeil(mulInt(captureTicks, 100), addInt(100, speedPercent)),
  );
}

/**
 * How units divert to a point and capture it (CB-8f). All in cells or ticks.
 */
export interface CaptureConfig {
  /** Progress that takes a point. */
  readonly captureTicks: number;
  /** Most units counted per tick in the capture range. */
  readonly maxCapturersCounted: number;
  /** Units this close to the point's centre capture; a diverted unit waits. */
  readonly captureRadiusCells: number;
  /** A unit this close to the point's centre (and seeing it) diverts to it. */
  readonly pointAggroRangeCells: number;
}

/** The numbers of a buff without its `id` and `weight` (what the arena state keeps). */
export function buffEffectOf(buff: PointBuff): PointBuffEffect {
  return buff.kind === 'unit_strength'
    ? { kind: 'unit_strength', strengthPercent: buff.strengthPercent }
    : {
        kind: 'heal',
        healIntervalTicks: buff.healIntervalTicks,
        healRadiusCells: buff.healRadiusCells,
        healAmount: buff.healAmount,
      };
}

export interface PointsConfig {
  /** Chance in percent that a plot band gets a point. */
  readonly chancePercent: number;
  /** Cells kept free at each edge of a band when placing a point. */
  readonly bandMarginCells: number;
  /** The buffs a point can have, in file order (the order of the pick). */
  readonly buffs: readonly PointBuff[];
  readonly buff: ReadonlyMap<string, PointBuff>;
  /**
   * The most a side's held `unit_strength` points add together (CB-8g). It is
   * outside the Armory cap `maxUnitStrengthPercent`.
   */
  readonly maxPointStrengthPercent: number;
  readonly guards: GuardsConfig;
  readonly capture: CaptureConfig;
}

export interface PointsLoadContext {
  /** When given, `bandMarginCells` must leave a column in the band. */
  readonly plotWidth?: number;
  /** When given, every guard unit must exist and must not fly. */
  readonly units?: UnitConfig;
}

export type PointsLoadResult = LoadResult<PointsConfig>;

/** Most buffs the file may list. */
export const MAX_POINT_BUFFS = 16;

const TOP_KEYS = new Set([
  '$schema',
  'chancePercent',
  'bandMarginCells',
  'buffs',
  'maxPointStrengthPercent',
  'capture',
  'guards',
]);
const CAPTURE_KEYS = new Set([
  'captureTicks',
  'maxCapturersCounted',
  'captureRadiusCells',
  'pointAggroRangeCells',
]);
const GUARD_KEYS = new Set([
  'baseBudget',
  'growthPercent',
  'maxGuardsPerPoint',
  'leashCells',
  'units',
]);
const GUARD_UNIT_KEYS = new Set(['unit', 'cost', 'weight']);

/** Largest `guards.baseBudget`, `cost` and `leashCells`; bounds the budget math. */
export const MAX_GUARD_BASE_BUDGET = 1_000_000;
export const MAX_GUARD_COST = 1_000_000;
export const MAX_GUARDS_PER_POINT = 9;
export const MAX_GUARD_LEASH_CELLS = 8;
export const MAX_GUARD_UNITS = 16;
/** Bounds of the buff numbers (CB-8g). */
export const MAX_POINT_STRENGTH_PERCENT = 100_000;
export const MAX_BUFF_STRENGTH_PERCENT = 10_000;
export const MAX_HEAL_INTERVAL_TICKS = 1_000_000;
export const MAX_HEAL_RADIUS_CELLS = 8;
export const MAX_HEAL_AMOUNT = 1_000_000;
/** Largest `capture.captureTicks`, `maxCapturersCounted` and range in cells. */
export const MAX_CAPTURE_TICKS = 1_000_000;
export const MAX_CAPTURERS_COUNTED = 1000;
export const MAX_CAPTURE_CELLS = 8;
/** The smallest and largest `guards.growthPercent`. */
export const MIN_GUARD_GROWTH_PERCENT = 100;
export const MAX_GUARD_GROWTH_PERCENT = 1000;

function loadGuards(
  data: unknown,
  context: PointsLoadContext,
  errors: string[],
): GuardsConfig | undefined {
  if (!isRecord(data)) {
    errors.push('points: "guards" must be an object.');
    return undefined;
  }
  const before = errors.length;
  rejectUnknownKeys(data, GUARD_KEYS, 'guards', errors);
  const baseBudget = readInt(
    data,
    'baseBudget',
    1,
    'guards',
    errors,
    MAX_GUARD_BASE_BUDGET,
  );
  const growthPercent = readInt(
    data,
    'growthPercent',
    MIN_GUARD_GROWTH_PERCENT,
    'guards',
    errors,
    MAX_GUARD_GROWTH_PERCENT,
  );
  const maxGuardsPerPoint = readInt(
    data,
    'maxGuardsPerPoint',
    1,
    'guards',
    errors,
    MAX_GUARDS_PER_POINT,
  );
  const leashCells = readInt(
    data,
    'leashCells',
    1,
    'guards',
    errors,
    MAX_GUARD_LEASH_CELLS,
  );
  const units: GuardUnit[] = [];
  const raw = data['units'];
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_GUARD_UNITS) {
    errors.push(
      `guards: "units" must be a list of 1 to ${String(MAX_GUARD_UNITS)} units.`,
    );
  } else {
    const seen = new Set<string>();
    raw.forEach((entry: unknown, i) => {
      const at = `guards.units[${String(i)}]`;
      if (!isRecord(entry)) {
        errors.push(`${at}: must be an object.`);
        return;
      }
      rejectUnknownKeys(entry, GUARD_UNIT_KEYS, at, errors);
      const unit = entry['unit'];
      let unitOk = typeof unit === 'string' && unit !== '';
      if (!unitOk) errors.push(`${at}: "unit" must be a unit ID.`);
      if (unitOk && context.units !== undefined) {
        const def = context.units.get(unit as string);
        if (def === undefined) {
          errors.push(`${at}: unknown unit "${unit as string}".`);
          unitOk = false;
        } else if (def.flying) {
          errors.push(`${at}: guards do not fly ("${unit as string}").`);
          unitOk = false;
        }
      }
      const cost = readInt(entry, 'cost', 1, at, errors, MAX_GUARD_COST);
      const weight = readInt(entry, 'weight', 1, at, errors, 1000);
      if (unitOk) {
        if (seen.has(unit as string)) {
          errors.push(`${at}: duplicate unit "${unit as string}".`);
        }
        seen.add(unit as string);
      }
      if (unitOk && cost !== undefined && weight !== undefined) {
        units.push({ unit: unit as UnitId, cost, weight });
      }
    });
  }
  if (
    errors.length > before ||
    baseBudget === undefined ||
    growthPercent === undefined ||
    maxGuardsPerPoint === undefined ||
    leashCells === undefined
  ) {
    return undefined;
  }
  return { baseBudget, growthPercent, maxGuardsPerPoint, leashCells, units };
}

function loadCapture(
  data: unknown,
  errors: string[],
): CaptureConfig | undefined {
  if (!isRecord(data)) {
    errors.push('points: "capture" must be an object.');
    return undefined;
  }
  const before = errors.length;
  rejectUnknownKeys(data, CAPTURE_KEYS, 'capture', errors);
  const captureTicks = readInt(
    data,
    'captureTicks',
    1,
    'capture',
    errors,
    MAX_CAPTURE_TICKS,
  );
  const maxCapturersCounted = readInt(
    data,
    'maxCapturersCounted',
    1,
    'capture',
    errors,
    MAX_CAPTURERS_COUNTED,
  );
  const captureRadiusCells = readInt(
    data,
    'captureRadiusCells',
    1,
    'capture',
    errors,
    MAX_CAPTURE_CELLS,
  );
  const pointAggroRangeCells = readInt(
    data,
    'pointAggroRangeCells',
    1,
    'capture',
    errors,
    MAX_CAPTURE_CELLS,
  );
  if (
    errors.length > before ||
    captureTicks === undefined ||
    maxCapturersCounted === undefined ||
    captureRadiusCells === undefined ||
    pointAggroRangeCells === undefined
  ) {
    return undefined;
  }
  return {
    captureTicks,
    maxCapturersCounted,
    captureRadiusCells,
    pointAggroRangeCells,
  };
}

const BUFF_KEYS: Record<PointBuffKind, ReadonlySet<string>> = {
  unit_strength: new Set(['id', 'kind', 'weight', 'strengthPercent']),
  heal: new Set([
    'id',
    'kind',
    'weight',
    'healIntervalTicks',
    'healRadiusCells',
    'healAmount',
  ]),
};
const BUFF_KEYS_ANY = new Set([
  'id',
  'kind',
  'weight',
  'strengthPercent',
  'healIntervalTicks',
  'healRadiusCells',
  'healAmount',
]);
const BUFF_ID = /^poi_[a-z0-9_]+$/;

/** Validate parsed points data (the contents of points.json). */
export function loadPoints(
  data: unknown,
  context: PointsLoadContext = {},
): PointsLoadResult {
  if (!isRecord(data)) {
    return { ok: false, errors: ['Points file must be an object.'] };
  }
  const errors: string[] = [];
  rejectUnknownKeys(data, TOP_KEYS, 'points', errors);
  const chancePercent = readInt(
    data,
    'chancePercent',
    0,
    'points',
    errors,
    100,
  );
  const bandMarginCells = readInt(data, 'bandMarginCells', 0, 'points', errors);
  if (
    bandMarginCells !== undefined &&
    context.plotWidth !== undefined &&
    2 * bandMarginCells >= context.plotWidth
  ) {
    errors.push(
      'points: "bandMarginCells" leaves no column in a band (twice it must be below "plotWidth").',
    );
  }
  const buffs: PointBuff[] = [];
  const raw = data['buffs'];
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_POINT_BUFFS) {
    errors.push(
      `points: "buffs" must be a list of 1 to ${String(MAX_POINT_BUFFS)} buffs.`,
    );
  } else {
    const seen = new Set<string>();
    raw.forEach((entry: unknown, i) => {
      const at = `buffs[${String(i)}]`;
      if (!isRecord(entry)) {
        errors.push(`${at}: must be an object.`);
        return;
      }
      const id = readId(entry, BUFF_ID, at, errors);
      const kind = entry['kind'];
      const kindOk = POINT_BUFF_KINDS.includes(kind as PointBuffKind);
      if (!kindOk) {
        errors.push(
          `${at}: "kind" must be one of ${POINT_BUFF_KINDS.join(', ')} (got ${show(kind)}).`,
        );
      }
      rejectUnknownKeys(
        entry,
        kindOk ? BUFF_KEYS[kind as PointBuffKind] : BUFF_KEYS_ANY,
        at,
        errors,
      );
      const weight = readInt(entry, 'weight', 1, at, errors, 1000);
      if (id !== undefined) {
        if (seen.has(id)) errors.push(`${at}: duplicate buff id "${id}".`);
        seen.add(id);
      }
      let effect: PointBuffEffect | undefined;
      if (kind === 'unit_strength') {
        const strengthPercent = readInt(
          entry,
          'strengthPercent',
          1,
          at,
          errors,
          MAX_BUFF_STRENGTH_PERCENT,
        );
        if (strengthPercent !== undefined) {
          effect = { kind, strengthPercent };
        }
      } else if (kind === 'heal') {
        const healIntervalTicks = readInt(
          entry,
          'healIntervalTicks',
          1,
          at,
          errors,
          MAX_HEAL_INTERVAL_TICKS,
        );
        const healRadiusCells = readInt(
          entry,
          'healRadiusCells',
          1,
          at,
          errors,
          MAX_HEAL_RADIUS_CELLS,
        );
        const healAmount = readInt(
          entry,
          'healAmount',
          1,
          at,
          errors,
          MAX_HEAL_AMOUNT,
        );
        if (
          healIntervalTicks !== undefined &&
          healRadiusCells !== undefined &&
          healAmount !== undefined
        ) {
          effect = { kind, healIntervalTicks, healRadiusCells, healAmount };
        }
      }
      if (id !== undefined && effect !== undefined && weight !== undefined) {
        buffs.push({ ...effect, id, weight });
      }
    });
  }
  const maxPointStrengthPercent = readInt(
    data,
    'maxPointStrengthPercent',
    0,
    'points',
    errors,
    MAX_POINT_STRENGTH_PERCENT,
  );
  const guards = loadGuards(data['guards'], context, errors);
  const capture = loadCapture(data['capture'], errors);
  if (
    errors.length > 0 ||
    chancePercent === undefined ||
    bandMarginCells === undefined ||
    maxPointStrengthPercent === undefined ||
    guards === undefined ||
    capture === undefined
  ) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    config: {
      chancePercent,
      bandMarginCells,
      buffs,
      buff: new Map(buffs.map((b) => [b.id, b])),
      maxPointStrengthPercent,
      guards,
      capture,
    },
  };
}

/** Like loadPoints, but throws one Error listing every problem. */
export function loadPointsOrThrow(
  data: unknown,
  context: PointsLoadContext = {},
): PointsConfig {
  return unwrapOrThrow('points', loadPoints(data, context));
}
