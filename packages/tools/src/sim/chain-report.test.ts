import { validateTeamState } from '@game/core';
import { describe, expect, test } from 'vitest';
import { parseArgs } from './args.js';
import { main } from './cli.js';
import { loadSimContext } from './context.js';
import {
  CHAIN_BOARDS,
  buildChainBoard,
  shopChainLines,
} from './chain-report.js';

const ctx = loadSimContext();

describe('sim stage --chains', () => {
  test('arguments', () => {
    expect(parseArgs(['stage', '--chains'])).toMatchObject({
      kind: 'stage',
      chains: true,
      rounds: 9,
      seeds: 3,
    });
    expect(parseArgs(['stage'])).toMatchObject({ chains: false, rounds: 12 });
  });

  test('every reference board is a valid team state with its plot', () => {
    for (const spec of CHAIN_BOARDS) {
      const b = buildChainBoard(ctx, spec);
      expect(validateTeamState(b.team, ctx.content, ctx.mapgen).ok).toBe(true);
      const defs = b.team.buildings.map((x) => x.def);
      for (const d of [spec.main, spec.next, spec.side]) {
        if (d !== null) expect(defs).toContain(d);
      }
      expect(b.plotValue > 0).toBe(spec.main !== null);
    }
  });

  test('the shop lines name every re-roll habit', () => {
    const lines = shopChainLines(ctx, 40);
    expect(lines.join('\n')).toMatch(/never/);
    expect(lines.join('\n')).toMatch(/10 gold in all/);
  });

  test('a short report runs', () => {
    let out = '';
    const code = main(['stage', '--chains', '--rounds', '3', '--seeds', '1'], {
      out: (t) => (out += `${t}\n`),
      err: () => undefined,
    });
    expect(code).toBe(0);
    expect(out).toMatch(/Premium:/);
    expect(out).toMatch(/Shop: a player who commits/);
  });
});
