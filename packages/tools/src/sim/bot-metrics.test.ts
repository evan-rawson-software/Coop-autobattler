import {
  buildReferenceBoard,
  startBattle,
  type BattleReason,
} from '@game/core';
import { playBotRun } from '@game/session';
import { describe, expect, test } from 'vitest';
import { botDeps } from './bot-command.js';
import {
  BATTLE_REASONS,
  measureBattle,
  measureRecord,
  metricLines,
  addTally,
  noteBoard,
  recordingDeps,
  shopLines,
  shopTallyDeps,
  type ShopTally,
  type BattleMetrics,
  type BattleRecord,
} from './bot-metrics.js';
import { main } from './cli.js';
import { loadSimContext } from './context.js';

const ctx = loadSimContext();

function run(argv: string[]): string {
  let out = '';
  const code = main(argv, {
    out: (t) => (out += `${t}\n`),
    err: () => undefined,
  });
  expect(code).toBe(0);
  return out;
}

function metrics(party: number): BattleMetrics[] {
  const records: BattleRecord[] = [];
  const deps = botDeps(ctx);
  playBotRun(
    recordingDeps(deps, records),
    {
      runId: 'm',
      runVersion: '1.0',
      seed: 3,
      players: ['A', 'B', 'C', 'D'].slice(0, party),
      host: 0,
    },
    { strategy: 'rush', seed: 3, maxRounds: 3 },
  );
  return records.map((r) =>
    measureRecord(r, deps, ctx.content, ctx.sim.overloadStartTick),
  );
}

function fake(over: Partial<BattleMetrics>): BattleMetrics {
  return {
    kind: 'pve',
    round: 1,
    partySize: 2,
    won: true,
    reason: 'core_destroyed',
    endTick: 500,
    coresStanding: [2, 0],
    overloaded: false,
    producerTicks: 100,
    producerWaiting: 25,
    unitsMade: 3,
    unitsTopSpeed: 4,
    turretTicks: 50,
    turretWaiting: 5,
    firstCoreLost: 1,
    firstCoreTie: false,
    ...over,
  };
}

describe('bot shop counts', () => {
  test('a played run is counted and bought never exceeds offered', () => {
    const tally: ShopTally = new Map();
    const result = playBotRun(
      shopTallyDeps(botDeps(ctx), tally),
      { runId: 's', runVersion: '1.0', seed: 3, players: ['A'], host: 0 },
      { strategy: 'rush', seed: 3, maxRounds: 3 },
    );
    noteBoard(tally, result.state);
    let bought = 0;
    for (const c of tally.values()) {
      expect(c.bought).toBeLessThanOrEqual(c.offered);
      bought += c.bought;
    }
    expect(bought).toBeGreaterThan(0);
    // The wrapper gives the same run as the plain deps.
    const plain = playBotRun(
      botDeps(ctx),
      { runId: 's', runVersion: '1.0', seed: 3, players: ['A'], host: 0 },
      { strategy: 'rush', seed: 3, maxRounds: 3 },
    );
    expect(result.state).toEqual(plain.state);
  });

  test('the lines of known counts, sorted by definition', () => {
    const a: ShopTally = new Map([
      ['bld_wall', { offered: 4, bought: 2, placed: 1 }],
      ['bld_armory', { offered: 1, bought: 0, placed: 0 }],
    ]);
    const b: ShopTally = new Map([
      ['bld_wall', { offered: 1, bought: 1, placed: 1 }],
    ]);
    addTally(a, b);
    expect(shopLines(a).slice(1)).toEqual([
      '    bld_armory  offered 1, bought 0, placed 0',
      '    bld_wall    offered 5, bought 3, placed 2',
    ]);
  });
});

describe('bot battle measurements', () => {
  for (const party of [1, 2]) {
    test(`shares are in range and reasons add up, party of ${String(party)}`, () => {
      const ms = metrics(party);
      expect(ms.length).toBeGreaterThanOrEqual(6);
      const reasons = BATTLE_REASONS.map(
        (r) => ms.filter((m) => m.reason === r).length,
      );
      expect(reasons.reduce((a, b) => a + b, 0)).toBe(ms.length);
      for (const m of ms) {
        expect(m.producerWaiting).toBeGreaterThanOrEqual(0);
        expect(m.producerWaiting).toBeLessThanOrEqual(m.producerTicks);
        expect(m.turretWaiting).toBeLessThanOrEqual(m.turretTicks);
        expect(m.overloaded).toBe(m.endTick >= ctx.sim.overloadStartTick);
      }
      const text = metricLines(ms, ctx.sim.overloadStartTick).join('\n');
      for (const m of text.matchAll(/(\d+(?:\.\d)?)%/g)) {
        const v = Number(m[1]);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
      const pve = ms.filter((m) => m.kind === 'pve').length;
      expect(text).toContain(`End reason, pve (${String(pve)} battles)`);
    });
  }

  test('a Core kill before Overload counts as such', () => {
    const team = (name: 'rush' | 'poor') =>
      buildReferenceBoard(name, ctx.content, ctx.mapgen);
    const started = startBattle(
      { teamA: team('rush'), teamB: team('poor'), seed: 1 },
      ctx.content,
      { sim: ctx.sim, mapgen: ctx.mapgen },
    );
    if (!started.ok) throw new Error(started.error.message);
    const m = measureBattle(
      started.battle,
      ctx.content,
      ctx.sim.overloadStartTick,
      { kind: 'pvp', round: 1, partySize: 1 },
    );
    const reason: BattleReason = 'core_destroyed';
    expect(m.reason).toBe(reason);
    expect(m.endTick).toBeLessThan(ctx.sim.overloadStartTick);
    expect(m.overloaded).toBe(false);
    expect(m.won).toBe(true);
    expect(m.firstCoreLost).toBe(1);
    expect(m.unitsMade).toBeGreaterThan(0);
  });

  test('the report lines of known battles', () => {
    const ms = [
      fake({}),
      fake({
        endTick: 1900,
        overloaded: true,
        reason: 'time_limit',
        won: false,
        firstCoreLost: null,
      }),
      fake({ kind: 'pvp', won: false, firstCoreLost: 0 }),
      fake({ kind: 'pvp', won: true, firstCoreLost: 0 }),
    ];
    const text = metricLines(ms, 1800).join('\n');
    expect(text).toContain(
      'End reason, pve (2 battles): core_destroyed 1 (50.0%), time_limit 1 (50.0%)',
    );
    expect(text).toContain(
      'End reason, boss/pvp (2 battles): core_destroyed 2 (100.0%)',
    );
    expect(text).toContain(
      'pve 50.0% of 2, boss/pvp 0.0% of 2, all 25.0% of 4',
    );
    expect(text).toContain(
      'barracks-type 25.0% of 400 ticks; turrets 10.0% of 200 ticks',
    );
    expect(text).toContain('75.0% (12 of 16)');
    // One battle without a first Core; the party lost the first Core in two
    // battles (lost one, won one) and took it in one (won).
    expect(text).toContain('1 with no Core lost');
    expect(text).toContain(
      'party lost the first Core in 2 and then lost the battle 50.0%',
    );
    expect(text).toContain(
      'party took the first Core in 1 and then won 100.0%',
    );
  });

  test('the command prints the new lines and is deterministic', () => {
    const argv = [
      'bot',
      '--strategy',
      'rush',
      '--count',
      '1',
      '--max-rounds',
      '2',
      '--party',
      '2',
    ];
    const out = run(argv);
    for (const part of [
      'End reason, pve',
      'End reason, boss/pvp',
      'Overload share',
      'Under-supply',
      'top-speed output',
      'First Core lost',
      'Shop by building',
      'bld_barracks',
    ]) {
      expect(out).toContain(part);
    }
    expect(run(argv)).toBe(out);
  });
});
