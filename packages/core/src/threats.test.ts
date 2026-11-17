import { describe, expect, test } from 'vitest';
import threatsJson from '../../../content/threats.json';
import { hashJson } from './hash.js';
import {
  buildStronghold,
  generateThreat,
  pickArchetypes,
  pickBoss,
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
import { Rng } from './rng.js';
import { content, got, mapgen, threats } from './testing/support.js';

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
    // A few absolute values: 100 * 1.25^(r-1) with a floor after each step.
    expect(threatBudget(threats, 1, 'medium', 1)).toBe(100);
    expect(threatBudget(threats, 2, 'medium', 1)).toBe(125);
    expect(threatBudget(threats, 3, 'medium', 1)).toBe(156);
    expect(threatBudget(threats, 3, 'hard', 2)).toBe(
      2 * Math.floor((156 * 140) / 100),
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

  test('boss gating fields: required for a boss, rejected otherwise, bounded', () => {
    const errs = (f: (a: Record<string, unknown>[]) => void): string => {
      const r = loadThreats(
        edit((d) => {
          f(d['archetypes'] as Record<string, unknown>[]);
        }),
        ctx,
      );
      return r.ok ? '' : r.errors.join('\n');
    };
    const bossIx = threats.archetypes.findIndex((a) => a.bossOnly);
    const boss = (a: Record<string, unknown>[]) =>
      a[bossIx] as Record<string, unknown>;
    expect(errs((a) => delete boss(a)['fromRound'])).toMatch(/fromRound/);
    expect(errs((a) => delete boss(a)['minPartySize'])).toMatch(/minPartySize/);
    expect(errs((a) => (boss(a)['fromRound'] = 0))).toMatch(/fromRound/);
    expect(errs((a) => (boss(a)['minPartySize'] = 5))).toMatch(
      /at most maxPartySize/,
    );
    expect(errs((a) => (boss(a)['minPartySize'] = 1.5))).toMatch(
      /minPartySize/,
    );
    expect(
      errs((a) => ((a[0] as Record<string, unknown>)['minPartySize'] = 1)),
    ).toMatch(/only allowed when "bossOnly" is true/);
    // A threat type may have a fromRound (at least 1); one must start at 1.
    expect(
      errs((a) => {
        for (const x of a) if (x['bossOnly'] === false) x['fromRound'] = 3;
      }),
    ).toMatch(/needs "fromRound" 1/);
    expect(
      errs((a) => ((a[0] as Record<string, unknown>)['fromRound'] = 0)),
    ).toMatch(/fromRound/);
    expect(
      errs((a) => ((a[1] as Record<string, unknown>)['fromRound'] = 3)),
    ).toBe('');
    // A boss roster needs one boss from round 1 for one player.
    expect(errs((a) => (boss(a)['fromRound'] = 2))).toMatch(/always be drawn/);
  });

  test('brood: thresholds strictly descending, 1 to 99, at most 5; share 1 to 60; boss-only', () => {
    const broodIx = threats.archetypes.findIndex((a) => a.brood !== undefined);
    expect(broodIx).toBeGreaterThan(0);
    const errs = (f: (b: Record<string, unknown>) => void): string => {
      const r = loadThreats(
        edit((d) => {
          const a = (d['archetypes'] as Record<string, unknown>[])[broodIx];
          f(a as Record<string, unknown>);
        }),
        ctx,
      );
      return r.ok ? '' : r.errors.join('\n');
    };
    const brood = (a: Record<string, unknown>) =>
      a['brood'] as Record<string, unknown>;
    expect(errs(() => undefined)).toBe('');
    expect(errs((a) => (brood(a)['thresholdsPercent'] = [50, 75]))).toMatch(
      /strictly descending/,
    );
    expect(errs((a) => (brood(a)['thresholdsPercent'] = [50, 50]))).toMatch(
      /strictly descending/,
    );
    expect(errs((a) => (brood(a)['thresholdsPercent'] = [100, 50]))).toMatch(
      /1 to 99/,
    );
    expect(errs((a) => (brood(a)['thresholdsPercent'] = [50, 0]))).toMatch(
      /1 to 99/,
    );
    expect(errs((a) => (brood(a)['thresholdsPercent'] = []))).toMatch(
      /1 to 5 thresholds/,
    );
    expect(
      errs((a) => (brood(a)['thresholdsPercent'] = [90, 80, 70, 60, 50, 40])),
    ).toMatch(/1 to 5 thresholds/);
    expect(errs((a) => (brood(a)['sharePercent'] = 61))).toMatch(/at most 60/);
    expect(errs((a) => (brood(a)['sharePercent'] = 0))).toMatch(/sharePercent/);
    expect(errs((a) => (brood(a)['extra'] = 1))).toMatch(/unknown field/);
    // Not on an archetype that is not boss-only.
    const r = loadThreats(
      edit((d) => {
        (d['archetypes'] as Record<string, unknown>[])[0] = {
          ...((d['archetypes'] as Record<string, unknown>[])[0] ?? {}),
          brood: { thresholdsPercent: [50], sharePercent: 10 },
        };
      }),
      ctx,
    );
    expect(r.ok ? '' : r.errors.join()).toMatch(
      /"brood" is only allowed when "bossOnly" is true/,
    );
  });

  test('easy, medium and hard multipliers must increase strictly', () => {
    const errorsFor = (easy: number, medium: number, hard: number) => {
      const r = loadThreats(
        edit((d) => {
          d['typeMultiplierPercent'] = {
            ...(d['typeMultiplierPercent'] as Record<string, number>),
            easy,
            medium,
            hard,
          };
        }),
        ctx,
      );
      return r.ok ? [] : r.errors;
    };
    expect(errorsFor(70, 100, 140)).toEqual([]);
    for (const [e, m, h] of [
      [100, 100, 140],
      [70, 100, 100],
      [120, 100, 140],
      [70, 150, 140],
    ] as const) {
      expect(errorsFor(e, m, h).join()).toMatch(/increase strictly/);
    }
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

  // Builds every archetype at several rounds and party sizes: about 2.5 s on
  // its own, but it shares a CI shard with the 50 s threat-bounds test, where
  // it has run past the default 5 s timeout. A long timeout, like the other
  // heavy core tests.
  test('every profile builds, respects the caps and stays inside the budget', () => {
    const cap = (party: number): number =>
      threats.maxUnitsPerWavePerPlot * party;
    for (const arch of threats.archetypes) {
      for (const type of THREAT_TYPES) {
        for (const party of [1, 2, 3, 4]) {
          if (party < (arch.minPartySize ?? 1)) continue;
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
            expect(state.buildings).toHaveLength(
              p.stronghold.buildings.length +
                (p.stronghold.pylons?.length ?? 0),
            );
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
            expect(p.stronghold.cores).toHaveLength(party);
            expect(
              p.stronghold.cores.reduce((a, c) => a + c.health, 0),
            ).toBeGreaterThanOrEqual(threats.minCoreHealth * party);
          }
        }
      }
    }
  }, 60_000);

  test('ranged mix: archers and drones from round 4, none before', () => {
    const count = (round: number, arch: string, unit: string): number =>
      generateThreat(
        { seed: 7, round, type: 'medium', partySize: 1, archetype: arch },
        content,
        configs,
      )
        .waves.filter((w) => w.unit === unit)
        .reduce((a, w) => a + w.count, 0);
    for (const arch of ['arch_rusher', 'arch_escalator', 'arch_boss']) {
      for (const round of [1, 2, 3]) {
        expect(count(round, arch, 'unit_archer')).toBe(0);
        expect(count(round, arch, 'unit_drone')).toBe(0);
      }
      expect(count(10, arch, 'unit_archer'), arch).toBeGreaterThan(0);
      expect(count(10, arch, 'unit_drone'), arch).toBeGreaterThan(0);
    }
    // Switching the mix off gives back the melee-only waves.
    const off = { ...threats } as {
      -readonly [K in keyof typeof threats]: (typeof threats)[K];
    };
    delete off.rangedMix;
    const p = generateThreat(
      {
        seed: 7,
        round: 10,
        type: 'medium',
        partySize: 1,
        archetype: 'arch_rusher',
      },
      content,
      { threats: off, mapgen },
    );
    expect(p.waves.some((w) => w.unit === 'unit_archer')).toBe(false);
  });

  test('ranged units never push a wave over the unit cap', () => {
    // A small cap makes the "ranged keeps at least one unit" bump matter.
    for (const perPlot of [1, 2, 3, 5]) {
      const small = { ...threats, maxUnitsPerWavePerPlot: perPlot };
      for (const arch of threats.archetypes) {
        // A champion archetype needs room for the champions (the loader asks
        // for at least 2 per plot).
        if (arch.champion !== undefined && perPlot < 2) continue;
        for (let round = 4; round <= 30; round++) {
          const party = arch.minPartySize ?? 1;
          const p = generateThreat(
            {
              seed: round,
              round,
              type: 'hard',
              partySize: party,
              archetype: arch.id,
            },
            content,
            { threats: small, mapgen },
          );
          const perTick = new Map<number, number>();
          for (const w of p.waves) {
            perTick.set(w.tick, (perTick.get(w.tick) ?? 0) + w.count);
          }
          for (const total of perTick.values()) {
            expect(total, `${arch.id} r${String(round)}`).toBeLessThanOrEqual(
              perPlot * party,
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
            partySize: arch.minPartySize ?? 1,
            archetype: arch.id,
          },
          content,
          configs,
        );
        // The champions are paid from their own share of the wave budget (and
        // are never worth less than a plain unit): leave them out and the
        // share out.
        const waveBudget = Math.floor(
          (Math.floor((p.budget * arch.waveSharePercent) / 100) *
            (100 - (arch.champion?.sharePercent ?? 0))) /
            100,
        );
        const power = p.waves
          .filter((w) => w.healthPercent === undefined)
          .reduce(
            (a, w) =>
              a +
              (w.count * cost(w.unit) * (100 + p.unitStrengthPercent)) / 100,
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
    const line = gen('arch_escalator', 4, 16);
    const walls = line.stronghold.buildings.filter(
      (b) => b.def === 'bld_wall_block',
    );
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
      for (const b of p.stronghold.buildings) {
        const k = `${String(b.x)},${String(b.y)}`;
        expect(seen.has(k)).toBe(false);
        seen.add(k);
        expect(b.y).toBeLessThan(mapgen.plotDepth - 1);
        for (const core of p.stronghold.cores) {
          expect(
            b.x >= core.x &&
              b.x < core.x + 2 &&
              b.y >= core.y &&
              b.y < core.y + 2,
          ).toBe(false);
        }
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
    // Rusher, Fortress, Escalator, Skirmishers (from round 2), Swarm and
    // Maze (from round 2).
    expect(seen.size).toBe(6);
  });

  test('wraps around when fewer than three archetypes exist', () => {
    const two: ThreatsConfig = {
      ...threats,
      archetypes: threats.archetypes.filter(
        (a) =>
          ![
            'arch_escalator',
            'arch_skirmishers',
            'arch_swarm',
            'arch_maze',
          ].includes(a.id),
      ),
    };
    const p = pickArchetypes(1, 1, two);
    expect(p.hard).toBe(p.easy);
    expect(p.easy).not.toBe(p.medium);
  });

  describe("unlock rounds and leaving out last round's types", () => {
    const base = got(threats.archetypes.find((a) => !a.bossOnly));
    const make = (...specs: [string, number?][]): ThreatsConfig => ({
      ...threats,
      archetypes: specs.map(([id, fromRound]) => ({
        ...base,
        id,
        ...(fromRound === undefined ? {} : { fromRound }),
      })),
    });
    const ids = (p: ReturnType<typeof pickArchetypes>) => [
      p.easy,
      p.medium,
      p.hard,
    ];

    test('types are unlocked by round', () => {
      const cfg = make(['a1'], ['a2'], ['a3'], ['a4', 2], ['a5', 4]);
      for (let seed = 0; seed < 20; seed++) {
        expect(ids(pickArchetypes(seed, 1, cfg)).sort()).toEqual([
          'a1',
          'a2',
          'a3',
        ]);
        expect(ids(pickArchetypes(seed, 3, cfg))).not.toContain('a5');
      }
      const seen = new Set<string>();
      for (let seed = 0; seed < 40; seed++) {
        for (const id of ids(pickArchetypes(seed, 4, cfg))) seen.add(id);
      }
      expect(seen.has('a5')).toBe(true);
    });

    test('with six eligible types, two consecutive rounds share none', () => {
      const cfg = make(['a1'], ['a2'], ['a3'], ['a4'], ['a5'], ['a6']);
      for (let seed = 0; seed < 30; seed++) {
        const r1 = ids(pickArchetypes(seed, 1, cfg));
        const r2 = ids(pickArchetypes(seed, 2, cfg, r1));
        expect(new Set(r2).size).toBe(3);
        expect(r2.filter((x) => r1.includes(x))).toEqual([]);
      }
    });

    test('with four eligible types, the overlap is two', () => {
      const cfg = make(['a1'], ['a2'], ['a3'], ['a4']);
      for (let seed = 0; seed < 30; seed++) {
        const r1 = ids(pickArchetypes(seed, 1, cfg));
        const r2 = ids(pickArchetypes(seed, 2, cfg, r1));
        expect(new Set(r2).size).toBe(3);
        expect(r2.filter((x) => r1.includes(x))).toHaveLength(2);
      }
    });

    test('without previous it is the plain shuffle, and it is deterministic', () => {
      for (let seed = 0; seed < 10; seed++) {
        expect(pickArchetypes(seed, 2, threats, [])).toEqual(
          pickArchetypes(seed, 2, threats),
        );
      }
    });
  });

  test('the summary describes the profile', () => {
    const p = generateThreat(
      {
        seed: 2,
        round: 10,
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
    expect(s.coreHealth).toBe(got(p.stronghold.cores[0]).health);
    expect(s.cores).toBe(1);
    expect(s.walls + s.turrets).toBe(p.stronghold.buildings.length);
    expect(
      threatSummary({ ...p, type: 'easy', waves: [] }, content),
    ).toMatchObject({ level: 1, firstWaveTick: null, totalUnits: 0 });
  });
});

describe('pickBoss', () => {
  const arch = threats.archetypes.find((a) => a.bossOnly);
  const roster: ThreatsConfig = {
    ...threats,
    archetypes: [
      { ...got(arch), id: 'arch_a', fromRound: 1, minPartySize: 1 },
      { ...got(arch), id: 'arch_b', fromRound: 3, minPartySize: 1 },
      { ...got(arch), id: 'arch_c', fromRound: 5, minPartySize: 2 },
    ],
  };
  const pick = (
    round: number,
    partySize: number,
    seed: number,
    previousBoss?: string,
  ) =>
    pickBoss(
      {
        round,
        partySize,
        ...(previousBoss === undefined ? {} : { previousBoss }),
      },
      roster,
      Rng.fromSeed(seed),
    );
  const seen = (f: (seed: number) => string) =>
    [...new Set(Array.from({ length: 60 }, (_, i) => f(i)))].sort();

  test('round and party size gate the eligible list', () => {
    expect(seen((i) => pick(2, 4, i))).toEqual(['arch_a']);
    expect(seen((i) => pick(3, 4, i))).toEqual(['arch_a', 'arch_b']);
    expect(seen((i) => pick(5, 1, i))).toEqual(['arch_a', 'arch_b']);
    expect(seen((i) => pick(5, 2, i))).toEqual(['arch_a', 'arch_b', 'arch_c']);
  });

  test('the previous boss is excluded unless it is the only one', () => {
    expect(seen((i) => pick(3, 1, i, 'arch_a'))).toEqual(['arch_b']);
    expect(seen((i) => pick(5, 2, i, 'arch_b'))).toEqual(['arch_a', 'arch_c']);
    expect(seen((i) => pick(1, 1, i, 'arch_a'))).toEqual(['arch_a']);
  });

  test('is one nextInt on the rng and is pure', () => {
    const a = Rng.fromSeed(9);
    const b = Rng.fromSeed(9);
    expect(pickBoss({ round: 5, partySize: 2 }, roster, a)).toBe(
      ['arch_a', 'arch_b', 'arch_c'][b.nextInt(3)],
    );
    expect(a.getState()).toEqual(b.getState());
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

describe('brood bursts (MM-9d)', () => {
  const brood = got(threats.archetypes.find((a) => a.id === 'arch_boss_brood'));
  const make = (partySize: number, round: number) =>
    generateThreat(
      { seed: 7, round, type: 'boss', partySize, archetype: brood.id },
      content,
      configs,
    );

  test('only the brood archetype has bursts; the others have none', () => {
    for (const a of threats.archetypes) {
      const p = generateThreat(
        { seed: 7, round: 6, type: 'boss', partySize: 2, archetype: a.id },
        content,
        configs,
      );
      expect('bursts' in p.stronghold).toBe(a.brood !== undefined);
    }
  });

  test('bursts are listed by Core, then threshold, then composition; one entry per unit type', () => {
    const p = make(2, 5);
    const bursts = got(p.stronghold.bursts);
    const keys = bursts.map((b) => [b.core, b.thresholdPercent]);
    const ths = got(brood.brood).thresholdsPercent;
    expect(keys).toEqual(
      [0, 1].flatMap((c) => ths.map((t) => [c, t])).slice(0, keys.length),
    );
    for (const b of bursts) expect(b.count).toBeGreaterThan(0);
  });

  test('the burst share comes out of the stronghold budget before walls, turrets and Core health', () => {
    const plain = generateThreat(
      {
        seed: 7,
        round: 8,
        type: 'boss',
        partySize: 1,
        archetype: 'arch_boss',
      },
      content,
      configs,
    );
    const p = make(1, 8);
    // Same waves; the Core is smaller by the burst share (30 percent of S).
    expect(p.waves).toEqual(plain.waves);
    expect(p.budget).toBe(plain.budget);
    const sum = (x: typeof p) =>
      x.stronghold.cores.reduce((a, c) => a + c.health, 0);
    expect(sum(p)).toBeLessThan(sum(plain));
  });

  test('four Cores and three thresholds make twelve bursts', () => {
    // Round 14, 4 players: 12 slots, two soldiers each at strength +234.
    const p = make(4, 14);
    const total = got(p.stronghold.bursts).reduce((a, b) => a + b.count, 0);
    expect(p.stronghold.bursts).toHaveLength(12);
    expect(total).toBe(24);
  });
});

describe('Skirmishers and Swarm (issue #431)', () => {
  const gen = (
    archetype: string,
    round: number,
    partySize: number,
    type: ThreatType = 'medium',
  ) =>
    generateThreat(
      { seed: 7, round, partySize, type, archetype },
      content,
      configs,
    );
  const countOf = (p: ReturnType<typeof gen>, unit: string) =>
    p.waves.filter((w) => w.unit === unit).reduce((a, w) => a + w.count, 0);
  const size = (p: ReturnType<typeof gen>) =>
    p.waves.reduce((a, w) => a + w.count, 0);

  test('the content has the issue numbers', () => {
    const sk = got(threats.archetypes.find((a) => a.id === 'arch_skirmishers'));
    const sw = got(threats.archetypes.find((a) => a.id === 'arch_swarm'));
    expect(sk.fromRound).toBe(2);
    expect(sk.waveSharePercent).toBe(50);
    expect(sk.waves.count).toBe(6);
    expect(sk.stronghold.turretSharePercent).toBe(45);
    expect(sw.fromRound).toBe(1);
    expect(sw.waveSharePercent).toBe(80);
    expect(sw.waves.count).toBe(14);
    expect(sw.stronghold.layout).toBe('open');
  });

  test('Swarm: fourteen waves of raiders, one every 45 ticks from tick 80', () => {
    const p = gen('arch_swarm', 1, 1);
    expect(p.waves.map((w) => w.tick)).toEqual(
      Array.from({ length: 14 }, (_, k) => 80 + 45 * k),
    );
    expect(p.waves.every((w) => w.unit === 'unit_raider')).toBe(true);
    expect(p.unitStrengthPercent).toBe(0);
  });

  test('Swarm keeps raiders as most of its units, and stays under the cap with strength', () => {
    for (const round of [5, 10, 15]) {
      for (const party of [1, 4]) {
        const p = gen('arch_swarm', round, party);
        expect(countOf(p, 'unit_raider') * 2).toBeGreaterThan(size(p));
        const perTick = new Map<number, number>();
        for (const w of p.waves)
          perTick.set(w.tick, (perTick.get(w.tick) ?? 0) + w.count);
        expect(Math.max(...perTick.values())).toBeLessThanOrEqual(
          threats.maxUnitsPerWavePerPlot * party,
        );
      }
    }
    expect(gen('arch_swarm', 15, 1).unitStrengthPercent).toBeGreaterThan(0);
  });

  test('Skirmishers: mostly archers, none before round 2 in the offers', () => {
    const p = gen('arch_skirmishers', 10, 4);
    expect(countOf(p, 'unit_archer') * 2).toBeGreaterThan(size(p));
    expect(countOf(p, 'unit_soldier')).toBeGreaterThan(0);
    expect(p.waves[0]?.tick).toBe(150);
    expect(p.stronghold.buildings.some((b) => b.def === 'bld_wall_block')).toBe(
      false,
    );
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const r1 = pickArchetypes(seed, 1, threats);
      expect(JSON.stringify(r1)).not.toContain('arch_skirmishers');
    }
  });
});

describe('Maze (issue #432)', () => {
  const gen = (
    round: number,
    partySize: number,
    type: ThreatType = 'medium',
    seed = 7,
  ) =>
    generateThreat(
      { seed, round, partySize, type, archetype: 'arch_maze' },
      content,
      configs,
    );
  const W = mapgen.plotWidth;
  const H = mapgen.plotDepth;

  /** 4-connected reachability from the front-most free row to the Core. */
  function reaches(p: ReturnType<typeof gen>, plot: number): boolean {
    const blocked = new Set(
      p.stronghold.buildings.map((b) => `${String(b.x)},${String(b.y)}`),
    );
    const core = got(p.stronghold.cores[plot]);
    const inCore = (x: number, y: number) =>
      x >= core.x && x < core.x + 2 && y >= core.y && y < core.y + 2;
    const lo = plot * W;
    const seen = new Set<string>();
    const stack: [number, number][] = [];
    for (let x = lo; x < lo + W; x++) stack.push([x, H - 2]);
    while (stack.length > 0) {
      const [x, y] = got(stack.pop());
      const k = `${String(x)},${String(y)}`;
      if (x < lo || x >= lo + W || y < 0 || y > H - 2) continue;
      if (seen.has(k) || blocked.has(k)) continue;
      seen.add(k);
      if (inCore(x, y)) return true;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    return false;
  }

  test('the content has the issue numbers', () => {
    const a = got(threats.archetypes.find((x) => x.id === 'arch_maze'));
    expect(a.fromRound).toBe(2);
    expect(a.waveSharePercent).toBe(25);
    expect(a.waves).toMatchObject({
      firstTick: 400,
      intervalTicks: 300,
      count: 4,
      growthPercent: 125,
    });
    expect(a.stronghold).toEqual({
      coreHealthPerBudget: 300,
      wallSharePercent: 40,
      turretSharePercent: 30,
      layout: 'maze',
    });
    expect(pickArchetypes(1, 1, threats).easy).not.toBe('arch_maze');
  });

  test('the path to the Core is open at every round, type, party size and seed', () => {
    for (const seed of [1, 7, 99]) {
      for (const type of THREAT_TYPES) {
        for (const party of [1, 2, 4]) {
          for (let round = 1; round <= 25; round++) {
            const p = gen(round, party, type, seed);
            for (let plot = 0; plot < party; plot++) {
              expect(reaches(p, plot)).toBe(true);
            }
            const cells = p.stronghold.buildings.map(
              (b) => `${String(b.x)},${String(b.y)}`,
            );
            expect(new Set(cells).size).toBe(cells.length);
            // Walls and turrets stay inside their plot's rows 0 .. H - 2.
            for (const b of p.stronghold.buildings) {
              expect(b.y).toBeLessThanOrEqual(H - 2);
            }
          }
        }
      }
    }
  });

  test('walls fill the front row first; a small budget gives a short maze', () => {
    const wallYs = (p: ReturnType<typeof gen>) =>
      p.stronghold.buildings
        .filter((b) => b.def === 'bld_wall_block')
        .map((b) => b.y);
    const small = wallYs(gen(2, 1, 'easy'));
    expect(small.length).toBeGreaterThan(0);
    expect(new Set(small)).toEqual(new Set([13]));
    const full = wallYs(gen(15, 1, 'hard'));
    expect(new Set(full)).toEqual(new Set([13, 10, 7, 4]));
    // Every row has exactly one gap of two cells, at the ends, alternating.
    const p = gen(15, 1, 'hard');
    const rowX = (y: number) =>
      p.stronghold.buildings
        .filter((b) => b.def === 'bld_wall_block' && b.y === y)
        .map((b) => b.x);
    const sides = [13, 10, 7, 4].map((y) => {
      const xs = rowX(y);
      expect(xs).toHaveLength(W - 2);
      return xs.includes(0) ? 'right' : 'left';
    });
    expect(sides[0]).not.toBe(sides[1]);
    expect(sides[0]).toBe(sides[2]);
    expect(sides[1]).toBe(sides[3]);
    expect(full.length).toBe(88);
  });

  test('the first row side comes from the plot stream, so plots differ by seed', () => {
    const first = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const xs = gen(15, 1, 'hard', seed)
        .stronghold.buildings.filter(
          (b) => b.def === 'bld_wall_block' && b.y === 13,
        )
        .map((b) => b.x);
      first.add(xs.includes(0) ? 'right' : 'left');
    }
    expect(first.size).toBe(2);
  });

  test('turrets stay behind the first wall row, off the wall rows, and respect the cap', () => {
    const p = gen(15, 1, 'hard');
    const turrets = p.stronghold.buildings.filter(
      (b) => b.def === 'bld_turret',
    );
    expect(turrets).toHaveLength(threats.maxTurretsPerPlot);
    for (const t of turrets) {
      expect([13, 10, 7, 4]).not.toContain(t.y);
      expect(t.y).toBeLessThan(13);
    }
  });

  test('a maze that does not fit the plot is a content error', () => {
    const bad: ThreatsConfig = {
      ...threats,
      layouts: {
        ...threats.layouts,
        maze: { ...threats.layouts.maze, gapWidth: 1, rows: 4, firstRow: 15 },
      },
    };
    expect(() =>
      generateThreat(
        {
          seed: 1,
          round: 5,
          partySize: 1,
          type: 'medium',
          archetype: 'arch_maze',
        },
        content,
        { threats: bad, mapgen },
      ),
    ).toThrow(RangeError);
  });

  test('the loader checks the maze parameters', () => {
    const raw = JSON.parse(JSON.stringify(threatsJson)) as {
      layouts: { maze: Record<string, unknown> };
    };
    raw.layouts.maze['rowSpacing'] = 1;
    const r = loadThreats(raw, {
      units: content.units,
      buildings: content.buildings,
    });
    expect(r.ok).toBe(false);
    const raw2 = JSON.parse(JSON.stringify(threatsJson)) as {
      layouts: { maze: Record<string, unknown> };
    };
    delete raw2.layouts.maze['rows'];
    expect(
      loadThreats(raw2, { units: content.units, buildings: content.buildings })
        .ok,
    ).toBe(false);
  });
});
