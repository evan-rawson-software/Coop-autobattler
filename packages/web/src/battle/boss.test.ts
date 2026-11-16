import { describe, expect, test } from 'vitest';
import { content } from '../content.js';
import { sideStats, deriveMoments, coreNameOf } from './derive.js';
import {
  bossMarks,
  burstUnitsText,
  overloadMaxima,
  sharedPool,
  standingPylons,
} from './boss.js';
import { Playback, simulateRecord } from './playback.js';
import { buildSample } from './samples.js';
import { battleConfig } from './setup.js';

const play = (opponent: string, seed = 1) => {
  const s = buildSample({ player: 'rush', opponent, seed, tick: 0 });
  const r = simulateRecord(s.battle, content, battleConfig);
  if (!r.ok) throw new Error(r.error.message);
  return {
    sample: s,
    record: r.record,
    pb: new Playback(s.battle, content, battleConfig, r.record),
  };
};
const labels = {
  side: ['Your', 'Stronghold'] as const,
  coreName: coreNameOf(content),
  zoneRevealed: 'zone',
  overload: 'overload',
};
const tps = battleConfig.sim.ticksPerSecond;

describe('Brood', () => {
  const b = play('pve:arch_boss_brood:3:boss');
  test('each boss Core is marked at 75, 50 and 25 percent', () => {
    const marks = bossMarks(b.pb.sim);
    expect([...marks.bursts.values()]).toEqual(
      [...marks.bursts.values()].map(() => [75, 50, 25]),
    );
    expect(marks.bursts.size).toBeGreaterThan(0);
    const foe = sideStats(b.pb, content, 1, tps);
    expect(foe.cores.every((c) => c.marks?.join() === '75,50,25')).toBe(true);
    expect(sideStats(b.pb, content, 0, tps).cores[0]?.marks).toBeUndefined();
  });

  test('each burst is a log line naming the percent and the units', () => {
    const lines = deriveMoments(b.record, content, labels).filter(
      (m) => m.kind === 'burst',
    );
    expect(lines).toHaveLength(3);
    expect(lines.map((m) => m.text.match(/at (\d+)%/)?.[1])).toEqual([
      '75',
      '50',
      '25',
    ]);
    expect(lines[0]?.text).toMatch(/^Stronghold Core burst at 75%: \d+ \w+/);
    expect(lines[0]?.focus).not.toBeNull();
  });
});

describe('Linked Cores', () => {
  const b = play('pve:arch_boss_linked:3:boss');
  test('the side is one pool', () => {
    expect(b.record.linked).toEqual([false, true]);
    const pool = sharedPool(b.pb.sim, b.record, 1);
    expect(pool?.hp).toBe(pool?.max);
    expect(sharedPool(b.pb.sim, b.record, 0)).toBeNull();
  });

  test('the pool, not a Core, loses health in the record and the stats', () => {
    const end = b.record.coreHp[1];
    expect(end[0]).toBe(b.record.coreMax[1]);
    expect(end[300]).toBeLessThan(b.record.coreMax[1]);
    b.pb.seekTo(300);
    const foe = sideStats(b.pb, content, 1, tps);
    expect(foe.pool?.hp).toBeLessThan(foe.pool?.max ?? 0);
    expect(foe.pool?.hp).toBe(foe.coreHp);
    // Every Core still stands until the pool is empty.
    expect(foe.cores.length).toBeGreaterThan(1);
    expect(foe.cores.every((c) => c.hp > 0)).toBe(true);
  });

  test('Overload counts the pool as one entry', () => {
    const foe = overloadMaxima(b.record, 1);
    expect(foe).toEqual([b.record.coreMax[1]]);
    // The two-player party's Cores are listed one by one.
    expect(overloadMaxima(b.record, 0)).toHaveLength(2);
  });
});

describe('Pylons', () => {
  const b = play('pve:arch_boss_pylons:3:boss');
  test('the pylons and the Core they shield are listed', () => {
    const marks = bossMarks(b.pb.sim);
    expect(marks.pylons.length).toBeGreaterThan(0);
    const foe = sideStats(b.pb, content, 1, tps);
    expect(foe.pylons).toEqual({
      standing: marks.pylons.length,
      total: marks.pylons.length,
    });
    expect(sideStats(b.pb, content, 0, tps).pylons).toBeNull();
  });

  test('the count falls as pylons fall, and the log names the shield', () => {
    const moments = deriveMoments(b.record, content, labels);
    const down = moments.find((m) => m.kind === 'shield');
    expect(down?.text).toBe('Stronghold Core shield is down');
    expect(moments.filter((m) => m.kind === 'pylon').length).toBe(
      bossMarks(b.pb.sim).pylons.length - 1,
    );
    b.pb.seekTo((down?.tick ?? 1) + 1);
    const marks = bossMarks(b.pb.sim);
    expect(standingPylons(marks, b.pb.sim.health)).toBe(0);
    expect(sideStats(b.pb, content, 1, tps).pylons?.standing).toBe(0);
  });
});

describe('Warlord', () => {
  const b = play('pve:arch_boss_warlord:3:boss');
  test('champions are found and logged once per wave', () => {
    const heroes = Object.values(b.record.champions);
    expect(heroes.length).toBeGreaterThan(0);
    for (const hp of heroes) expect(hp).toBeGreaterThan(0);
    const lines = deriveMoments(b.record, content, labels).filter(
      (m) => m.kind === 'champion',
    );
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]?.text).toMatch(
      /^Stronghold champion golem enters, health \d+$/,
    );
    expect(bossMarks(b.pb.sim).champions).toBe(true);
  });
});

describe('any other battle', () => {
  test('has no boss marks', () => {
    const b = play('pve:arch_rusher:3:medium');
    const marks = bossMarks(b.pb.sim);
    expect(marks.bursts.size + marks.pylons.length).toBe(0);
    expect(marks.linked || marks.champions).toBe(false);
    expect(Object.keys(b.record.champions)).toHaveLength(0);
    expect(b.record.linked).toEqual([false, false]);
    expect(sideStats(b.pb, content, 1, tps).pool).toBeNull();
  });
});

describe('burst text', () => {
  test('lists the units with their counts', () => {
    expect(
      burstUnitsText(
        [
          { unit: 'unit_soldier', count: 4 },
          { unit: 'unit_raider', count: 1 },
        ],
        content,
      ),
    ).toBe('4 Soldiers, 1 Raider');
  });
});
