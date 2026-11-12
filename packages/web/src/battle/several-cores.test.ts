import { generateMap, listLegalCorePositions, placeCore } from '@game/core';
import { describe, expect, test } from 'vitest';
import { buildScene, enemyCoreCentre } from '../board/scene.js';
import { content } from '../content.js';
import { buildSampleTeam } from '../sample-team.js';
import { destroyedOf, sideStats } from './derive.js';
import { makeDrawIndex } from './draw.js';
import { reasonText } from './panels.js';
import { Playback, simulateRecord } from './playback.js';
import { battleConfig } from './setup.js';
import type { BattleDescription } from './types.js';

const twoCores = (seed: number) => {
  const map = generateMap(seed, 2, content, content.mapgen);
  let state = buildSampleTeam(map, content, seed);
  for (let p = 0; p < 2; p++) {
    if (state.cores[p] !== null) continue;
    const pos = listLegalCorePositions(map, content, content.mapgen, p)[0];
    if (pos === undefined) throw new Error('no legal Core position');
    const r = placeCore(state, content, content.mapgen, p, pos);
    if (!r.ok) throw new Error(r.reason);
    state = r.state;
  }
  return state;
};

describe('several Cores per side', () => {
  test('every Core has its own health, rectangle and fall', () => {
    const d: BattleDescription = {
      kind: 'versus',
      input: { teamA: twoCores(3), teamB: twoCores(4), seed: 3 },
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
    const fallen = end.cores.filter((c) => c.hp === 0).map((c) => c.player);
    expect(fallen).toEqual(destroyedOf(rec, 0).cores.slice().sort());
    expect(rec.summary.sides[0].coresStanding).toBe(2 - fallen.length);
  }, 120_000);

  test('the time-limit text names the ladder', () => {
    expect(reasonText('time_limit', 'Core')).toMatch(/more Cores standing/);
    expect(reasonText('time_limit', 'Core')).toMatch(/total Core health/);
  });
});
