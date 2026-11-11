import { describe, expect, test, vi } from 'vitest';
import { createReadyGate } from './ready-gate.js';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('Ready gate', () => {
  test('a double click sends once and stays ready on success', async () => {
    const send = vi.fn(() => Promise.resolve(true));
    const seen: boolean[] = [];
    const press = createReadyGate(send, (r) => seen.push(r));
    press();
    press();
    await tick();
    press();
    expect(send).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([true]);
  });

  test('a failed send makes Ready available again, and it can be retried', async () => {
    const send = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const seen: boolean[] = [];
    const press = createReadyGate(send, (r) => seen.push(r));
    press();
    press();
    await tick();
    expect(seen).toEqual([true, false]);
    press();
    await tick();
    expect(send).toHaveBeenCalledTimes(2);
    expect(seen).toEqual([true, false, true]);
  });

  test('a rejected send also re-enables', async () => {
    const seen: boolean[] = [];
    const press = createReadyGate(
      () => Promise.reject(new Error('x')),
      (r) => seen.push(r),
    );
    press();
    await tick();
    expect(seen).toEqual([true, false]);
  });
});
