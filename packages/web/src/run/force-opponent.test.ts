import { describe, expect, test } from 'vitest';
import { createMemoryGhostStore } from '@game/session';
import type { GhostBucket } from '@game/core';
import {
  FORCE_OPPONENT_KEY,
  readForcedOpponent,
  withForcedOpponent,
  writeForcedOpponent,
  type ForcedOpponent,
} from './force-opponent.js';
import { createMemoryStorage } from './local-storage-store.js';

const bucket: GhostBucket = { gameVersion: '0.1', partySize: 1, round: 1 };

describe('forced opponent', () => {
  test('defaults to auto and round-trips through storage', () => {
    const st = createMemoryStorage();
    expect(readForcedOpponent(st)).toBe('auto');
    writeForcedOpponent('boss', st);
    expect(readForcedOpponent(st)).toBe('boss');
    writeForcedOpponent('ghost', st);
    expect(readForcedOpponent(st)).toBe('ghost');
    writeForcedOpponent('auto', st);
    expect(st.getItem(FORCE_OPPONENT_KEY)).toBeNull();
    st.setItem(FORCE_OPPONENT_KEY, 'junk');
    expect(readForcedOpponent(st)).toBe('auto');
  });

  test('boss hides the pool from the read, nothing else', async () => {
    const inner = createMemoryGhostStore();
    inner.injectRaw(bucket, 'o', {
      owner: { id: 'o', label: 'x' },
      runId: 'r',
    });
    let mode: ForcedOpponent = 'auto';
    const store = withForcedOpponent(inner, () => mode);
    expect(await store.list(bucket)).toHaveLength(1);
    mode = 'ghost';
    expect(await store.list(bucket)).toHaveLength(1);
    mode = 'boss';
    expect(await store.list(bucket)).toHaveLength(0);
    expect(inner.size()).toBe(1);
  });
});
