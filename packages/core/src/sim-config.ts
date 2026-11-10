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
}

export type SimConfigLoadResult = LoadResult<SimConfig>;

const KEYS = new Set([
  '$schema',
  'ticksPerSecond',
  'inputBufferUnits',
  'breachBaseCost',
  'breachHealthPerCost',
  'aggroRangeCells',
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
  if (
    errors.length > 0 ||
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
    },
  };
}

/** Like loadSimConfig, but throws one Error listing every problem. */
export function loadSimConfigOrThrow(data: unknown): SimConfig {
  return unwrapOrThrow('simulation configuration', loadSimConfig(data));
}
