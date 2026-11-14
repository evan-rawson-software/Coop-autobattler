/**
 * Default rules, stub battle and no-op hooks. Each of these is a seam that a
 * later issue replaces; the comments say which.
 */
import type { Content, MapgenConfig } from '@game/core';
import type {
  BattleResolver,
  IntentHandler,
  RunDeps,
  RunHooks,
  RunRules,
} from './types.js';

/** Starting lives 5 (RS-7), a PvP loss costs one life (RS-5). */
export const defaultRunRules: RunRules = {
  startingLives: 5,
  pvpLossLifeCost: 1,
};

/**
 * STUB. Replaced by the real battle simulation (the simulation work).
 *
 * Deterministic: the party wins when a roll in 0..99 from the supplied stream
 * is below `30 + 10 * placedBuildings`, capped at 90. PvE opponents are
 * labelled `pve`, PvP opponents `ghost`; it never produces a boss.
 */
export const stubBattle: BattleResolver = {
  resolve({ kind, state, rng }) {
    const buildings = state.team.buildings.length;
    const threshold = Math.min(90, 30 + 10 * buildings);
    const roll = rng.nextInt(100);
    return {
      won: roll < threshold,
      opponent:
        kind === 'pve'
          ? { kind: 'pve', label: 'Stub raiders' }
          : { kind: 'ghost', label: 'Stub ghost' },
      detail: { stub: true, roll, threshold, buildings },
    };
  },
};

/** A resolver that always gives the same answer; handy in tests. */
export function fixedBattle(won: boolean): BattleResolver {
  return {
    resolve({ kind, rng }) {
      rng.nextU32();
      return {
        won,
        opponent:
          kind === 'pve'
            ? { kind: 'pve', label: 'Fixed raiders' }
            : { kind: 'ghost', label: 'Fixed ghost' },
        detail: { stub: true },
      };
    },
  };
}

/**
 * No-op / placeholder hooks. Each one names the issue that replaces it.
 */
export const defaultHooks: RunHooks = {
  /** Replaced by W2-2: add the starting buildings and gold. */
  startingKit: () => ({}),
  /** Replaced by W2-3: PvE options with archetype and reward. */
  pveOptions: () => [{ id: 'easy' }, { id: 'medium' }, { id: 'hard' }],
  /** Replaced by W2-3: three drawn event offers. */
  eventOffers: () => [
    { id: 'stub_event_a' },
    { id: 'stub_event_b' },
    { id: 'stub_event_c' },
  ],
  /** Replaced by W2-3: apply the event and say whether it needs a follow-up. */
  resolveEvent: () => ({ patch: {}, followUp: null }),
  /** Replaced by W2-2: roll shop offers, pay base income. */
  onShopEnter: () => ({}),
  /** Replaced by W2-3: gold for wins, consolation gold. */
  rewards: () => ({}),
};

/** Build a `RunDeps` from content, with stub defaults and optional overrides. */
export function createDeps(
  content: Content,
  mapgenConfig: MapgenConfig,
  overrides: {
    readonly rules?: RunRules;
    readonly battle?: BattleResolver;
    readonly hooks?: Partial<RunHooks>;
    readonly handlers?: Readonly<Record<string, IntentHandler>>;
  } = {},
): RunDeps {
  return {
    content,
    mapgenConfig,
    rules: overrides.rules ?? defaultRunRules,
    battle: overrides.battle ?? stubBattle,
    hooks: { ...defaultHooks, ...overrides.hooks },
    handlers: overrides.handlers ?? {},
  };
}
