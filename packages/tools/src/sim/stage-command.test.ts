import { validateTeamState } from '@game/core';
import { describe, expect, test } from 'vitest';
import { parseArgs } from './args.js';
import { main } from './cli.js';
import { loadSimContext } from './context.js';
import {
  STAGE_BOARDS,
  buildStageBoard,
  kitMatchesContent,
  soldiersMade,
  stageCore,
} from './stage-command.js';

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

describe('sim stage', () => {
  test('arguments', () => {
    expect(parseArgs(['stage'])).toMatchObject({
      kind: 'stage',
      rounds: 12,
      seeds: 6,
    });
    expect(parseArgs(['stage', '--rounds', '3', '--seeds', '2'])).toMatchObject(
      { rounds: 3, seeds: 2 },
    );
  });

  test('the Core goes to (11, 5) on the map of seed 5', () => {
    expect(stageCore(ctx)).toMatchObject({ x: 11, y: 5, note: 'legal' });
  });

  test('the five boards build legally and their value rises', () => {
    const boards = STAGE_BOARDS.map((n) => buildStageBoard(ctx, n));
    for (const b of boards) {
      expect(
        validateTeamState(b.team, ctx.content, ctx.mapgen),
        b.name,
      ).toMatchObject({ ok: true });
    }
    const values = boards.map((b) => b.value);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1] ?? 0);
    }
    expect(kitMatchesContent(ctx)).toBe(true);
  });

  test('every Barracks of a board keeps up with its collector at tier 1', () => {
    const made = soldiersMade(ctx, buildStageBoard(ctx, 'full1').team);
    expect(made).toBe(30);
  });

  test('a short run prints every table and is deterministic', () => {
    const argv = ['stage', '--rounds', '2', '--seeds', '1'];
    const out = run(argv);
    for (const part of [
      'Boards (shop value',
      'Last round in which the board wins',
      'Hard, last round won',
      'Win % by round, boss',
      'Supply check',
    ]) {
      expect(out).toContain(part);
    }
    for (const n of STAGE_BOARDS) expect(out).toContain(`  ${n} `);
    expect(run(argv)).toBe(out);
  });
});
