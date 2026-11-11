import type { TeamState } from '@game/core';
import { describe, expect, test } from 'vitest';
import { content } from '../content.js';
import { buildingRows } from './derive.js';
import type { BattleRecord } from './playback.js';

const producer = content.buildings
  .list()
  .find((d) => d.kind === 'unit_producer');

function rowsFor(
  conduits: unknown[],
  events: unknown[],
): ReturnType<typeof buildingRows> {
  const team = {
    buildings: [{ id: 5, def: producer?.id }],
    conduits,
  } as unknown as TeamState;
  const record = {
    eventLog: events,
    initialTeams: [team, team],
  } as unknown as BattleRecord;
  return buildingRows(record, content, 0);
}

describe('why a unit producer produced nothing', () => {
  test('no conduit connected', () => {
    expect(rowsFor([], [])[0]?.note).toMatch(/no conduit was connected/);
  });
  test('wired but never received its input', () => {
    const c = [{ id: 9, from: { building: 1 }, to: { building: 5 } }];
    expect(rowsFor(c, [])[0]?.note).toMatch(/never received its input/);
  });
  test('no note when it trained units', () => {
    const c = [{ id: 9, from: { building: 1 }, to: { building: 5 } }];
    const ev = [{ type: 'unit_spawned', side: 0, building: 5, unit: 1 }];
    expect(rowsFor(c, ev)[0]?.note).toBeNull();
  });
});
