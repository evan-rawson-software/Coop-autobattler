import { describe, expect, test } from 'vitest';
import { MAX_HEALTH } from './limits.js';
import { simulatePveBattle, startPveBattle } from './pve-battle.js';
import {
  buildStronghold,
  generateThreat,
  shareOf,
  threatSummary,
  type ThreatProfile,
} from './threat-gen.js';
import { THREAT_TYPES, maxThreatRound } from './threats.js';
import {
  content,
  Lab,
  bigBoard,
  got,
  mapgen,
  simConfig,
  threats,
} from './testing/support.js';

const config = { sim: simConfig, mapgen };
const configs = { threats, mapgen };
const ROUNDS = maxThreatRound(threats);

function profile(
  archetype: string,
  type: (typeof THREAT_TYPES)[number],
  size: number,
  round: number,
): ThreatProfile {
  return generateThreat(
    { seed: 31 + round, round, type, partySize: size, archetype },
    content,
    configs,
  );
}

/** A dense four-plot party: 96 barracks and 48 sources. */
function denseParty() {
  const lab = new Lab(bigBoard().map);
  lab.state = bigBoard();
  lab.allCores(6);
  return lab.state;
}

describe('shareOf', () => {
  test('floor(total / n) each, one more for the lowest plot indices', () => {
    expect([0, 1, 2, 3].map((p) => shareOf(10, p, 4))).toEqual([3, 3, 2, 2]);
    expect([0, 1, 2].map((p) => shareOf(7, p, 3))).toEqual([3, 2, 2]);
    expect([0, 1].map((p) => shareOf(0, p, 2))).toEqual([0, 0]);
    expect(shareOf(5, 0, 1)).toBe(5);
  });
});

describe('one Core per player (PP-14)', () => {
  test('every threat, boss included, has one Core per plot, health split evenly, clamp never reached', () => {
    for (const arch of threats.archetypes) {
      for (const type of THREAT_TYPES) {
        for (let size = 1; size <= 4; size++) {
          for (let round = 1; round <= ROUNDS; round++) {
            const p = profile(arch.id, type, size, round);
            const where = `${arch.id} ${type} ${String(size)}p r${String(round)}`;
            const cores = p.stronghold.cores;
            expect(cores, where).toHaveLength(size);
            cores.forEach((c, i) => {
              expect(c.x, where).toBeGreaterThanOrEqual(i * mapgen.plotWidth);
              expect(c.x + 1, where).toBeLessThan((i + 1) * mapgen.plotWidth);
              // The clamp to MAX_HEALTH is not reached: the sum is exact.
              expect(c.health, where).toBeLessThan(MAX_HEALTH);
              expect(c.health, where).toBeGreaterThanOrEqual(
                threats.minCoreHealth,
              );
            });
            const hs = cores.map((c) => c.health);
            expect(
              Math.max(...hs) - Math.min(...hs),
              where,
            ).toBeLessThanOrEqual(1);
            // Extra points go to the lowest plot indices.
            for (let i = 1; i < hs.length; i++) {
              expect(got(hs[i - 1]), where).toBeGreaterThanOrEqual(got(hs[i]));
            }
            const total = hs.reduce((a, h) => a + h, 0);
            // The expected total, worked out on its own from the budget, the
            // price of the placed walls and turrets and the archetype.
            const stronghold =
              p.budget - Math.floor((p.budget * arch.waveSharePercent) / 100);
            const spent = p.stronghold.buildings.reduce(
              (a, b) =>
                a +
                (
                  got(got(content.buildings.get(b.def)).tiers[0]) as {
                    price: number;
                  }
                ).price,
              0,
            );
            const expected = Math.max(
              threats.minCoreHealth * size,
              Math.floor(
                ((stronghold - spent) * arch.stronghold.coreHealthPerBudget) /
                  100,
              ),
            );
            expect(total, where).toBe(expected);
            expect(threatSummary(p, content), where).toMatchObject({
              coreHealth: total,
              cores: size,
            });
          }
        }
      }
    }
  }, 300_000);

  test('every building stands inside one plot and belongs to it; every stronghold builds (rounds 1 to 63)', () => {
    for (const arch of threats.archetypes) {
      for (let size = 1; size <= 4; size++) {
        for (let round = 1; round <= 63; round++) {
          const p = profile(arch.id, 'hard', size, round);
          const state = buildStronghold(p, content, mapgen);
          expect(state.cores.every((c) => c !== null)).toBe(true);
          for (const b of state.buildings) {
            const plot = Math.floor(b.x / mapgen.plotWidth);
            expect(b.owner).toBe(plot);
            expect(plot).toBeLessThan(size);
          }
        }
      }
    }
  }, 300_000);

  test('a four-plot Fortress has one ring set per plot', () => {
    const p = profile('arch_fortress', 'hard', 4, 12);
    const state = buildStronghold(p, content, mapgen);
    for (let plot = 0; plot < 4; plot++) {
      const walls = state.buildings.filter(
        (b) => b.def === 'bld_wall_block' && b.owner === plot,
      );
      expect(walls.length).toBeGreaterThan(8);
      const core = got(p.stronghold.cores[plot]);
      // A ring surrounds that plot's own Core: walls on all four sides of it.
      expect(walls.some((w) => w.x < core.x)).toBe(true);
      expect(walls.some((w) => w.x > core.x + 1)).toBe(true);
      expect(walls.some((w) => w.y < core.y)).toBe(true);
      expect(walls.some((w) => w.y > core.y + 1)).toBe(true);
    }
    // The plots' layouts differ: one stream per plot.
    const rel = (plot: number): string =>
      state.buildings
        .filter((b) => b.def === 'bld_turret' && b.owner === plot)
        .map((b) => `${String(b.x - plot * mapgen.plotWidth)},${String(b.y)}`)
        .join(';');
    expect(new Set([0, 1, 2, 3].map(rel)).size).toBeGreaterThan(1);
  });
});

describe('PvE battles against several Cores', () => {
  test('a wave unit heads for the Core of the plot it enters', () => {
    const t = profile('arch_rusher', 'hard', 4, 12);
    const s = startPveBattle(
      { team: denseParty(), threat: t, seed: 3 },
      content,
      config,
    );
    if (!s.ok) throw new Error('refused');
    const { battle } = s;
    const firstWave = got(t.waves[0]).tick;
    while (battle.sim.tick <= firstWave + 200) battle.step();
    const spawns = battle.eventLog.filter(
      (e) => e.type === 'unit_spawned' && e.side === 1 && e.building === 0,
    );
    expect(spawns.length).toBeGreaterThan(0);
    const owners = new Set<number>();
    for (const e of spawns) {
      if (e.type !== 'unit_spawned') continue;
      // Own-frame plot `owner` faces party plot `3 - owner` (half-turn).
      expect(e.target).toBe(3 - e.owner);
      owners.add(e.owner);
    }
    expect(owners.size).toBeGreaterThan(1);
  });

  test('the party wins only after every stronghold Core is destroyed', () => {
    const t = profile('arch_rusher', 'easy', 4, 1);
    const r = simulatePveBattle(
      { team: denseParty(), threat: t, seed: 3 },
      content,
      config,
    );
    if (!r.ok) throw new Error(r.error.message);
    expect(r.result).toMatchObject({ winner: 0, reason: 'core_destroyed' });
    const fallen = r.eventLog.filter(
      (e) => e.type === 'core_destroyed' && e.side === 1,
    );
    expect(fallen).toHaveLength(4);
    expect(got(fallen[3]).tick).toBe(r.result.endTick - 1);
  });
});
