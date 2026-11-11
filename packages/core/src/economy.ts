/** Economy configuration (W2-2): loaded from content/economy.json. */

import type { BuildingConfig, BuildingId } from './buildings.js';
import {
  isRecord,
  readInt,
  rejectUnknownKeys,
  unwrapOrThrow,
  type LoadResult,
} from './load-util.js';

export interface KitEntry {
  readonly def: BuildingId;
  readonly tier: number;
  readonly count: number;
}

export interface OfferWeight {
  readonly def: BuildingId;
  readonly weight: number;
}

export interface TierOddsRow {
  readonly fromRound: number;
  /** Weights for tiers 1, 2 and 3. */
  readonly weights: readonly [number, number, number];
}

/** Gold paid to each player after a battle (W2-3, EC-6, EC-7). */
export interface RewardsConfig {
  /** A PvE win pays by difficulty; a PvE loss pays nothing. */
  readonly pveWin: {
    readonly easy: number;
    readonly medium: number;
    readonly hard: number;
  };
  readonly pvpWin: number;
  /** The consolation after a PvP loss. */
  readonly pvpLoss: number;
}

export interface EconomyConfig {
  readonly startingGold: number;
  readonly startingKit: readonly KitEntry[];
  readonly baseIncomePerShop: number;
  readonly shopOfferCount: number;
  readonly rerollCost: number;
  readonly sellRefundPercent: number;
  readonly rewards: RewardsConfig;
  readonly offerWeights: readonly OfferWeight[];
  readonly tierOdds: readonly TierOddsRow[];
}

export type EconomyLoadResult = LoadResult<EconomyConfig>;

export interface EconomyLoadContext {
  readonly buildings: BuildingConfig;
}

const KEYS = new Set([
  '$schema',
  'startingGold',
  'startingKit',
  'baseIncomePerShop',
  'shopOfferCount',
  'rerollCost',
  'sellRefundPercent',
  'rewards',
  'offerWeights',
  'tierOdds',
]);

function list(
  data: Record<string, unknown>,
  key: string,
  errors: string[],
): unknown[] {
  const v = data[key];
  if (!Array.isArray(v)) {
    errors.push(`economy: "${key}" must be a list.`);
    return [];
  }
  return v as unknown[];
}

/**
 * Check a building reference. Returns the ID when it names a known building
 * that is not the Core.
 */
function checkDef(
  def: unknown,
  at: string,
  context: EconomyLoadContext,
  errors: string[],
): string | undefined {
  if (typeof def !== 'string' || def === '') {
    errors.push(`${at}: missing or empty "def".`);
    return undefined;
  }
  const b = context.buildings.get(def);
  if (b === undefined) {
    errors.push(`${at}: unknown building "${def}".`);
    return undefined;
  }
  if (b.kind === 'core') {
    errors.push(`${at}: "${def}" is the Core and cannot be bought or owned.`);
    return undefined;
  }
  return def;
}

function readRewards(
  raw: unknown,
  errors: string[],
): RewardsConfig | undefined {
  if (!isRecord(raw)) {
    errors.push('economy: "rewards" must be an object.');
    return undefined;
  }
  rejectUnknownKeys(
    raw,
    new Set(['pveWin', 'pvpWin', 'pvpLoss']),
    'rewards',
    errors,
  );
  const pvpWin = readInt(raw, 'pvpWin', 0, 'rewards', errors);
  const pvpLoss = readInt(raw, 'pvpLoss', 0, 'rewards', errors);
  const pve = raw['pveWin'];
  if (!isRecord(pve)) {
    errors.push('rewards: "pveWin" must be an object.');
    return undefined;
  }
  rejectUnknownKeys(
    pve,
    new Set(['easy', 'medium', 'hard']),
    'rewards.pveWin',
    errors,
  );
  const easy = readInt(pve, 'easy', 0, 'rewards.pveWin', errors);
  const medium = readInt(pve, 'medium', 0, 'rewards.pveWin', errors);
  const hard = readInt(pve, 'hard', 0, 'rewards.pveWin', errors);
  if (
    easy === undefined ||
    medium === undefined ||
    hard === undefined ||
    pvpWin === undefined ||
    pvpLoss === undefined
  ) {
    return undefined;
  }
  if (!(easy < medium && medium < hard)) {
    errors.push(
      'rewards.pveWin: must increase strictly from easy to medium to hard.',
    );
    return undefined;
  }
  return { pveWin: { easy, medium, hard }, pvpWin, pvpLoss };
}

/** Validate parsed economy data (the contents of economy.json). */
export function loadEconomy(
  data: unknown,
  context: EconomyLoadContext,
): EconomyLoadResult {
  if (!isRecord(data)) {
    return { ok: false, errors: ['Economy file must be an object.'] };
  }
  const errors: string[] = [];
  rejectUnknownKeys(data, KEYS, 'economy', errors);
  const startingGold = readInt(data, 'startingGold', 0, 'economy', errors);
  const baseIncomePerShop = readInt(
    data,
    'baseIncomePerShop',
    0,
    'economy',
    errors,
  );
  const shopOfferCount = readInt(data, 'shopOfferCount', 1, 'economy', errors);
  const rerollCost = readInt(data, 'rerollCost', 0, 'economy', errors);
  const sellRefundPercent = readInt(
    data,
    'sellRefundPercent',
    0,
    'economy',
    errors,
  );
  if (sellRefundPercent !== undefined && sellRefundPercent > 100) {
    errors.push('economy: "sellRefundPercent" must be at most 100.');
  }

  const rewards = readRewards(data['rewards'], errors);

  const startingKit: KitEntry[] = [];
  list(data, 'startingKit', errors).forEach((e, i) => {
    const at = `startingKit[${String(i)}]`;
    if (!isRecord(e)) {
      errors.push(`${at}: must be an object.`);
      return;
    }
    rejectUnknownKeys(e, new Set(['def', 'tier', 'count']), at, errors);
    const def = checkDef(e['def'], at, context, errors);
    const tier = readInt(e, 'tier', 1, at, errors);
    if (tier !== undefined && tier > 3) {
      errors.push(`${at}: "tier" must be 1 to 3 (got ${String(tier)}).`);
    }
    const count = readInt(e, 'count', 1, at, errors);
    if (def !== undefined && tier !== undefined && count !== undefined) {
      startingKit.push({ def, tier, count });
    }
  });

  const offerWeights: OfferWeight[] = [];
  const seenDefs = new Set<string>();
  const weightEntries = list(data, 'offerWeights', errors);
  if (weightEntries.length === 0) {
    errors.push('economy: "offerWeights" must not be empty.');
  }
  weightEntries.forEach((e, i) => {
    const at = `offerWeights[${String(i)}]`;
    if (!isRecord(e)) {
      errors.push(`${at}: must be an object.`);
      return;
    }
    rejectUnknownKeys(e, new Set(['def', 'weight']), at, errors);
    const def = checkDef(e['def'], at, context, errors);
    if (def !== undefined) {
      if (seenDefs.has(def)) errors.push(`${at}: duplicate entry "${def}".`);
      seenDefs.add(def);
    }
    const weight = readInt(e, 'weight', 1, at, errors);
    if (def !== undefined && weight !== undefined) {
      offerWeights.push({ def, weight });
    }
  });

  const tierOdds: TierOddsRow[] = [];
  const oddsEntries = list(data, 'tierOdds', errors);
  if (oddsEntries.length === 0) {
    errors.push('economy: "tierOdds" must not be empty.');
  }
  let previous = 0;
  oddsEntries.forEach((e, i) => {
    const at = `tierOdds[${String(i)}]`;
    if (!isRecord(e)) {
      errors.push(`${at}: must be an object.`);
      return;
    }
    rejectUnknownKeys(e, new Set(['fromRound', 'weights']), at, errors);
    const fromRound = readInt(e, 'fromRound', 1, at, errors);
    if (fromRound !== undefined) {
      if (i === 0 && fromRound !== 1) {
        errors.push(
          `${at}: the first row must start at round 1 (got ${String(fromRound)}).`,
        );
      } else if (i > 0 && fromRound <= previous) {
        errors.push(
          `${at}: "fromRound" ${String(fromRound)} must be greater than the previous row's ${String(previous)}.`,
        );
      }
      previous = fromRound;
    }
    const w = e['weights'];
    const ok =
      Array.isArray(w) &&
      w.length === 3 &&
      w.every((x) => typeof x === 'number' && Number.isInteger(x) && x >= 0);
    if (!ok) {
      errors.push(`${at}: "weights" must be three non-negative integers.`);
    } else {
      const ws = w as [number, number, number];
      if (ws[0] + ws[1] + ws[2] < 1) {
        errors.push(`${at}: "weights" must have a positive sum.`);
      }
      if (fromRound !== undefined) tierOdds.push({ fromRound, weights: ws });
    }
  });

  if (
    errors.length > 0 ||
    startingGold === undefined ||
    baseIncomePerShop === undefined ||
    shopOfferCount === undefined ||
    rerollCost === undefined ||
    sellRefundPercent === undefined ||
    rewards === undefined
  ) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    config: {
      startingGold,
      startingKit,
      baseIncomePerShop,
      shopOfferCount,
      rerollCost,
      sellRefundPercent,
      rewards,
      offerWeights,
      tierOdds,
    },
  };
}

/** Like loadEconomy, but throws one Error listing every problem. */
export function loadEconomyOrThrow(
  data: unknown,
  context: EconomyLoadContext,
): EconomyConfig {
  return unwrapOrThrow('economy configuration', loadEconomy(data, context));
}
