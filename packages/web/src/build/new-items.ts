/**
 * Which inventory items are new this round (the "NEW" badge, issue #301):
 * bought or won since the round began and not placed yet. Building ids are
 * never reused and only grow, so an item is new when its id is at least the
 * run's next id as first seen in this round. The first sight is when the run
 * enters the round's shop or build step (the session notes every state), so a
 * purchase made later has a higher id. Nothing is saved: a reload forgets it.
 */

import type { RunState } from '@game/session';

const roundStart = new Map<string, number>();

/** Remember the next id of `run` the first time its round is seen. */
export function noteRound(run: RunState): void {
  // Before the first build (Core placement) the starting kit is still coming.
  if (run.step !== 'shop' && run.step !== 'build') return;
  // A test double may carry no team.
  const next = (run.team as RunState['team'] | undefined)?.nextId;
  if (next === undefined) return;
  const key = `${run.runId}:${String(run.round)}`;
  if (!roundStart.has(key)) roundStart.set(key, next);
}

/** Ids of the stash items that arrived this round. */
export function newStashIds(run: RunState): ReadonlySet<number> {
  const from = roundStart.get(`${run.runId}:${String(run.round)}`);
  if (from === undefined) return new Set();
  return new Set(run.team.stash.filter((s) => s.id >= from).map((s) => s.id));
}

/** Forget everything (tests). */
export function resetNewItems(): void {
  roundStart.clear();
}
