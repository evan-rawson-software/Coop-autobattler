/**
 * What the screens know about the tutorial of the run in front of them
 * (issue #309). The run screen derives it once from the run state and
 * provides it; the frame shows the coach card and checklist from it, and the
 * Build screen reads it to lock slots, lock Ready and draw the highlights.
 * There is no context outside a tutorial run, or once it was skipped or done.
 */
import { createContext } from 'preact';
import { useContext, useEffect, useMemo } from 'preact/hooks';
import type { RunState } from '@game/session';
import { useStore } from '../app-state.js';
import { computeFlowView } from '../build/view-model.js';
import { simConfig } from '../build/setup.js';
import { content } from '../content.js';
import {
  allowedDefs,
  powerNearCore,
  stepsDone,
  tutorialDefs,
  tutorialFacts,
  tutorialPosition,
  type StepNo,
  type TutorialDefs,
  type TutorialFacts,
  type TutorialInput,
  type TutorialPosition,
} from './steps.js';
import { isTutorialRun } from './tutorial-flag.js';
import { finishTutorial, progressOf, tutorialStore } from './tutorial-store.js';

export interface TutorialInfo {
  readonly runId: string;
  /** Position with the battle still playing (the frame refines it). */
  readonly input: Omit<TutorialInput, 'battleDone'>;
  readonly facts: TutorialFacts;
  readonly defs: TutorialDefs;
  readonly powerNear: boolean;
}

export const TutorialContext = createContext<TutorialInfo | null>(null);

/** The position, given whether the battle playback has ended. */
export function positionOf(
  info: TutorialInfo,
  battleDone: boolean,
): TutorialPosition {
  return tutorialPosition({ ...info.input, battleDone });
}

/**
 * The control the frame should ring (`data-tut-target`, styled in
 * `tutorial.css`); inventory slots are marked by the Build screen itself.
 */
export function targetOf(
  info: TutorialInfo,
  framePhase: string,
): string | null {
  const pos = positionOf(info, framePhase === 'result');
  if (pos.kind !== 'step') return null;
  switch (pos.n) {
    case 3:
      return info.facts.barracksPlaced ? 'conduit' : null;
    case 4:
      return 'paths';
    case 5:
      return info.input.run.step === 'pve_choice' ? 'fight' : 'ready';
    case 6:
      return 'speed';
    default:
      return null;
  }
}

export function doneOf(
  info: TutorialInfo,
  battleDone: boolean,
): readonly boolean[] {
  return stepsDone({ ...info.input, battleDone });
}

/** The tutorial as the Build screen sees it. */
export interface BuildTutorial {
  readonly info: TutorialInfo;
  readonly n: StepNo | null;
  /** Ready is locked until step 5. */
  readonly readyLocked: boolean;
  /** Inventory defs usable now; null means all. */
  readonly allowed: ReadonlySet<string> | null;
}

export function useBuildTutorial(): BuildTutorial | null {
  const info = useContext(TutorialContext);
  if (info === null) return null;
  const pos = positionOf(info, false);
  const n = pos.kind === 'step' ? pos.n : null;
  return {
    info,
    n,
    readyLocked: n !== null && n < 5,
    allowed: allowedDefs(n, info.defs),
  };
}

/**
 * Derive the tutorial for the run on screen; null when this run has none
 * (not started as the tutorial, skipped, or finished). Also closes the
 * tutorial once the run has moved past its last step.
 */
export function useTutorialInfo(
  runId: string,
  state: RunState,
  player: number,
): TutorialInfo | null {
  const all = useStore(tutorialStore);
  const progress = progressOf(all, runId);
  const marked = useMemo(() => isTutorialRun(runId), [runId]);
  const active =
    marked && progress.skipped !== true && progress.finished !== true;
  const turretSkipped = progress.turretSkipped === true;

  const watching =
    active &&
    (state.step === 'build' ||
      state.step === 'shop' ||
      state.step === 'pve_choice' ||
      state.step === 'pve_summary');
  const team = state.team;
  const defs = useMemo(() => tutorialDefs(content), []);
  // The dry run is only needed to know whether the Barracks gets its Ore.
  const flow = useMemo(() => {
    if (!watching) return null;
    const hasBarracks = team.buildings.some(
      (b) => b.owner === player && b.def === defs.barracks,
    );
    if (!hasBarracks) return null;
    return computeFlowView(team, content, simConfig, 600);
  }, [watching, team, player, defs]);
  const facts = useMemo(
    () => tutorialFacts(team, content, player, flow),
    [team, player, flow],
  );
  const powerNear = useMemo(
    () => powerNearCore(team, content, player),
    [team, player],
  );

  const input = useMemo(
    () => ({ run: state, facts, turretSkipped }),
    [state, facts, turretSkipped],
  );
  const off =
    active && tutorialPosition({ ...input, battleDone: false }).kind === 'off';
  // Past the battle (the reward step and on) the tutorial is over.
  useEffect(() => {
    if (off) finishTutorial(runId);
  }, [off, runId]);

  return useMemo(
    () => (active && !off ? { runId, input, facts, defs, powerNear } : null),
    [active, off, runId, input, facts, defs, powerNear],
  );
}
