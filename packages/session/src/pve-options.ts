/**
 * PvE difficulty options (W2-3, RS-3, RS-3b, RS-6a).
 *
 * For each round three options (easy, medium, hard) are generated with the
 * threat generator and stored in the run state before the shop that leads up
 * to the battle. Each option is plain JSON:
 *
 *   { id, difficulty, archetype, reward: { gold }, budget, summary, threat }
 *
 * `threat` is the whole `ThreatProfile` of the battle (the stored outcome of
 * the draw); `summary` is `threatSummary(threat)` for the choice screen.
 *
 * RNG: the hook gets the stream `pve_options:r<round>`. The archetype pick
 * uses `rng.child('archetypes').nextU32()` as its seed; each difficulty's
 * threat uses `rng.child(<difficulty>).nextU32()`.
 */
import {
  generateThreat,
  pickArchetypes,
  threatSummary,
  type Content,
  type RewardsConfig,
  type ThreatConfigs,
  type ThreatProfile,
  type ThreatSummary,
} from '@game/core';
import type { Json, RunHooks } from './types.js';

export const PVE_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type PveDifficulty = (typeof PVE_DIFFICULTIES)[number];

export interface PveOption {
  readonly id: PveDifficulty;
  readonly difficulty: PveDifficulty;
  readonly archetype: string;
  readonly reward: { readonly gold: number };
  /** The threat's budget (harder options have strictly larger budgets). */
  readonly budget: number;
  readonly summary: ThreatSummary;
  readonly threat: ThreatProfile;
}

/** What the choice screen needs: an option without the full threat. */
export type PveOptionView = Omit<PveOption, 'threat'>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Read a stored option; null if it is not one of ours. `partySize` is the
 * number of players in the run: the threat's stronghold must have one Core
 * per player, or a tampered option would throw later when the battle is built.
 */
export function readPveOption(v: unknown, partySize: number): PveOption | null {
  if (!isRecord(v)) return null;
  const id = v['id'];
  if (!(PVE_DIFFICULTIES as readonly unknown[]).includes(id)) return null;
  const threat = v['threat'];
  if (!isRecord(threat) || !isRecord(v['summary'])) return null;
  const stronghold = threat['stronghold'];
  if (!isRecord(stronghold)) return null;
  const cores = stronghold['cores'];
  if (!Array.isArray(cores) || cores.length !== partySize) return null;
  const reward = v['reward'];
  if (!isRecord(reward) || typeof reward['gold'] !== 'number') return null;
  return v as unknown as PveOption;
}

export function pveOptionView(option: PveOption): PveOptionView {
  return {
    id: option.id,
    difficulty: option.difficulty,
    archetype: option.archetype,
    reward: option.reward,
    budget: option.budget,
    summary: option.summary,
  };
}

/** The `pveOptions` hook for the given content, threat configuration and rewards. */
export function pveOptionsHook(
  content: Pick<Content, 'units' | 'buildings'>,
  configs: ThreatConfigs,
  rewards: RewardsConfig,
): RunHooks['pveOptions'] {
  return (state, rng, round): readonly Json[] => {
    const partySize = state.players.length;
    const pick = pickArchetypes(
      rng.child('archetypes').nextU32(),
      round,
      configs.threats,
    );
    return PVE_DIFFICULTIES.map((difficulty): Json => {
      const archetype = pick[difficulty];
      const threat = generateThreat(
        {
          seed: rng.child(difficulty).nextU32(),
          round,
          type: difficulty,
          partySize,
          archetype,
        },
        content,
        configs,
      );
      const option: PveOption = {
        id: difficulty,
        difficulty,
        archetype,
        reward: { gold: rewards.pveWin[difficulty] },
        budget: threat.budget,
        summary: threatSummary(threat, content),
        threat,
      };
      return option as unknown as Json;
    });
  };
}
