import {
  buildReferenceBoard,
  generateThreat,
  simulatePveBattle,
} from '@game/core';
import { describe, expect, test } from 'vitest';
import { content } from '../content.js';
import { battleConfig, threatsConfig } from './setup.js';

describe('wave archers and drones on the Battle screen (issue #59)', () => {
  test('a round-10 wave battle spawns archers and drones', () => {
    const threat = generateThreat(
      {
        seed: 9,
        round: 10,
        type: 'medium',
        partySize: 1,
        archetype: 'arch_rusher',
      },
      content,
      { threats: threatsConfig, mapgen: content.mapgen },
    );
    const r = simulatePveBattle(
      {
        team: buildReferenceBoard('fortify', content, content.mapgen),
        threat,
        seed: 3,
      },
      content,
      battleConfig,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const spawned = new Set(
      r.eventLog.flatMap((e) =>
        e.type === 'unit_spawned' && e.side === 1 ? [e.def] : [],
      ),
    );
    // Their sprites (both sides, idle, walk, attack) are pinned in
    // packages/art/src/assets.test.ts; the screen draws any unit def it has art for.
    for (const def of ['unit_archer', 'unit_drone']) {
      expect(spawned.has(def), def).toBe(true);
    }
  });
});
