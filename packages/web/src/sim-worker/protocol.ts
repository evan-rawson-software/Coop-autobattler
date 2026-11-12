/**
 * Messages between the page and the simulation worker. Plain data only (the
 * battle description in, the record out), so both survive structured clone.
 */

import type { BattleRecord, RecordResult } from '../battle/playback.js';
import type { BattleDescription } from '../battle/types.js';

export interface SimRequest {
  /** Chosen by the client; the response carries it back. */
  readonly id: number;
  readonly desc: BattleDescription;
}

export type SimResponse =
  | {
      readonly id: number;
      readonly kind: 'result';
      readonly result: RecordResult;
    }
  /** The simulation threw (a bug, not a rejected description). */
  | { readonly id: number; readonly kind: 'error'; readonly message: string };

/** The buffers of a record, to hand over by transfer instead of copying. */
export function recordTransferables(record: BattleRecord): ArrayBuffer[] {
  return [
    record.coreHp[0].buffer,
    record.coreHp[1].buffer,
    record.tickStart.buffer,
  ] as ArrayBuffer[];
}
