import { describe, expect, test } from 'vitest';
import { content } from '../content.js';
import {
  applyIntent,
  createRun,
  type Intent,
  type RunState,
} from '@game/session';
import { realDeps } from '../run/test-run.js';
import { nextIntent } from '../run/drive.js';
import {
  barSpecialist,
  partyPicks,
  specialistCards,
  specialistLines,
  specialistName,
} from './view-model.js';

const ROSTER = content.specialists.ids();

function two(): RunState {
  // Two players, nobody has picked.
  const r = createRun(
    {
      runId: 'spec-test',
      runVersion: '1.0',
      seed: 5,
      players: ['Ann', 'Bo'],
      host: 0,
    },
    realDeps(),
  );
  if (!r.ok) throw new Error(r.detail);
  expect(r.state.step).toBe('specialist_pick');
  return r.state;
}

/** Apply an intent as a player; it must be accepted. */
function send(state: RunState, intent: Intent, player = 0): RunState {
  const r = applyIntent(state, player, intent, realDeps());
  if (!r.ok) throw new Error(`${intent.type}: ${r.reason}`);
  return r.state;
}

describe('the cards of the pick', () => {
  test('one card per specialist, the whole roster in file order, with its texts', () => {
    const cards = specialistCards(two(), 0);
    expect(cards.map((c) => c.id)).toEqual(ROSTER);
    expect(cards.map((c) => c.name)).toEqual([
      'Flowmancer',
      'Wardsmith',
      'Beastbinder',
      'Alchemist',
    ]);
    expect(cards[0]).toMatchObject({
      family: 'Family: Logistics',
      bonus: 'Collectors produce about 10% faster.',
      signature: 'Mana Well (1x1)',
      pickedBy: [],
      mine: false,
    });
  });

  test('a pick shows on its card for everyone and is "mine" only for its owner', () => {
    let s = two();
    s = send(s, { type: 'pick_specialist', specialist: ROSTER[1] as string });
    const mine = specialistCards(s, 0);
    expect(mine[1]).toMatchObject({ pickedBy: ['Ann'], mine: true });
    expect(mine.filter((c) => c.mine)).toHaveLength(1);
    const theirs = specialistCards(s, 1);
    expect(theirs[1]).toMatchObject({ pickedBy: ['Ann'], mine: false });
  });

  test('duplicates list both players on one card', () => {
    let s = two();
    s = send(s, { type: 'pick_specialist', specialist: ROSTER[2] as string });
    s = send(
      s,
      { type: 'pick_specialist', specialist: ROSTER[2] as string },
      1,
    );
    expect(specialistCards(s, 0)[2]?.pickedBy).toEqual(['Ann', 'Bo']);
  });
});

describe('the party panel', () => {
  test('choosing, not ready and locked, by name', () => {
    let s = two();
    expect(partyPicks(s).map((r) => [r.name, r.pick, r.status])).toEqual([
      ['Ann', 'no pick yet', 'choosing'],
      ['Bo', 'no pick yet', 'choosing'],
    ]);
    s = send(s, { type: 'pick_specialist', specialist: ROSTER[0] as string });
    expect(partyPicks(s)[0]).toMatchObject({
      pick: 'Flowmancer',
      status: 'not_ready',
      statusText: 'not ready',
      picked: true,
    });
    s = send(s, { type: 'ready' });
    expect(partyPicks(s)[0]).toMatchObject({
      status: 'locked',
      statusText: 'ready · locked',
    });
    expect(partyPicks(s)[1]).toMatchObject({
      status: 'choosing',
      picked: false,
    });
  });
});

describe('the run bar, the PvP panel and the run summary', () => {
  test("the bar names the acting player's specialist, nothing before the pick", () => {
    let s = two();
    expect(barSpecialist(s.team, 0)).toBeNull();
    s = send(s, { type: 'pick_specialist', specialist: ROSTER[3] as string });
    expect(barSpecialist(s.team, 0)).toEqual({
      name: 'Alchemist',
      title: 'Specialist: Alchemist',
    });
    expect(barSpecialist(s.team, 1)).toBeNull();
  });

  test('a team from before specialists says nothing', () => {
    expect(barSpecialist({}, 0)).toBeNull();
    expect(specialistLines(undefined)).toEqual([]);
    expect(specialistLines([])).toEqual([]);
    expect(specialistLines([null, null])).toEqual([]);
  });

  test('lines list each player with the real names, or the fallback for a ghost', () => {
    const ids = [ROSTER[0] as string, null, ROSTER[2] as string];
    expect(specialistLines(ids, ['Ann', 'Bo', 'Cy'])).toEqual([
      'Ann: Flowmancer',
      'Cy: Beastbinder',
    ]);
    expect(specialistLines(ids)).toEqual([
      'Player 1: Flowmancer',
      'Player 3: Beastbinder',
    ]);
  });

  test('an ID without text is shown as the ID, never thrown on', () => {
    expect(specialistName('spec_future')).toBe('spec_future');
  });
});

describe('the default path of the setup helpers', () => {
  test('the drive helper picks the roster in turn, then readies', () => {
    const s = two();
    expect(nextIntent(s, 0)).toEqual({
      type: 'pick_specialist',
      specialist: ROSTER[0],
    });
    expect(nextIntent(s, 1)).toEqual({
      type: 'pick_specialist',
      specialist: ROSTER[1],
    });
    const picked = send(s, nextIntent(s, 0) as Intent);
    expect(nextIntent(picked, 0)).toEqual({ type: 'ready' });
  });
});
