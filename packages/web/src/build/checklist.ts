/**
 * The "Before you fight" checklist (issue #301): what is wrong with the
 * factory, each with a one-line fix, and below it what is right. It is
 * derived from the problems list (`deriveProblems`, unchanged) and from the
 * board state, so it never disagrees with the problems the smoke checks.
 * Pure.
 */

import type { TeamState } from '@game/core';
import type { WebContent } from '../content.js';
import { plural } from '../plural.js';
import { screenText, screenTexts, type ScreenTexts } from './texts.js';
import {
  buildingName,
  resourceName,
  type FlowView,
  type Problem,
  type ProblemKind,
} from './view-model.js';

/** `warn` is a mistake, `hint` a reminder (not an error), `info` a
 * neutral note (partly fed, still works), `ok` is fine. */
export type CheckState = 'warn' | 'hint' | 'info' | 'ok';

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
  /** Warnings, then reminders, then notes, then the satisfied checks (at most `maxOk`). */
  readonly items: readonly CheckItem[];
  /** Satisfied checks that were left out to keep the list short. */
  readonly okHidden: number;
}

/** "Extractor (Ore)" becomes "Extractors (Ore)": the noun takes the s. */
function pluralName(n: number, name: string): string {
  const m = /^(.*?)( \(.*\))$/.exec(name);
  return m === null
    ? plural(n, name)
    : `${plural(n, m[1] as string)}${m[2] as string}`;
}

/** The fix line of each problem kind (null: the problem text says it). */
const FIX_KEY: Readonly<Record<ProblemKind, string | null>> = {
  missing_input: 'uiFixMissingInput',
  starved: 'uiFixStarved',
  under_supplied: null,
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

/** Partly fed is information, not a mistake: the building still works. */
export function isInfo(p: Problem): boolean {
  return p.kind === 'under_supplied';
}

/** Only these stop something working; they alone are warnings. */
export function isWarning(p: Problem): boolean {
  return !isReminder(p) && !isInfo(p);
}

/** Does the building have an input with no conduit into it? */
export function unpowered(
  problems: readonly Problem[],
  building: number,
): boolean {
  return problems.some(
    (p) => p.kind === 'missing_input' && p.building === building,
  );
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
  const infos: CheckItem[] = [];
  // Identical lines are one line with a count ("2 Extractors have no conduit").
  const seen = new Map<string, Problem[]>();
  for (const p of problems) {
    const same = seen.get(p.text);
    if (same === undefined) seen.set(p.text, [p]);
    else same.push(p);
  }
  for (const p of problems) {
    const same = seen.get(p.text) ?? [p];
    if (same[0] !== p) continue;
    const n = same.length;
    let text = p.text;
    if (n > 1) {
      const g = p.group;
      text =
        g === undefined
          ? screenText(texts, 'uiCheckRepeat', { text, count: String(n) })
          : screenText(texts, g.key, {
              count: String(n),
              names: pluralName(n, g.name),
              resource: g.resource ?? '',
            });
    }
    const key = FIX_KEY[p.kind];
    const item: CheckItem = {
      id: p.id,
      state: isInfo(p) ? 'info' : isReminder(p) ? 'hint' : 'warn',
      text,
      fix: key === null ? null : screenText(texts, key),
      problem: p,
    };
    (isInfo(p) ? infos : isReminder(p) ? reminders : warnings).push(item);
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
    items: [...warnings, ...reminders, ...infos, ...ok.slice(0, maxOk)],
    okHidden: Math.max(0, ok.length - maxOk),
  };
}
