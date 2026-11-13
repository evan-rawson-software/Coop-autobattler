/**
 * Outcome and front width on varied, unequal boards (issue #82, part 2). The
 * boards are the factories of the scripted bot at several rounds and
 * strategies, dense factories with random-looking gaps and tiers, and evenly
 * matched full factories whose Cores sit in different places: no exact mirror
 * images. Measured before the wide-front pathing in brackets (same set).
 */
import { describe, expect, test } from 'vitest';
import { loadSimContext } from './context.js';
import {
  denseBoards,
  matchedBoards,
  matchedPairs,
  runVaried,
  summariseVaried,
  variedBoards,
  variedPairs,
  type VariedBattle,
  type VariedBoard,
} from './varied.js';

const ctx = loadSimContext();

function play(
  boards: readonly VariedBoard[],
  pairs: readonly (readonly [number, number])[],
  firstSeed: number,
): VariedBattle[] {
  return pairs.map(([i, j], n) =>
    runVaried(
      ctx,
      boards[i] as VariedBoard,
      boards[j] as VariedBoard,
      firstSeed + n,
    ),
  );
}

describe('varied unequal boards', () => {
  const bot = variedBoards(ctx, {
    parties: [1],
    seeds: [1, 2],
    rounds: [4, 8],
  });
  const dense = denseBoards(ctx, [1]);
  const matched = matchedBoards(ctx, [1]);

  test('the boards are varied and unequal', () => {
    expect(bot.length).toBe(16);
    expect(dense.length).toBe(6);
    expect(matched.length).toBe(9);
    const distinct = new Set(
      [...bot, ...dense, ...matched].map((b) => JSON.stringify(b.team)),
    );
    expect(distinct.size).toBeGreaterThanOrEqual(25);
  });

  test('battles end by a Core kill, and armies advance on a wide front', () => {
    const rows = [
      ...play(bot, variedPairs(bot, 3), 1),
      ...play(dense, variedPairs(dense, 3), 49),
      ...play(matched, matchedPairs(matched), 67),
    ];
    const all = summariseVaried(rows);
    expect(all.battles).toBe(84);
    // Share of battles ended by a destroyed Core [0.976], not by the
    // tiebreak rungs after Overload.
    expect(all.coreKillShare).toBeGreaterThanOrEqual(0.97);
    // Front width: units that have left their board (mean per sample) stand
    // in this many distinct columns [3.4 columns for 17 units; one column for
    // every five units was a conga line]; at first contact the leading band
    // of a side spans this many [4.3].
    expect(all.advancedColumns).toBeGreaterThanOrEqual(7);
    expect(all.advancedColumnsPerUnit).toBeGreaterThanOrEqual(0.28);
    expect(all.meanColumns).toBeGreaterThanOrEqual(6.5);
    // Evenly matched armies [2 of 18 ended by the tiebreak, now 1].
    const even = summariseVaried(play(matched, matchedPairs(matched), 67));
    expect(even.overloadShare).toBeLessThanOrEqual(0.1);
    expect(even.advancedColumnsPerUnit).toBeGreaterThanOrEqual(0.25);
  }, 120_000);

  test('a party of four gets a Core per player and can fight (issue #164)', () => {
    const dense4 = denseBoards(ctx, [4]);
    const matched4 = matchedBoards(ctx, [4]);
    for (const b of [...dense4, ...matched4]) {
      expect(b.team.cores).toHaveLength(4);
      expect(b.team.cores.every((c) => c !== null)).toBe(true);
    }
    const row = runVaried(
      ctx,
      dense4[1] as VariedBoard,
      matched4[0] as VariedBoard,
      1,
    );
    expect(row.ticks).toBeGreaterThan(0);
  });
});
