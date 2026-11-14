/**
 * Progress of the guided tutorial (issue #309), per run. A small web-side
 * record in `localStorage` keyed by run id; it is not part of the run state or
 * the saves. Which step the player is on is derived from the run itself
 * (`steps.ts`), so this holds only what the run cannot know: that the player
 * skipped the tips, skipped the Turret step, or finished the tutorial.
 * Without usable storage the record lives in memory for the page's lifetime.
 */
import { createStore } from '../app-state.js';
import { DEFAULT_PREFIX } from '../run/local-storage-store.js';

export const TUTORIAL_PROGRESS_KEY = `${DEFAULT_PREFIX}tutorial-progress`;
export const TUTORIAL_DONE_KEY = `${DEFAULT_PREFIX}tutorial-completed`;
const MAX_KEPT = 50;

export interface TutorialProgress {
  /** "Skip" was confirmed: no more tips for this run. */
  readonly skipped?: true;
  /** "Skip this step" on the Turret step. */
  readonly turretSkipped?: true;
  /** The closing tip was shown and dismissed (or the run moved past it). */
  readonly finished?: true;
}

type Record_ = Readonly<Record<string, TutorialProgress>>;

function read(): Record_ {
  try {
    const raw = window.localStorage.getItem(TUTORIAL_PROGRESS_KEY);
    if (raw === null) return {};
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
    const out: Record<string, TutorialProgress> = {};
    for (const [id, p] of Object.entries(v)) {
      if (typeof p !== 'object' || p === null) continue;
      const q = p as Record<string, unknown>;
      out[id] = {
        ...(q['skipped'] === true ? { skipped: true as const } : {}),
        ...(q['turretSkipped'] === true
          ? { turretSkipped: true as const }
          : {}),
        ...(q['finished'] === true ? { finished: true as const } : {}),
      };
    }
    return out;
  } catch {
    return {};
  }
}

function write(all: Record_): void {
  try {
    window.localStorage.setItem(TUTORIAL_PROGRESS_KEY, JSON.stringify(all));
  } catch {
    // Storage is unavailable: the progress stays for this page only.
  }
}

/** Progress of every run. Reads storage once, at load. */
export const tutorialStore = createStore<Record_>(read());

const NONE: TutorialProgress = {};

export function progressOf(all: Record_, runId: string): TutorialProgress {
  return all[runId] ?? NONE;
}

function update(runId: string, patch: TutorialProgress): void {
  const now = tutorialStore.get();
  const merged = { ...progressOf(now, runId), ...patch };
  const ids = Object.keys(now).filter((id) => id !== runId);
  ids.push(runId);
  const next: Record<string, TutorialProgress> = {};
  for (const id of ids.slice(-MAX_KEPT)) {
    next[id] = id === runId ? merged : (now[id] as TutorialProgress);
  }
  tutorialStore.set(next);
  write(next);
}

/** Skip was confirmed: hide all tips for this run. */
export function skipTutorial(runId: string): void {
  update(runId, { skipped: true });
}

export function skipTurretStep(runId: string): void {
  update(runId, { turretSkipped: true });
}

/** The tutorial is over for this run, and counts as completed for the menu. */
export function finishTutorial(runId: string): void {
  if (progressOf(tutorialStore.get(), runId).finished === true) return;
  update(runId, { finished: true });
  try {
    window.localStorage.setItem(TUTORIAL_DONE_KEY, '1');
  } catch {
    // Not remembered across visits; the menu keeps its Play the tutorial.
  }
  completedStore.set(true);
}

function readDone(): boolean {
  try {
    return window.localStorage.getItem(TUTORIAL_DONE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Has the player ever finished the tutorial? Drives the main menu. */
export const completedStore = createStore<boolean>(readDone());

export function hasCompletedTutorial(): boolean {
  return completedStore.get();
}
