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
    case 'specialist_pick':
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

/**
 * The round the frame shows. The session counts a round up only when the
 * shop after the rival battle is left, so that shop (the Build that prepares
 * the next Stronghold) is shown as the next round. Display only: saved data,
 * history and everything sent to the session keep `state.round`.
 */
export function displayRound(
  state: Pick<RunState, 'round' | 'step' | 'leg'>,
): number {
  return state.step === 'shop' && state.leg === 'pvp'
    ? state.round + 1
    : state.round;
}

/** The steps of a displayed round, in order (the stepper's chips). */
export type StepId =
  | 'setup'
  | 'build1'
  | 'stronghold'
  | 'reward1'
  | 'build2'
  | 'rival'
  | 'reward2';

export const STEP_ORDER: readonly StepId[] = [
  'setup',
  'build1',
  'stronghold',
  'reward1',
  'build2',
  'rival',
  'reward2',
];

/** The phase kind a stepper step belongs to (for tips and descriptions). */
export function phaseOfStepId(id: StepId): PhaseId {
  switch (id) {
    case 'setup':
      return 'setup';
    case 'build1':
    case 'build2':
      return 'build';
    case 'stronghold':
    case 'rival':
      return 'fight';
    case 'reward1':
    case 'reward2':
      return 'reward';
  }
}

/**
 * Where the run is in the displayed round; null when there is no round (run
 * over). The Build before the Stronghold is the rival leg's shop of the
 * previous round (or the 'build' step in round 1).
 */
export function stepIdFor(
  state: Pick<RunState, 'step' | 'leg'>,
): StepId | null {
  switch (state.step) {
    case 'specialist_pick':
    case 'core_placement':
      return 'setup';
    case 'build':
      return 'build1';
    case 'shop':
      return state.leg === 'pvp' ? 'build1' : 'build2';
    case 'pve_choice':
    case 'pve_battle':
    case 'pve_summary':
      return 'stronghold';
    case 'pvp_battle':
    case 'pvp_summary':
      return 'rival';
    case 'event_choice':
    case 'event_resolve':
      return state.leg === 'pvp' ? 'reward2' : 'reward1';
    case 'run_over':
      return null;
  }
}

/** The steps the stepper lists: Set up only in round 1. */
export function stepperPhases(round: number): readonly StepId[] {
  return round <= 1 ? STEP_ORDER : STEP_ORDER.slice(1);
}

export type StepState = 'done' | 'current' | 'upcoming';

export interface StepperItem {
  readonly id: StepId;
  readonly state: StepState;
}

/** The stepper's steps, each finished, current or upcoming. */
export function stepperItems(
  round: number,
  current: StepId,
): readonly StepperItem[] {
  const at = STEP_ORDER.indexOf(current);
  return stepperPhases(round).map((id) => {
    const i = STEP_ORDER.indexOf(id);
    return { id, state: i < at ? 'done' : i === at ? 'current' : 'upcoming' };
  });
}

/**
 * The phase that Continue leads to from a battle result, or null when it
 * leads nowhere new (not a result, or the run ends). After either result
 * comes the event (Reward).
 */
export function nextPhaseAfterResult(
  step: Step,
  runEnds: boolean,
): PhaseId | null {
  if (step === 'pve_summary') return 'reward';
  if (step === 'pvp_summary') return runEnds ? null : 'reward';
  return null;
}

/** What the frame needs to know about the run's place in the round. */
export interface PhaseInfo {
  readonly phase: PhaseId;
  /** The stepper step the run is at. */
  readonly stepId: StepId;
  /** The displayed round (see `displayRound`). */
  readonly round: number;
  readonly leg: Leg;
  /** Set on a battle result screen. */
  readonly next: PhaseId | null;
  /** The player has placed a building (the Build tip then collapses). */
  readonly placed?: boolean;
}

/** Set by the run screen; absent outside a run (no stepper then). */
export const PhaseContext = createContext<PhaseInfo | null>(null);
