/**
 * Golden-vector kind `arena-sim`. Input: `{ teamA, teamB, gapRows, ticks }`
 * where each team is a `team-state-ops` script (`seed`, `partySize`, `ops`).
 * Both boards are built, a battle starts at tick 0 and runs for `ticks` ticks.
 * An optional `units` list `[{ side, def, x, y }]` (arena cell: the unit
 * stands at its centre) or `[{ side, def, px, py }]` (exact position, sub-cell
 * units) puts units on the field at tick 0, in list order (scenario setup,
 * like `spawnUnitForTest`; a position that does not fit is an error). An optional `buildingHealth` list
 * `[{ side, building, hp }]` or, for a Core, `[{ side, core, hp }]` (`core`
 * is the player index) sets the current health of those buildings at tick 0
 * (`hp` from 1 to the maximum), so a scenario can start with damaged
 * buildings. An optional `restoreAt` list of ticks makes the run
 * save and restore the state (JSON round trip, then `createArenaContext`) after
 * that many ticks; a restored battle must continue exactly like the original,
 * so the result is the same with or without it. Result: `{ tick, stateHash, events, sides }` where `stateHash` is the hash
 * of the final `ArenaSim`, `events` the number of events, and `sides` a
 * summary per side (`spawned`, `alive`, `unitsDied`, `buildingDamageDealt`,
 * `buildingsDestroyed`, `coreHealth`: the list of Core health by player). The event log is the vector's event log.
 *
 * Two optional inputs help scenarios that the shipped unit types cannot
 * show: `extraUnits`, a list of unit definitions in the format of
 * `content/units.json` that are added to the content for this run (a unit too
 * wide for a gap, a target dummy), and `report: "positions"`, which adds
 * `positions` to the result (`report: "stats"` adds `stats`, `[[id, hp, maxHp, damage], ...]`; a unit may have `hp`; `lateUnits` are placed after the guards and the posts' starting `controller`; a post may have a `buff` as in `content/points.json` and `guards.maxPointStrengthPercent` is the cap): `[[id, px, py], ...]` of the living units.
 * `extraBuildings` is a list of building definitions in the format of
 * `content/buildings.json`, added for this run (a consumer of a refined
 * resource, which no shipped building is yet).
 *
 * Optional `modifiersA` and `modifiersB` give a side's run modifiers, a list of
 * `{ id, effects }` (the form held in a team state, see `TeamState.modifiers`),
 * so a scenario can show what a modifier does in a battle.
 *
 * An optional `checkpointEvery` (a positive integer) adds `checkpoints` to the
 * output: at every multiple of it that the battle reaches (not tick 0), an
 * entry `{ tick, alive: [side 0, side 1], coreHealth: [side 0, side 1],
 * stateHash }` with the same Core health lists and state hash as the result.
 */
import {
  placeGuards,
  pointStrengthBonus,
  spawnGuardForTest,
  createArenaContext,
  createArenaSim,
  hashJson,
  isCoreHealth,
  loadUnitsOrThrow,
  parseTeamModifiers,
  runTeamStateOps,
  spawnUnitForTest,
  stepArena,
  type ArenaContent,
  type ArenaEvent,
  type ArenaSim,
  type Json,
  type MapgenConfig,
  type PointBuffEffect,
  type SimConfig,
  type TeamState,
} from '@game/core';
import { withExtraBuildings } from './extra-buildings.js';
import type { SimulationFn } from './prng.js';

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

/** The team with the run modifiers `raw` (if given), parsed and checked. */
function withModifiers(team: TeamState, raw: Json | undefined): TeamState {
  if (raw === undefined) return team;
  const errors: string[] = [];
  const modifiers = parseTeamModifiers(raw, errors);
  if (modifiers === undefined) {
    throw new TypeError(`arena-sim: modifiers: ${errors.join(' ')}`);
  }
  return { ...team, modifiers };
}

/** Per-side summary of a battle state. */
export function summarizeArena(sim: ArenaSim): Json {
  return [0, 1].map((side) => {
    let buildingsDestroyed = 0;
    const coreHealth: number[] = [];
    for (const h of sim.health) {
      if (h.side !== side) continue;
      if (isCoreHealth(h)) coreHealth.push(h.hp);
      else if (h.hp <= 0) buildingsDestroyed += 1;
    }
    return {
      spawned: sim.spawned[side === 0 ? 0 : 1],
      alive: sim.units.filter((u) => u.side === side).length,
      unitsDied: sim.unitsDied[side === 0 ? 0 : 1],
      buildingDamageDealt: sim.buildingDamageDealt[side === 0 ? 0 : 1],
      buildingsDestroyed,
      coreHealth,
    };
  });
}

/** A post's buff in a vector: `{kind, ...numbers}` as in `content/points.json`. */
function readBuff(raw: Json): PointBuffEffect {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('arena-sim: guards.posts.buff must be an object');
  }
  const b = raw as Record<string, Json>;
  if (b['kind'] === 'unit_strength') {
    return {
      kind: 'unit_strength',
      strengthPercent: nonNegative(b['strengthPercent'], 'buff.strengthPercent'),
    };
  }
  if (b['kind'] === 'heal') {
    return {
      kind: 'heal',
      healIntervalTicks: nonNegative(b['healIntervalTicks'], 'buff.healIntervalTicks'),
      healRadiusCells: nonNegative(b['healRadiusCells'], 'buff.healRadiusCells'),
      healAmount: nonNegative(b['healAmount'], 'buff.healAmount'),
    };
  }
  throw new TypeError('arena-sim: buff.kind must be unit_strength or heal');
}

export function makeArenaSimKind(
  shipped: ArenaContent,
  mapgen: MapgenConfig,
  simConfig: SimConfig,
): SimulationFn {
  return (input: Json) => {
    const extra = field(input, 'extraUnits');
    const withUnits: ArenaContent =
      extra === undefined
        ? shipped
        : {
            ...shipped,
            units: loadUnitsOrThrow({
              units: [...shipped.units.list(), ...(extra as Json[])],
            }),
          };
    const content = withExtraBuildings(
      withUnits,
      field(input, 'extraBuildings'),
    );
    const gapRows = nonNegative(field(input, 'gapRows'), 'gapRows');
    const ticks = nonNegative(field(input, 'ticks'), 'ticks');
    const a = field(input, 'teamA');
    const b = field(input, 'teamB');
    if (a === undefined || b === undefined) {
      throw new TypeError('arena-sim: teamA and teamB are required');
    }
    const teamA = withModifiers(
      runTeamStateOps(a, content, mapgen).state,
      field(input, 'modifiersA'),
    );
    const teamB = withModifiers(
      runTeamStateOps(b, content, mapgen).state,
      field(input, 'modifiersB'),
    );
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
        const hp = nonNegative(e['hp'], 'buildingHealth.hp');
        const h =
          e['core'] !== undefined
            ? sim.health.find(
                (x) =>
                  isCoreHealth(x) &&
                  x.side === side &&
                  x.core === nonNegative(e['core'], 'buildingHealth.core'),
              )
            : sim.health.find(
                (x) =>
                  !isCoreHealth(x) &&
                  x.side === side &&
                  x.building ===
                    nonNegative(e['building'], 'buildingHealth.building'),
              );
        if (h === undefined || hp < 1 || hp > h.hp) {
          throw new TypeError(
            'arena-sim: buildingHealth names a missing building or an hp outside 1..maximum',
          );
        }
        h.hp = hp;
        if (isCoreHealth(h)) h.remaining = hp;
      }
    }
    const events: ArenaEvent[] = [];
    let ctx = createArenaContext(sim, content, simConfig, { events });
    // Each unit is `{side, def, x, y}` or `{side, def, px, py}`, with an
    // optional `hp` (below its maximum, to start damaged).
    const spawnList = (units: Json | undefined, name: string): void => {
      if (units === undefined) return;
      if (!Array.isArray(units)) {
        throw new TypeError(`arena-sim: ${name} must be an array`);
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
        const side = nonNegative(u['side'], 'unit.side');
        const spawned =
          u['px'] !== undefined || u['py'] !== undefined
            ? spawnUnitForTest(sim, ctx, {
                side,
                def,
                px: nonNegative(u['px'], 'unit.px'),
                py: nonNegative(u['py'], 'unit.py'),
              })
            : spawnUnitForTest(sim, ctx, {
                side,
                def,
                x: nonNegative(u['x'], 'unit.x'),
                y: nonNegative(u['y'], 'unit.y'),
              });
        if (u['hp'] !== undefined) {
          const hp = nonNegative(u['hp'], 'unit.hp');
          if (hp < 1 || hp > spawned.maxHp) {
            throw new TypeError('arena-sim: unit.hp must be 1..maximum health');
          }
          spawned.hp = hp;
        }
      }
    };
    spawnList(field(input, 'units'), 'units');
    const guardsRaw = field(input, 'guards');
    if (guardsRaw !== undefined) {
      if (
        guardsRaw === null ||
        typeof guardsRaw !== 'object' ||
        Array.isArray(guardsRaw)
      ) {
        throw new TypeError('arena-sim: guards must be an object');
      }
      const g = guardsRaw as Record<string, Json>;
      const posts = g['posts'];
      if (!Array.isArray(posts)) {
        throw new TypeError('arena-sim: guards.posts must be an array');
      }
      const cap = g['capture'] ?? {};
      if (typeof cap !== 'object' || Array.isArray(cap)) {
        throw new TypeError('arena-sim: guards.capture must be an object');
      }
      const capture = cap as Record<string, Json>;
      const capNum = (key: string, fallback: number): number =>
        capture[key] === undefined
          ? fallback
          : nonNegative(capture[key], `guards.capture.${key}`);
      placeGuards(sim, ctx, {
        capture: {
          captureTicks: capNum('captureTicks', 50),
          maxCapturersCounted: capNum('maxCapturersCounted', 3),
          captureRadiusCells: capNum('captureRadiusCells', 2),
          pointAggroRangeCells: capNum('pointAggroRangeCells', 3),
        },
        leashCells:
          g['leashCells'] === undefined
            ? 3
            : nonNegative(g['leashCells'], 'guards.leashCells'),
        posts: (posts as Json[]).map((raw) => {
          const p = raw as Record<string, Json>;
          return {
            id: nonNegative(p['id'], 'guards.posts.id'),
            x: nonNegative(p['x'], 'guards.posts.x'),
            y: nonNegative(p['y'], 'guards.posts.y'),
            ...(p['buff'] === undefined ? {} : { buff: readBuff(p['buff']) }),
          };
        }),
        ...(g['maxPointStrengthPercent'] === undefined
          ? {}
          : {
              maxPointStrengthPercent: nonNegative(
                g['maxPointStrengthPercent'],
                'guards.maxPointStrengthPercent',
              ),
            }),
        plans: [],
      });
      // Test setup: a post may start held by a side (`controller` 0 or 1).
      for (const raw of posts as Json[]) {
        const p = raw as Record<string, Json>;
        if (p['controller'] === undefined) continue;
        const point = sim.points?.find((q) => q.id === p['id']);
        if (point !== undefined) {
          point.controller = nonNegative(p['controller'], 'guards.posts.controller');
        }
      }
      const list = g['units'] ?? [];
      if (!Array.isArray(list)) {
        throw new TypeError('arena-sim: guards.units must be an array');
      }
      for (const raw of list as Json[]) {
        const u = raw as Record<string, Json>;
        const def = u['def'];
        if (typeof def !== 'string') {
          throw new TypeError('arena-sim: guard.def must be a string');
        }
        const common = {
          def,
          post: nonNegative(u['post'], 'guard.post'),
          ...(u['strengthPercent'] === undefined
            ? {}
            : {
                strengthPercent: nonNegative(
                  u['strengthPercent'],
                  'guard.strengthPercent',
                ),
              }),
        };
        if (u['px'] !== undefined || u['py'] !== undefined) {
          spawnGuardForTest(sim, ctx, {
            ...common,
            px: nonNegative(u['px'], 'guard.px'),
            py: nonNegative(u['py'], 'guard.py'),
          });
        } else {
          spawnGuardForTest(sim, ctx, {
            ...common,
            x: nonNegative(u['x'], 'guard.x'),
            y: nonNegative(u['y'], 'guard.y'),
          });
        }
      }
    }
    // Units placed after the guards and the starting holders of the points
    // (so they spawn with the holder's point bonus).
    spawnList(field(input, 'lateUnits'), 'lateUnits');
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
    const everyRaw = field(input, 'checkpointEvery');
    const every =
      everyRaw === undefined ? 0 : nonNegative(everyRaw, 'checkpointEvery');
    if (everyRaw !== undefined && every < 1) {
      throw new TypeError(
        'arena-sim: checkpointEvery must be a positive integer',
      );
    }
    const checkpoints: Json[] = [];
    for (let t = 0; t < ticks; t++) {
      if (restoreAt.has(t)) {
        sim = JSON.parse(JSON.stringify(sim)) as ArenaSim;
        ctx = createArenaContext(sim, content, simConfig, { events });
      }
      stepArena(sim, ctx);
      if (every > 0 && sim.tick % every === 0) {
        const sides = summarizeArena(sim) as Record<string, Json>[];
        checkpoints.push({
          tick: sim.tick,
          alive: sides.map((x) => x['alive'] as Json),
          coreHealth: sides.map((x) => x['coreHealth'] as Json),
          stateHash: hashJson(sim),
        });
      }
    }
    const result: Record<string, Json> = {
      tick: sim.tick,
      stateHash: hashJson(sim),
      events: events.length,
      sides: summarizeArena(sim),
    };
    if (sim.guards !== undefined) {
      result['guards'] = {
        alive: sim.units.filter((u) => u.side === 2).length,
        killed: [...sim.guards.killed],
      };
    }
    if (sim.points !== undefined) {
      result['points'] = sim.points.map((p) => ({
        id: p.id,
        controller: p.controller,
        progressSide: p.progressSide,
        progress: p.progress,
        held: [...p.held],
      }));
    }
    if (sim.guards !== undefined) {
      result['pointBonus'] = [0, 1].map((side) => pointStrengthBonus(sim, side));
      result['healed'] = [...sim.guards.healed];
    }
    if (field(input, 'report') === 'positions') {
      result['positions'] = sim.units.map((u) => [u.id, u.px, u.py]);
    }
    if (field(input, 'report') === 'stats') {
      result['stats'] = sim.units.map((u) => [u.id, u.hp, u.maxHp, u.damage]);
    }
    const eventLog = events as unknown as Json[];
    return every > 0 ? { result, eventLog, checkpoints } : { result, eventLog };
  };
}
