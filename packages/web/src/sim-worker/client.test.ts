import { hashJson } from '@game/core';
import { describe, expect, test } from 'vitest';
import { simulateRecord } from '../battle/playback.js';
import {
  buildSample,
  DEFAULT_SELECTION,
  STRESS_ID,
} from '../battle/samples.js';
import { battleConfig } from '../battle/setup.js';
import { content } from '../content.js';
import { CancelledError, SimClient, type WorkerLike } from './client.js';
import { handleRequest } from './handler.js';
import { recordTransferables, type SimRequest } from './protocol.js';
import type { SimResponse } from './protocol.js';

const desc = buildSample(DEFAULT_SELECTION).battle;
const other = buildSample({ ...DEFAULT_SELECTION, seed: 2 }).battle;

/** A worker stand-in: the real handler, with the structured clone and the
 * transfer of the real thing, answering on a later macrotask. */
class FakeWorker implements WorkerLike {
  onmessage: ((ev: { data: SimResponse }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessageerror: ((ev: unknown) => void) | null = null;
  terminated = false;
  static all: FakeWorker[] = [];
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(msg: SimRequest): void {
    const req = structuredClone(msg);
    setTimeout(() => {
      if (this.terminated) return;
      const res = handleRequest(req);
      const transfer =
        res.kind === 'result' && res.result.ok
          ? recordTransferables(res.result.record)
          : [];
      this.onmessage?.({ data: structuredClone(res, { transfer }) });
    }, 0);
  }
  terminate(): void {
    this.terminated = true;
  }
}

function fresh(): SimClient {
  FakeWorker.all = [];
  return new SimClient(() => new FakeWorker());
}

describe('the simulation worker client', () => {
  test('a worker result has the same state and event-log hashes as the synchronous path', async () => {
    const direct = simulateRecord(desc, content, battleConfig);
    if (!direct.ok) throw new Error('direct');
    const client = fresh();
    const out = await client.simulate(desc).promise;
    if (!out.ok) throw new Error(out.message);
    expect(client.lastRanOnMainThread).toBe(false);
    expect(hashJson(out.record.eventLog)).toBe(
      hashJson(direct.record.eventLog),
    );
    expect(out.record.result).toEqual(direct.record.result);
    expect(hashJson(out.record.summary)).toBe(hashJson(direct.record.summary));
    // Everything but the timing is identical, typed arrays included.
    const strip = (r: typeof out.record) => ({
      ...r,
      simMs: 0,
      coreHp: r.coreHp.map((a) => Array.from(a)),
      tickStart: Array.from(r.tickStart),
    });
    expect(hashJson(strip(out.record))).toBe(hashJson(strip(direct.record)));
    expect(out.record.coreHp[0]).toBeInstanceOf(Int32Array);
  });

  test('the fallback without Workers gives the same result on the main thread', async () => {
    const direct = simulateRecord(desc, content, battleConfig);
    if (!direct.ok) throw new Error('direct');
    const client = new SimClient(null);
    expect(client.usesWorker).toBe(false);
    const out = await client.simulate(desc).promise;
    if (!out.ok) throw new Error(out.message);
    expect(client.lastRanOnMainThread).toBe(true);
    expect(hashJson(out.record.eventLog)).toBe(
      hashJson(direct.record.eventLog),
    );
  });

  test('a worker that fails to start falls back for that and later requests', async () => {
    class Broken extends FakeWorker {
      override postMessage(): void {
        setTimeout(() => this.onerror?.({}), 0);
      }
    }
    const client = new SimClient(() => new Broken());
    const out = await client.simulate(desc).promise;
    expect(out.ok).toBe(true);
    expect(client.lastRanOnMainThread).toBe(true);
    expect(client.usesWorker).toBe(false);
    expect((await client.simulate(other).promise).ok).toBe(true);
    expect(client.workersStarted).toBe(1);
  });

  test('a malformed response (messageerror) falls back instead of hanging', async () => {
    class Garbled extends FakeWorker {
      override postMessage(): void {
        setTimeout(() => this.onmessageerror?.({}), 0);
      }
    }
    const client = new SimClient(() => new Garbled());
    const out = await client.simulate(desc).promise;
    expect(out.ok).toBe(true);
    expect(client.lastRanOnMainThread).toBe(true);
    expect(client.usesWorker).toBe(false);
  });

  test('a cancelled request rejects, and its late result is ignored', async () => {
    const client = fresh();
    const first = client.simulate(desc);
    const second = client.simulate(other);
    first.cancel();
    await expect(first.promise).rejects.toBeInstanceOf(CancelledError);
    // The worker running the first was terminated; the second is re-sent.
    expect(FakeWorker.all[0]?.terminated).toBe(true);
    const out = await second.promise;
    if (!out.ok) throw new Error(out.message);
    const direct = simulateRecord(other, content, battleConfig);
    if (!direct.ok) throw new Error('direct');
    expect(hashJson(out.record.eventLog)).toBe(
      hashJson(direct.record.eventLog),
    );
    expect(client.workersStarted).toBe(2);
  });

  test('a stale response for a cancelled id is dropped by a surviving worker', () => {
    const client = fresh();
    const a = client.simulate(desc);
    const w = FakeWorker.all[0];
    if (w === undefined) throw new Error('no worker');
    a.cancel();
    a.promise.catch(() => undefined);
    // A response that arrives anyway (e.g. posted before terminate).
    w.onmessage?.({ data: handleRequest({ id: 1, desc }) });
    expect(client.lastRoundTripMs).toBe(0);
  });

  test('a throwing simulation rejects the promise', async () => {
    const client = new SimClient(null);
    const boom = { kind: 'versus', input: null } as unknown as typeof desc;
    await expect(client.simulate(boom).promise).rejects.toBeInstanceOf(Error);
  });
});

describe('the stress battle', () => {
  test('transfers and hashes the same through the worker path', async () => {
    const stress = buildSample({
      ...DEFAULT_SELECTION,
      opponent: STRESS_ID,
    }).battle;
    const direct = simulateRecord(stress, content, battleConfig);
    if (!direct.ok) throw new Error('direct');
    const out = await fresh().simulate(stress).promise;
    if (!out.ok) throw new Error(out.message);
    expect(hashJson(out.record.eventLog)).toBe(
      hashJson(direct.record.eventLog),
    );
    expect(out.record.result).toEqual(direct.record.result);
    expect(hashJson(out.record.summary)).toBe(hashJson(direct.record.summary));
  }, 60000);
});
