/**
 * PvE threat configuration and the budget curve (W1-9, SC-1 to SC-7): loaded
 * from content/threats.json. See docs/rules-reference.md, "PvE threats".
 */

import type { BuildingConfig } from './buildings.js';
import { sortedKeys } from './hash.js';
import { mulDiv } from './int.js';
import {
  isRecord,
  readInt,
  rejectUnknownKeys,
  unwrapOrThrow,
  type LoadResult,
} from './load-util.js';
import type { UnitConfig, UnitId } from './units.js';

export type ThreatType = 'easy' | 'medium' | 'hard' | 'boss';
export const THREAT_TYPES: readonly ThreatType[] = [
  'easy',
  'medium',
  'hard',
  'boss',
];
export type LayoutId = 'ring' | 'line' | 'open';
export type ArchetypeId = string;

export interface UnitCost {
  readonly unit: UnitId;
  readonly cost: number;
}

export interface WaveComposition {
  readonly unit: UnitId;
  readonly weight: number;
}

export interface WaveTemplate {
  readonly firstTick: number;
  readonly intervalTicks: number;
  readonly count: number;
  readonly growthPercent: number;
  readonly composition: readonly WaveComposition[];
  /** Every Nth wave (from 1) is made only of `unit`. */
  readonly signature?: { readonly everyNthWave: number; readonly unit: UnitId };
}

export interface StrongholdTemplate {
  readonly coreHealthPerBudget: number;
  readonly wallSharePercent: number;
  readonly turretSharePercent: number;
  readonly layout: LayoutId;
}

export interface ArchetypeDef {
  readonly id: ArchetypeId;
  readonly bossOnly: boolean;
  readonly waveSharePercent: number;
  readonly waves: WaveTemplate;
  readonly stronghold: StrongholdTemplate;
}

export interface RingLayoutConfig {
  readonly coreRow: number;
  readonly firstRingDistance: number;
  readonly ringSpacing: number;
  readonly gapWidth: number;
  readonly turretMinDistance: number;
}
export interface LineLayoutConfig {
  readonly coreRow: number;
  readonly lineRow: number;
  readonly maxRows: number;
  readonly gapWidth: number;
  readonly gapMargin: number;
  readonly turretMinDistance: number;
}
export interface OpenLayoutConfig {
  readonly coreRow: number;
  readonly turretMinDistance: number;
}

export interface ThreatsConfig {
  readonly baseBudget: number;
  readonly growthPercent: number;
  readonly typeMultiplierPercent: Readonly<Record<ThreatType, number>>;
  readonly maxPartySize: number;
  readonly maxUnitsPerWavePerPlot: number;
  readonly maxWallsPerPlot: number;
  readonly maxTurretsPerPlot: number;
  readonly minCoreHealth: number;
  readonly compositionJitterPercent: number;
  readonly unitCost: readonly UnitCost[];
  readonly layouts: {
    readonly ring: RingLayoutConfig;
    readonly line: LineLayoutConfig;
    readonly open: OpenLayoutConfig;
  };
  readonly archetypes: readonly ArchetypeDef[];
}

export type ThreatsLoadResult = LoadResult<ThreatsConfig>;

export interface ThreatsLoadContext {
  readonly units: UnitConfig;
  readonly buildings: BuildingConfig;
}

/** Headroom for percent arithmetic on budgets (see `budgetLimit`). */
const HEADROOM = 1000;

/**
 * The largest growth-only value V that a round may reach: `floor((2^53 - 1) /
 * (1000 * maxTypePercent * maxPartySize))`. The factor 1000 is headroom so
 * that any later percent multiplication of a budget (up to 1000 percent) stays
 * inside the safe integer range.
 */
export function budgetLimit(config: ThreatsConfig): number {
  const maxType = Math.max(
    ...THREAT_TYPES.map((t) => config.typeMultiplierPercent[t]),
  );
  return Math.floor(
    Number.MAX_SAFE_INTEGER / (HEADROOM * maxType * config.maxPartySize),
  );
}

/**
 * The largest round with its own budget: the last round `r` whose growth-only
 * value `V_r` (see `threatBudget`) is at most `budgetLimit`. Later rounds are
 * clamped to it, so the budget stops growing there (a round that high is far
 * beyond any run that can be survived).
 */
export function maxThreatRound(config: ThreatsConfig): number {
  const limit = budgetLimit(config);
  let v = config.baseBudget;
  let round = 1;
  for (;;) {
    const next = mulDiv(v, config.growthPercent, 100);
    if (next > limit) return round;
    v = next;
    round += 1;
  }
}

/**
 * SC-1: `budget(round, type, partySize) = B0 * g^(round - 1) * m(type) *
 * partySize`, in integers, in exactly this order:
 *
 * 1. `v = baseBudget`; repeat `min(round, maxThreatRound) - 1` times:
 *    `v = floor(v * growthPercent / 100)`.
 * 2. `v = floor(v * typeMultiplierPercent[type] / 100)`.
 * 3. `budget = v * partySize`.
 */
export function threatBudget(
  config: ThreatsConfig,
  round: number,
  type: ThreatType,
  partySize: number,
): number {
  if (!Number.isInteger(round) || round < 1) {
    throw new RangeError(`threatBudget: round must be an integer >= 1.`);
  }
  if (
    !Number.isInteger(partySize) ||
    partySize < 1 ||
    partySize > config.maxPartySize
  ) {
    throw new RangeError(
      `threatBudget: party size must be an integer from 1 to ${String(config.maxPartySize)}.`,
    );
  }
  const steps = Math.min(round, maxThreatRound(config)) - 1;
  let v = config.baseBudget;
  for (let i = 0; i < steps; i++) v = mulDiv(v, config.growthPercent, 100);
  v = mulDiv(v, config.typeMultiplierPercent[type], 100);
  return v * partySize;
}

export function findArchetype(
  config: ThreatsConfig,
  id: ArchetypeId,
): ArchetypeDef | undefined {
  return config.archetypes.find((a) => a.id === id);
}

// ---------------------------------------------------------------------------
// Loader

const KEYS = new Set([
  '$schema',
  'baseBudget',
  'growthPercent',
  'typeMultiplierPercent',
  'maxPartySize',
  'maxUnitsPerWavePerPlot',
  'maxWallsPerPlot',
  'maxTurretsPerPlot',
  'minCoreHealth',
  'compositionJitterPercent',
  'unitCost',
  'layouts',
  'archetypes',
]);
const ARCH_ID = /^arch_[a-z0-9_]+$/;
const LAYOUTS: readonly string[] = ['ring', 'line', 'open'];

function complete(o: Record<string, unknown>): boolean {
  return sortedKeys(o).every((k) => o[k] !== undefined);
}

function readRecord(
  parent: Record<string, unknown>,
  key: string,
  at: string,
  errors: string[],
): Record<string, unknown> | undefined {
  const v = parent[key];
  if (!isRecord(v)) {
    errors.push(`${at}: "${key}" must be an object.`);
    return undefined;
  }
  return v;
}

function readArray(
  parent: Record<string, unknown>,
  key: string,
  at: string,
  errors: string[],
): unknown[] {
  const v = parent[key];
  if (!Array.isArray(v)) {
    errors.push(`${at}: "${key}" must be a list.`);
    return [];
  }
  return v as unknown[];
}

function readUnit(
  record: Record<string, unknown>,
  at: string,
  context: ThreatsLoadContext,
  errors: string[],
): UnitId | undefined {
  const unit = record['unit'];
  if (typeof unit !== 'string' || context.units.get(unit) === undefined) {
    errors.push(`${at}: unknown unit ${JSON.stringify(unit)}.`);
    return undefined;
  }
  return unit;
}

/** Validate parsed threat data (the contents of threats.json). */
export function loadThreats(
  data: unknown,
  context: ThreatsLoadContext,
): ThreatsLoadResult {
  if (!isRecord(data)) {
    return { ok: false, errors: ['Threats file must be an object.'] };
  }
  const errors: string[] = [];
  rejectUnknownKeys(data, KEYS, 'threats', errors);
  const baseBudget = readInt(data, 'baseBudget', 1, 'threats', errors);
  const growthPercent = readInt(data, 'growthPercent', 101, 'threats', errors);
  if (growthPercent !== undefined && growthPercent > 1000) {
    errors.push('threats: "growthPercent" must be at most 1000.');
  }
  const maxPartySize = readInt(data, 'maxPartySize', 1, 'threats', errors);
  const maxUnitsPerWavePerPlot = readInt(
    data,
    'maxUnitsPerWavePerPlot',
    1,
    'threats',
    errors,
  );
  const maxWallsPerPlot = readInt(
    data,
    'maxWallsPerPlot',
    0,
    'threats',
    errors,
  );
  const maxTurretsPerPlot = readInt(
    data,
    'maxTurretsPerPlot',
    0,
    'threats',
    errors,
  );
  const minCoreHealth = readInt(data, 'minCoreHealth', 1, 'threats', errors);
  const compositionJitterPercent = readInt(
    data,
    'compositionJitterPercent',
    0,
    'threats',
    errors,
  );
  if (compositionJitterPercent !== undefined && compositionJitterPercent > 99) {
    errors.push('threats: "compositionJitterPercent" must be at most 99.');
  }

  let multipliers: Record<ThreatType, number> | undefined;
  const mult = readRecord(data, 'typeMultiplierPercent', 'threats', errors);
  if (mult !== undefined) {
    rejectUnknownKeys(
      mult,
      new Set(THREAT_TYPES),
      'threats.typeMultiplierPercent',
      errors,
    );
    const m: Partial<Record<ThreatType, number>> = {};
    for (const t of THREAT_TYPES) {
      const v = readInt(mult, t, 1, 'threats.typeMultiplierPercent', errors);
      if (v !== undefined) m[t] = v;
    }
    if (THREAT_TYPES.every((t) => m[t] !== undefined)) {
      const full = m as Record<ThreatType, number>;
      multipliers = full;
      if (!(full.easy < full.medium && full.medium < full.hard)) {
        errors.push(
          'threats.typeMultiplierPercent: must increase strictly from easy to medium to hard.',
        );
      }
    }
  }

  const unitCost: UnitCost[] = [];
  readArray(data, 'unitCost', 'threats', errors).forEach((e, i) => {
    const at = `unitCost[${String(i)}]`;
    if (!isRecord(e)) {
      errors.push(`${at}: must be an object.`);
      return;
    }
    rejectUnknownKeys(e, new Set(['unit', 'cost']), at, errors);
    const unit = readUnit(e, at, context, errors);
    const cost = readInt(e, 'cost', 1, at, errors);
    if (unit !== undefined && cost !== undefined) {
      if (unitCost.some((u) => u.unit === unit)) {
        errors.push(`${at}: duplicate unit "${unit}".`);
      }
      unitCost.push({ unit, cost });
    }
  });
  if (unitCost.length === 0) errors.push('threats: "unitCost" is empty.');
  const priced = (u: UnitId): boolean => unitCost.some((c) => c.unit === u);

  let layouts: ThreatsConfig['layouts'] | undefined;
  const lay = readRecord(data, 'layouts', 'threats', errors);
  if (lay !== undefined) {
    rejectUnknownKeys(lay, new Set(LAYOUTS), 'threats.layouts', errors);
    const ring = readRecord(lay, 'ring', 'threats.layouts', errors);
    const line = readRecord(lay, 'line', 'threats.layouts', errors);
    const open = readRecord(lay, 'open', 'threats.layouts', errors);
    if (ring !== undefined && line !== undefined && open !== undefined) {
      const ringKeys = [
        'coreRow',
        'firstRingDistance',
        'ringSpacing',
        'gapWidth',
        'turretMinDistance',
      ];
      const lineKeys = [
        'coreRow',
        'lineRow',
        'maxRows',
        'gapWidth',
        'gapMargin',
        'turretMinDistance',
      ];
      const openKeys = ['coreRow', 'turretMinDistance'];
      rejectUnknownKeys(ring, new Set(ringKeys), 'layouts.ring', errors);
      rejectUnknownKeys(line, new Set(lineKeys), 'layouts.line', errors);
      rejectUnknownKeys(open, new Set(openKeys), 'layouts.open', errors);
      const r = (
        rec: Record<string, unknown>,
        k: string,
        at: string,
        min: number,
      ) => readInt(rec, k, min, at, errors);
      const ringV = {
        coreRow: r(ring, 'coreRow', 'layouts.ring', 0),
        firstRingDistance: r(ring, 'firstRingDistance', 'layouts.ring', 1),
        ringSpacing: r(ring, 'ringSpacing', 'layouts.ring', 1),
        gapWidth: r(ring, 'gapWidth', 'layouts.ring', 1),
        turretMinDistance: r(ring, 'turretMinDistance', 'layouts.ring', 1),
      };
      const lineV = {
        coreRow: r(line, 'coreRow', 'layouts.line', 0),
        lineRow: r(line, 'lineRow', 'layouts.line', 1),
        maxRows: r(line, 'maxRows', 'layouts.line', 1),
        gapWidth: r(line, 'gapWidth', 'layouts.line', 1),
        gapMargin: r(line, 'gapMargin', 'layouts.line', 0),
        turretMinDistance: r(line, 'turretMinDistance', 'layouts.line', 1),
      };
      const openV = {
        coreRow: r(open, 'coreRow', 'layouts.open', 0),
        turretMinDistance: r(open, 'turretMinDistance', 'layouts.open', 1),
      };
      if (complete(ringV) && complete(lineV) && complete(openV)) {
        layouts = {
          ring: ringV as RingLayoutConfig,
          line: lineV as LineLayoutConfig,
          open: openV as OpenLayoutConfig,
        };
      }
    }
  }

  const hasWall = context.buildings
    .list()
    .some((b) => b.kind === 'defense' && b.defenseType === 'wall');
  const hasTurret = context.buildings
    .list()
    .some((b) => b.kind === 'defense' && b.defenseType === 'turret');

  const archetypes: ArchetypeDef[] = [];
  const archList = readArray(data, 'archetypes', 'threats', errors);
  if (archList.length === 0) errors.push('threats: "archetypes" is empty.');
  archList.forEach((e, i) => {
    const at = `archetypes[${String(i)}]`;
    if (!isRecord(e)) {
      errors.push(`${at}: must be an object.`);
      return;
    }
    rejectUnknownKeys(
      e,
      new Set(['id', 'bossOnly', 'waveSharePercent', 'waves', 'stronghold']),
      at,
      errors,
    );
    const id = e['id'];
    if (typeof id !== 'string' || !ARCH_ID.test(id)) {
      errors.push(`${at}: "id" must match ${String(ARCH_ID)}.`);
    } else if (archetypes.some((a) => a.id === id)) {
      errors.push(`${at}: duplicate id "${id}".`);
    }
    if (typeof e['bossOnly'] !== 'boolean') {
      errors.push(`${at}: "bossOnly" must be true or false.`);
    }
    const waveShare = readInt(e, 'waveSharePercent', 0, at, errors);
    if (waveShare !== undefined && waveShare > 100) {
      errors.push(`${at}: "waveSharePercent" must be at most 100.`);
    }

    let waves: WaveTemplate | undefined;
    const w = readRecord(e, 'waves', at, errors);
    if (w !== undefined) {
      const wat = `${at}.waves`;
      rejectUnknownKeys(
        w,
        new Set([
          'firstTick',
          'intervalTicks',
          'count',
          'growthPercent',
          'composition',
          'signature',
        ]),
        wat,
        errors,
      );
      const firstTick = readInt(w, 'firstTick', 0, wat, errors);
      const intervalTicks = readInt(w, 'intervalTicks', 1, wat, errors);
      const count = readInt(w, 'count', 1, wat, errors);
      if (count !== undefined && count > 12) {
        errors.push(`${wat}: "count" must be at most 12.`);
      }
      const growth = readInt(w, 'growthPercent', 100, wat, errors);
      if (growth !== undefined && growth > 300) {
        errors.push(`${wat}: "growthPercent" must be at most 300.`);
      }
      const composition: WaveComposition[] = [];
      readArray(w, 'composition', wat, errors).forEach((c, j) => {
        const cat = `${wat}.composition[${String(j)}]`;
        if (!isRecord(c)) {
          errors.push(`${cat}: must be an object.`);
          return;
        }
        rejectUnknownKeys(c, new Set(['unit', 'weight']), cat, errors);
        const unit = readUnit(c, cat, context, errors);
        const weight = readInt(c, 'weight', 1, cat, errors);
        if (unit !== undefined && weight !== undefined) {
          if (!priced(unit))
            errors.push(`${cat}: unit "${unit}" has no unitCost.`);
          composition.push({ unit, weight });
        }
      });
      if (composition.length === 0)
        errors.push(`${wat}: "composition" is empty.`);
      let signature: WaveTemplate['signature'];
      if (w['signature'] !== undefined) {
        const s = w['signature'];
        const sat = `${wat}.signature`;
        if (!isRecord(s)) {
          errors.push(`${sat}: must be an object.`);
        } else {
          rejectUnknownKeys(s, new Set(['everyNthWave', 'unit']), sat, errors);
          const every = readInt(s, 'everyNthWave', 1, sat, errors);
          const unit = readUnit(s, sat, context, errors);
          if (every !== undefined && unit !== undefined) {
            if (!priced(unit))
              errors.push(`${sat}: unit "${unit}" has no unitCost.`);
            signature = { everyNthWave: every, unit };
          }
        }
      }
      if (
        firstTick !== undefined &&
        intervalTicks !== undefined &&
        count !== undefined &&
        growth !== undefined &&
        composition.length > 0
      ) {
        waves = {
          firstTick,
          intervalTicks,
          count,
          growthPercent: growth,
          composition,
          ...(signature === undefined ? {} : { signature }),
        };
      }
    }

    let stronghold: StrongholdTemplate | undefined;
    const s = readRecord(e, 'stronghold', at, errors);
    if (s !== undefined) {
      const sat = `${at}.stronghold`;
      rejectUnknownKeys(
        s,
        new Set([
          'coreHealthPerBudget',
          'wallSharePercent',
          'turretSharePercent',
          'layout',
        ]),
        sat,
        errors,
      );
      const perBudget = readInt(s, 'coreHealthPerBudget', 1, sat, errors);
      if (perBudget !== undefined && perBudget > 1000) {
        errors.push(`${sat}: "coreHealthPerBudget" must be at most 1000.`);
      }
      const wall = readInt(s, 'wallSharePercent', 0, sat, errors);
      const turret = readInt(s, 'turretSharePercent', 0, sat, errors);
      if (wall !== undefined && turret !== undefined) {
        if (wall + turret > 100) {
          errors.push(
            `${sat}: wall and turret shares must sum to at most 100.`,
          );
        }
        if (wall > 0 && !hasWall)
          errors.push(`${sat}: there is no wall building.`);
        if (turret > 0 && !hasTurret) {
          errors.push(`${sat}: there is no turret building.`);
        }
      }
      const layout = s['layout'];
      if (typeof layout !== 'string' || !LAYOUTS.includes(layout)) {
        errors.push(`${sat}: "layout" must be one of ${LAYOUTS.join(', ')}.`);
      } else if (
        perBudget !== undefined &&
        wall !== undefined &&
        turret !== undefined
      ) {
        stronghold = {
          coreHealthPerBudget: perBudget,
          wallSharePercent: wall,
          turretSharePercent: turret,
          layout: layout as LayoutId,
        };
      }
    }
    if (
      typeof id === 'string' &&
      typeof e['bossOnly'] === 'boolean' &&
      waveShare !== undefined &&
      waves !== undefined &&
      stronghold !== undefined
    ) {
      archetypes.push({
        id,
        bossOnly: e['bossOnly'],
        waveSharePercent: waveShare,
        waves,
        stronghold,
      });
    }
  });

  if (
    errors.length > 0 ||
    baseBudget === undefined ||
    growthPercent === undefined ||
    multipliers === undefined ||
    maxPartySize === undefined ||
    maxUnitsPerWavePerPlot === undefined ||
    maxWallsPerPlot === undefined ||
    maxTurretsPerPlot === undefined ||
    minCoreHealth === undefined ||
    compositionJitterPercent === undefined ||
    layouts === undefined
  ) {
    return { ok: false, errors };
  }
  const config: ThreatsConfig = {
    baseBudget,
    growthPercent,
    typeMultiplierPercent: multipliers,
    maxPartySize,
    maxUnitsPerWavePerPlot,
    maxWallsPerPlot,
    maxTurretsPerPlot,
    minCoreHealth,
    compositionJitterPercent,
    unitCost,
    layouts,
    archetypes,
  };
  if (baseBudget > budgetLimit(config)) {
    return {
      ok: false,
      errors: ['threats: "baseBudget" is above the safe budget limit.'],
    };
  }
  return { ok: true, config };
}

/** Like loadThreats, but throws one Error listing every problem. */
export function loadThreatsOrThrow(
  data: unknown,
  context: ThreatsLoadContext,
): ThreatsConfig {
  return unwrapOrThrow('threats configuration', loadThreats(data, context));
}
