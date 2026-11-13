/**
 * Golden-vector kinds `threat-gen` and `pve-battle` (W1-9).
 *
 * `threat-gen`: input `{ seed, round, type, partySize, archetype }`; result
 * `{ profile, hash }` with `hash = hashJson(profile)`.
 *
 * `pve-battle`: input `{ team, threat, seed }` where `team` is a
 * `team-state-ops` script and `threat` is a `threat-gen` input. Result on
 * success: `{ ok: true, result, summary (no timeline), threatHash, zone,
 * stateHash, events }`; the event log is the vector's event log. On a refused
 * battle `{ ok: false, error: { code, message } }`.
 */
import {
  generateThreat,
  hashJson,
  runTeamStateOps,
  startPveBattle,
  type ArenaContent,
  type Json,
  type MapgenConfig,
  type SimConfig,
  type ThreatInput,
  type ThreatsConfig,
  type ThreatType,
} from '@game/core';
import type { SimulationFn } from './prng.js';

function obj(v: Json | undefined, what: string): Record<string, Json> {
  if (
    v === null ||
    v === undefined ||
    typeof v !== 'object' ||
    Array.isArray(v)
  ) {
    throw new TypeError(`${what} must be an object`);
  }
  return v as Record<string, Json>;
}

function threatInput(v: Json | undefined): ThreatInput {
  const o = obj(v, 'threat');
  const { seed, round, partySize, type, archetype } = o;
  if (
    typeof seed !== 'number' ||
    typeof round !== 'number' ||
    typeof partySize !== 'number' ||
    typeof type !== 'string' ||
    typeof archetype !== 'string'
  ) {
    throw new TypeError(
      'threat: seed, round, partySize, type and archetype are required',
    );
  }
  return { seed, round, partySize, type: type as ThreatType, archetype };
}

export function makeThreatGenKind(
  content: ArenaContent,
  mapgen: MapgenConfig,
  threats: ThreatsConfig,
): SimulationFn {
  return (input: Json) => {
    const profile = generateThreat(threatInput(input), content, {
      threats,
      mapgen,
    });
    return {
      result: {
        profile: profile as unknown as Json,
        hash: hashJson(profile),
      },
    };
  };
}

export function makePveBattleKind(
  content: ArenaContent,
  mapgen: MapgenConfig,
  simConfig: SimConfig,
  threats: ThreatsConfig,
): SimulationFn {
  return (input: Json) => {
    const o = obj(input, 'input');
    const seed = o['seed'];
    const script = o['team'];
    if (typeof seed !== 'number' || script === undefined) {
      throw new TypeError(
        'pve-battle: team, threat and a numeric seed are required',
      );
    }
    const team = runTeamStateOps(script, content, mapgen).state;
    const threat = generateThreat(threatInput(o['threat']), content, {
      threats,
      mapgen,
    });
    const started = startPveBattle({ team, threat, seed }, content, {
      sim: simConfig,
      mapgen,
    });
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
        threatHash: hashJson(threat),
        zone: battle.zone as unknown as Json,
        stateHash: hashJson(battle.sim),
        events: battle.eventLog.length,
      },
      eventLog: battle.eventLog as unknown as Json[],
    };
  };
}
