import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { afterAll, describe, expect, test } from 'vitest';
import {
  ALL_REFERENCE_BOARDS,
  REFERENCE_SEED,
  buildAnyReferenceBoard,
  generateMap,
  hashJson,
  validateTeamState,
  type Json,
} from '@game/core';
import { CliError } from './args.js';
import { denseFourPlotTeam } from './bench-teams.js';
import {
  boardFileOf,
  boardFileText,
  parseBoardText,
  type Board,
} from './boards.js';
import { boardPath, loadBoard, main, repoRoot } from './cli.js';
import {
  batchCommand,
  battleCommand,
  mapCommand,
  pveCommand,
} from './commands.js';
import { loadSimContext } from './context.js';

const ctx = loadSimContext();
const board = (name: string): Board => loadBoard(name, ctx);

const tmp = mkdtempSync(path.join(os.tmpdir(), 'sim-test-'));
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function run(argv: string[]): { code: number; out: string; err: string } {
  let out = '';
  let err = '';
  const code = main(argv, {
    out: (t) => (out += `${t}\n`),
    err: (t) => (err += `${t}\n`),
  });
  return { code, out, err };
}

describe('reference board files', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const schema = (n: string): object =>
    JSON.parse(
      readFileSync(path.join(repoRoot, 'schemas', n), 'utf8'),
    ) as object;
  ajv.addSchema(schema('map.schema.json'));
  const validateSchema = ajv.compile(schema('team-state.schema.json'));

  test('there are four, in a fixed order', () => {
    expect(ALL_REFERENCE_BOARDS).toEqual(['rush', 'fortify', 'siege', 'poor']);
  });

  for (const name of ALL_REFERENCE_BOARDS) {
    describe(name, () => {
      const file = path.join(repoRoot, 'boards', `${name}.json`);
      const built = buildAnyReferenceBoard(name, ctx.content, ctx.mapgen);

      test('the committed JSON equals what the script builds', () => {
        const expected = boardFileText(
          boardFileOf(name, REFERENCE_SEED, built),
        );
        // If this fails, run `pnpm boards:export` and review the diff.
        expect(readFileSync(file, 'utf8')).toBe(expected);
      });

      test('passes the whole-state validator and the schema', () => {
        const data = JSON.parse(readFileSync(file, 'utf8')) as {
          team: unknown;
          mapSeed: number;
        };
        const result = validateTeamState(data.team, ctx.content, ctx.mapgen);
        expect(result).toMatchObject({ ok: true });
        if (result.ok) expect(result.state).toEqual(built);
        expect(validateSchema(data.team)).toBe(true);
        expect(built.core).not.toBeNull();
        expect(built.map).toEqual(
          generateMap(data.mapSeed, 1, ctx.content, ctx.mapgen),
        );
      });
    });
  }
});

describe('board loading', () => {
  test('names and paths', () => {
    expect(boardPath('rush')).toBe(path.join(repoRoot, 'boards', 'rush.json'));
    expect(boardPath('./x/y.json')).toBe(path.resolve('./x/y.json'));
    expect(board('rush').label).toBe('rush');
  });

  test('a bare team state is accepted', () => {
    const bare = JSON.stringify(
      buildAnyReferenceBoard('rush', ctx.content, ctx.mapgen),
    );
    expect(parseBoardText(bare, 'bare', ctx).team.core).toEqual({
      x: 11,
      y: 5,
    });
  });

  test('bad files give clear errors', () => {
    expect(() => parseBoardText('{', 'f.json', ctx)).toThrow(/not valid JSON/);
    expect(() => parseBoardText('[]', 'f.json', ctx)).toThrow(/JSON object/);
    expect(() => parseBoardText('{"team": {}}', 'f.json', ctx)).toThrow(
      /not a valid team state/,
    );
    expect(() => loadBoard('no-such-board', ctx)).toThrow(CliError);
  });
});

describe('commands', () => {
  test('map prints the grid, nodes and a hash, deterministically', () => {
    const out = mapCommand(ctx, { seed: 5, party: 1 }).text;
    expect(out).toBe(mapCommand(ctx, { seed: 5, party: 1 }).text);
    expect(out.split('\n')[0]).toBe('Map: seed 5, party size 1, 24 x 16 cells');
    expect(out).toContain('res_a@(10,1)');
    expect(out).toMatch(/Map hash: [0-9a-f]{8}/);
    expect(out).not.toBe(mapCommand(ctx, { seed: 6, party: 1 }).text);
  });

  test('battle reports result, timeline and the event log hash', () => {
    const args = { a: board('rush'), b: board('poor'), seed: 1, ascii: false };
    const r = battleCommand(ctx, args);
    expect(r.text).toBe(battleCommand(ctx, args).text);
    expect(r.text).toContain('Result: A (rush) wins');
    expect(r.text).toContain('Timeline');
    expect(r.log).toBeDefined();
    const hash = hashJson(r.log);
    expect(r.text).toContain(`hash ${hash}`);
    expect(r.text).not.toContain('Final arena');
    expect(battleCommand(ctx, { ...args, ascii: true }).text).toContain(
      'Final arena:',
    );
  });

  test('battle refuses boards of different party sizes', () => {
    const big: Board = { label: 'dense', team: denseFourPlotTeam(ctx, 1) };
    expect(() =>
      battleCommand(ctx, { a: board('rush'), b: big, seed: 1, ascii: false }),
    ).toThrow(/same party size/);
  });

  test('pve fights a generated threat', () => {
    const args = {
      team: board('rush'),
      threat: {
        archetype: 'arch_rusher',
        type: 'medium' as const,
        round: 3,
        threatSeed: undefined,
      },
      seed: 1,
      ascii: false,
    };
    const r = pveCommand(ctx, args);
    expect(r.text).toContain('Threat: arch_rusher medium round 3');
    expect(r.text).toMatch(/Result: [AB] /);
    expect(r.text).toBe(pveCommand(ctx, args).text);
    expect(() =>
      pveCommand(ctx, {
        ...args,
        threat: { ...args.threat, archetype: 'arch_nope' },
      }),
    ).toThrow(/Unknown archetype "arch_nope"/);
  });

  test('batch counts add up and are deterministic', () => {
    const args = {
      a: board('rush'),
      b: board('poor'),
      threat: null,
      count: 25,
      seed: 1,
    };
    const t = batchCommand(ctx, args).text;
    expect(t).toBe(batchCommand(ctx, args).text);
    expect(t).toContain('A wins (rush): 25 of 25 (100.0%)');
    expect(t).toContain('B wins (poor): 0 of 25 (0.0%)');
    expect(t).toMatch(/mean \d+\.\d, min \d+, median \d+, p90 \d+, max \d+/);
    expect(t).toContain('Ended by: core_destroyed 25');
    const pve = batchCommand(ctx, {
      ...args,
      b: null,
      count: 10,
      threat: {
        archetype: 'arch_fortress',
        type: 'easy',
        round: 1,
        threatSeed: undefined,
      },
    }).text;
    expect(pve).toContain('arch_fortress/easy/r1');
    expect(pve).toContain('10 battles');
  });
});

describe('main', () => {
  test('help and usage errors', () => {
    expect(run(['--help']).code).toBe(0);
    expect(run(['--help']).out).toContain('Usage: pnpm sim');
    const bad = run(['battle', '--a', 'rush']);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('--b is required');
    expect(bad.out).toBe('');
  });

  test('a missing board is exit code 1', () => {
    const r = run([
      'battle',
      '--a',
      'rush',
      '--b',
      path.join(tmp, 'none.json'),
    ]);
    expect(r.code).toBe(1);
    expect(r.err).toContain('not found');
  });

  test('an invalid board file is exit code 1', () => {
    const file = path.join(tmp, 'bad.json');
    writeFileSync(file, '{"team": {"map": 1}}');
    const r = run(['battle', '--a', 'rush', '--b', file]);
    expect(r.code).toBe(1);
    expect(r.err).toContain('not a valid team state');
  });

  test('battle output is deterministic and has no timings without --time', () => {
    const argv = ['battle', '--a', 'rush', '--b', 'fortify', '--seed', '1'];
    const one = run(argv);
    expect(one.code).toBe(0);
    expect(one.out).toBe(run(argv).out);
    expect(one.out).not.toMatch(/Time:|ms\b/);
    expect(run([...argv, '--time']).out).toMatch(/Time: \d+ ms/);
  });

  test('--log writes the full event log', () => {
    const file = path.join(tmp, 'log.json');
    const r = run(['battle', '--a', 'rush', '--b', 'poor', '--log', file]);
    expect(r.code).toBe(0);
    const log = JSON.parse(readFileSync(file, 'utf8')) as {
      type: string;
    }[];
    expect(log[0]?.type).toBe('zone_revealed');
    expect(log[log.length - 1]?.type).toBe('battle_ended');
    expect(r.out).toContain(`hash ${hashJson(log as unknown as Json)}`);
  });

  test('map, pve and batch run', () => {
    expect(run(['map', '--seed', '5']).code).toBe(0);
    expect(
      run(['pve', '--team', 'rush', '--archetype', 'rusher', '--round', '2'])
        .code,
    ).toBe(0);
    const b = run(['batch', '--a', 'rush', '--b', 'poor', '--count', '5']);
    expect(b.code).toBe(0);
    expect(b.out).toContain('5 battles');
  });
});
