/**
 * How a status message behaves, on every screen that has one: it stays until
 * the player's next action or about four seconds, whichever comes first, and
 * the newest message replaces the one before. An error is the exception: it
 * is not timed out, only replaced by the next action's message.
 */
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

export const STATUS_MS = 4000;

export type StatusKind = 'info' | 'ok' | 'error';

export interface StatusMessage {
  readonly text: string;
  readonly kind: StatusKind;
}

const EMPTY: StatusMessage = { text: '', kind: 'info' };

/** A message to show, how to say a new one, and how to clear it. */
export function useStatus(): readonly [
  StatusMessage,
  (text: string, kind: StatusKind) => void,
  () => void,
] {
  const [status, setStatus] = useState<StatusMessage>(EMPTY);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = (): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  const clear = useCallback((): void => {
    stop();
    setStatus(EMPTY);
  }, []);
  const say = useCallback((text: string, kind: StatusKind): void => {
    stop();
    setStatus({ text, kind });
    if (kind !== 'error') {
      timer.current = setTimeout(() => {
        timer.current = null;
        setStatus(EMPTY);
      }, STATUS_MS);
    }
  }, []);
  useEffect(() => stop, []);
  return [status, say, clear];
}

/**
 * `status` with the same time limit applied to a message the screen's
 * controller owns: a message of one of `kinds` reads blank after four
 * seconds. A new message (a new object) starts a new count.
 */
export function useFading(
  status: StatusMessage,
  kinds: readonly StatusKind[],
): StatusMessage {
  const [gone, setGone] = useState<StatusMessage | null>(null);
  const fades = kinds.includes(status.kind) && status.text !== '';
  useEffect(() => {
    if (!fades) return undefined;
    const id = setTimeout(() => {
      setGone(status);
    }, STATUS_MS);
    return () => {
      clearTimeout(id);
    };
  }, [status, fades]);
  return gone === status ? EMPTY : status;
}

/** Run `fn` once the notice has shown for the time limit. */
export function useNoticeTimeout(
  notice: string | null,
  clear: () => void,
): void {
  useEffect(() => {
    if (notice === null) return undefined;
    const id = setTimeout(clear, STATUS_MS);
    return () => {
      clearTimeout(id);
    };
  }, [notice, clear]);
}
