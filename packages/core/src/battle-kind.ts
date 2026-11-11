/**
 * Golden-vector kind `battle`. Input `{ teamA, teamB, seed }` where each team
 * is a `team-state-ops` script. Result on success: `{ ok: true, result,
 * summary, zone, stateHash, events }` where `summary` has no timeline,
 * `stateHash` is the hash of the final `ArenaSim` and `events` the number of
 * events; the event log is the vector's event log. On a refused battle:
 * `{ ok: false, error: { code, message } }`.
 */
import { startBattle } from './battle.js';
import type { ArenaContent } from './arena.js';
import { hashJson, type Json } from './hash.js';
import type { SimulationFn } from './golden-kinds.js';
import type { MapgenConfig } from './mapgen.js';
import type { SimConfig } from './sim-config.js';
import { runTeamStateOps } from './team-state-ops.js';

function field(input: Json, key: string): Json | undefined {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('battle: input must be an object');
  }
  return (input as Record<string, Json>)[key];
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
    const started = startBattle({ teamA, teamB, seed }, content, {
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
        zone: battle.zone as unknown as Json,
        stateHash: hashJson(battle.sim),
        events: battle.eventLog.length,
      },
      eventLog: battle.eventLog as unknown as Json[],
    };
  };
}
