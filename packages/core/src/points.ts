/**
 * Points of interest of the neutral zone (CB-8c, CB-8d): loaded from
 * content/points.json. See docs/rules-reference.md, "The neutral zone".
 */

import {
  isRecord,
  readId,
  readInt,
  rejectUnknownKeys,
  show,
  unwrapOrThrow,
  type LoadResult,
} from './load-util.js';

/** What a held point gives (CB-8g). The numbers of each kind come later. */
export const POINT_BUFF_KINDS = ['unit_strength', 'heal'] as const;
export type PointBuffKind = (typeof POINT_BUFF_KINDS)[number];

export interface PointBuff {
  readonly id: string;
  readonly kind: PointBuffKind;
  readonly weight: number;
}

export interface PointsConfig {
  /** Chance in percent that a plot band gets a point. */
  readonly chancePercent: number;
  /** Cells kept free at each edge of a band when placing a point. */
  readonly bandMarginCells: number;
  /** The buffs a point can have, in file order (the order of the pick). */
  readonly buffs: readonly PointBuff[];
  readonly buff: ReadonlyMap<string, PointBuff>;
}

export interface PointsLoadContext {
  /** When given, `bandMarginCells` must leave a column in the band. */
  readonly plotWidth?: number;
}

export type PointsLoadResult = LoadResult<PointsConfig>;

/** Most buffs the file may list. */
export const MAX_POINT_BUFFS = 16;

const TOP_KEYS = new Set([
  '$schema',
  'chancePercent',
  'bandMarginCells',
  'buffs',
]);
const BUFF_KEYS = new Set(['id', 'kind', 'weight']);
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
      rejectUnknownKeys(entry, BUFF_KEYS, at, errors);
      const id = readId(entry, BUFF_ID, at, errors);
      const kind = entry['kind'];
      const kindOk = POINT_BUFF_KINDS.includes(kind as PointBuffKind);
      if (!kindOk) {
        errors.push(
          `${at}: "kind" must be one of ${POINT_BUFF_KINDS.join(', ')} (got ${show(kind)}).`,
        );
      }
      const weight = readInt(entry, 'weight', 1, at, errors, 1000);
      if (id !== undefined) {
        if (seen.has(id)) errors.push(`${at}: duplicate buff id "${id}".`);
        seen.add(id);
      }
      if (id !== undefined && kindOk && weight !== undefined) {
        buffs.push({ id, kind: kind as PointBuffKind, weight });
      }
    });
  }
  if (
    errors.length > 0 ||
    chancePercent === undefined ||
    bandMarginCells === undefined
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
