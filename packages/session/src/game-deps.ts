/**
 * `createGameDeps`: the fully wired `RunDeps` (W2-3): economy (W2-2), PvE
 * options, events, rewards and real battles. `createEconomyDeps` still
 * works and keeps the stub battle and the placeholder event hooks.
 */
import type {
  Content,
  EconomyConfig,
  EventsConfig,
  MapgenConfig,
  SimConfig,
  ThreatsConfig,
} from '@game/core';
import { createDeps } from './defaults.js';
import { economyHandlers, economyHooks } from './economy.js';
import {
  checkEventHandlers,
  defaultEventHandlers,
  eventChooseHandlers,
  eventHooks,
  type EventHandlers,
} from './events.js';
import { SELECT_GHOST, selectGhostHandler } from './ghosts.js';
import { pveOptionsHook } from './pve-options.js';
import { createBattleResolver, type FindPvpOpponent } from './real-battle.js';
import { rewardHooks } from './rewards.js';
import type {
  BattleResolver,
  GhostRules,
  IntentHandler,
  RunDeps,
  RunHooks,
  RunRules,
} from './types.js';

/** The configuration files a game needs besides `content`. */
export interface GameConfigs {
  readonly mapgen: MapgenConfig;
  readonly economy: EconomyConfig;
  readonly events: EventsConfig;
  readonly threats: ThreatsConfig;
  readonly sim: SimConfig;
}

export interface GameOverrides {
  readonly rules?: RunRules;
  /** Replace the real battle resolver (tests: `fixedBattle`). */
  readonly battle?: BattleResolver;
  readonly hooks?: Partial<RunHooks>;
  readonly handlers?: Readonly<Record<string, IntentHandler>>;
  /** Event type handlers; default `defaultEventHandlers`. */
  readonly eventHandlers?: EventHandlers;
  /** The ghost seam: return a team to fight in PvP, or null for a boss. */
  readonly findPvpOpponent?: FindPvpOpponent;
  /**
   * Switch the ghost pool on (W3-1): `select_ghost`, the snapshot and
   * selection effects and the ready gate before a PvP battle. Without it PvP
   * always fights the generated boss.
   */
  readonly ghosts?: Pick<GhostRules, 'ownerId'>;
}

/**
 * Economy, PvE options, events, rewards and real battles on top of
 * `createDeps`. Throws if an event definition names a type without a handler
 * or has params its handler rejects.
 */
export function createGameDeps(
  content: Content,
  configs: GameConfigs,
  overrides: GameOverrides = {},
): RunDeps {
  const eventHandlers = overrides.eventHandlers ?? defaultEventHandlers;
  const problems = checkEventHandlers(configs.events, eventHandlers);
  if (problems.length > 0) {
    throw new Error(`Invalid events setup:\n- ${problems.join('\n- ')}`);
  }
  const threatConfigs = { threats: configs.threats, mapgen: configs.mapgen };
  const battle = createBattleResolver({
    content,
    sim: configs.sim,
    mapgen: configs.mapgen,
    threats: configs.threats,
    ...(overrides.findPvpOpponent === undefined
      ? {}
      : { findPvpOpponent: overrides.findPvpOpponent }),
  });
  const deps = createDeps(content, configs.mapgen, {
    ...(overrides.rules === undefined ? {} : { rules: overrides.rules }),
    battle: overrides.battle ?? battle,
    hooks: {
      ...economyHooks(content, configs.economy),
      pveOptions: pveOptionsHook(
        content,
        threatConfigs,
        configs.economy.rewards,
      ),
      ...eventHooks(content, configs.events, eventHandlers),
      ...rewardHooks(configs.economy.rewards),
      ...overrides.hooks,
    },
    handlers: {
      ...economyHandlers(content, configs.economy),
      ...eventChooseHandlers(content, configs.events, eventHandlers),
      ...(overrides.ghosts === undefined
        ? {}
        : { [SELECT_GHOST]: selectGhostHandler }),
      ...overrides.handlers,
    },
  });
  return {
    ...deps,
    rewards: configs.economy.rewards,
    ...(overrides.ghosts === undefined
      ? {}
      : {
          ghosts: {
            ownerId: overrides.ghosts.ownerId,
            economy: configs.economy,
            events: configs.events,
          },
        }),
  };
}
