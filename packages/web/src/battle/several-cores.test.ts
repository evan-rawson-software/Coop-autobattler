import { generateMap, listLegalCorePositions, placeCore } from '@game/core';
import { describe, expect, test } from 'vitest';
import { buildScene, enemyCoreCentre } from '../board/scene.js';
import { content } from '../content.js';
import { buildSampleTeam } from '../sample-team.js';
import { coreMaxima, destroyedOf, sideStats } from './derive.js';
import { makeDrawIndex } from './draw.js';
import { reasonText } from './panels.js';
import { Playback, simulateRecord } from './playback.js';
import { battleConfig } from './setup.js';
import type { BattleDescription } from './types.js';

const cores = (seed: number, players: number, count = players) => {
  const map = generateMap(seed, players, content, content.mapgen);
  let state = buildSampleTeam(map, content, seed);
  for (let p = 0; p < count; p++) {
    if (state.cores[p] !== null) continue;
    const spots = listLegalCorePositions(map, content, content.mapgen, p);
    const placed = spots
      .map((pos) => placeCore(state, content, content.mapgen, p, pos))
      .find((r) => r.ok);
    if (!placed?.ok) throw new Error('no Core spot');
    state = placed.state;
  }
  return state;
};

describe('several Cores per side', () => {
  test('every Core has its own health, rectangle and fall', () => {
    const d: BattleDescription = {
      kind: 'versus',
      input: {
        teamA: cores(3, 2),
        teamB: cores(4, 2),
        seed: 3,
        // Frail Cores on the foe's side, so Cores fall during the battle.
        sideOptions: [{}, { coreHealths: [1, 1] }],
      },
    };
    const r = simulateRecord(d, content, battleConfig);
    if (!r.ok) throw new Error(r.error.message);
    const rec = r.record;
    const pb = new Playback(d, content, battleConfig, rec);
    const start = sideStats(pb, content, 0, 10);
    expect(start.cores.map((c) => c.player)).toEqual([0, 1]);
    expect(start.cores.every((c) => c.hp === c.max && c.max > 0)).toBe(true);
    expect(start.cores.reduce((n, c) => n + c.hp, 0)).toBe(start.coreHp);
    const scene = buildScene(
      rec.initialTeams[0],
      rec.initialTeams[1],
      rec.zone.depth,
      content,
    );
    for (const b of scene.boards) {
      expect(b.cores.filter((c) => c !== null)).toHaveLength(2);
    }
    expect(enemyCoreCentre(scene)).not.toBeNull();
    const idx = makeDrawIndex(scene, { own: 'a', enemy: 'b' });
    expect(idx.coreRects[1].filter((x) => x !== null)).toHaveLength(2);
    pb.skip();
    const end = sideStats(pb, content, 0, 10);
    expect(end.coreHp).toBe(rec.summary.sides[0].coreHealth);
    const foe = sideStats(pb, content, 1, 10);
    const fallen = foe.cores.filter((c) => c.hp === 0).map((c) => c.player);
    expect(fallen.length).toBeGreaterThan(0);
    expect(fallen).toEqual(destroyedOf(rec, 1).cores.slice().sort());
    expect(rec.summary.sides[1].coresStanding).toBe(2 - fallen.length);
    expect(end.coreHp).toBe(rec.summary.sides[0].coreHealth);
    // Seek across the first fall and back: the Cores follow the tick.
    const fell = rec.eventLog.find((e) => e.type === 'core_destroyed');
    if (fell === undefined) throw new Error('no Core fell');
    pb.seekTo(fell.tick);
    const before = sideStats(pb, content, 1, 10);
    pb.seekTo(fell.tick + 1);
    const after = sideStats(pb, content, 1, 10);
    expect(after.cores.filter((c) => c.hp === 0).length).toBe(
      before.cores.filter((c) => c.hp === 0).length + 1,
    );
    pb.seekTo(0);
    expect(sideStats(pb, content, 1, 10).cores.every((c) => c.hp > 0)).toBe(
      true,
    );
  }, 120_000);

  test('four Cores against four, with different health; two against four is refused', () => {
    const d: BattleDescription = {
      kind: 'versus',
      input: {
        teamA: cores(3, 4),
        teamB: cores(5, 4),
        seed: 5,
        sideOptions: [{ coreHealths: [900, 800, 700, 600] }, {}],
      },
    };
    const r = simulateRecord(d, content, battleConfig);
    if (!r.ok) throw new Error(r.error.message);
    const pb = new Playback(d, content, battleConfig, r.record);
    expect(sideStats(pb, content, 0, 10).cores.map((c) => c.max)).toEqual([
      900, 800, 700, 600,
    ]);
    expect(sideStats(pb, content, 1, 10).cores).toHaveLength(4);
    expect(coreMaxima(r.record, 1)).toHaveLength(4);
    pb.skip();
    const sides = r.record.summary.sides;
    expect(sides[0].cores).toHaveLength(4);
    expect(sides[1].cores).toHaveLength(4);
    // A side with a player without a Core no longer fights (PP-2).
    const partial = {
      ...cores(3, 4),
      cores: cores(3, 4).cores.map((c, p) => (p < 2 ? c : null)),
    };
    const bad = simulateRecord(
      {
        kind: 'versus',
        input: { teamA: partial, teamB: cores(5, 4), seed: 5 },
      },
      content,
      battleConfig,
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('core_not_placed');
  }, 120_000);

  test('the time-limit text names the ladder', () => {
    expect(reasonText('time_limit', 'Core')).toMatch(/more Cores standing/);
    expect(reasonText('time_limit', 'Core')).toMatch(/total Core health/);
  });
});
