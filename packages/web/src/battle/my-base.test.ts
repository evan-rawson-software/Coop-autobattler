import { generateMap, listLegalCorePositions, placeCore } from '@game/core';
import { describe, expect, test } from 'vitest';
import { buildScene, ownCoreCentre } from '../board/scene.js';
import { content } from '../content.js';
import { buildSampleTeam } from '../sample-team.js';
import { Playback, simulateRecord } from './playback.js';
import { battleConfig } from './setup.js';
import type { BattleDescription } from './types.js';

const team = (seed: number, players: number) => {
  const map = generateMap(seed, players, content, content.mapgen);
  let state = buildSampleTeam(map, content, seed);
  for (let p = 0; p < players; p++) {
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

const sceneOf = (players: number) =>
  buildScene(team(3, players), team(4, players), 4, content);

const centreOf = (scene: ReturnType<typeof sceneOf>, player: number) => {
  const own = scene.boards.find((b) => b.frame.id === 'own');
  const r = own?.cores[player]?.rect;
  if (r === undefined) throw new Error('no Core');
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
};

describe('"My base" centres on the acting player\'s Core', () => {
  test('solo: the only Core', () => {
    const scene = sceneOf(1);
    expect(ownCoreCentre(scene, 0)).toEqual(centreOf(scene, 0));
    expect(ownCoreCentre(scene, 0)).toEqual(ownCoreCentre(scene));
  });

  test("acting player 2 of 3: that player's Core", () => {
    const scene = sceneOf(3);
    expect(ownCoreCentre(scene, 1)).toEqual(centreOf(scene, 1));
    expect(ownCoreCentre(scene, 1)).not.toEqual(centreOf(scene, 0));
    expect(ownCoreCentre(scene, 2)).toEqual(centreOf(scene, 2));
  });

  test('a fallen Core keeps its position', () => {
    const d: BattleDescription = {
      kind: 'versus',
      input: {
        teamA: team(3, 2),
        teamB: team(4, 2),
        seed: 3,
        sideOptions: [{ coreHealths: [1, 1] }, {}],
      },
    };
    const r = simulateRecord(d, content, battleConfig);
    if (!r.ok) throw new Error(r.error.message);
    const pb = new Playback(d, content, battleConfig, r.record);
    const before = buildScene(
      r.record.initialTeams[0],
      r.record.initialTeams[1],
      r.record.zone.depth,
      content,
    );
    pb.skip();
    expect(
      r.record.eventLog.filter((e) => e.type === 'core_destroyed').length,
    ).toBeGreaterThan(0);
    const after = buildScene(
      pb.sim.teams[0],
      pb.sim.teams[1],
      r.record.zone.depth,
      content,
    );
    expect(ownCoreCentre(after, 1)).toEqual(ownCoreCentre(before, 1));
    expect(ownCoreCentre(after, 1)).toEqual(centreOf(before, 1));
  }, 120_000);

  test('no acting player: the first Core', () => {
    const scene = sceneOf(3);
    expect(ownCoreCentre(scene)).toEqual(centreOf(scene, 0));
    expect(ownCoreCentre(scene, null)).toEqual(centreOf(scene, 0));
    expect(ownCoreCentre(scene, undefined)).toEqual(centreOf(scene, 0));
  });
});
