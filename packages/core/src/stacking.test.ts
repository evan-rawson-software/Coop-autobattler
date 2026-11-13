/**
 * Stacking duration in whole battles (issue #82): how long two units stay
 * overlapped by more than half the sum of their radii, and how much of the
 * time units spend that deep. Soft collision allows overlap; it must not let
 * pairs stay stacked (against a wall, or at a target under a crowd).
 */
import { describe, expect, test } from 'vitest';
import { startBattle } from './battle.js';
import { ALL_REFERENCE_BOARDS, buildAnyReferenceBoard } from './index.js';
import {
  Lab,
  bigBoard,
  content,
  got,
  mapgen,
  simConfig,
} from './test-support.js';
import { CELL_UNITS } from './limits.js';
import type { TeamState } from './team-state.js';

const config = { sim: simConfig, mapgen };

interface Stack {
  /** Most consecutive ticks one pair stayed deeper than 50 percent. */
  longest: number;
  unitTicks: number;
  over50: number;
  over90: number;
  coincident: number;
  /** Unit-ticks spent in a pile: a cell holding PILE or more living units of one side. */
  pileUnitTicks: number;
  /** Most consecutive ticks one (cell, side) stayed a pile. */
  longestPile: number;
  /** Pile runs of at least LONG_PILE ticks. */
  longPiles: number;
  /** Most units of one side in one cell at one tick. */
  maxInCell: number;
}

const PILE = 10;
const LONG_PILE = 100;

function stacking(a: TeamState, b: TeamState, seed: number): Stack {
  const s = startBattle({ teamA: a, teamB: b, seed }, content, config);
  if (!s.ok) throw new Error('refused');
  const { battle } = s;
  const out: Stack = {
    longest: 0,
    unitTicks: 0,
    over50: 0,
    over90: 0,
    coincident: 0,
    pileUnitTicks: 0,
    longestPile: 0,
    longPiles: 0,
    maxInCell: 0,
  };
  let runs = new Map<number, number>();
  let pileRuns = new Map<number, number>();
  const cell = 2 * 47;
  while (!battle.isOver()) {
    battle.step();
    const units = battle.sim.units;
    const buckets = new Map<number, number[]>();
    units.forEach((u, i) => {
      const k = Math.floor(u.px / cell) * 65536 + Math.floor(u.py / cell);
      const l = buckets.get(k);
      if (l === undefined) buckets.set(k, [i]);
      else l.push(i);
    });
    const worst = new Float64Array(units.length);
    const next = new Map<number, number>();
    units.forEach((u, i) => {
      const ru = got(content.units.get(u.def)).collisionRadius;
      const gx = Math.floor(u.px / cell);
      const gy = Math.floor(u.py / cell);
      for (let x = gx - 1; x <= gx + 1; x++) {
        for (let y = gy - 1; y <= gy + 1; y++) {
          for (const j of buckets.get(x * 65536 + y) ?? []) {
            if (j <= i) continue;
            const v = got(units[j]);
            const r = ru + got(content.units.get(v.def)).collisionRadius;
            const d2 = (u.px - v.px) ** 2 + (u.py - v.py) ** 2;
            if (d2 >= r * r) continue;
            const frac = 1 - Math.sqrt(d2) / r;
            worst[i] = Math.max(worst[i] ?? 0, frac);
            worst[j] = Math.max(worst[j] ?? 0, frac);
            if (d2 === 0) out.coincident += 1;
            if (frac > 0.5) {
              const key = u.id * 1048576 + v.id;
              const n = (runs.get(key) ?? 0) + 1;
              next.set(key, n);
              if (n > out.longest) out.longest = n;
            }
          }
        }
      }
    });
    runs = next;
    const counts = new Map<number, number>();
    for (const u of units) {
      if (u.hp <= 0) continue;
      const k =
        (Math.floor(u.px / CELL_UNITS) * 65536 +
          Math.floor(u.py / CELL_UNITS)) *
          4 +
        u.side;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const nextPiles = new Map<number, number>();
    for (const [k, n] of counts) {
      out.maxInCell = Math.max(out.maxInCell, n);
      if (n < PILE) continue;
      out.pileUnitTicks += n;
      const run = (pileRuns.get(k) ?? 0) + 1;
      nextPiles.set(k, run);
      out.longestPile = Math.max(out.longestPile, run);
    }
    for (const [k, run] of pileRuns) {
      if (!nextPiles.has(k) && run >= LONG_PILE) out.longPiles += 1;
    }
    pileRuns = nextPiles;
    for (const w of worst) {
      out.unitTicks += 1;
      if (w > 0.5) out.over50 += 1;
      if (w > 0.9) out.over90 += 1;
    }
  }
  for (const run of pileRuns.values()) {
    if (run >= LONG_PILE) out.longPiles += 1;
  }
  return out;
}

describe('stacking duration', () => {
  test('reference battles: no pair stays deeper than 50 percent for long', () => {
    const boards = ALL_REFERENCE_BOARDS.map((n) =>
      buildAnyReferenceBoard(n, content, mapgen),
    );
    let longest = 0;
    let unitTicks = 0;
    let over50 = 0;
    let over90 = 0;
    let pileUnitTicks = 0;
    let longestPile = 0;
    let longPiles = 0;
    let maxInCell = 0;
    for (const a of boards) {
      for (const b of boards) {
        const r = stacking(a, b, 1);
        longest = Math.max(longest, r.longest);
        unitTicks += r.unitTicks;
        over50 += r.over50;
        over90 += r.over90;
        pileUnitTicks += r.pileUnitTicks;
        longestPile = Math.max(longestPile, r.longestPile);
        longPiles += r.longPiles;
        maxInCell = Math.max(maxInCell, r.maxInCell);
      }
    }
    expect(longest).toBeLessThanOrEqual(LONGEST_REFERENCE);
    expect(over50 / unitTicks).toBeLessThanOrEqual(SHARE50_REFERENCE);
    expect(over90 / unitTicks).toBeLessThanOrEqual(SHARE90_REFERENCE);
    expect(pileUnitTicks).toBe(0);
    expect(longestPile).toBe(0);
    expect(longPiles).toBe(0);
    expect(maxInCell).toBeLessThanOrEqual(4);
  }, 120_000);

  test('the dense four-plot battle (tier 1): same', () => {
    const lab = new Lab(bigBoard().map);
    lab.state = bigBoard();
    lab.allCores(6);
    const r = stacking(lab.state, lab.state, 1);
    expect(r.longest).toBeLessThanOrEqual(LONGEST_DENSE);
    expect(r.over50 / r.unitTicks).toBeLessThanOrEqual(SHARE50_DENSE);
    expect(r.over90 / r.unitTicks).toBeLessThanOrEqual(SHARE90_DENSE);
    expect(r.pileUnitTicks / r.unitTicks).toBeLessThanOrEqual(0.099);
    expect(r.longestPile).toBeLessThanOrEqual(51);
    expect(r.longPiles).toBeLessThanOrEqual(0);
    expect(r.maxInCell).toBeLessThanOrEqual(24);
  }, 120_000);
});

describe('stacking duration, tier 3 and mixed', () => {
  test('dense four plots, tier 3 and tier 1 against tier 3', () => {
    const lab = new Lab(bigBoard().map);
    lab.state = bigBoard();
    lab.allCores(6);
    const t1 = lab.state;
    const heavy = new Lab(bigBoard().map);
    heavy.state = {
      ...t1,
      buildings: t1.buildings.map((p) =>
        p.def === 'bld_splitter' ? p : { ...p, tier: 3 },
      ),
    };
    const t3 = heavy.state;
    const a = stacking(t3, t3, 1);
    const b = stacking(t1, t3, 1);
    expect(a.longest).toBeLessThanOrEqual(34);
    expect(a.over50 / a.unitTicks).toBeLessThanOrEqual(0.09);
    expect(a.over90 / a.unitTicks).toBeLessThanOrEqual(0.005);
    expect(a.pileUnitTicks / a.unitTicks).toBeLessThanOrEqual(0.12);
    expect(a.longestPile).toBeLessThanOrEqual(143);
    expect(a.longPiles).toBeLessThanOrEqual(2);
    expect(a.maxInCell).toBeLessThanOrEqual(30);
    expect(b.longest).toBeLessThanOrEqual(6);
    expect(b.over50 / b.unitTicks).toBeLessThanOrEqual(0.009);
    expect(b.over90 / b.unitTicks).toBeLessThanOrEqual(0.0002);
    expect(b.pileUnitTicks / b.unitTicks).toBeLessThanOrEqual(0.0059);
    expect(b.longestPile).toBeLessThanOrEqual(18);
    expect(b.longPiles).toBeLessThanOrEqual(0);
    expect(b.maxInCell).toBeLessThanOrEqual(20);
  }, 120_000);
});

// Pinned from measurements (after the wide-front pathing of #82 part 2; before it, in brackets).
// reference: longest 0 [3] ticks, 0 [0.19] percent of unit-ticks over 50, 0 over 90;
// dense tier 1: longest 12 [10], 1.04 [3.4] over 50, 0.008 [0.15] over 90;
// tier 3: longest 30 [17], 6.5 [8.6] over 50, 0.34 [0.6] over 90;
// tier 1 against tier 3: longest 5 [11], 0.22 [1.1] over 50, 0.005 [0.015] over 90.
// The longest run of a pair is one worst case; the shares of unit-ticks, which
// count the whole battle, all fall. The deep piles (10+ units of one side in a
// cell, #121) sit on front lines where a crowd converges on the same few
// enemies, not at the Core. Their bounds are a ratchet: re-set when army sizes
// are settled (#145) and when the test board is replaced by a legal one (#164).
const LONGEST_REFERENCE = 2;
const SHARE50_REFERENCE = 0.0005;
const SHARE90_REFERENCE = 0.0005;
const LONGEST_DENSE = 24;
const SHARE50_DENSE = 0.06;
const SHARE90_DENSE = 0.0015;
// Measured with one Core per player (#138): reference battles 0 / 0 / 0;
// dense tier 1: longest 14, 2.05 percent over 50, 0.039 over 90 (limits 14,
// 2.5, 0.06); tier 3: longest 30, 5.83 over 50, 0.41 over 90; tier 1 against
// tier 3: longest 6, 0.78 over 50, 0.0078 over 90. Judge a change against
// these, not against the limits.
// Measured after the rebalance (#145; units come out at their top speed and
// the boards are no longer legal, 48 collectors on 4 areas): reference
// battles 0 / 0 / 0; dense tier 1: longest 23, 5.64 percent over 50, 0.135
// over 90 (limits 24, 6, 0.15); tier 3: longest 29, 8.33 over 50, 0.39 over
// 90 (limits 34, 9, 0.5); tier 1 against tier 3: longest 5, 0.39 over 50,
// 0.0086 over 90. The dense boards are replaced by legal ones in #164.
