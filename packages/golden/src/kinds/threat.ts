/**
 * Golden-vector kinds `threat-gen` and `pve-battle` (W1-9).
 *
 * `threat-gen`: input `{ seed, round, type, partySize, archetype }`; result
 * `{ profile, hash }` with `hash = hashJson(profile)`.
 *
 * `pve-battle`: input `{ team, threat, seed, coreHealths?, partyCoreHealthPercent? }` where `team` is a
 * `team-state-ops` script and `threat` is a `threat-gen` input. The optional
 * `coreHealths` (test only) replaces the generated starting health of the
 * stronghold's Cores by player index, so a scenario can make a Core fall in
 * one hit; the optional `partyCoreHealthPercent` (test only) gives the party's
 * Cores that many percent more health. Result on
 * success: `{ ok: true, result, summary (no timeline), threatHash, zone,
 * stateHash, events }`; the event log is the vector's event log. On a refused
 * battle `{ ok: false, error: { code, message } }`.
 */
import {
  generateThreat,
  hashJson,
  pickBoss,
  Rng,
  runTeamStateOps,
  startPveBattle,
  type ArchetypeDef,
  type ArenaContent,
  type Json,
  type MapgenConfig,
  type SimConfig,
  type TeamState,
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
    const scripted = runTeamStateOps(script, content, mapgen).state;
    // Test-only: `partyCoreHealthPercent` gives the party's Cores that many
    // percent more health (as a run modifier would), so a battle can reach the
    // time limit instead of ending with the Overload decay.
    const bonus = o['partyCoreHealthPercent'];
    if (
      bonus !== undefined &&
      (typeof bonus !== 'number' || !Number.isInteger(bonus) || bonus < 1)
    ) {
      throw new TypeError(
        'pve-battle: partyCoreHealthPercent must be a positive integer',
      );
    }
    const team: TeamState =
      typeof bonus === 'number'
        ? {
            ...scripted,
            modifiers: [
              {
                id: 'mod_golden_core_health',
                effects: Array.from(
                  { length: Math.ceil(bonus / 1000) },
                  (_, i) => ({
                    kind: 'core_health_percent' as const,
                    percent: Math.min(1000, bonus - i * 1000),
                  }),
                ),
              },
            ],
          }
        : scripted;
    const generated = generateThreat(threatInput(o['threat']), content, {
      threats,
      mapgen,
    });
    // Test-only override: `coreHealths` replaces the generated starting health
    // of the stronghold Cores (by player index; fewer entries keep the rest).
    const override = o['coreHealths'];
    let threat = generated;
    if (override !== undefined) {
      if (
        !Array.isArray(override) ||
        override.some((h) => typeof h !== 'number' || !Number.isInteger(h) || h < 1)
      ) {
        throw new TypeError(
          'pve-battle: coreHealths must be a list of positive integers',
        );
      }
      threat = {
        ...generated,
        stronghold: {
          ...generated.stronghold,
          cores: generated.stronghold.cores.map((c, p) => ({
            ...c,
            health: (override[p] as number | undefined) ?? c.health,
          })),
          ...(generated.stronghold.sharedHealth === undefined
            ? {}
            : {
                sharedHealth: generated.stronghold.cores.reduce(
                  (a, c, p) => a + ((override[p] as number | undefined) ?? c.health),
                  0,
                ),
              }),
        },
      };
    }
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

/**
 * `boss-pick`: input `{ seed, round, partySize, previousBoss?, archetypes? }`.
 * `rng = Rng.fromSeed(seed).child("boss")`; the result is `{ boss }` from
 * `pickBoss`. `archetypes` (a test list of `{id, bossOnly?, fromRound?,
 * minPartySize?}`, `bossOnly` default true) replaces the shipped archetypes
 * (each takes the waves and stronghold of the first shipped archetype).
 */
export function makeBossPickKind(threats: ThreatsConfig): SimulationFn {
  return (input: Json) => {
    const o = obj(input, 'input');
    const { seed, round, partySize, previousBoss, archetypes } = o;
    if (
      typeof seed !== 'number' ||
      typeof round !== 'number' ||
      typeof partySize !== 'number' ||
      (previousBoss !== undefined && typeof previousBoss !== 'string')
    ) {
      throw new TypeError('boss-pick: seed, round and partySize are required');
    }
    let config = threats;
    if (archetypes !== undefined) {
      if (!Array.isArray(archetypes)) {
        throw new TypeError('boss-pick: archetypes must be an array');
      }
      const template = threats.archetypes[0] as ArchetypeDef;
      config = {
        ...threats,
        archetypes: (archetypes as Json[]).map((e): ArchetypeDef => {
          const a = obj(e, 'archetype');
          const id = a['id'];
          if (typeof id !== 'string') throw new TypeError('archetype: id');
          const bossOnly = a['bossOnly'] !== false;
          const from = a['fromRound'];
          const min = a['minPartySize'];
          return {
            ...template,
            id,
            bossOnly,
            ...(bossOnly
              ? {
                  fromRound: typeof from === 'number' ? from : 1,
                  minPartySize: typeof min === 'number' ? min : 1,
                }
              : {}),
          };
        }),
      };
    }
    const boss = pickBoss(
      {
        round,
        partySize,
        ...(previousBoss === undefined ? {} : { previousBoss }),
      },
      config,
      Rng.fromSeed(seed).child('boss'),
    );
    return { result: { boss } };
  };
}
