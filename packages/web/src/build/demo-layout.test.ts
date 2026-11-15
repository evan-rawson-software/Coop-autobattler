import { listLegalCorePositions, type Cell } from '@game/core';
import { describe, expect, test } from 'vitest';
import { content } from '../content.js';
import { REFINING_DEMO_KIT, planRefiningDemo } from './demo-layout.js';
import { BuildSession } from './session.js';
import { DEFAULT_SEED } from './setup.js';

async function demoSession(seed: number): Promise<BuildSession> {
  const s = await BuildSession.start(
    seed,
    Date.now,
    ['You'],
    REFINING_DEMO_KIT,
  );
  const pos = listLegalCorePositions(
    s.run.team.map,
    content,
    content.mapgen,
    0,
  )[0] as Cell;
  expect(
    (await s.dispatch({ type: 'place_core', x: pos.x, y: pos.y })).ok,
  ).toBe(true);
  expect((await s.dispatch({ type: 'ready' })).ok).toBe(true);
  return s;
}

describe('the refining demo layout', () => {
  test.each([1, 2, 3])(
    'seed %i: every step is accepted by the session, and the chains are wired',
    async (seed) => {
      const s = await demoSession(seed);
      const plan = planRefiningDemo(s.run.team, content);
      for (const a of plan.actions) {
        const r = await s.act(a);
        expect(r.ok, JSON.stringify([a, r])).toBe(true);
      }
      const team = s.run.team;
      const placed = (def: string) =>
        team.buildings.filter((b) => b.def === def).length;
      // Most seeds fit all three consumers; at least one chain must fit.
      const consumers = [
        'bld_refinery_ab',
        'bld_refinery_bc',
        'bld_foundry',
      ].reduce((n, d) => n + placed(d), 0);
      expect(consumers).toBeGreaterThan(0);
      expect(team.conduits.length).toBeGreaterThan(0);
      // A refinery with its collectors is followed by what it feeds.
      expect(placed('bld_golem_forge')).toBeLessThanOrEqual(
        placed('bld_refinery_ab'),
      );
      expect(placed('bld_spire')).toBeLessThanOrEqual(
        placed('bld_refinery_bc'),
      );
    },
  );

  test('the default dev seed gets all three chains', async () => {
    const s = await demoSession(DEFAULT_SEED);
    const plan = planRefiningDemo(s.run.team, content);
    for (const a of plan.actions) await s.act(a);
    for (const d of [
      'bld_refinery_ab',
      'bld_refinery_bc',
      'bld_foundry',
      'bld_golem_forge',
      'bld_spire',
    ]) {
      expect(
        s.run.team.buildings.some((b) => b.def === d),
        d,
      ).toBe(true);
    }
  });
});
