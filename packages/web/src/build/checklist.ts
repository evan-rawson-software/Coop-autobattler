/**
 * The "Before you fight" checklist (issue #301): what is wrong with the
 * factory, each with a one-line fix, and below it what is right. It is
 * derived from the problems list (`deriveProblems`, unchanged) and from the
 * board state, so it never disagrees with the problems the smoke checks.
 * Pure.
 */

import type { TeamState } from '@game/core';
import type { WebContent } from '../content.js';
import { screenText, screenTexts, type ScreenTexts } from './texts.js';
import {
  buildingName,
  resourceName,
  type FlowView,
  type Problem,
  type ProblemKind,
} from './view-model.js';

/** `warn` is a mistake, `hint` a reminder (not an error), `ok` is fine. */
export type CheckState = 'warn' | 'hint' | 'ok';

export interface CheckItem {
  readonly id: string;
  readonly state: CheckState;
  /** The one-line statement: the problem, or the satisfied check. */
  readonly text: string;
  /** What to do about it; null for `ok` and where the text says it already. */
  readonly fix: string | null;
  /** The problem it comes from, to jump to it; null for `ok`. */
  readonly problem: Problem | null;
}

export interface Checklist {
  /** Warnings, then reminders, then the satisfied checks (at most `maxOk`). */
  readonly items: readonly CheckItem[];
  /** Satisfied checks that were left out to keep the list short. */
  readonly okHidden: number;
}

/** The fix line of each problem kind (null: the problem text says it). */
const FIX_KEY: Readonly<Record<ProblemKind, string | null>> = {
  missing_input: 'uiFixMissingInput',
  starved: 'uiFixStarved',
  under_supplied: 'uiFixUnderSupplied',
  lost_output: 'uiFixLostOutput',
  output_faces_edge: null,
  stalled_output: 'uiFixStalled',
  broken_link: 'uiFixBroken',
  stash: 'uiFixStash',
  free_nodes: null,
};

/** A reminder is not an error: something is unused, not broken. */
export function isReminder(p: Problem): boolean {
  return p.kind === 'stash' || p.kind === 'free_nodes';
}

export function deriveChecklist(
  team: TeamState,
  content: WebContent,
  problems: readonly Problem[],
  flow: FlowView | null,
  acting: number,
  maxOk = 4,
  texts: ScreenTexts = screenTexts,
): Checklist {
  const warnings: CheckItem[] = [];
  const reminders: CheckItem[] = [];
  for (const p of problems) {
    const key = FIX_KEY[p.kind];
    const item: CheckItem = {
      id: p.id,
      state: isReminder(p) ? 'hint' : 'warn',
      text: p.text,
      fix: key === null ? null : screenText(texts, key),
      problem: p,
    };
    (isReminder(p) ? reminders : warnings).push(item);
  }

  const ok: CheckItem[] = [];
  if (flow !== null) {
    for (const u of flow.supply) {
      if (u.state !== 'full') continue;
      const b = team.buildings.find((x) => x.id === u.building);
      if (b === undefined || b.owner !== acting) continue;
      const resources = [
        ...new Set(
          flow.dry.consumers
            .filter((c) => c.building === b.id && c.delivered > 0)
            .map((c) => resourceName(content, c.resource)),
        ),
      ];
      if (resources.length === 0) continue;
      ok.push({
        id: `getting:${String(b.id)}`,
        state: 'ok',
        text: screenText(texts, 'uiCheckGetting', {
          name: buildingName(content, b.def),
          resource: resources.join(' and '),
        }),
        fix: null,
        problem: null,
      });
    }
  }
  const mine = team.stash.filter((s) => s.owner === acting);
  if (mine.length === 0 && team.buildings.some((b) => b.owner === acting)) {
    ok.push({
      id: 'all-placed',
      state: 'ok',
      text: screenText(texts, 'uiCheckAllPlaced'),
      fix: null,
      problem: null,
    });
  }
  return {
    items: [...warnings, ...reminders, ...ok.slice(0, maxOk)],
    okHidden: Math.max(0, ok.length - maxOk),
  };
}
