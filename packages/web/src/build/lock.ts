/**
 * What the Shop and Build tabs may offer right now, from the session's own
 * selectors: `allowedIntents` (a Ready player may only unready) and
 * `sealedProducers` (a unit producer with no walkable route to the front row
 * blocks Ready). Pure; the rules answer in `session`, this only words them.
 */
import {
  allowedIntents,
  sealedProducers,
  type RunDeps,
  type RunState,
} from '@game/session';
import type { WebContent } from '../content.js';
import { screenText, screenTexts } from './texts.js';
import { buildingName } from './view-model.js';

export type LockDeps = Pick<RunDeps, 'content' | 'handlers'>;

export const READY_LOCK_TEXT = screenText(screenTexts, 'readyLock');
export const SEALED_HINT = screenText(screenTexts, 'sealedHint');

export interface SealedInfo {
  /** Building ids of the sealed producers. */
  readonly ids: readonly number[];
  /** "Barracks (column 3, row 5)" for each. */
  readonly labels: readonly string[];
  /** Why Ready is disabled; null when nothing is sealed. */
  readonly reason: string | null;
}

export function sealedInfo(
  run: RunState,
  deps: Pick<RunDeps, 'content'>,
  content: WebContent,
  player: number,
): SealedInfo {
  // Only the player's own sealed producers count (PP-15), as in `ready`.
  const ids = sealedProducers(run, deps).filter(
    (id) => run.team.buildings.find((b) => b.id === id)?.owner === player,
  );
  const labels = ids.map((id) => {
    const b = run.team.buildings.find((x) => x.id === id);
    return b === undefined
      ? `building ${String(id)}`
      : `${buildingName(content, b.def)} (column ${String(b.x)}, row ${String(b.y)})`;
  });
  return {
    ids,
    labels,
    reason:
      ids.length === 0
        ? null
        : screenText(
            screenTexts,
            ids.length === 1 ? 'sealedBlockedOne' : 'sealedBlockedMany',
            { labels: labels.join(', '), hint: SEALED_HINT },
          ),
  };
}

export interface Gate {
  /** The viewing player has pressed Ready: buying, selling and building are locked. */
  readonly ready: boolean;
  /** Intent types this player may send now. */
  readonly allowed: ReadonlySet<string>;
  readonly sealed: SealedInfo;
  /** Why the Ready button is disabled (sealed); null when it can be pressed. */
  readonly readyBlock: string | null;
  /** Why buy, sell, re-roll and board changes are refused; null when open. */
  readonly editBlock: string | null;
}

export function gateFor(
  run: RunState,
  player: number,
  deps: LockDeps,
  content: WebContent,
): Gate {
  const allowed = new Set(allowedIntents(run, player, deps));
  const ready = run.perPlayer[player]?.ready === true;
  const sealed = sealedInfo(run, deps, content, player);
  return {
    ready,
    allowed,
    sealed,
    readyBlock: ready ? null : sealed.reason,
    editBlock: ready ? READY_LOCK_TEXT : null,
  };
}
