/**
 * Golden-vector kind `battle`. Input `{ teamA, teamB, seed }` where each team
 * is a `team-state-ops` script, plus an optional `sideOptions`: `[side0, side1]`
 * where each is `null` or an object of the arena side options (`scheduledWaves`,
 * `freePower`, `unitStrengthPercent`, `coreHealths`; see "Side options"), so a
 * scenario can bring waves of units or turrets that need no supply. Result on success: `{ ok: true, result,
 * summary, zone, stateHash, events }` where `summary` has no timeline,
 * `stateHash` is the hash of the final `ArenaSim` and `events` the number of
 * events; the event log is the vector's event log. On a refused battle:
 * `{ ok: false, error: { code, message } }`.
 */
import {
  hashJson,
  runTeamStateOps,
  sortedKeys,
  startBattle,
  type ArenaContent,
  type Json,
  type MapgenConfig,
  type ScheduledWave,
  type SideOptions,
  type SimConfig,
} from '@game/core';
import type { SimulationFn } from './prng.js';

function field(input: Json, key: string): Json | undefined {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('battle: input must be an object');
  }
  return (input as Record<string, Json>)[key];
}

function isPlainObject(v: Json | undefined): v is Record<string, Json> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function intField(v: Json | undefined, what: string, min: number): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min) {
    throw new TypeError(`battle: ${what} must be an integer >= ${String(min)}`);
  }
  return v;
}

function rejectUnknown(
  o: Record<string, Json>,
  known: readonly string[],
  what: string,
): void {
  for (const k of sortedKeys(o)) {
    if (!known.includes(k)) {
      throw new TypeError(
        `battle: unknown key "${k}" in ${what} (known: ${known.join(', ')})`,
      );
    }
  }
}

/**
 * One side's options, field by field: `scheduledWaves` (a list of `{tick,
 * unit, count}`), `freePower` (boolean), `unitStrengthPercent` (an
 * integer) and `coreHealths` (a list of integers, one per player). Unknown keys and wrong types throw a `TypeError`.
 */
export function parseSideOptions(raw: Json, what: string): SideOptions {
  if (!isPlainObject(raw)) {
    throw new TypeError(`battle: ${what} must be an object or null`);
  }
  rejectUnknown(
    raw,
    ['scheduledWaves', 'freePower', 'unitStrengthPercent', 'coreHealths'],
    what,
  );
  const out: {
    scheduledWaves?: ScheduledWave[];
    freePower?: boolean;
    unitStrengthPercent?: number;
    coreHealths?: number[];
  } = {};
  const waves = raw['scheduledWaves'];
  if (waves !== undefined) {
    if (!Array.isArray(waves)) {
      throw new TypeError(`battle: ${what}.scheduledWaves must be an array`);
    }
    out.scheduledWaves = (waves as Json[]).map((w, j) => {
      const at = `${what}.scheduledWaves[${String(j)}]`;
      if (!isPlainObject(w)) {
        throw new TypeError(`battle: ${at} must be an object`);
      }
      rejectUnknown(w, ['tick', 'unit', 'count'], at);
      const unit = w['unit'];
      if (typeof unit !== 'string') {
        throw new TypeError(`battle: ${at}.unit must be a string`);
      }
      return {
        tick: intField(w['tick'], `${at}.tick`, 0),
        unit,
        count: intField(w['count'], `${at}.count`, 0),
      };
    });
  }
  const free = raw['freePower'];
  if (free !== undefined) {
    if (typeof free !== 'boolean') {
      throw new TypeError(`battle: ${what}.freePower must be a boolean`);
    }
    out.freePower = free;
  }
  const strength = raw['unitStrengthPercent'];
  if (strength !== undefined) {
    out.unitStrengthPercent = intField(
      strength,
      `${what}.unitStrengthPercent`,
      0,
    );
  }
  const cores = raw['coreHealths'];
  if (cores !== undefined) {
    if (!Array.isArray(cores)) {
      throw new TypeError(`battle: ${what}.coreHealths must be an array`);
    }
    out.coreHealths = (cores as Json[]).map((c, j) =>
      intField(c, `${what}.coreHealths[${String(j)}]`, 1),
    );
  }
  return out;
}

/** `sideOptions` of a battle input: a pair of `null` or option objects. */
export function parseSideOptionsPair(
  given: Json,
): readonly [SideOptions | null, SideOptions | null] {
  if (!Array.isArray(given) || given.length !== 2) {
    throw new TypeError(
      'battle: sideOptions must be a list of two objects or nulls',
    );
  }
  const side = (i: 0 | 1): SideOptions | null => {
    const o = given[i] as Json;
    return o === null ? null : parseSideOptions(o, `sideOptions[${String(i)}]`);
  };
  return [side(0), side(1)];
}

export function makeBattleKind(
  content: ArenaContent,
  mapgen: MapgenConfig,
  simConfig: SimConfig,
): SimulationFn {
  return (input: Json) => {
    const a = field(input, 'teamA');
    const b = field(input, 'teamB');
    const seed = field(input, 'seed');
    if (a === undefined || b === undefined || typeof seed !== 'number') {
      throw new TypeError(
        'battle: teamA, teamB and a numeric seed are required',
      );
    }
    const teamA = runTeamStateOps(a, content, mapgen).state;
    const teamB = runTeamStateOps(b, content, mapgen).state;
    const given = field(input, 'sideOptions');
    const sideOptions =
      given === undefined ? {} : { sideOptions: parseSideOptionsPair(given) };
    const started = startBattle(
      { teamA, teamB, seed, ...sideOptions },
      content,
      {
        sim: simConfig,
        mapgen,
      },
    );
    if (!started.ok) {
      return {
        result: {
          ok: false,
          error: { code: started.error.code, message: started.error.message },
        },
      };
    }
    const { battle } = started;
    while (!battle.isOver()) battle.step();
    const summary = battle.summary();
    return {
      result: {
        ok: true,
        result: battle.result() as unknown as Json,
        summary: { sides: summary.sides } as unknown as Json,
        zone: battle.zone as unknown as Json,
        stateHash: hashJson(battle.sim),
        events: battle.eventLog.length,
      },
      eventLog: battle.eventLog as unknown as Json[],
    };
  };
}
