import { describe, expect, test } from 'vitest';
import type { SaveListItem } from '@game/session';
import { agoText, menuRows, recordRows } from './view-model.js';

const NOW = 1_000_000_000_000;

function item(over: Partial<SaveListItem> & { runId: string }): SaveListItem {
  return {
    corrupt: false,
    runVersion: '0.1',
    installedVersionAtSave: '0.1.0',
    actionCounter: 3,
    hostName: 'You',
    playerNames: ['You'],
    summary: { round: 6, lives: 3, step: 'build', outcome: null },
    updatedAt: NOW - 2 * 86_400_000,
    ...over,
  } as SaveListItem;
}

describe('agoText', () => {
  test('words for each scale', () => {
    expect(agoText(NOW - 10_000, NOW)).toBe('just now');
    expect(agoText(NOW - 5 * 60_000, NOW)).toBe('5 minutes ago');
    expect(agoText(NOW - 60 * 60_000, NOW)).toBe('1 hour ago');
    expect(agoText(NOW - 2 * 86_400_000, NOW)).toBe('2 days ago');
    expect(agoText(NOW - 21 * 86_400_000, NOW)).toBe('3 weeks ago');
    expect(agoText(0, NOW)).toBe('at an unknown time');
  });
});

describe('menuRows', () => {
  test('lists every run once, with round, lives and step', () => {
    const rows = menuRows(
      [item({ runId: 'a' }), item({ runId: 'b' }), item({ runId: 'c' })],
      NOW,
      5,
    );
    expect(rows.map((r) => r.runId)).toEqual(['a', 'b', 'c']);
    expect(rows[0]).toMatchObject({
      kind: 'run',
      title: 'You (solo)',
      detail: 'Round 6 · Lives 3 / 5 · Build',
      playedAgo: '2 days ago',
      note: null,
      blocked: null,
    });
  });

  test('an older minor version gets the prompt note and can be resumed', () => {
    const [row] = menuRows([item({ runId: 'a', runVersion: '0.0' })], NOW, 5);
    expect(row).toMatchObject({ kind: 'run', blocked: null });
    expect(row?.kind === 'run' ? row.note : '').toMatch(
      /older version: some things may have changed/,
    );
  });

  test('a newer version is listed but cannot be resumed', () => {
    const [row] = menuRows([item({ runId: 'a', runVersion: '0.2' })], NOW, 5);
    expect(row?.kind === 'run' ? row.blocked : null).toMatch(/newer version/);
  });

  test('a run in an unreadable format is listed but cannot be resumed', () => {
    const [row] = menuRows(
      [item({ runId: 'a', unsupportedFormat: true } as never)],
      NOW,
      5,
    );
    expect(row?.kind === 'run' ? row.blocked : null).toMatch(/format/);
  });

  test('a damaged record is listed so it can be discarded', () => {
    const [row] = menuRows(
      [{ corrupt: true, runId: 'x', updatedAt: 0, errors: ['bad'] }],
      NOW,
      5,
    );
    expect(row).toMatchObject({ kind: 'damaged', runId: 'x' });
  });

  test('a run that already ended is not listed', () => {
    const rows = menuRows(
      [
        item({
          runId: 'a',
          summary: {
            round: 2,
            lives: 0,
            step: 'run_over',
            outcome: 'defeated',
          },
        }),
      ],
      NOW,
      5,
    );
    expect(rows).toEqual([]);
  });

  test('a party shows its names', () => {
    const [row] = menuRows(
      [item({ runId: 'a', playerNames: ['You', 'Ana', 'Bo'] })],
      NOW,
      5,
    );
    expect(row?.kind === 'run' ? row.title : '').toBe('You + Ana + Bo');
  });
});

describe('recordRows', () => {
  test('one row per party size, a dash where nothing was played', () => {
    expect(recordRows({ 1: 11, 3: 7 })).toEqual([
      { label: '1 player', value: 'round 11' },
      { label: '2 players', value: '—' },
      { label: '3 players', value: 'round 7' },
      { label: '4 players', value: '—' },
    ]);
  });
});
