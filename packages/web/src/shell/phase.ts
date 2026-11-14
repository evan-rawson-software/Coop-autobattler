/**
 * The phases of a round, for the stepper in the top bar and the first-visit
 * tips (issue #300). Pure: maps a run step to one of four phases. The run
 * state does not know about phases; this is only how the screens name them.
 */
import { createContext } from 'preact';
import type { RunState, Step } from '@game/session';

type Leg = RunState['leg'];

export type PhaseId = 'setup' | 'build' | 'fight' | 'reward';

export const PHASE_ORDER: readonly PhaseId[] = [
  'setup',
  'build',
  'fight',
  'reward',
];

/** The phase a step belongs to; null where there is none (run over). */
export function phaseForStep(step: Step): PhaseId | null {
  switch (step) {
    case 'core_placement':
      return 'setup';
    case 'build':
    case 'shop':
      return 'build';
    case 'pve_choice':
    case 'pve_battle':
    case 'pve_summary':
    case 'pvp_battle':
    case 'pvp_summary':
      return 'fight';
    case 'event_choice':
    case 'event_resolve':
      return 'reward';
    case 'run_over':
      return null;
  }
}

/** The phases the stepper lists: Set up only in round 1. */
export function stepperPhases(round: number): readonly PhaseId[] {
  return round <= 1 ? PHASE_ORDER : PHASE_ORDER.slice(1);
}

export type StepState = 'done' | 'current' | 'upcoming';

export interface StepperItem {
  readonly id: PhaseId;
  readonly state: StepState;
}

/** The stepper's steps, each finished, current or upcoming. */
export function stepperItems(
  round: number,
  current: PhaseId,
): readonly StepperItem[] {
  const at = PHASE_ORDER.indexOf(current);
  return stepperPhases(round).map((id) => {
    const i = PHASE_ORDER.indexOf(id);
    return { id, state: i < at ? 'done' : i === at ? 'current' : 'upcoming' };
  });
}

/** Each round has two battles: the Stronghold (1), then a rival party (2). */
export function battleNumber(leg: Leg): 1 | 2 {
  return leg === 'pvp' ? 2 : 1;
}

/**
 * The phase that Continue leads to from a battle result, or null when it
 * leads nowhere new (not a result, or the run ends). After the Stronghold
 * result comes the event (Reward); after the rival party result the next
 * round's Build.
 */
export function nextPhaseAfterResult(
  step: Step,
  runEnds: boolean,
): PhaseId | null {
  if (step === 'pve_summary') return 'reward';
  if (step === 'pvp_summary') return runEnds ? null : 'build';
  return null;
}

/** What the frame needs to know about the run's place in the round. */
export interface PhaseInfo {
  readonly phase: PhaseId;
  readonly round: number;
  readonly leg: Leg;
  /** Set on a battle result screen. */
  readonly next: PhaseId | null;
}

/** Set by the run screen; absent outside a run (no stepper then). */
export const PhaseContext = createContext<PhaseInfo | null>(null);
