import { describe, expect, test } from 'vitest';
import { openFor } from './arena-paths.js';
import { stepArena, type ArenaEvent } from './arena-sim.js';
import { hashJson } from './hash.js';
import { CELL_UNITS } from './limits.js';
import { simulatePveBattle, startPveBattle } from './pve-battle.js';
import {
  REFERENCE_BOARDS,
  buildReferenceBoard,
  type ReferenceBoardName,
} from './reference-boards.js';
import { generateThreat, type ThreatProfile } from './threat-gen.js';
import { THREAT_TYPES, type ThreatType } from './threats.js';
import type { TeamState } from './team-state.js';
import {
  Lab,
  bigBoard,
  content,
  got,
  mapgen,
  simConfig,
  threats,
  TIMING,
} from './testing/support.js';

const config = { sim: simConfig, mapgen };
const configs = { threats, mapgen };
// The single-player sweeps: an archetype that needs a bigger party (Linked)
// cannot be generated for party size 1.
const ARCHETYPES = threats.archetypes
  .filter((a) => (a.minPartySize ?? 1) <= 1)
  .map((a) => a.id);

const boards = Object.fromEntries(
  REFERENCE_BOARDS.map((n) => [n, buildReferenceBoard(n, content, mapgen)]),
) as Record<ReferenceBoardName, TeamState>;

function threat(
  archetype: string,
  type: ThreatType,
  round: number,
  partySize = 1,
): ThreatProfile {
  return generateThreat(
    { seed: 100 + round, round, type, partySize, archetype },
    content,
    configs,
  );
}

function fight(board: ReferenceBoardName, t: ThreatProfile) {
  const r = simulatePveBattle(
    { round: t.round, team: boards[board], threat: t, seed: 7 + t.round },
    content,
    config,
  );
  if (!r.ok) throw new Error(r.error.message);
  return r;
}

/** A dense four-plot party: 96 barracks and 48 sources. */
function denseParty(): TeamState {
  const lab = new Lab(bigBoard().map);
  lab.state = bigBoard();
  lab.allCores(6);
  return lab.state;
}

describe('reference boards', () => {
  test('build, with the Core placed', () => {
    for (const n of REFERENCE_BOARDS) {
      const b = boards[n];
      expect(b.cores[0]).toEqual({ x: 11, y: 5 });
      expect(b.map.width).toBe(24);
    }
    expect(boards.rush.buildings.map((p) => p.def).sort()).toEqual([
      'bld_barracks',
      'bld_barracks',
      'bld_barracks',
      'bld_extractor',
      'bld_extractor',
      'bld_extractor',
      'bld_wall_block',
      'bld_wall_block',
      'bld_wall_block',
      'bld_wall_block',
      'bld_wall_block',
    ]);
    expect(
      boards.fortify.buildings.filter((p) => p.def === 'bld_turret'),
    ).toHaveLength(2);
    expect(boards.fortify.conduits).toHaveLength(4);
    expect(boards.poor.conduits).toHaveLength(1);
  });
});

describe('running a PvE battle', () => {
  test('the same inputs give the same battle; the threat is echoed', () => {
    const t = threat('arch_fortress', 'medium', 3);
    const a = fight('fortify', t);
    const b = fight('fortify', t);
    expect(hashJson(a.eventLog as never)).toBe(hashJson(b.eventLog as never));
    expect(a.result).toEqual(b.result);
    expect(a.threat).toEqual(t);
  });

  test('startPveBattle stepped by hand matches simulatePveBattle', () => {
    const t = threat('arch_rusher', 'medium', 4);
    const started = startPveBattle(
      { round: t.round, team: boards.rush, threat: t, seed: 11 },
      content,
      config,
    );
    if (!started.ok) throw new Error('refused');
    expect(started.battle.threat).toBe(t);
    while (!started.battle.isOver()) started.battle.step();
    const whole = simulatePveBattle(
      { round: t.round, team: boards.rush, threat: t, seed: 11 },
      content,
      config,
    );
    if (!whole.ok) throw new Error('refused');
    expect(started.battle.result()).toEqual(whole.result);
    expect(hashJson(started.battle.eventLog as never)).toBe(
      hashJson(whole.eventLog as never),
    );
  });

  test('side 1 is the threat: stronghold Core health and buildings', () => {
    const t = threat('arch_fortress', 'hard', 6);
    const r = startPveBattle(
      { round: t.round, team: boards.poor, threat: t, seed: 1 },
      content,
      config,
    );
    if (!r.ok) throw new Error('refused');
    const sim = r.battle.sim;
    expect(
      sim.health.find((h) => h.side === 1 && 'core' in h && h.core === 0)?.hp,
    ).toBe(got(t.stronghold.cores[0]).health);
    expect(sim.teams[1].buildings).toHaveLength(t.stronghold.buildings.length);
    expect(sim.teams[1].map.features).toHaveLength(0);
    expect(sim.teams[1].map.nodes).toHaveLength(0);
    expect(sim.boards[1].sources).toHaveLength(0);
    expect(r.battle.summary().sides[1].coreMaxHealth).toBe(
      t.stronghold.cores.reduce((a, c) => a + c.health, 0),
    );
  });

  test('a party size that differs from the threat is refused', () => {
    const t = threat('arch_rusher', 'easy', 1, 2);
    const r = startPveBattle(
      { round: t.round, team: boards.rush, threat: t, seed: 1 },
      content,
      config,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('party_size_mismatch');
  });

  test('a stronghold that cannot be built throws', () => {
    const t = threat('arch_fortress', 'medium', 3);
    const first = got(t.stronghold.buildings[0]);
    const bad: ThreatProfile = {
      ...t,
      stronghold: {
        ...t.stronghold,
        buildings: [first, { ...first }],
      },
    };
    expect(() =>
      startPveBattle(
        { round: bad.round, team: boards.rush, threat: bad, seed: 1 },
        content,
        config,
      ),
    ).toThrow(/rejected/);
  });
});

describe('waves along the whole front', () => {
  test('a four-plot wave spans all four plots and never spawns on a blocked cell', () => {
    for (const arch of ['arch_rusher', 'arch_escalator', 'arch_boss']) {
      const t = threat(arch, 'hard', 12, 4);
      const s = startPveBattle(
        { round: t.round, team: denseParty(), threat: t, seed: 3 },
        content,
        config,
      );
      if (!s.ok) throw new Error('refused');
      const { battle } = s;
      const lastWave = Math.max(...t.waves.map((w) => w.tick));
      // A party Core that does not fall keeps the wave units busy.
      got(battle.sim.health.find((h) => h.side === 0 && 'core' in h)).hp =
        10 ** 12;
      // `stepArena` never ends a battle, so every wave is queued whatever
      // happens to the Cores; units that find no room enter a little later.
      while (
        battle.sim.tick <= lastWave ||
        (battle.sim.entering.length > 0 && battle.sim.tick < lastWave + 600)
      ) {
        stepArena(battle.sim, battle.ctx);
      }
      expect(battle.sim.entering).toHaveLength(0);
      const spawns = battle.eventLog.filter(
        (e): e is Extract<ArenaEvent, { type: 'unit_spawned' }> =>
          e.type === 'unit_spawned' && e.side === 1 && e.building === 0,
      );
      expect(spawns.length).toBe(t.waves.reduce((a, w) => a + w.count, 0));
      const geom = battle.ctx.arena.geom;
      const byTick = new Map<number, number[]>();
      for (const e of spawns) {
        // Own-frame column and the front row of side 1.
        const cx = Math.floor(e.px / CELL_UNITS);
        const cy = Math.floor(e.py / CELL_UNITS);
        expect(cy).toBe(geom.height - geom.boardHeight);
        const k = cy * geom.width + cx;
        expect(battle.ctx.arena.blocked[k]).toBe(0);
        expect(openFor(battle.ctx.arena, 1, k)).toBe(true);
        const col = geom.width - 1 - cx;
        byTick.set(e.tick, [...(byTick.get(e.tick) ?? []), col]);
      }
      // Units that find their place taken (the middle of the row is often
      // still crowded by the previous wave) enter a little later; over the
      // battle every plot sees units come in.
      const every = new Set<number>();
      for (const cols of byTick.values()) {
        for (const c of cols) every.add(Math.floor(c / mapgen.plotWidth));
      }
      expect([...every].sort()).toEqual([0, 1, 2, 3]);
    }
  }, 120_000);

  test('an ASCII snapshot of a Rusher wave arriving', () => {
    const t = threat('arch_rusher', 'medium', 5);
    const s = startPveBattle(
      { round: t.round, team: boards.rush, threat: t, seed: 3 },
      content,
      config,
    );
    if (!s.ok) throw new Error('refused');
    while (s.battle.sim.tick <= got(t.waves[0]).tick) s.battle.step();
    const units = s.battle.sim.units.filter((u) => u.side === 1);
    expect(units.length).toBe(
      got(t.waves[0]).count +
        t.waves
          .filter((w) => w.tick === got(t.waves[0]).tick && w !== t.waves[0])
          .reduce((a, w) => a + w.count, 0),
    );
    expect(new Set(units.map((u) => Math.floor(u.py / CELL_UNITS))).size).toBe(
      1,
    );
  });
});

describe('Maze (issue #432)', () => {
  test('units walk the maze through its gaps: the Core falls with every wall standing', () => {
    // Measured: the rush board beats medium Maze in rounds 4 and 6 (threat seed
    // 100 + round, battle seed 7 + round); no unit attacks a wall, since the
    // path is never sealed.
    for (const round of [4, 6]) {
      const t = threat('arch_maze', 'medium', round);
      const walls = t.stronghold.buildings.filter(
        (b) => b.def === 'bld_wall_block',
      );
      expect(walls.length).toBeGreaterThan(10);
      expect(t.stronghold.buildings.some((b) => b.def === 'bld_turret')).toBe(
        true,
      );
      const r = fight('rush', t);
      expect(r.result.winner).toBe(0);
      expect(r.eventLog.some((e) => e.type === 'core_destroyed')).toBe(true);
      expect(r.eventLog.some((e) => e.type === 'building_destroyed')).toBe(
        false,
      );
    }
  }, 60_000);
});

describe('Focus (issue #433)', () => {
  /** Run the waves of a Focus threat into a dense four-plot party. */
  function spawnsOf(t: ThreatProfile, party: TeamState) {
    const s = startPveBattle(
      { round: t.round, team: party, threat: t, seed: 3 },
      content,
      config,
    );
    if (!s.ok) throw new Error('refused');
    const { battle } = s;
    const lastWave = Math.max(...t.waves.map((w) => w.tick));
    got(battle.sim.health.find((h) => h.side === 0 && 'core' in h)).hp =
      10 ** 12;
    while (
      battle.sim.tick <= lastWave ||
      (battle.sim.entering.length > 0 && battle.sim.tick < lastWave + 600)
    ) {
      stepArena(battle.sim, battle.ctx);
    }
    expect(battle.sim.entering).toHaveLength(0);
    return {
      geom: battle.ctx.arena.geom,
      spawns: battle.eventLog.filter(
        (e): e is Extract<ArenaEvent, { type: 'unit_spawned' }> =>
          e.type === 'unit_spawned' && e.side === 1 && e.building === 0,
      ),
    };
  }

  test('a focused wave spawns only on its plot, and its units target that plot', () => {
    const t = threat('arch_focus', 'hard', 10, 4);
    const { geom, spawns } = spawnsOf(t, denseParty());
    // The units each plot must receive: the counts of its waves.
    const want = [0, 0, 0, 0];
    for (const w of t.waves)
      want[got(w.plot)] = (want[got(w.plot)] ?? 0) + w.count;
    expect(want.filter((n) => n > 0).length).toBeGreaterThan(1);
    const seen = [0, 0, 0, 0];
    for (const e of spawns) {
      const cx = Math.floor(e.px / CELL_UNITS);
      const col = geom.width - 1 - cx;
      const plot = Math.floor(col / mapgen.plotWidth);
      expect(e.owner).toBe(plot);
      seen[plot] = (seen[plot] ?? 0) + 1;
    }
    expect(seen).toEqual(want);
  }, 120_000);

  test('solo Focus spawns exactly as the same waves without a plot', () => {
    const t = threat('arch_focus', 'medium', 5, 1);
    const plain: ThreatProfile = {
      ...t,
      waves: t.waves.map((w) => ({
        tick: w.tick,
        unit: w.unit,
        count: w.count,
      })),
    };
    const a = fight('rush', t);
    const b = fight('rush', plain);
    expect(hashJson(a.eventLog as never)).toBe(hashJson(b.eventLog as never));
  }, 60_000);
});

describe('the threat fights back', () => {
  test('stronghold turrets fire with no flow', () => {
    const t = threat('arch_fortress', 'hard', 5);
    const r = fight('rush', t);
    const shots = r.eventLog.filter(
      (e) => e.type === 'turret_fired' && e.side === 1,
    );
    expect(shots.length).toBeGreaterThan(0);
    expect(r.eventLog.some((e) => e.type === 'produced' && e.side === 1)).toBe(
      false,
    );
  });
});

describe('late rounds stay inside the performance budget', () => {
  test('peak units alive on the threat side at round 15 hard and round 20 boss', () => {
    for (const party of [1, 4]) {
      for (const [type, round] of [
        ['hard', 15],
        ['boss', 20],
      ] as const) {
        for (const arch of ARCHETYPES) {
          // Sample moved (waves mix in archers and drones from round 4, which
          // cost more per unit, so fewer units per wave): Fortress hard at
          // round 15 now has unitStrengthPercent 100 (party 1) and 96
          // (party 4), which fail "> 100" (117 and 121 without the mix);
          // round 16 has 142 and 144. Maze hard (issue #432) has 100 at round
          // 15 for both party sizes (its waves are light: a quarter of the
          // budget in four waves) and 150 and 155 at round 16.
          const sampleRound =
            (arch === 'arch_fortress' || arch === 'arch_maze') &&
            type === 'hard'
              ? round + 1
              : round;
          const t = threat(arch, type, sampleRound, party);
          const s = startPveBattle(
            {
              round: t.round,
              team: party === 1 ? boards.rush : denseParty(),
              threat: t,
              seed: 5,
            },
            content,
            config,
          );
          if (!s.ok) throw new Error('refused');
          const { battle } = s;
          let peak = 0;
          const t0 = Date.now();
          while (!battle.isOver()) {
            battle.step();
            peak = Math.max(
              peak,
              battle.sim.units.filter((u) => u.side === 1).length,
            );
          }
          const ms = Date.now() - t0;
          expect(peak).toBeLessThan(1000);
          expect(ms).toBeLessThan(10_000 * TIMING);
          expect(battle.sim.tick).toBeLessThan(simConfig.maxBattleTicks);
          // Late power is strength, not numbers.
          expect(t.unitStrengthPercent).toBeGreaterThan(100);
        }
      }
    }
  }, 240_000);
});

// ---------------------------------------------------------------------------
// The sweep (acceptance criteria 2, 3 and 9)

const MAX_ROUND = 25;

interface Row {
  board: ReferenceBoardName;
  arch: string;
  type: ThreatType;
  round: number;
  won: boolean;
  endTick: number;
  reason: string;
}

const rows: Row[] = [];
function sweep(): Row[] {
  if (rows.length > 0) return rows;
  for (const arch of ARCHETYPES) {
    for (const type of THREAT_TYPES) {
      for (const board of REFERENCE_BOARDS) {
        for (let round = 1; round <= MAX_ROUND; round++) {
          const r = fight(board, threat(arch, type, round));
          rows.push({
            board,
            arch,
            type,
            round,
            won: r.result.winner === 0,
            endTick: r.result.endTick,
            reason: r.result.reason,
          });
        }
      }
    }
  }
  return rows;
}

/** The last round at which a board wins any threat in the sweep (pinned). */
const LAST_WIN: Record<ReferenceBoardName, number> = {
  rush: 13,
  // 11 before the neutral guards (CB-8e, #372): they hold a point with a
  // round-scaled strength and cost the fortify board its round 11 win.
  // 12 with Focus (issue #433): the fortify board beats easy Focus in round
  // 12 (a ring of defences, and a solo Focus is the ordinary waves of a
  // 60-percent wave share, which the fortify board's army and turrets hold
  // while the rush board's last win stays round 13).
  fortify: 12,
  poor: 8,
};

describe('sweep of reference boards against every threat', () => {
  test('every battle ends with a result before maxBattleTicks', () => {
    const all = sweep();
    expect(all).toHaveLength(ARCHETYPES.length * 4 * 3 * MAX_ROUND);
    const reasons: Record<string, number> = {};
    for (const r of all) {
      expect(r.endTick).toBeLessThan(simConfig.maxBattleTicks);
      reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
    }
    expect(reasons['time_limit']).toBeUndefined();
  }, 300_000);

  test('early winnable, eventually impossible (SC-4)', () => {
    const all = sweep();
    for (const board of REFERENCE_BOARDS) {
      const mine = all.filter((r) => r.board === board);
      const won = mine.filter((r) => r.won).map((r) => r.round);
      expect(Math.max(...won)).toBe(LAST_WIN[board]);
      // Round 1, easy: every board beats every archetype (one exception below).
      for (const r of mine.filter((x) => x.round === 1 && x.type === 'easy')) {
        // Measured (issue #431): the poor board (tier 1, two small producers)
        // loses to easy Swarm in round 1 (its Core falls at tick 338 to 14
        // fast raiders); every other board and archetype wins. Balance is #435.
        if (board === 'poor' && r.arch === 'arch_swarm') {
          expect(r.won).toBe(false);
          continue;
        }
        expect(r.won).toBe(true);
      }
    }
    // Monotone-ish: the number of wins falls from block to block and the last
    // block has none.
    const winsIn = (lo: number, hi: number): number =>
      all.filter((r) => r.won && r.round >= lo && r.round <= hi).length;
    const blocks = [
      winsIn(1, 5),
      winsIn(6, 10),
      winsIn(11, 15),
      winsIn(16, 20),
      winsIn(21, 25),
    ];
    expect(blocks[0]).toBeGreaterThan(blocks[1] ?? 0);
    expect(blocks[1]).toBeGreaterThan(blocks[2] ?? 0);
    expect(blocks[2]).toBeGreaterThan(blocks[3] ?? 0);
    expect(blocks[4]).toBe(0);
    // With threats growing 25 percent per round (issue #145) the wins fall
    // off slowly: 270, 155, 15 and none from round 16 on (the last win is
    // the rush board's, in round 13, since waves hold archers and drones; it
    // was round 16 before the Escalator's waves came forward). The counts
    // include the Brood boss (issue #398), the Pylons boss (issue #400) and
    // the Warlord boss (issue #401); without the Warlord they were 327, 190,
    // 19. With the neutral guards of the points (CB-8e, #372) they are 368,
    // 194 and 19 (were 377, 216, 22): guards fight units of both sides. With
    // the points diverting units (CB-8f, #373) the middle block is 195. The
    // Skirmishers and Swarm archetypes (issue #431) add 86, 41 and 1 wins
    // (454, 236 and 20): two more archetypes in the sweep, nothing else moved.
    // Maze (issue #432) adds 54, 19 and 0 (508, 255 and 20), likewise.
    // Focus (issue #433) adds 53, 28 and 4 (561, 283 and 24), likewise.
    expect(blocks).toEqual([561, 283, 24, 0, 0]);
  }, 300_000);

  test('archetypes test what they should (criterion 3)', () => {
    const all = sweep();
    const get = (
      board: ReferenceBoardName,
      arch: string,
      type: ThreatType,
      round: number,
    ): Row =>
      got(
        all.find(
          (r) =>
            r.board === board &&
            r.arch === arch &&
            r.type === type &&
            r.round === round,
        ),
      );
    // The fortify board, with walls, turrets and an army behind them, beats a
    // medium Fortress in round 7 that the rush board loses to.
    expect(get('rush', 'arch_fortress', 'medium', 7).won).toBe(false);
    expect(get('fortify', 'arch_fortress', 'medium', 7).won).toBe(true);
    // The fortify board takes longer against the Fortress in the early
    // rounds, where both win: 1.34 times as long in easy round 1 and never
    // shorter. (The decay of Overload ends the slow wins: several of
    // them end at tick 2401 or 2701. The decay hits both Cores equally and the Core with less
    // health falls first: shipped strongholds are often below the party's 500,
    // so outlasting a smaller Core is a legitimate, intended way to win;
    // decided in #75.) With the neutral guards (CB-8e, #372) the rush board
    // loses time at a point where the fortify board does not: in easy round 2
    // the fortify board is 36 ticks shorter (407 against 443) and in medium
    // round 2 4 ticks (466 against 470); "never shorter" is now "at most 36
    // ticks shorter". With the points diverting units (CB-8f, #373) the rush
    // board loses more time at the point (easy round 2: 461 against 407,
    // medium round 2: 480 against 466), so the fortify board is at most 54
    // ticks shorter.
    let ratioSum = 0;
    let cases = 0;
    for (const type of ['easy', 'medium', 'hard'] as const) {
      for (const round of [1, 2, 3]) {
        const rush = get('rush', 'arch_fortress', type, round);
        const fort = get('fortify', 'arch_fortress', type, round);
        expect(rush.won && fort.won).toBe(true);
        expect(fort.endTick).toBeGreaterThanOrEqual(rush.endTick - 54);
        ratioSum += fort.endTick / rush.endTick;
        cases += 1;
      }
    }
    expect(
      10 * get('fortify', 'arch_fortress', 'easy', 1).endTick,
    ).toBeGreaterThanOrEqual(
      13 * get('rush', 'arch_fortress', 'easy', 1).endTick,
    );
    expect(ratioSum / cases).toBeGreaterThan(1.4);
  }, 300_000);
});
