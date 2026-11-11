/** Simulation constants (W1-4): loaded from content/sim.json. */

import {
  isRecord,
  readInt,
  rejectUnknownKeys,
  unwrapOrThrow,
  type LoadResult,
} from './load-util.js';

export interface SimConfig {
  /** Fixed ticks per second of battle time (CB-10). */
  readonly ticksPerSecond: number;
  /** Capacity, in units, of each consumer input buffer. */
  readonly inputBufferUnits: number;
  /** Cost of stepping through an enemy building when a base is sealed. */
  readonly breachBaseCost: number;
  /** Building health that adds 1 to that cost (rounded up). */
  readonly breachHealthPerCost: number;
  /** Manhattan range within which a unit chases an enemy unit (CB-16). */
  readonly aggroRangeCells: number;
  /** Global cap on the summed `source_speed` bonus of one side, percent (SC-8). */
  readonly maxSourceSpeedPercent: number;
  /** Global cap on the summed `unit_strength` bonus of one side, percent (SC-8). */
  readonly maxUnitStrengthPercent: number;
  /** First tick at which Overload applies (CB-12). */
  readonly overloadStartTick: number;
  /** Ticks between Overload levels. */
  readonly overloadIntervalTicks: number;
  /** Percent of extra unit damage per Overload level. */
  readonly overloadDamageStepPercent: number;
  /** Core damage per Overload level, applied once per interval to both Cores. */
  readonly overloadCoreDamageStep: number;
  /** Hard cap on battle length in ticks (CB-33 safety net). */
  readonly maxBattleTicks: number;
  /** Ticks between timeline samples in a battle summary. */
  readonly timelineSampleTicks: number;
}

export type SimConfigLoadResult = LoadResult<SimConfig>;

const KEYS = new Set([
  '$schema',
  'ticksPerSecond',
  'inputBufferUnits',
  'breachBaseCost',
  'breachHealthPerCost',
  'aggroRangeCells',
  'maxSourceSpeedPercent',
  'maxUnitStrengthPercent',
  'overloadStartTick',
  'overloadIntervalTicks',
  'overloadDamageStepPercent',
  'overloadCoreDamageStep',
  'maxBattleTicks',
  'timelineSampleTicks',
]);

/** Validate parsed simulation configuration (the contents of sim.json). */
export function loadSimConfig(data: unknown): SimConfigLoadResult {
  if (!isRecord(data)) {
    return { ok: false, errors: ['Sim file must be an object.'] };
  }
  const errors: string[] = [];
  rejectUnknownKeys(data, KEYS, 'sim', errors);
  const ticksPerSecond = readInt(data, 'ticksPerSecond', 1, 'sim', errors);
  const inputBufferUnits = readInt(data, 'inputBufferUnits', 1, 'sim', errors);
  const breachBaseCost = readInt(data, 'breachBaseCost', 0, 'sim', errors);
  const breachHealthPerCost = readInt(
    data,
    'breachHealthPerCost',
    1,
    'sim',
    errors,
  );
  const aggroRangeCells = readInt(data, 'aggroRangeCells', 0, 'sim', errors);
  const maxSourceSpeedPercent = readInt(
    data,
    'maxSourceSpeedPercent',
    0,
    'sim',
    errors,
  );
  const maxUnitStrengthPercent = readInt(
    data,
    'maxUnitStrengthPercent',
    0,
    'sim',
    errors,
  );
  const overloadStartTick = readInt(
    data,
    'overloadStartTick',
    0,
    'sim',
    errors,
  );
  const overloadIntervalTicks = readInt(
    data,
    'overloadIntervalTicks',
    1,
    'sim',
    errors,
  );
  const overloadDamageStepPercent = readInt(
    data,
    'overloadDamageStepPercent',
    0,
    'sim',
    errors,
  );
  const overloadCoreDamageStep = readInt(
    data,
    'overloadCoreDamageStep',
    0,
    'sim',
    errors,
  );
  const maxBattleTicks = readInt(data, 'maxBattleTicks', 1, 'sim', errors);
  const timelineSampleTicks = readInt(
    data,
    'timelineSampleTicks',
    1,
    'sim',
    errors,
  );
  if (
    errors.length > 0 ||
    maxBattleTicks === undefined ||
    timelineSampleTicks === undefined ||
    maxSourceSpeedPercent === undefined ||
    maxUnitStrengthPercent === undefined ||
    overloadStartTick === undefined ||
    overloadIntervalTicks === undefined ||
    overloadDamageStepPercent === undefined ||
    overloadCoreDamageStep === undefined ||
    aggroRangeCells === undefined ||
    ticksPerSecond === undefined ||
    inputBufferUnits === undefined ||
    breachBaseCost === undefined ||
    breachHealthPerCost === undefined
  ) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    config: {
      ticksPerSecond,
      inputBufferUnits,
      breachBaseCost,
      breachHealthPerCost,
      aggroRangeCells,
      maxSourceSpeedPercent,
      maxUnitStrengthPercent,
      overloadStartTick,
      overloadIntervalTicks,
      overloadDamageStepPercent,
      overloadCoreDamageStep,
      maxBattleTicks,
      timelineSampleTicks,
    },
  };
}

/** Like loadSimConfig, but throws one Error listing every problem. */
export function loadSimConfigOrThrow(data: unknown): SimConfig {
  return unwrapOrThrow('simulation configuration', loadSimConfig(data));
}
