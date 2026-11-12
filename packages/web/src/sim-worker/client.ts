/**
 * The page's side of the simulation worker: `simulate` returns a promise of
 * the battle record and a way to cancel it.
 *
 * - Requests are keyed by id; a response for an id nobody waits for (a
 *   cancelled request) is dropped.
 * - Cancelling the request the worker is running terminates the worker
 *   (a synchronous simulation cannot be interrupted); the next request starts
 *   a fresh one.
 * - Without Workers, or if the worker fails to start, the same handler runs
 *   on the main thread behind the same interface (after a macrotask, so the
 *   page can paint "preparing" first).
 */

import type { BattleRecord } from '../battle/playback.js';
import type { BattleDescription } from '../battle/types.js';
import { handleRequest } from './handler.js';
import type { SimRequest, SimResponse } from './protocol.js';

export type RecordOutcome =
  | { readonly ok: true; readonly record: BattleRecord }
  | { readonly ok: false; readonly message: string };

export interface SimHandle {
  readonly promise: Promise<RecordOutcome>;
  /** Drop the request: the promise rejects with a `CancelledError`. */
  cancel(): void;
}

export class CancelledError extends Error {
  constructor() {
    super('Simulation cancelled.');
    this.name = 'CancelledError';
  }
}

/** The part of `Worker` the client uses (so tests can supply a stand-in). */
export interface WorkerLike {
  onmessage: ((ev: { data: SimResponse }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessageerror: ((ev: unknown) => void) | null;
  postMessage(msg: SimRequest): void;
  terminate(): void;
}

interface Job {
  readonly req: SimRequest;
  readonly startedAt: number;
  resolve(r: RecordOutcome): void;
  reject(e: unknown): void;
}

/** A short text for an error, an error event or whatever a worker raised. */
function reasonOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null) {
    const o = e as { message?: unknown; filename?: unknown };
    if (typeof o.message === 'string' && o.message !== '') {
      return typeof o.filename === 'string' && o.filename !== ''
        ? `${o.message} at ${o.filename}`
        : o.message;
    }
  }
  return 'unknown error';
}

function toOutcome(res: SimResponse): RecordOutcome | Error {
  if (res.kind === 'error') return new Error(res.message);
  return res.result.ok
    ? { ok: true, record: res.result.record }
    : { ok: false, message: res.result.error.message };
}

export class SimClient {
  private worker: WorkerLike | null = null;
  private sync: boolean;
  private nextId = 1;
  private readonly jobs = new Map<number, Job>();
  /** How many workers were started (for tests and the smoke script). */
  workersStarted = 0;
  /** Whether the latest finished request ran on the main thread. */
  lastRanOnMainThread = false;
  /** Request to result in milliseconds, queueing and transfer included. */
  lastRoundTripMs = 0;

  constructor(private readonly makeWorker: (() => WorkerLike) | null) {
    this.sync = makeWorker === null;
  }

  get usesWorker(): boolean {
    return !this.sync;
  }

  simulate(desc: BattleDescription): SimHandle {
    const id = this.nextId++;
    let job!: Job;
    const promise = new Promise<RecordOutcome>((resolve, reject) => {
      job = {
        req: { id, desc },
        startedAt: performance.now(),
        resolve,
        reject,
      };
    });
    this.jobs.set(id, job);
    this.dispatch(job);
    return {
      promise,
      cancel: () => {
        if (!this.jobs.delete(id)) return;
        job.reject(new CancelledError());
        // The worker may be busy with this very request.
        if (this.worker !== null) {
          this.worker.terminate();
          this.worker = null;
          // Anything queued behind it goes to a new worker.
          for (const other of this.jobs.values()) this.dispatch(other);
        }
      },
    };
  }

  private dispatch(job: Job): void {
    if (!this.sync) {
      try {
        this.ensureWorker().postMessage(job.req);
        return;
      } catch (e) {
        this.fallBack(reasonOf(e));
      }
    }
    setTimeout(() => {
      if (this.jobs.get(job.req.id) !== job) return;
      this.lastRanOnMainThread = true;
      this.settle(job, handleRequest(job.req));
    }, 0);
  }

  private ensureWorker(): WorkerLike {
    if (this.worker !== null) return this.worker;
    const w = this.makeWorker?.();
    if (w === undefined) throw new Error('No worker.');
    this.workersStarted++;
    w.onmessage = (ev) => {
      const job = this.jobs.get(ev.data.id);
      if (job === undefined) return; // cancelled or stale
      this.lastRanOnMainThread = false;
      this.settle(job, ev.data);
    };
    // A response that cannot be deserialised is as good as a broken worker.
    w.onmessageerror = (ev) => {
      if (this.worker !== w) return;
      this.fallBack(`a response could not be read (${reasonOf(ev)})`);
      for (const job of [...this.jobs.values()]) this.dispatch(job);
    };
    w.onerror = (ev) => {
      // The script failed to load or crashed: use the main thread from now on.
      if (this.worker !== w) return;
      this.fallBack(reasonOf(ev));
      for (const job of [...this.jobs.values()]) this.dispatch(job);
    };
    this.worker = w;
    return w;
  }

  private fallBack(reason: string): void {
    if (!this.sync) {
      console.warn(
        `Simulation worker unavailable (${reason}); simulating on the main thread.`,
      );
    }
    this.sync = true;
    this.worker?.terminate();
    this.worker = null;
  }

  private settle(job: Job, res: SimResponse): void {
    this.jobs.delete(job.req.id);
    this.lastRoundTripMs = performance.now() - job.startedAt;
    const out = toOutcome(res);
    if (out instanceof Error) job.reject(out);
    else job.resolve(out);
  }
}

function browserWorker(): WorkerLike {
  return new Worker(new URL('./sim.worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as WorkerLike;
}

/** The app's client: a real worker where the browser has them. */
export const simClient = new SimClient(
  typeof Worker === 'undefined' ? null : browserWorker,
);
