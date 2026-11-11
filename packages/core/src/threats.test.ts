import { describe, expect, test } from 'vitest';
import threatsJson from '../../../content/threats.json';
import { hashJson } from './hash.js';
import {
  buildStronghold,
  generateThreat,
  pickArchetypes,
  scaleShare,
  threatSummary,
  type ThreatInput,
} from './threat-gen.js';
import {
  THREAT_TYPES,
  budgetLimit,
  loadThreats,
  maxThreatRound,
  threatBudget,
  type ThreatType,
  type ThreatsConfig,
} from './threats.js';
import { content, got, mapgen, threats } from './test-support.js';

/** The budget formula computed independently with BigInt. */
function bigBudget(
  config: ThreatsConfig,
  round: number,
  type: ThreatType,
  partySize: number,
): number {
  let v = BigInt(config.baseBudget);
  for (let i = 1; i < round; i++) v = (v * BigInt(config.growthPercent)) / 100n;
  v = (v * BigInt(config.typeMultiplierPercent[type])) / 100n;
  return Number(v * BigInt(partySize));
}

const configs = { threats, mapgen };

describe('budget (SC-1)', () => {
  test('follows the configured curve exactly', () => {
    for (const type of THREAT_TYPES) {
      for (const party of [1, 2, 3, 4]) {
        for (let round = 1; round <= 40; round++) {
          expect(threatBudget(threats, round, type, party)).toBe(
            bigBudget(threats, round, type, party),
          );
        }
      }
    }
    // A few absolute values: 100 * 1.35^(r-1) with a floor after each step.
    expect(threatBudget(threats, 1, 'medium', 1)).toBe(100);
    expect(threatBudget(threats, 2, 'medium', 1)).toBe(135);
    expect(threatBudget(threats, 3, 'medium', 1)).toBe(182);
    expect(threatBudget(threats, 3, 'hard', 2)).toBe(
      2 * Math.floor((182 * 140) / 100),
    );
    expect(threatBudget(threats, 1, 'easy', 1)).toBe(70);
  });

  test('is clamped at the maximum round and never leaves the safe range', () => {
    const max = maxThreatRound(threats);
    expect(max).toBeGreaterThan(30);
    const limit = budgetLimit(threats);
    expect(bigBudget(threats, max, 'medium', 1)).toBeLessThanOrEqual(limit);
    // The next round would exceed the limit.
    expect(
      Number(
        (BigInt(bigBudget(threats, max, 'medium', 1)) *
          BigInt(threats.growthPercent)) /
          100n,
      ),
    ).toBeGreaterThan(limit);
    for (const type of THREAT_TYPES) {
      expect(threatBudget(threats, max + 25, type, 4)).toBe(
        threatBudget(threats, max, type, 4),
      );
    }
    expect(
      Number.isSafeInteger(threatBudget(threats, 1000, 'boss', 4) * 1000),
    ).toBe(true);
  });

  test('rejects bad rounds and party sizes', () => {
    expect(() => threatBudget(threats, 0, 'easy', 1)).toThrow(RangeError);
    expect(() => threatBudget(threats, 1.5, 'easy', 1)).toThrow(RangeError);
    expect(() => threatBudget(threats, 1, 'easy', 0)).toThrow(RangeError);
    expect(() => threatBudget(threats, 1, 'easy', 5)).toThrow(RangeError);
  });

  test('scaling constants are editable in the configuration alone', () => {
    const alt: ThreatsConfig = {
      ...threats,
      baseBudget: 50,
      growthPercent: 150,
      typeMultiplierPercent: { easy: 50, medium: 100, hard: 200, boss: 300 },
    };
    for (const type of THREAT_TYPES) {
      for (let round = 1; round <= 12; round++) {
        expect(threatBudget(alt, round, type, 3)).toBe(
          bigBudget(alt, round, type, 3),
        );
      }
    }
    expect(threatBudget(alt, 4, 'medium', 1)).not.toBe(
      threatBudget(threats, 4, 'medium', 1),
    );
    const input: ThreatInput = {
      seed: 5,
      round: 6,
      type: 'hard',
      partySize: 1,
      archetype: 'arch_escalator',
    };
    const a = generateThreat(input, content, configs);
    const b = generateThreat(input, content, { threats: alt, mapgen });
    expect(a.budget).toBe(bigBudget(threats, 6, 'hard', 1));
    expect(b.budget).toBe(bigBudget(alt, 6, 'hard', 1));
    expect(hashJson(a as never)).not.toBe(hashJson(b as never));
  });
});

describe('the loader', () => {
  const ctx = { units: content.units, buildings: content.buildings };
  const edit = (f: (d: Record<string, unknown>) => void): unknown => {
    const d = JSON.parse(JSON.stringify(threatsJson)) as Record<
      string,
      unknown
    >;
    f(d);
    return d;
  };

  test('accepts the shipped file', () => {
    expect(loadThreats(threatsJson, ctx).ok).toBe(true);
  });

  test('rejects bad data with readable errors', () => {
    const bad = (
      f: (d: Record<string, unknown>) => void,
    ): readonly string[] => {
      const r = loadThreats(edit(f), ctx);
      return r.ok ? [] : r.errors;
    };
    expect(bad((d) => (d['growthPercent'] = 100)).join()).toMatch(
      /growthPercent/,
    );
    expect(bad((d) => (d['growthPercent'] = 135.5)).join()).toMatch(
      /growthPercent/,
    );
    expect(bad((d) => (d['extra'] = 1)).join()).toMatch(
      /unknown field "extra"/,
    );
    expect(
      bad((d) => {
        (d['unitCost'] as { unit: string }[])[0] = {
          unit: 'unit_nope',
        };
      }).join(),
    ).toMatch(/unknown unit/);
    expect(
      bad((d) => {
        const a = (
          d['archetypes'] as { stronghold: { wallSharePercent: number } }[]
        )[1];
        got(a).stronghold.wallSharePercent = 80;
      }).join(),
    ).toMatch(/sum to at most 100/);
    expect(bad((d) => (d['baseBudget'] = 2 ** 52)).join()).toMatch(
      /safe budget limit/,
    );
    expect(loadThreats(null, ctx).ok).toBe(false);
  });
});

describe('generateThreat', () => {
  test('is pure: the same inputs give the same profile', () => {
    const input: ThreatInput = {
      seed: 42,
      round: 7,
      type: 'medium',
      partySize: 2,
      archetype: 'arch_boss',
    };
    const a = generateThreat(input, content, configs);
    const b = generateThreat({ ...input }, content, configs);
    expect(a).toEqual(b);
    expect(hashJson(a as never)).toBe(hashJson(b as never));
    const c = generateThreat({ ...input, seed: 43 }, content, configs);
    expect(hashJson(c as never)).not.toBe(hashJson(a as never));
  });

  test('every profile builds, respects the caps and stays inside the budget', () => {
    const cap = (party: number): number =>
      threats.maxUnitsPerWavePerPlot * party;
    for (const arch of threats.archetypes) {
      for (const type of THREAT_TYPES) {
        for (const party of [1, 2, 3, 4]) {
          for (const round of [1, 2, 3, 5, 8, 12, 15, 20, 30]) {
            const p = generateThreat(
              {
                seed: round * 7 + party,
                round,
                type,
                partySize: party,
                archetype: arch.id,
              },
              content,
              configs,
            );
            expect(p.budget).toBe(bigBudget(threats, round, type, party));
            // The stronghold is valid (throws otherwise).
            const state = buildStronghold(p, content, mapgen);
            expect(state.buildings).toHaveLength(p.stronghold.buildings.length);
            expect(state.map.width).toBe(party * mapgen.plotWidth);
            // Waves: in tick order, each wave tick's units within the cap.
            const perTick = new Map<number, number>();
            let last = -1;
            for (const w of p.waves) {
              expect(w.tick).toBeGreaterThanOrEqual(last);
              last = w.tick;
              perTick.set(w.tick, (perTick.get(w.tick) ?? 0) + w.count);
            }
            expect(perTick.size).toBe(arch.waves.count);
            for (const n of perTick.values())
              expect(n).toBeLessThanOrEqual(cap(party));
            expect(p.unitStrengthPercent).toBeGreaterThanOrEqual(0);
            expect(p.stronghold.coreHealth).toBeGreaterThanOrEqual(
              threats.minCoreHealth,
            );
          }
        }
      }
    }
  });

  test('late rounds get their power from unitStrengthPercent', () => {
    const early = generateThreat(
      {
        seed: 1,
        round: 1,
        type: 'medium',
        partySize: 1,
        archetype: 'arch_rusher',
      },
      content,
      configs,
    );
    expect(early.unitStrengthPercent).toBe(0);
    let previous = 0;
    for (const round of [10, 15, 20, 25]) {
      const p = generateThreat(
        {
          seed: 1,
          round,
          type: 'hard',
          partySize: 1,
          archetype: 'arch_escalator',
        },
        content,
        configs,
      );
      expect(p.unitStrengthPercent).toBeGreaterThan(previous);
      previous = p.unitStrengthPercent;
    }
  });

  test('total wave power tracks the wave budget', () => {
    const cost = (u: string): number =>
      got(threats.unitCost.find((c) => c.unit === u)).cost;
    for (const arch of threats.archetypes) {
      for (const round of [6, 10, 15, 20]) {
        const p = generateThreat(
          {
            seed: round,
            round,
            type: 'medium',
            partySize: 1,
            archetype: arch.id,
          },
          content,
          configs,
        );
        const waveBudget = Math.floor((p.budget * arch.waveSharePercent) / 100);
        const power = p.waves.reduce(
          (a, w) =>
            a + (w.count * cost(w.unit) * (100 + p.unitStrengthPercent)) / 100,
          0,
        );
        expect(power).toBeGreaterThan(waveBudget * 0.5);
        expect(power).toBeLessThan(waveBudget * 1.5);
      }
    }
  });

  test('the Boss template has all-raider signature waves', () => {
    const p = generateThreat(
      { seed: 3, round: 6, type: 'boss', partySize: 1, archetype: 'arch_boss' },
      content,
      configs,
    );
    const ticks = [...new Set(p.waves.map((w) => w.tick))];
    expect(ticks).toHaveLength(6);
    const units = (tick: number): string[] =>
      p.waves.filter((w) => w.tick === tick).map((w) => w.unit);
    expect(units(got(ticks[2]))).toEqual(['unit_raider']);
    expect(units(got(ticks[5]))).toEqual(['unit_raider']);
    expect(units(got(ticks[0]))).toContain('unit_soldier');
  });

  test('rejects unknown archetypes, types and oversized parties', () => {
    const base: ThreatInput = {
      seed: 1,
      round: 1,
      type: 'easy',
      partySize: 1,
      archetype: 'arch_rusher',
    };
    expect(() =>
      generateThreat({ ...base, archetype: 'arch_x' }, content, configs),
    ).toThrow(RangeError);
    expect(() =>
      generateThreat({ ...base, type: 'nope' as ThreatType }, content, configs),
    ).toThrow(RangeError);
    expect(() =>
      generateThreat({ ...base, partySize: 5 }, content, configs),
    ).toThrow(RangeError);
  });
});

describe('layouts', () => {
  const gen = (archetype: string, party = 1, round = 8) =>
    generateThreat(
      { seed: 9, round, type: 'medium', partySize: party, archetype },
      content,
      configs,
    );

  test('open has no walls; ring has walls and gaps; line has a gap per plot', () => {
    const open = gen('arch_rusher');
    expect(threatSummary(open, content).walls).toBe(0);
    const ring = gen('arch_fortress');
    expect(threatSummary(ring, content).walls).toBeGreaterThan(8);
    const line = gen('arch_escalator', 4, 12);
    const walls = line.stronghold.buildings.filter((b) => b.def === 'bld_wall');
    const rows = new Set(walls.map((w) => w.y));
    expect(rows.has(threats.layouts.line.lineRow)).toBe(true);
    const topRow = new Set(
      walls.filter((w) => w.y === threats.layouts.line.lineRow).map((w) => w.x),
    );
    for (let p = 0; p < 4; p++) {
      let open = 0;
      for (let x = p * 24; x < (p + 1) * 24; x++) if (!topRow.has(x)) open += 1;
      expect(open).toBe(threats.layouts.line.gapWidth);
    }
  });

  test('turrets never stand on the front row, a wall or the Core', () => {
    for (const a of threats.archetypes) {
      const p = gen(a.id, 2, 14);
      const seen = new Set<string>();
      const core = p.stronghold.corePosition;
      for (const b of p.stronghold.buildings) {
        const k = `${String(b.x)},${String(b.y)}`;
        expect(seen.has(k)).toBe(false);
        seen.add(k);
        expect(b.y).toBeLessThan(mapgen.plotDepth - 1);
        expect(
          b.x >= core.x &&
            b.x < core.x + 2 &&
            b.y >= core.y &&
            b.y < core.y + 2,
        ).toBe(false);
      }
    }
  });
});

describe('pickArchetypes and threatSummary', () => {
  test('three distinct, deterministic, non-boss archetypes', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 20; seed++) {
      for (let round = 1; round <= 5; round++) {
        const a = pickArchetypes(seed, round, threats);
        const b = pickArchetypes(seed, round, threats);
        expect(a).toEqual(b);
        expect(new Set([a.easy, a.medium, a.hard]).size).toBe(3);
        for (const id of [a.easy, a.medium, a.hard]) {
          expect(
            got(threats.archetypes.find((x) => x.id === id)).bossOnly,
          ).toBe(false);
          seen.add(id);
        }
      }
    }
    expect(seen.size).toBe(3);
  });

  test('wraps around when fewer than three archetypes exist', () => {
    const two: ThreatsConfig = {
      ...threats,
      archetypes: threats.archetypes.filter((a) => a.id !== 'arch_escalator'),
    };
    const p = pickArchetypes(1, 1, two);
    expect(p.hard).toBe(p.easy);
    expect(p.easy).not.toBe(p.medium);
  });

  test('the summary describes the profile', () => {
    const p = generateThreat(
      {
        seed: 2,
        round: 5,
        type: 'hard',
        partySize: 1,
        archetype: 'arch_fortress',
      },
      content,
      configs,
    );
    const s = threatSummary(p, content);
    expect(s.archetype).toBe('arch_fortress');
    expect(s.type).toBe('hard');
    expect(s.level).toBe(3);
    expect(s.totalUnits).toBe(p.waves.reduce((a, w) => a + w.count, 0));
    expect(s.firstWaveTick).toBe(got(p.waves[0]).tick);
    expect(s.coreHealth).toBe(p.stronghold.coreHealth);
    expect(s.walls + s.turrets).toBe(p.stronghold.buildings.length);
    expect(
      threatSummary({ ...p, type: 'easy', waves: [] }, content),
    ).toMatchObject({ level: 1, firstWaveTick: null, totalUnits: 0 });
  });
});

describe('scaleShare', () => {
  test('is floor(total * part / whole) without overflow', () => {
    expect(scaleShare(1000, 1, 3)).toBe(333);
    expect(scaleShare(7, 7, 7)).toBe(7);
    const big = 9_000_000_000_000;
    expect(scaleShare(big, 1_000_000, 3_000_000)).toBe(3_000_000_000_000);
    expect(BigInt(scaleShare(big + 1, 5, 7))).toBe(
      ((BigInt(big) + 1n) * 5n) / 7n,
    );
  });
});
