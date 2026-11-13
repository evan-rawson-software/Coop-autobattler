/** Shared types of the battle screen. */

import type { ComponentChildren } from 'preact';
import type { BattleInput, PveBattleInput } from '@game/core';

/**
 * What to play: a team-versus-team battle (a ghost or a boss board) or a PvE
 * battle against a generated threat. The simulation is run from this alone.
 */
export type BattleDescription =
  | { readonly kind: 'versus'; readonly input: BattleInput }
  | { readonly kind: 'pve'; readonly input: PveBattleInput };

export type OpponentKind = 'ghost' | 'boss' | 'pve';

/** Who the party fights, as shown on the screen. */
export interface OpponentInfo {
  /** e.g. the ghost's party name, or the threat's name. */
  readonly name: string;
  readonly kind: OpponentKind;
  /** A short kind label such as an archetype name; defaults per kind. */
  readonly label?: string;
}

export interface BattleViewProps {
  /**
   * What to play. The battle is simulated again whenever this object is
   * replaced by another one, so callers keep the same object while it is the
   * same battle (memoise it).
   */
  readonly battle: BattleDescription;
  /** Who is fought. May change at any time; the screen follows it. */
  readonly opponent: OpponentInfo;
  /** Top bar title, e.g. "Round 4 · PvP battle". */
  readonly title: string;
  /** The reward / cost line of the summary, from whether the party won. */
  readonly reward: (won: boolean) => string;
  /**
   * What the run state says happened. When set, the banner and the reward
   * come from `won`, never from the re-simulation, and the simulated event
   * log must hash to `eventLogHash` or the battle is not played (a panel
   * with the stored result is shown instead).
   */
  readonly stored?: {
    readonly won: boolean;
    readonly eventLogHash: string;
    /** The stored end reason of the battle, shown if it cannot be played. */
    readonly reason?: string;
  };
  /**
   * The Ready button of the summary. Returns whether Ready was accepted; when
   * it was not, the button is available again.
   */
  readonly onReady: () => Promise<boolean>;
  /**
   * Whether the viewing player is Ready, as the run holds it. When given it
   * decides how the Ready button reads, so it survives the screen being
   * mounted again (a reload) and follows the acting player.
   */
  readonly ready?: boolean;
  /**
   * Resume at this tick (the battle is re-simulated to it). Playback starts
   * revealed when above 0. Read once per battle, when `battle` is simulated:
   * changing it later does not move a battle that is already playing.
   */
  readonly initialTick?: number;
  /** Called about twice a second while playing, and when playback stops. */
  readonly onTick?: (tick: number) => void;
  /**
   * The acting player of a run (the top bar's switcher): "My base" centres on
   * this player's Core. Absent in sample battles: the first Core is used.
   */
  readonly acting?: number;
  /** Extra controls for the top bar (the sample picker). */
  readonly topBarExtra?: ComponentChildren;
}
