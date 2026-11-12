/**
 * PvE battles (W1-9): the party (side 0) against a scripted threat (side 1).
 * Built on `startBattle`: the threat's stronghold becomes side 1's team state
 * and the waves, free turret power, strength and Core health reach the arena
 * through the general side options. See docs/rules-reference.md, "PvE
 * threats".
 */

import type { ArenaContent } from './arena.js';
import type { SideOptions } from './arena-sim.js';
import {
  startBattle,
  type Battle,
  type BattleConfig,
  type BattleError,
  type BattleResult,
  type BattleSummary,
} from './battle.js';
import type { ArenaEvent } from './arena-sim.js';
import type { NeutralZone } from './neutral-zone.js';
import { buildStronghold, type ThreatProfile } from './threat-gen.js';
import type { TeamState } from './team-state.js';

export interface PveBattleInput {
  /** Side 0, the party. */
  readonly team: TeamState;
  readonly threat: ThreatProfile;
  readonly seed: number;
}

export interface PveBattle extends Battle {
  /** The threat the battle was started with. */
  readonly threat: ThreatProfile;
}

export type StartPveBattleResult =
  | { readonly ok: true; readonly battle: PveBattle }
  | { readonly ok: false; readonly error: BattleError };

export type SimulatePveBattleResult =
  | {
      readonly ok: true;
      readonly result: BattleResult;
      readonly summary: BattleSummary;
      readonly eventLog: readonly ArenaEvent[];
      readonly zone: NeutralZone;
      readonly threat: ThreatProfile;
    }
  | { readonly ok: false; readonly error: BattleError };

/** The side options of a threat (side 1): see "Side options". */
export function threatSideOptions(threat: ThreatProfile): SideOptions {
  return {
    scheduledWaves: threat.waves.map((w) => ({
      tick: w.tick,
      unit: w.unit,
      count: w.count,
    })),
    freePower: true,
    unitStrengthPercent: threat.unitStrengthPercent,
    coreHealths: [threat.stronghold.coreHealth],
  };
}

/**
 * Set a PvE battle up at tick 0. The stronghold is built with
 * `buildStronghold` (throws if the profile cannot be built); the checks of
 * `startBattle` follow (a party size that differs from the threat's gives
 * `party_size_mismatch`).
 */
export function startPveBattle(
  input: PveBattleInput,
  content: ArenaContent,
  config: BattleConfig,
): StartPveBattleResult {
  const { team, threat, seed } = input;
  const stronghold = buildStronghold(threat, content, config.mapgen);
  const started = startBattle(
    {
      teamA: team,
      teamB: stronghold,
      seed,
      sideOptions: [null, threatSideOptions(threat)],
    },
    content,
    config,
  );
  if (!started.ok) return started;
  return { ok: true, battle: { ...started.battle, threat } };
}

/** Run a PvE battle to its end. Same shape as `simulateBattle`, plus `threat`. */
export function simulatePveBattle(
  input: PveBattleInput,
  content: ArenaContent,
  config: BattleConfig,
): SimulatePveBattleResult {
  const started = startPveBattle(input, content, config);
  if (!started.ok) return started;
  const { battle } = started;
  while (!battle.isOver()) battle.step();
  const result = battle.result();
  if (result === null) throw new Error('PveBattle: ended without a result.');
  return {
    ok: true,
    result,
    summary: battle.summary(),
    eventLog: battle.eventLog,
    zone: battle.zone,
    threat: input.threat,
  };
}
