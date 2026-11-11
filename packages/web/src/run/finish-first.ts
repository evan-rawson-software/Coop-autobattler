/**
 * Make the Run over data durable before a finished run's save is removed.
 *
 * The session controller ends a run by saving the final state (with its
 * `outcome`), appending the history entry and removing the save, in that
 * order. `finishFirst` wraps the save store so that `remove` first writes the
 * final state to the finished-runs store and waits for it. Whatever the
 * browser loses (the tab, the power) between the steps, the next start finds
 * one of:
 *
 * - the save with its last step (nothing finished yet),
 * - the save with an `outcome` (and maybe the finished record): `initSaves`
 *   removes it through this same wrapper, which writes the record first,
 * - no save and the finished record (the Run over screen).
 *
 * A save the game cannot read (damaged, stored under another key, an
 * unsupported format, from a newer game or an older major version) never gets
 * a finished record: its state cannot be trusted. It is only removed.
 *
 * If the finished record cannot be written, the save is NOT removed: the run
 * stays where it is and is finished again at the next start.
 */
import {
  checkSaveShape,
  classify,
  hasUnsupportedFormat,
  type SaveStore,
} from '@game/session';
import type { FinishedRuns } from './finished.js';
import { INSTALLED_VERSION } from './version.js';

export function finishFirst(
  saves: SaveStore,
  finished: FinishedRuns,
  now: () => number,
): SaveStore {
  return {
    list: () => saves.list(),
    get: (runId) => saves.get(runId),
    put: (record) => saves.put(record),
    listHistory: () => saves.listHistory(),
    appendHistory: (entry) => saves.appendHistory(entry),
    bestDepthByPartySize: () => saves.bestDepthByPartySize(),
    async remove(runId) {
      const shape = checkSaveShape(await saves.get(runId));
      if (
        shape.ok &&
        shape.record.runId === runId &&
        !hasUnsupportedFormat(shape.record) &&
        ['same', 'older_minor'].includes(
          classify(shape.record.runVersion, INSTALLED_VERSION),
        ) &&
        shape.record.state.outcome !== null
      ) {
        await finished.put({
          runId,
          state: { ...shape.record.state, runId },
          finishedAt: now(),
        });
      }
      await saves.remove(runId);
    },
  };
}
