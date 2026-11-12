import { describe, expect, test } from 'vitest';
import { MAX_DAMAGE, MAX_HEALTH } from './limits.js';
import { simulatePveBattle, startPveBattle } from './pve-battle.js';
import { unitStats } from './arena-sim.js';
import { buildStronghold, generateThreat } from './threat-gen.js';
import { THREAT_TYPES, maxThreatRound } from './threats.js';
import { maxStrengthPercent } from './units.js';
import { content, mapgen, simConfig, threats } from './test-support.js';

const config = { sim: simConfig, mapgen };
const configs = { threats, mapgen };
const ROUNDS = maxThreatRound(threats);
const SIZES = [1, 2, 3, 4];

function profile(
  archetype: string,
  type: (typeof THREAT_TYPES)[number],
  size: number,
  round: number,
) {
  return generateThreat(
    { seed: 1000 + round, round, type, partySize: size, archetype },
    content,
    configs,
  );
}

/** A party of the given size: the Core-only board of the round-1 stronghold. */
function party(size: number) {
  return buildStronghold(
    generateThreat(
      {
        seed: 1,
        round: 1,
        type: 'easy',
        partySize: size,
        archetype: 'arch_rusher',
      },
      content,
      configs,
    ),
    content,
    mapgen,
  );
}

describe('generated threats stay within the content bounds', () => {
  test('every unit type at the clamped strength is within the caps', () => {
    for (const def of content.units.list()) {
      const p = maxStrengthPercent(def);
      const at = unitStats(0, def, p);
      expect(at.health).toBeLessThanOrEqual(MAX_HEALTH);
      expect(at.damage).toBeLessThanOrEqual(MAX_DAMAGE);
      // One more percent would pass a cap.
      const over = (): unknown => unitStats(0, def, p + 1);
      expect(over).toThrow(RangeError);
    }
  });

  test('no generated threat is clamped, and each starts a battle', () => {
    const strengthLimit = content.units
      .list()
      .reduce((m, def) => Math.min(m, maxStrengthPercent(def)), Infinity);
    let maxCore = 0;
    let maxStrength = 0;
    for (const arch of threats.archetypes) {
      for (const type of THREAT_TYPES) {
        for (const size of SIZES) {
          const team = party(size);
          for (let round = 1; round <= ROUNDS; round++) {
            const t = profile(arch.id, type, size, round);
            const where = `${arch.id} ${type} party ${String(size)} round ${String(round)}`;
            // Strictly below the clamps: a clamped value would equal them.
            const coreMax = Math.max(
              ...t.stronghold.cores.map((c) => c.health),
            );
            expect(coreMax, where).toBeLessThan(MAX_HEALTH);
            expect(t.unitStrengthPercent, where).toBeLessThan(strengthLimit);
            if (round === ROUNDS) {
              maxCore = Math.max(maxCore, coreMax);
              maxStrength = Math.max(maxStrength, t.unitStrengthPercent);
            }
            const r = startPveBattle(
              { team, threat: t, seed: 5 },
              content,
              config,
            );
            expect(r.ok, where).toBe(true);
          }
        }
      }
    }
    // Large headroom: the largest values at the last round are far below.
    expect(maxCore * 3).toBeLessThan(MAX_HEALTH);
    expect(maxStrength * 10).toBeLessThan(strengthLimit);
  }, 300_000);

  test('sampled boss threats simulate to the end', () => {
    for (const arch of threats.archetypes) {
      for (const size of [1, 4]) {
        for (const round of [30, 42, ROUNDS]) {
          const t = profile(arch.id, 'boss', size, round);
          const r = simulatePveBattle(
            { team: party(size), threat: t, seed: 9 },
            content,
            config,
          );
          expect(r.ok).toBe(true);
        }
      }
    }
  });
});
