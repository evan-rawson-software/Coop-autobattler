/**
 * Send one Shop action through the session and word the outcome.
 *
 * Nothing here waits for an earlier action: the controller queues intents and
 * applies each one to the state the one before it left, so a second buy right
 * after a first is judged against the gold that is really left, and shows
 * its own rejection reason if it no longer fits.
 */
import type { Intent } from '@game/session';
import type { BuildSession } from '../build/session.js';
import { shopReason } from './messages.js';

export interface ActionOutcome {
  readonly ok: boolean;
  readonly text: string;
  readonly kind: 'ok' | 'error';
}

export async function performAction(
  session: BuildSession,
  intent: Intent,
  okText: string,
): Promise<ActionOutcome> {
  const r = await session.dispatch(intent);
  return r.ok
    ? { ok: true, text: okText, kind: 'ok' }
    : { ok: false, text: shopReason(r.reason, r.detail), kind: 'error' };
}
