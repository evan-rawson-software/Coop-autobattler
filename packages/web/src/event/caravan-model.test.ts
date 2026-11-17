import { describe, expect, test } from 'vitest';
import { openDraft, type Json, type RunState } from '@game/session';
import { gameConfigs } from '../build/setup.js';
import { content } from '../content.js';
import { newRun, realDeps } from '../run/test-run.js';
import { caravanScreen } from './caravan-model.js';

const config = gameConfigs.events;

/** A solo run in a hand-made Caravan draft. */
function draftRun(
  items: Json[],
  order = [0],
  taken: (string | null)[] = [null],
) {
  const base: RunState = newRun();
  return {
    ...base,
    step: 'event_resolve',
    pending: {
      offer: {
        id: 'evt_caravan',
        event: 'evt_caravan',
        type: 'caravan',
        items,
        order,
      },
      followUp: { prompt: 'caravan', mode: 'draft', items, order, taken },
    },
  } as RunState;
}

describe('the Caravan screen model', () => {
  test('cards, who is up, the party-wide mark', () => {
    const run = draftRun([
      { id: 'it0', kind: 'gold', gold: 6 },
      {
        id: 'it1',
        kind: 'modifier',
        modifier: 'mod_stout_walls',
        partyWide: true,
      },
    ]);
    expect(openDraft(run)).not.toBeNull();
    const m = caravanScreen(run, config, content, 0, realDeps());
    expect(m?.role).toBe('choose');
    expect(m?.cards.map((c) => c.title)[0]).toBe('6 gold');
    expect(m?.cards[1]?.partyWide).toBe(true);
    expect(m?.cards.every((c) => c.holder === null)).toBe(true);
    expect(m?.rows).toEqual([
      expect.objectContaining({ player: 0, state: 'up' }),
    ]);
    expect(m?.mustSkip).toBe(false);
  });

  test('a taken reward shows its holder', () => {
    const base = newRun();
    const two: RunState = {
      ...base,
      players: [
        { index: 0, name: 'Ann' },
        { index: 1, name: 'Bo' },
      ],
    };
    const run = {
      ...draftRun(
        [
          { id: 'it0', kind: 'gold', gold: 6 },
          { id: 'it1', kind: 'upgrade' },
          { id: 'it2', kind: 'upgrade' },
        ],
        [1, 0],
        ['it0', null],
      ),
      players: two.players,
    } as RunState;
    const m = caravanScreen(run, config, content, 0, realDeps());
    expect(m?.cards[0]?.holderText).toBe('Taken by Bo');
    expect(m?.role).toBe('choose');
    const other = caravanScreen(run, config, content, 1, realDeps());
    expect(other?.role).toBe('change');
    expect(other?.cards[0]?.mine).toBe(true);
  });
});

describe('whose turn the screen says it is', () => {
  const two = (): RunState => ({
    ...draftRun(
      [
        { id: 'it0', kind: 'gold', gold: 6 },
        { id: 'it1', kind: 'upgrade' },
        { id: 'it2', kind: 'upgrade' },
      ],
      [1, 0],
      [null, null],
    ),
    players: [
      { index: 0, name: 'Ann' },
      { index: 1, name: 'Bo' },
    ],
  });

  test('the chooser sees "Your turn"; the other seat sees who is choosing', () => {
    const run = two();
    const bo = caravanScreen(run, config, content, 1, realDeps());
    expect(bo?.role).toBe('choose');
    expect(bo?.headline).toMatch(/^Your turn, Bo:/);
    const ann = caravanScreen(run, config, content, 0, realDeps());
    expect(ann?.role).toBe('wait');
    expect(ann?.headline).toBe('Bo is choosing.');
    expect(ann?.headline).not.toMatch(/Your turn/);
    // The order list is the same for both and marks the viewer.
    expect(ann?.rows.map((r) => `${r.name}:${r.state}`)).toEqual([
      'Bo:up',
      'Ann (you):waiting',
    ]);
    expect(bo?.rows.map((r) => `${r.name}:${r.state}`)).toEqual([
      'Bo (you):up',
      'Ann:waiting',
    ]);
  });
});
