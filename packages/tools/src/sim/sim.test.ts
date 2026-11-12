import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
  soleCore,
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
import {
  boardPath,
  loadBoard,
  main,
  repoRoot,
  resolveUserPath,
  userCwd,
} from './cli.js';
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
          partySize: number;
        };
        const result = validateTeamState(data.team, ctx.content, ctx.mapgen);
        expect(result).toMatchObject({ ok: true });
        if (result.ok) expect(result.state).toEqual(built);
        expect(validateSchema(data.team)).toBe(true);
        expect(soleCore(built)).not.toBeNull();
        expect(built.map).toEqual(
          generateMap(data.mapSeed, data.partySize, ctx.content, ctx.mapgen),
        );
      });
    });
  }
});

describe('cli errors', () => {
  const bad: [string[], number, RegExp][] = [
    [['battle', '--a', os.tmpdir(), '--b', 'poor'], 1, /Cannot read board/],
    [['battle', '--a=', '--b', 'poor'], 2, /non-empty/],
    [
      [
        'battle',
        '--a',
        'rush',
        '--b',
        'poor',
        '--log',
        '/nonexistent/dir/x.json',
      ],
      1,
      /Cannot write the event log/,
    ],
    [
      [
        'batch',
        '--a',
        'rush',
        '--b',
        'poor',
        '--seed',
        '4294967295',
        '--count',
        '3',
      ],
      2,
      /must stay within/,
    ],
    [
      ['pve', '--team', 'rush', '--archetype', 'rusher', '--round', '999'],
      2,
      /highest supported round/,
    ],
    [
      ['batch', '--a', 'rush', '--archetype', 'rusher', '--round', '999'],
      2,
      /highest supported round/,
    ],
  ];
  for (const [argv, code, pattern] of bad) {
    test(argv.join(' '), () => {
      const r = run(argv);
      expect(r.code).toBe(code);
      expect(r.err).toMatch(pattern);
      expect(r.out).toBe('');
    });
  }

  test('the log path is checked before the battle runs', () => {
    const r = run(['battle', '--a', 'rush', '--b', 'poor', '--log', tmp]);
    expect(r.code).toBe(1);
    expect(r.out).toBe('');
  });
});

describe('board loading', () => {
  test('names and paths', () => {
    expect(boardPath('rush')).toBe(path.join(repoRoot, 'boards', 'rush.json'));
    expect(boardPath('./x/y.json', tmp)).toBe(path.join(tmp, 'x', 'y.json'));
    expect(board('rush').label).toBe('rush');
  });

  test('relative paths resolve against INIT_CWD, else the cwd', () => {
    expect(userCwd({ INIT_CWD: '/some/dir' })).toBe('/some/dir');
    expect(userCwd({})).toBe(process.cwd());
    expect(userCwd({ INIT_CWD: '' })).toBe(process.cwd());
    expect(resolveUserPath('sub.json', '/some/dir')).toBe('/some/dir/sub.json');
    expect(resolveUserPath('/abs/x.json', '/some/dir')).toBe('/abs/x.json');
  });

  test('a bare word is a board name only if it is known', () => {
    for (const n of ALL_REFERENCE_BOARDS) {
      expect(boardPath(n, tmp)).toBe(
        path.join(repoRoot, 'boards', `${n}.json`),
      );
    }
    expect(boardPath('myboard', tmp)).toBe(path.join(tmp, 'myboard'));
    writeFileSync(
      path.join(tmp, 'myboard'),
      readFileSync(path.join(repoRoot, 'boards', 'rush.json'), 'utf8'),
    );
    expect(loadBoard('myboard', ctx, () => undefined, tmp).label).toBe('rush');
    let msg = '';
    try {
      loadBoard('nosuchboard', ctx, () => undefined, tmp);
    } catch (e) {
      msg = e instanceof Error ? e.message : '';
    }
    expect(msg).toMatch(/reference board name/);
    expect(msg).toContain(`as a path, ${path.join(tmp, 'nosuchboard')}`);
  });

  test('a bare team state is accepted', () => {
    const bare = JSON.stringify(
      buildAnyReferenceBoard('rush', ctx.content, ctx.mapgen),
    );
    const notes: string[] = [];
    expect(
      parseBoardText(bare, 'bare', ctx, (t) => notes.push(t)).team.cores[0],
    ).toEqual({
      x: 11,
      y: 5,
    });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/bare.*cannot be verified/);
  });

  test('a bare team state notes on stderr, not stdout', () => {
    const file = path.join(tmp, 'bare.json');
    writeFileSync(
      file,
      JSON.stringify(buildAnyReferenceBoard('rush', ctx.content, ctx.mapgen)),
    );
    const r = run(['battle', '--a', file, '--b', 'poor']);
    expect(r.code).toBe(0);
    expect(r.err).toMatch(/cannot be verified/);
    expect(r.out).not.toMatch(/cannot be verified/);
  });

  test('mapSeed and partySize are checked against the team map', () => {
    const file = (over: Record<string, unknown>): string => {
      const base = JSON.parse(
        readFileSync(path.join(repoRoot, 'boards', 'rush.json'), 'utf8'),
      ) as Record<string, unknown>;
      return JSON.stringify({ ...base, ...over });
    };
    expect(() => parseBoardText(file({}), 'ok', ctx)).not.toThrow();
    expect(() => parseBoardText(file({ mapSeed: 99 }), 'f.json', ctx)).toThrow(
      /not the map generated for "mapSeed" 99/,
    );
    expect(() => parseBoardText(file({ mapSeed: 'x' }), 'f.json', ctx)).toThrow(
      /mapSeed/,
    );
    expect(() => parseBoardText(file({ partySize: 3 }), 'f.json', ctx)).toThrow(
      /partySize/,
    );
    const base = JSON.parse(file({})) as {
      mapSeed?: number;
      partySize?: number;
      team: { map: { features: unknown[] } };
    };
    base.team.map.features = [];
    expect(() => parseBoardText(JSON.stringify(base), 'f.json', ctx)).toThrow(
      CliError,
    );
    // The wrapper form requires both fields, whatever else is wrong.
    const noSeed = JSON.parse(file({})) as Record<string, unknown>;
    delete noSeed['mapSeed'];
    expect(() => parseBoardText(JSON.stringify(noSeed), 'f.json', ctx)).toThrow(
      /"mapSeed" is required/,
    );
    const noSeedEmpty = JSON.parse(JSON.stringify(base)) as typeof base;
    delete noSeedEmpty.mapSeed;
    expect(() =>
      parseBoardText(JSON.stringify(noSeedEmpty), 'f.json', ctx),
    ).toThrow(CliError);
    const noSize = JSON.parse(file({})) as Record<string, unknown>;
    delete noSize['partySize'];
    expect(() => parseBoardText(JSON.stringify(noSize), 'f.json', ctx)).toThrow(
      /"partySize" is required/,
    );
    const wrongSize = JSON.parse(file({ partySize: 3 })) as Record<
      string,
      unknown
    >;
    delete wrongSize['mapSeed'];
    expect(() =>
      parseBoardText(JSON.stringify(wrongSize), 'f.json', ctx),
    ).toThrow(/partySize/);
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

  test('--log resolves a relative path against INIT_CWD', () => {
    const dir = path.join(tmp, 'sub');
    mkdirSync(dir, { recursive: true });
    const saved = process.env['INIT_CWD'];
    process.env['INIT_CWD'] = dir;
    try {
      const r = run([
        'battle',
        '--a',
        'rush',
        '--b',
        'poor',
        '--log',
        'rel.json',
      ]);
      expect(r.code).toBe(0);
      expect(existsSync(path.join(dir, 'rel.json'))).toBe(true);
      expect(r.out).toContain(`written to ${path.join(dir, 'rel.json')}`);
    } finally {
      if (saved === undefined) delete process.env['INIT_CWD'];
      else process.env['INIT_CWD'] = saved;
    }
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
