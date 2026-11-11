/**
 * Golden-vector kind `arena-sim`. Input: `{ teamA, teamB, gapRows, ticks }`
 * where each team is a `team-state-ops` script (`seed`, `partySize`, `ops`).
 * Both boards are built, a battle starts at tick 0 and runs for `ticks` ticks.
 * An optional `units` list `[{ side, def, x, y }]` (arena coordinates) puts
 * units on the field at tick 0, in list order (scenario setup, like
 * `spawnUnitForTest`). An optional `buildingHealth` list
 * `[{ side, building, hp }]` sets the current health of those buildings at
 * tick 0 (building 0 is the Core; `hp` from 1 to the building's maximum), so
 * a scenario can start with damaged buildings. An optional `restoreAt` list of ticks makes the run
 * save and restore the state (JSON round trip, then `createArenaContext`) after
 * that many ticks; a restored battle must continue exactly like the original,
 * so the result is the same with or without it. Result: `{ tick, stateHash, events, sides }` where `stateHash` is the hash
 * of the final `ArenaSim`, `events` the number of events, and `sides` a
 * summary per side (`spawned`, `alive`, `unitsDied`, `buildingsDestroyed`,
 * `coreHealth`). The event log is the vector's event log.
 */
import type { ArenaContent } from './arena.js';
import {
  createArenaContext,
  createArenaSim,
  spawnUnitForTest,
  stepArena,
  type ArenaEvent,
  type ArenaSim,
} from './arena-sim.js';
import { hashJson, type Json } from './hash.js';
import type { SimulationFn } from './golden-kinds.js';
import type { MapgenConfig } from './mapgen.js';
import type { SimConfig } from './sim-config.js';
import { runTeamStateOps } from './team-state-ops.js';

function field(input: Json, key: string): Json | undefined {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('arena-sim: input must be an object');
  }
  return (input as Record<string, Json>)[key];
}

function nonNegative(v: Json | undefined, what: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    throw new TypeError(`arena-sim: ${what} must be a non-negative integer`);
  }
  return v;
}

/** Per-side summary of a battle state. */
export function summarizeArena(sim: ArenaSim): Json {
  return [0, 1].map((side) => {
    let buildingsDestroyed = 0;
    let coreHealth = 0;
    for (const h of sim.health) {
      if (h.side !== side) continue;
      if (h.building === 0) coreHealth = h.hp;
      else if (h.hp <= 0) buildingsDestroyed += 1;
    }
    return {
      spawned: sim.spawned[side === 0 ? 0 : 1],
      alive: sim.units.filter((u) => u.side === side).length,
      unitsDied: sim.unitsDied[side === 0 ? 0 : 1],
      buildingsDestroyed,
      coreHealth,
    };
  });
}

export function makeArenaSimKind(
  content: ArenaContent,
  mapgen: MapgenConfig,
  simConfig: SimConfig,
): SimulationFn {
  return (input: Json) => {
    const gapRows = nonNegative(field(input, 'gapRows'), 'gapRows');
    const ticks = nonNegative(field(input, 'ticks'), 'ticks');
    const a = field(input, 'teamA');
    const b = field(input, 'teamB');
    if (a === undefined || b === undefined) {
      throw new TypeError('arena-sim: teamA and teamB are required');
    }
    const teamA = runTeamStateOps(a, content, mapgen).state;
    const teamB = runTeamStateOps(b, content, mapgen).state;
    let sim = createArenaSim(teamA, teamB, gapRows, content, simConfig);
    const damaged = field(input, 'buildingHealth');
    if (damaged !== undefined) {
      if (!Array.isArray(damaged)) {
        throw new TypeError('arena-sim: buildingHealth must be an array');
      }
      for (const raw of damaged as Json[]) {
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
          throw new TypeError(
            'arena-sim: each buildingHealth must be an object',
          );
        }
        const e = raw as Record<string, Json>;
        const side = nonNegative(e['side'], 'buildingHealth.side');
        const building = nonNegative(e['building'], 'buildingHealth.building');
        const hp = nonNegative(e['hp'], 'buildingHealth.hp');
        const h = sim.health.find(
          (x) => x.side === side && x.building === building,
        );
        if (h === undefined || hp < 1 || hp > h.hp) {
          throw new TypeError(
            'arena-sim: buildingHealth names a missing building or an hp outside 1..maximum',
          );
        }
        h.hp = hp;
      }
    }
    const events: ArenaEvent[] = [];
    let ctx = createArenaContext(sim, content, simConfig, { events });
    const units = field(input, 'units');
    if (units !== undefined) {
      if (!Array.isArray(units)) {
        throw new TypeError('arena-sim: units must be an array');
      }
      for (const raw of units as Json[]) {
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
          throw new TypeError('arena-sim: each unit must be an object');
        }
        const u = raw as Record<string, Json>;
        const def = u['def'];
        if (typeof def !== 'string') {
          throw new TypeError('arena-sim: unit.def must be a string');
        }
        spawnUnitForTest(sim, ctx, {
          side: nonNegative(u['side'], 'unit.side'),
          def,
          x: nonNegative(u['x'], 'unit.x'),
          y: nonNegative(u['y'], 'unit.y'),
        });
      }
    }
    const restoreRaw = field(input, 'restoreAt');
    const restoreAt = new Set<number>();
    if (restoreRaw !== undefined) {
      if (!Array.isArray(restoreRaw)) {
        throw new TypeError('arena-sim: restoreAt must be an array');
      }
      for (const r of restoreRaw as Json[]) {
        restoreAt.add(nonNegative(r, 'restoreAt entry'));
      }
    }
    for (let t = 0; t < ticks; t++) {
      if (restoreAt.has(t)) {
        sim = JSON.parse(JSON.stringify(sim)) as ArenaSim;
        ctx = createArenaContext(sim, content, simConfig, { events });
      }
      stepArena(sim, ctx);
    }
    const result: Json = {
      tick: sim.tick,
      stateHash: hashJson(sim),
      events: events.length,
      sides: summarizeArena(sim),
    };
    return { result, eventLog: events as unknown as Json[] };
  };
}
