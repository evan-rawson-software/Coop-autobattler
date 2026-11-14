/**
 * The real `BattleResolver` (W2-3, W3-1): PvE battles run `simulatePveBattle`
 * against the voted option's stored threat; PvP battles run against the ghost
 * stored in `state.pvpOpponent` (or the one `findPvpOpponent` returns), else
 * against a generated threat of type `boss` for the round.
 *
 * `BattleResult.detail` never holds the event log (it can be megabytes and
 * the save is rewritten after every action). It holds what is needed to
 * re-simulate exactly (`BattleDetail`) plus a small summary with the hash of
 * the event log. The party's team cannot change between the battle and the
 * summary step (the summary steps accept only ready, unready and abandon),
 * so the team in the run state is the team that fought; `teamHash` records
 * that and `replay` refuses if it ever differs.
 */
import {
  generateThreat,
  hashJson,
  startBattle,
  startPveBattle,
  type Battle,
  type BattleConfig,
  type BattleSummary,
  type Content,
  type MapgenConfig,
  type SimConfig,
  type TeamState,
  type ThreatConfigs,
  type ThreatInput,
  type ThreatProfile,
  type ThreatsConfig,
} from '@game/core';
import { readPveOption } from './pve-options.js';
import type {
  BattleInput,
  BattleResolver,
  BattleResult,
  Json,
  ReplayBattleResult,
  RunState,
} from './types.js';

/** A ghost opponent: a stored team to fight in a PvP battle. */
export interface PvpOpponent {
  readonly label: string;
  readonly team: TeamState;
}

/**
 * An override for the opponent. Return an opponent to fight a ghost, or null
 * to use the opponent stored in the run state (`state.pvpOpponent`, fixed by
 * `select_ghost`) or else a generated boss. Must be deterministic in its input
 * (it may use `input.rng`).
 */
export type FindPvpOpponent = (input: BattleInput) => PvpOpponent | null;

/** Where the opponent of a stored battle comes from. */
export type BattleSource =
  /** PvE: the threat is `pending.option.threat`. */
  | { readonly type: 'option' }
  /**
   * A generated threat. `threat` is the stored profile the battle is fought
   * (and replayed) against, so a later change to the threat content cannot
   * change a replay; `input` records how it was made.
   */
  | {
      readonly type: 'generated';
      readonly input: ThreatInput;
      readonly threat: ThreatProfile;
    }
  /** A ghost: its team is stored here. */
  | {
      readonly type: 'ghost';
      readonly label: string;
      readonly team: TeamState;
    };

export interface StoredBattleSummary {
  readonly winner: 0 | 1;
  readonly reason: string;
  readonly endTick: number;
  readonly events: number;
  /** `hashJson` of the whole event log. */
  readonly eventLogHash: string;
  /** Core health at the end, [party, opponent]. */
  readonly coreHealth: readonly [number, number];
  readonly coreMaxHealth: readonly [number, number];
}

/** `BattleResult.detail` of the real resolver (plain JSON). */
export interface BattleDetail {
  readonly version: 1;
  readonly kind: 'pve' | 'pvp';
  readonly round: number;
  /** The battle seed (the zone and the simulation derive from it). */
  readonly seed: number;
  readonly source: BattleSource;
  /** `hashJson` of the party's team state when the battle was fought. */
  readonly teamHash: string;
  readonly summary: StoredBattleSummary;
}

export interface BattleSetup {
  readonly content: Content;
  readonly sim: SimConfig;
  readonly mapgen: MapgenConfig;
  readonly threats: ThreatsConfig;
  /** Default: none (the stored `pvpOpponent` or else a boss). */
  readonly findPvpOpponent?: FindPvpOpponent;
}

function pendingRecord(s: RunState): Record<string, Json> {
  const p = s.pending;
  return typeof p === 'object' && p !== null && !Array.isArray(p)
    ? (p as Record<string, Json>)
    : {};
}

function summaryOf(
  summary: BattleSummary,
  result: { winner: 0 | 1; reason: string; endTick: number },
  eventLog: readonly unknown[],
): StoredBattleSummary {
  const [a, b] = summary.sides;
  return {
    winner: result.winner,
    reason: result.reason,
    endTick: result.endTick,
    events: eventLog.length,
    eventLogHash: hashJson(eventLog),
    coreHealth: [a.coreHealth, b.coreHealth],
    coreMaxHealth: [a.coreMaxHealth, b.coreMaxHealth],
  };
}

export function createBattleResolver(setup: BattleSetup): BattleResolver {
  const { content } = setup;
  const config: BattleConfig = { sim: setup.sim, mapgen: setup.mapgen };
  const threatConfigs: ThreatConfigs = {
    threats: setup.threats,
    mapgen: setup.mapgen,
  };

  /** Archetypes a boss may use: the boss-only ones, else all. */
  function bossArchetypes(): string[] {
    const boss = setup.threats.archetypes.filter((a) => a.bossOnly);
    const pool = boss.length > 0 ? boss : setup.threats.archetypes;
    return pool.map((a) => a.id);
  }

  function startFor(
    team: TeamState,
    source: BattleSource,
    seed: number,
    state: RunState,
  ): { battle: Battle; label: string } | { error: string } {
    if (source.type === 'ghost') {
      const started = startBattle(
        { teamA: team, teamB: source.team, seed },
        content,
        config,
      );
      return started.ok
        ? { battle: started.battle, label: source.label }
        : { error: started.error.message };
    }
    let threat;
    if (source.type === 'option') {
      const option = readPveOption(
        pendingRecord(state)['option'],
        state.players.length,
      );
      if (option === null) return { error: 'the PvE option is not stored' };
      threat = option.threat;
    } else {
      threat = source.threat;
    }
    const started = startPveBattle({ team, threat, seed }, content, config);
    return started.ok
      ? { battle: started.battle, label: threat.archetype }
      : { error: started.error.message };
  }

  return {
    resolve(input): BattleResult {
      const { kind, state, rng } = input;
      const seed = rng.nextU32();
      let source: BattleSource;
      if (kind === 'pve') {
        const option = readPveOption(input.option, state.players.length);
        if (option === null) {
          throw new Error('PvE battle: no stored option was voted for.');
        }
        source = { type: 'option' };
      } else {
        // The opponent fixed before the battle (W3-1) comes first; the
        // `findPvpOpponent` override is for tests and other front ends.
        const fixed = state.pvpOpponent;
        const ghost: PvpOpponent | null =
          setup.findPvpOpponent?.(input) ??
          (fixed !== null && fixed.round === state.round && fixed.ghost !== null
            ? { label: fixed.ghost.owner.label, team: fixed.ghost.team }
            : null);
        if (ghost !== null) {
          source = { type: 'ghost', label: ghost.label, team: ghost.team };
        } else {
          const threatInput: ThreatInput = {
            seed: rng.child('threat').nextU32(),
            round: state.round,
            type: 'boss',
            partySize: state.players.length,
            archetype: rng.child('archetype').pick(bossArchetypes()),
          };
          source = {
            type: 'generated',
            input: threatInput,
            threat: generateThreat(threatInput, content, threatConfigs),
          };
        }
      }
      const started = startFor(state.team, source, seed, state);
      if ('error' in started) {
        throw new Error(`Battle could not start: ${started.error}`);
      }
      const { battle } = started;
      while (!battle.isOver()) battle.step();
      const result = battle.result();
      if (result === null) throw new Error('Battle ended without a result.');
      const detail: BattleDetail = {
        version: 1,
        kind,
        round: state.round,
        seed,
        source,
        teamHash: hashJson(state.team),
        summary: summaryOf(battle.summary(), result, battle.eventLog),
      };
      return {
        won: result.winner === 0,
        opponent: {
          kind:
            kind === 'pve' ? 'pve' : source.type === 'ghost' ? 'ghost' : 'boss',
          label: started.label,
        },
        detail: detail as unknown as Json,
      };
    },

    replay(state): ReplayBattleResult {
      const battleJson = pendingRecord(state)['battle'];
      const detail =
        typeof battleJson === 'object' &&
        battleJson !== null &&
        !Array.isArray(battleJson)
          ? ((battleJson as Record<string, Json>)['detail'] as unknown as
              BattleDetail | undefined)
          : undefined;
      if (detail === undefined || (detail.version as number) !== 1) {
        return { ok: false, reason: 'no_stored_battle' };
      }
      if (hashJson(state.team) !== detail.teamHash) {
        return { ok: false, reason: 'team_changed' };
      }
      const started = startFor(state.team, detail.source, detail.seed, state);
      if ('error' in started) return { ok: false, reason: started.error };
      return {
        ok: true,
        battle: started.battle,
        stored: detail.summary as unknown as Json,
        storedEventLogHash: detail.summary.eventLogHash,
      };
    },
  };
}
