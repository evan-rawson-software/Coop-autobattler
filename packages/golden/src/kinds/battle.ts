/**
 * Golden-vector kind `battle`. Input `{ teamA, teamB, seed, round? }` (`round`
 * from 1, default 1: the guards of the zone's points scale with it, CB-8e)
 * and an optional test-only `zone` (a hand-made neutral zone) where each team
 * is a `team-state-ops` script, plus an optional `sideOptions`: `[side0, side1]`
 * where each is `null` or an object of the arena side options (`scheduledWaves`,
 * `freePower`, `unitStrengthPercent`, `coreHealths`; see "Side options"), so a
 * scenario can bring waves of units or turrets that need no supply. Optional `modifiersA` and `modifiersB` give a side's run
 * modifiers, a list of `{ id, effects }` as held in a team state
 * (`TeamState.modifiers`). Result on success: `{ ok: true, result,
 * summary, zone, stateHash, events }` where `summary` has no timeline (it has `points`, the final controller and
 * `pointHeldTicks` of each point, when the zone has points),
 * `stateHash` is the hash of the final `ArenaSim` and `events` the number of
 * events; the event log is the vector's event log. On a refused battle:
 * `{ ok: false, error: { code, message } }`.
 */
import {
  hashJson,
  parseTeamModifiers,
  runTeamStateOps,
  sortedKeys,
  startBattle,
  type BattleContent,
  type Json,
  type MapgenConfig,
  type NeutralZone,
  type ScheduledWave,
  type SideOptions,
  type SimConfig,
  type TeamState,
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

/** The team with the run modifiers `raw` (if given), parsed and checked. */
function withModifiers(team: TeamState, raw: Json | undefined): TeamState {
  if (raw === undefined) return team;
  const errors: string[] = [];
  const modifiers = parseTeamModifiers(raw, errors);
  if (modifiers === undefined) {
    throw new TypeError(`battle: modifiers: ${errors.join(' ')}`);
  }
  return { ...team, modifiers };
}

export function makeBattleKind(
  content: BattleContent,
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
    const teamA = withModifiers(
      runTeamStateOps(a, content, mapgen).state,
      field(input, 'modifiersA'),
    );
    const teamB = withModifiers(
      runTeamStateOps(b, content, mapgen).state,
      field(input, 'modifiersB'),
    );
    // The run's round (CB-8e): the guards scale with it. Optional, default 1.
    const givenRound = field(input, 'round');
    if (
      givenRound !== undefined &&
      (typeof givenRound !== 'number' ||
        !Number.isInteger(givenRound) ||
        givenRound < 1)
    ) {
      throw new TypeError('battle: round must be an integer >= 1');
    }
    const round = givenRound ?? 1;
    const given = field(input, 'sideOptions');
    const sideOptions =
      given === undefined ? {} : { sideOptions: parseSideOptionsPair(given) };
    // Test-only: a hand-made zone (`{ width, depth, features,
    // pointsOfInterest }`, checked like a generated one) replaces the
    // generated zone.
    const zoneGiven = field(input, 'zone');
    const options =
      zoneGiven === undefined
        ? {}
        : { zone: zoneGiven as unknown as NeutralZone };
    const started = startBattle(
      { teamA, teamB, seed, round, ...sideOptions },
      content,
      {
        sim: simConfig,
        mapgen,
      },
      options,
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
        summary: {
          sides: summary.sides,
          ...(summary.points === undefined ? {} : { points: summary.points }),
        } as unknown as Json,
        zone: battle.zone as unknown as Json,
        stateHash: hashJson(battle.sim),
        events: battle.eventLog.length,
      },
      eventLog: battle.eventLog as unknown as Json[],
    };
  };
}
