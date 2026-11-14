import { REFERENCE_BOARDS } from '@game/core';
import { describe, expect, test } from 'vitest';
import { content } from '../content.js';
import { deriveMoments } from './derive.js';
import { simulateRecord, type BattleRecord } from './playback.js';
import {
  breachSideOf,
  explainResult,
  lifeChip,
  resultFacts,
  type ResultFacts,
} from './result-why.js';
import { buildSample } from './samples.js';
import { battleConfig } from './setup.js';

// The cause sentence and the tip come from fixed rules over facts of the
// record; first match wins. Wrong order reads as blaming the wrong thing.

const base: ResultFacts = {
  placed: 5,
  dryProducers: [],
  dryTurrets: [],
  breach: null,
  ownFell: '0:54',
  ownCores: 1,
  foeFell: null,
  topUnits: null,
  coreName: 'Core',
  sourceName: 'Extractor',
  pathsName: 'Enemy paths',
};
const barracks = { building: 'Barracks', resource: 'Ore', units: 'Soldiers' };
const turret = { building: 'Turret', resource: 'Power', units: null };

describe('explainResult', () => {
  test('no buildings placed', () => {
    const w = explainResult({ ...base, placed: 0 }, false, 'x');
    expect(w.cause).toBe('You had no buildings on the board.');
    expect(w.tip).toMatch(/Place buildings from the tray/);
  });

  test('a producer that got no input, with the Core fall first', () => {
    const w = explainResult({ ...base, dryProducers: [barracks] }, false, 'x');
    expect(w.cause).toBe(
      'Your Core fell at 0:54. Your Barracks never got any Ore, so it trained no Soldiers.',
    );
    expect(w.tip).toBe(
      "Draw a conduit from a Ore Extractor to the Barracks. The Build checklist turns green when it's connected.",
    );
  });

  test('a producer comes before a dry turret, a turret before a breach', () => {
    const both = { ...base, dryProducers: [barracks], dryTurrets: [turret] };
    expect(explainResult(both, false, 'x').cause).toMatch(/Barracks/);
    const turretAndBreach = {
      ...base,
      dryTurrets: [turret],
      breach: { side: 'left', time: '0:48' },
    } as const;
    const w = explainResult(turretAndBreach, false, 'x');
    expect(w.cause).toMatch(/Your Turret had no Power, so it never fired\.$/);
    expect(w.tip).toMatch(/Power Extractor to the Turret/);
  });

  test('a breach names the side and the time', () => {
    const w = explainResult(
      { ...base, breach: { side: 'right', time: '0:48' } },
      false,
      'x',
    );
    expect(w.cause).toBe('Enemies got through on the right side at 0:48.');
    expect(w.tip).toBe('Turn on Enemy paths and block that side with walls.');
  });

  test('several Cores say the last one fell', () => {
    const w = explainResult(
      { ...base, ownCores: 2, dryProducers: [barracks] },
      false,
      'x',
    );
    expect(w.cause).toMatch(/^Your last Core fell at 0:54\./);
  });

  test('otherwise a defeat falls back to the Core fall or the reason text', () => {
    expect(explainResult(base, false, 'fallback').cause).toBe(
      'Your Core fell at 0:54.',
    );
    const timed = explainResult({ ...base, ownFell: null }, false, 'Time out.');
    expect(timed.cause).toBe('Time out.');
    expect(timed.tip).not.toBeNull();
  });

  test('a win names the units and when their Core fell, and has no tip', () => {
    const won = explainResult(
      { ...base, ownFell: null, foeFell: '1:02', topUnits: 'Soldiers' },
      true,
      'x',
    );
    expect(won).toEqual({
      cause: 'Your Soldiers destroyed their Core at 1:02.',
      tip: null,
    });
    expect(explainResult({ ...base, foeFell: '1:02' }, true, 'x').cause).toBe(
      'Their Core was destroyed at 1:02.',
    );
    expect(
      explainResult({ ...base, foeFell: null }, true, 'On time.').cause,
    ).toBe('On time.');
  });
});

describe('lifeChip', () => {
  test('a stronghold and any win cost no life', () => {
    expect(lifeChip(false, false, 'No reward')).toEqual({
      text: 'No life lost',
      lost: false,
    });
    expect(lifeChip(true, true, '+3 gold').lost).toBe(false);
  });
  test('a lost rival party battle shows its life cost', () => {
    expect(lifeChip(true, false, '−1 life · +1 gold')).toEqual({
      text: '−1 life',
      lost: true,
    });
  });
});

describe('breachSideOf', () => {
  test('left, right and the middle of the board', () => {
    expect(breachSideOf(2, 20)).toBe('left');
    expect(breachSideOf(18, 20)).toBe('right');
    expect(breachSideOf(10.5, 20)).toBe('middle');
  });
});

describe('resultFacts from a record', () => {
  const sample = buildSample({
    player: 'rush',
    opponent: 'ghost:fortify',
    seed: 1,
    tick: 0,
  });
  const made = simulateRecord(sample.battle, content, battleConfig);
  if (!made.ok) throw new Error(made.error.message);
  const rec: BattleRecord = made.record;
  const labels = {
    side: ['Your', 'Enemy'] as const,
    coreName: 'Core',
    zoneRevealed: 'zone',
    overload: 'overload',
  };
  const factsOf = (r: BattleRecord) =>
    resultFacts(r, content, deriveMoments(r, content, labels), 10);

  test('names the content, not hard-coded words', () => {
    const f = factsOf(rec);
    expect(f.coreName).toBe('Core');
    expect(f.sourceName).toBe('Extractor');
    expect(f.placed).toBeGreaterThan(0);
  });

  test('a record where nothing arrived blames every producer', () => {
    const quiet: BattleRecord = { ...rec, eventLog: [] };
    const f = factsOf(quiet);
    expect(f.dryProducers.length).toBeGreaterThan(0);
    expect(f.dryProducers[0]?.resource).not.toBeNull();
    expect(f.topUnits).toBeNull();
  });

  test('a board with no buildings', () => {
    const empty: BattleRecord = {
      ...rec,
      initialTeams: [
        { ...rec.initialTeams[0], buildings: [] },
        rec.initialTeams[1],
      ],
    };
    expect(factsOf(empty).placed).toBe(0);
  });

  test('every battle of the sample boards gets a sentence', () => {
    for (const player of REFERENCE_BOARDS) {
      const s = buildSample({
        player,
        opponent: 'ghost:rush',
        seed: 2,
        tick: 0,
      });
      const m = simulateRecord(s.battle, content, battleConfig);
      if (!m.ok) throw new Error(m.error.message);
      const r = m.record;
      const won = r.result.winner === 0;
      const why = explainResult(factsOf(r), won, 'fallback');
      expect(why.cause.length).toBeGreaterThan(5);
      expect(why.cause).not.toMatch(/[{}]/);
      expect(why.tip === null).toBe(won);
    }
  });
});
