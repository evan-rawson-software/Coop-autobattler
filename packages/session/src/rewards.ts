/**
 * Battle rewards (W2-3, EC-6, EC-7): gold only, paid to every player when the
 * battle's summary step ends.
 *
 * - PvE win: the stored reward of the option the party chose (more for
 *   harder options). PvE loss: nothing, and no life is lost (RS-3a).
 * - PvP win: `rewards.pvpWin`. PvP loss: the consolation `rewards.pvpLoss`
 *   (the life cost is the machine's rule, `RunRules.pvpLossLifeCost`).
 *
 * Amounts live in content/economy.json (`rewards`). Rewards never add
 * buildings (RS-6).
 */
import type { RewardsConfig } from '@game/core';
import { readPveOption } from './pve-options.js';
import type { PlayerRunState, RunHooks, RunState } from './types.js';

/** Gold each player gets for `won` in a `kind` battle of this state. */
export function rewardGold(
  state: RunState,
  kind: 'pve' | 'pvp',
  won: boolean,
  rewards: RewardsConfig,
): number {
  if (kind === 'pve') {
    if (!won) return 0;
    const pending = state.pending;
    const option =
      typeof pending === 'object' && pending !== null && !Array.isArray(pending)
        ? readPveOption((pending as Record<string, unknown>)['option'])
        : null;
    return option === null ? 0 : option.reward.gold;
  }
  return won ? rewards.pvpWin : rewards.pvpLoss;
}

/** The `rewards` hook. */
export function rewardHooks(rewards: RewardsConfig): Pick<RunHooks, 'rewards'> {
  return {
    rewards(state, battle) {
      const gold = rewardGold(state, battle.kind, battle.won, rewards);
      if (gold === 0) return {};
      return {
        perPlayer: state.perPlayer.map((p): PlayerRunState => ({
          ...p,
          gold: p.gold + gold,
        })),
      };
    },
  };
}
