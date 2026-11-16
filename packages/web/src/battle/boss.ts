/**
 * What a boss adds to the battle screen (MM-9d): the Brood's burst marks, the
 * linked Cores' shared pool, the Pylons' shields and the Warlord's champions.
 * Pure helpers; the drawing is in `draw.ts`, the words are in the
 * presentation file. Only the second side (the stronghold) has any of these.
 */

import {
  isCoreHealth,
  poolOf,
  type ArenaSim,
  type HealthSim,
  type UnitId,
} from '@game/core';
import type { WebContent } from '../content.js';
import { plural } from '../plural.js';
import type { BattleRecord } from './playback.js';

export interface BossPylon {
  /** The pylon's building instance ID. */
  readonly building: number;
  /** The player index of the Core it shields. */
  readonly core: number;
}

/** The boss mechanics of the second side, read from the battle's options. */
export interface BossMarks {
  /** Burst thresholds (percent of health) by boss Core, high to low. */
  readonly bursts: ReadonlyMap<number, readonly number[]>;
  readonly pylons: readonly BossPylon[];
  /** The Cores share one health pool. */
  readonly linked: boolean;
  /** Whether any wave is led by a champion. */
  readonly champions: boolean;
}

const NONE: BossMarks = {
  bursts: new Map(),
  pylons: [],
  linked: false,
  champions: false,
};

const cache = new WeakMap<ArenaSim, BossMarks>();

/** The boss mechanics of the battle; `NONE` for any other battle. */
export function bossMarks(sim: ArenaSim): BossMarks {
  let marks = cache.get(sim);
  if (marks === undefined) {
    marks = readMarks(sim);
    cache.set(sim, marks);
  }
  return marks;
}

function readMarks(sim: ArenaSim): BossMarks {
  const o = sim.sideOptions?.[1];
  if (o === undefined) return NONE;
  const bursts = new Map<number, number[]>();
  for (const b of o.bursts ?? []) {
    const list = bursts.get(b.core) ?? [];
    if (!list.includes(b.thresholdPercent)) list.push(b.thresholdPercent);
    bursts.set(b.core, list);
  }
  for (const list of bursts.values()) list.sort((a, b) => b - a);
  const pylons = (o.pylons ?? []).map((p) => ({
    building: p.building,
    core: p.core,
  }));
  const linked = poolOf(sim, 1) !== undefined;
  const champions = (o.scheduledWaves ?? []).some(
    (w) => w.healthPercent !== undefined,
  );
  if (bursts.size === 0 && pylons.length === 0 && !linked && !champions) {
    return NONE;
  }
  return { bursts, pylons, linked, champions };
}

/** The pylons (of `core`, or all) that still stand in `health`. */
export function standingPylons(
  marks: BossMarks,
  health: readonly HealthSim[],
  core?: number,
): number {
  let n = 0;
  for (const p of marks.pylons) {
    if (core !== undefined && p.core !== core) continue;
    const h = health.find(
      (x) => !isCoreHealth(x) && x.side === 1 && x.building === p.building,
    );
    if (h !== undefined && h.hp > 0) n += 1;
  }
  return n;
}

/** A shared pool's health now and at the start; null for any other side. */
export function sharedPool(
  sim: ArenaSim,
  record: Pick<BattleRecord, 'linked' | 'coreMax'>,
  side: 0 | 1,
): { readonly hp: number; readonly max: number } | null {
  if (!record.linked[side]) return null;
  const pool = poolOf(sim, side);
  if (pool === undefined) return null;
  return { hp: pool.hp, max: record.coreMax[side] };
}

/**
 * The Cores' maximum health as the Overload note counts them: a linked side
 * is one pool, any other side has one entry per Core.
 */
export function overloadMaxima(
  record: Pick<BattleRecord, 'linked' | 'coreMax' | 'initialHealth'>,
  side: 0 | 1,
): number[] {
  if (record.linked[side]) return [record.coreMax[side]];
  const out: number[] = [];
  for (const h of record.initialHealth) {
    if (isCoreHealth(h) && h.side === side) out.push(h.hp);
  }
  return out;
}

/** "4 Soldiers, 2 Raiders": the units of a burst, in release order. */
export function burstUnitsText(
  units: readonly { readonly unit: UnitId; readonly count: number }[],
  content: WebContent,
): string {
  return units
    .map((u) => {
      const name = content.presentation.get(u.unit)?.name ?? u.unit;
      return `${String(u.count)} ${plural(u.count, name)}`;
    })
    .join(', ');
}
