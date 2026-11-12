import { describe, expect, test } from 'vitest';
import { RUN_STATE_FORMAT_VERSION, type RunState } from '@game/session';
import { asFinishedRecord, createLocalFinishedRuns } from './finished.js';
import type { StorageLike } from './local-storage-store.js';

function memStorage(): StorageLike {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  } as unknown as StorageLike;
}

const rec = (formatVersion: number) => ({
  runId: 'r',
  finishedAt: 1,
  state: { formatVersion, team: { core: null } } as unknown as RunState,
});

describe('finished-run records of another format (issue #139)', () => {
  test('a record from before the per-player design is not read', async () => {
    expect(asFinishedRecord(rec(4))).toBeNull();
    expect(asFinishedRecord(rec(RUN_STATE_FORMAT_VERSION + 1))).toBeNull();
    expect(asFinishedRecord(rec(RUN_STATE_FORMAT_VERSION))).not.toBeNull();
    const s = createLocalFinishedRuns(memStorage(), 'p:');
    await s.put(rec(4));
    expect(await s.get('r')).toBeNull();
    await s.put(rec(RUN_STATE_FORMAT_VERSION));
    expect((await s.get('r'))?.runId).toBe('r');
  });
});
