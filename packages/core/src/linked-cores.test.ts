import { describe, expect, test } from 'vitest';
import threatsJson from '../../../content/threats.json';
import {
  createArenaContext,
  createArenaSim,
  poolOf,
  spawnUnitForTest,
  stepArena,
  type ArenaContext,
  type ArenaEvent,
  type ArenaSim,
} from './arena-sim.js';
import { generateThreat, threatSummary } from './threat-gen.js';
import { loadThreats } from './threats.js';
import {
  Lab,
  board,
  content,
  got,
  mapgen,
  simConfig,
  threats,
} from './testing/support.js';
import type { TeamState } from './team-state.js';

const GAP = 7;
const ctxOf = {
  units: content.units,
  buildings: content.buildings,
};

function twoCores(): TeamState {
  const lab = new Lab(board([], 48, 2));
  lab.core(11, 0, 0);
  lab.core(35, 0, 1);
  return lab.state;
}

function clone(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(threatsJson)) as Record<string, unknown>;
}

function errorsOf(edit: (a: Record<string, unknown>) => void): string {
  const data = clone();
  const list = data['archetypes'] as Record<string, unknown>[];
  edit(got(list.find((a) => a['id'] === 'arch_boss_linked')));
  const r = loadThreats(data, ctxOf);
  return r.ok ? '' : r.errors.join('\n');
}

describe('linkedCores content (MM-9d)', () => {
  const linked = got(
    threats.archetypes.find((a) => a.id === 'arch_boss_linked'),
  );

  test('the shipped archetype is boss-only from round 5 for two players or more', () => {
    expect(linked.bossOnly).toBe(true);
    expect(linked.fromRound).toBe(5);
    expect(linked.minPartySize).toBe(2);
    expect(linked.linkedCores).toBe(true);
    for (const a of threats.archetypes) {
      if (a !== linked) expect('linkedCores' in a).toBe(false);
    }
  });

  test('the loader checks where linkedCores is allowed', () => {
    expect(errorsOf(() => undefined)).toBe('');
    expect(errorsOf((a) => (a['minPartySize'] = 1))).toMatch(
      /"minPartySize" of at least 2/,
    );
    expect(errorsOf((a) => (a['linkedCores'] = 'yes'))).toMatch(
      /"linkedCores" must be true or false/,
    );
    expect(
      errorsOf((a) => {
        a['brood'] = { thresholdsPercent: [50], sharePercent: 10 };
      }),
    ).toMatch(/cannot be combined with "brood"/);
    const data = clone();
    const first = (data['archetypes'] as Record<string, unknown>[])[0] ?? {};
    (data['archetypes'] as Record<string, unknown>[])[0] = {
      ...first,
      linkedCores: true,
    };
    const r = loadThreats(data, ctxOf);
    expect(r.ok ? '' : r.errors.join()).toMatch(
      /"linkedCores" is only allowed when "bossOnly" is true/,
    );
  });
});

describe('linkedCores generator (MM-9d)', () => {
  const make = (partySize: number, round = 5) =>
    generateThreat(
      {
        seed: 7,
        round,
        type: 'boss',
        partySize,
        archetype: 'arch_boss_linked',
      },
      content,
      { threats, mapgen },
    );

  test('a party of one is refused', () => {
    expect(() => make(1)).toThrow(RangeError);
  });

  test('one Core per plot and sharedHealth is the sum of their health', () => {
    for (const size of [2, 3, 4]) {
      const p = make(size, 8);
      expect(p.stronghold.cores).toHaveLength(size);
      expect(p.stronghold.sharedHealth).toBe(
        p.stronghold.cores.reduce((a, c) => a + c.health, 0),
      );
      expect(threatSummary(p, content).coreHealth).toBe(
        p.stronghold.sharedHealth,
      );
    }
  });

  test('every other archetype has no sharedHealth, and the waves and stronghold are the Boss', () => {
    for (const a of threats.archetypes) {
      if (a.linkedCores === true) continue;
      const p = generateThreat(
        { seed: 7, round: 6, type: 'boss', partySize: 2, archetype: a.id },
        content,
        { threats, mapgen },
      );
      expect('sharedHealth' in p.stronghold).toBe(false);
    }
    const boss = generateThreat(
      { seed: 7, round: 6, type: 'boss', partySize: 2, archetype: 'arch_boss' },
      content,
      { threats, mapgen },
    );
    const lk = make(2, 6);
    expect(lk.waves).toEqual(boss.waves);
    expect(lk.stronghold.cores).toEqual(boss.stronghold.cores);
    expect(lk.stronghold.buildings).toEqual(boss.stronghold.buildings);
  });
});

/** Side 1 has two linked Cores of the given health; side 0 hits for 6 per soldier. */
function start(healths: number[], linked = true) {
  const sim = createArenaSim(twoCores(), twoCores(), GAP, content, simConfig, {
    sideOptions: [null, { coreHealths: healths, linkedCores: linked }],
  });
  const events: ArenaEvent[] = [];
  const ctx = createArenaContext(sim, content, simConfig, { events });
  return { sim, ctx, events };
}

/** A side 0 soldier beside side 1's Core `core`, aimed at it. */
function attacker(sim: ArenaSim, ctx: ArenaContext, core: number): void {
  const ref = got(ctx.arena.coreRef[1]?.[core]);
  const b = got(ctx.arena.buildings[ref]);
  for (const c of b.cells) {
    for (const [dx, dy] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ] as const) {
      try {
        spawnUnitForTest(sim, ctx, {
          side: 0,
          def: 'unit_soldier',
          x: c.x + dx,
          y: c.y + dy,
          owner: core,
          target: core,
        });
        return;
      } catch {
        // not open: try the next cell
      }
    }
  }
  throw new Error('no free cell next to the Core');
}

const coreHp = (sim: ArenaSim, side: number, core: number): number =>
  got(sim.health.find((h) => 'core' in h && h.side === side && h.core === core))
    .hp;

describe('linked Core pool in the arena (MM-9d)', () => {
  test('the pool starts as the sum and exists only with linkedCores', () => {
    expect(poolOf(start([300, 200]).sim, 1)).toEqual({
      side: 1,
      hp: 500,
      remaining: 500,
    });
    expect(poolOf(start([300, 200]).sim, 0)).toBeUndefined();
    expect('linkedPools' in start([300, 200], false).sim).toBe(false);
  });

  test('simultaneous hits on different Cores add up in the pool; the Cores keep their own health', () => {
    const { sim, ctx, events } = start([300, 200]);
    attacker(sim, ctx, 0);
    attacker(sim, ctx, 1);
    let attacks: ArenaEvent[] = [];
    for (let t = 0; t < 60 && attacks.length < 2; t++) {
      stepArena(sim, ctx);
      attacks = events.filter(
        (e) => e.type === 'unit_attacked' && e.target.kind === 'core',
      );
    }
    expect(attacks).toHaveLength(2);
    expect(attacks[0]?.tick).toBe(attacks[1]?.tick);
    expect(
      attacks.map((e) => (e.type === 'unit_attacked' ? e.pool : -1)),
    ).toEqual([500, 500]);
    expect(poolOf(sim, 1)?.hp).toBe(488);
    expect(coreHp(sim, 1, 0)).toBe(300);
    expect(coreHp(sim, 1, 1)).toBe(200);
    expect(sim.buildingDamageDealt[0]).toBe(12);
  });

  test('a Core of an unlinked side logs no pool', () => {
    const { sim, ctx, events } = start([300, 200], false);
    attacker(sim, ctx, 0);
    for (let t = 0; t < 40; t++) stepArena(sim, ctx);
    const hit = events.find(
      (e) => e.type === 'unit_attacked' && e.target.kind === 'core',
    );
    expect(hit && 'pool' in hit).toBe(false);
    expect(coreHp(sim, 1, 0)).toBeLessThan(300);
  });

  test('the Overload decay is taken from the pool once, not per Core', () => {
    const { sim, ctx, events } = start([1000, 1000]);
    for (let t = 0; t <= simConfig.overloadStartTick; t++) stepArena(sim, ctx);
    const decay = events.filter(
      (e) => e.type === 'overload_core_damage' && e.side === 1,
    );
    expect(decay).toEqual([
      {
        tick: simConfig.overloadStartTick,
        type: 'overload_core_damage',
        side: 1,
        core: 0,
        damage: simConfig.overloadCoreDamageStep,
        pool: 2000,
      },
    ]);
    expect(poolOf(sim, 1)?.hp).toBe(2000 - simConfig.overloadCoreDamageStep);
    // The party's own Cores are not linked: each takes the decay.
    expect(
      events.filter((e) => e.type === 'overload_core_damage' && e.side === 0),
    ).toHaveLength(2);
  });

  test('an empty pool destroys every Core in the tick, in Core order, with the overkill once', () => {
    const { sim, ctx, events } = start([7, 9]);
    for (let i = 0; i < 3; i++) attacker(sim, ctx, i % 2);
    for (let t = 0; t < 80 && coreHp(sim, 1, 0) > 0; t++) stepArena(sim, ctx);
    const fell = events.filter((e) => e.type === 'core_destroyed');
    expect(fell).toEqual([
      { tick: sim.tick - 1, type: 'core_destroyed', side: 1, core: 0 },
      { tick: sim.tick - 1, type: 'core_destroyed', side: 1, core: 1 },
    ]);
    expect(poolOf(sim, 1)?.hp).toBe(0);
    expect(poolOf(sim, 1)?.remaining).toBe(-2);
    const cores = sim.health.filter((h) => 'core' in h && h.side === 1);
    expect(cores.map((h) => ('core' in h ? h.remaining : 0))).toEqual([-2, 0]);
    expect(
      cores.every((h) => 'fellTick' in h && h.fellTick === sim.tick - 1),
    ).toBe(true);
  });
});
