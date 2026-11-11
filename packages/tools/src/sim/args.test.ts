import { describe, expect, test } from 'vitest';
import { CliError, parseArgs } from './args.js';

function usageError(argv: string[]): CliError {
  try {
    parseArgs(argv);
  } catch (e) {
    if (e instanceof CliError) return e;
    throw e;
  }
  throw new Error('expected a CliError');
}

describe('parseArgs', () => {
  test('no command or --help gives help', () => {
    expect(parseArgs([])).toEqual({ kind: 'help' });
    expect(parseArgs(['--help'])).toEqual({ kind: 'help' });
    expect(parseArgs(['battle', '--help'])).toEqual({ kind: 'help' });
  });

  test('map', () => {
    expect(parseArgs(['map', '--seed', '5'])).toEqual({
      kind: 'map',
      seed: 5,
      party: 1,
      time: false,
    });
    expect(parseArgs(['map', '--seed=7', '--party', '4', '--time'])).toEqual({
      kind: 'map',
      seed: 7,
      party: 4,
      time: true,
    });
  });

  test('battle with defaults and flags', () => {
    expect(parseArgs(['battle', '--a', 'rush', '--b', 'x.json'])).toEqual({
      kind: 'battle',
      a: 'rush',
      b: 'x.json',
      seed: 1,
      log: undefined,
      ascii: false,
      time: false,
    });
    const c = parseArgs([
      'battle',
      '--a=a',
      '--b=b',
      '--seed',
      '9',
      '--log',
      'out.json',
      '--ascii',
    ]);
    expect(c).toMatchObject({ seed: 9, log: 'out.json', ascii: true });
  });

  test('pve adds the arch_ prefix and defaults the type and round', () => {
    expect(
      parseArgs(['pve', '--team', 'rush', '--archetype', 'rusher']),
    ).toMatchObject({
      kind: 'pve',
      threat: {
        archetype: 'arch_rusher',
        type: 'medium',
        round: 1,
        threatSeed: undefined,
      },
    });
    expect(
      parseArgs([
        'pve',
        '--team',
        'rush',
        '--archetype',
        'arch_boss',
        '--type',
        'hard',
        '--round',
        '12',
        '--threat-seed',
        '3',
      ]),
    ).toMatchObject({
      threat: {
        archetype: 'arch_boss',
        type: 'hard',
        round: 12,
        threatSeed: 3,
      },
    });
  });

  test('batch needs exactly one opponent', () => {
    expect(
      parseArgs(['batch', '--a', 'rush', '--b', 'poor', '--count', '10']),
    ).toMatchObject({ kind: 'batch', b: 'poor', threat: null, count: 10 });
    expect(
      parseArgs(['batch', '--a', 'rush', '--archetype', 'fortress']),
    ).toMatchObject({
      b: null,
      count: 300,
      threat: { archetype: 'arch_fortress' },
    });
    expect(usageError(['batch', '--a', 'rush']).message).toMatch(
      /--b BOARD or --archetype/,
    );
    expect(
      usageError(['batch', '--a', 'r', '--b', 'p', '--archetype', 'x']).message,
    ).toMatch(/not both/);
  });

  test('a batch may end exactly at the largest seed', () => {
    expect(
      parseArgs([
        'batch',
        '--a',
        'x',
        '--b',
        'y',
        '--seed',
        '4294967295',
        '--count',
        '1',
      ]),
    ).toMatchObject({ seed: 4294967295, count: 1 });
  });

  test('bad input is a usage error with exit code 2', () => {
    const cases: [string[], RegExp][] = [
      [['frobnicate'], /Unknown command/],
      [['battle', '--a', 'x'], /--b is required/],
      [['battle', '--a', 'x', '--b'], /--b needs a value/],
      [['battle', '--a', 'x', '--b', '--ascii'], /--b needs a value/],
      [
        ['battle', '--a', 'x', '--b', 'y', '--seed', 'abc'],
        /must be an integer/,
      ],
      [['battle', '--a', 'x', '--b', 'y', '--seed', '-1'], /between/],
      [
        ['battle', '--a', 'x', '--b', 'y', '--seed', '1.5'],
        /must be an integer/,
      ],
      [['battle', '--a', 'x', '--b', 'y', '--bogus', '1'], /Unknown option/],
      [['battle', '--a', 'x', '--a', 'y', '--b', 'z'], /twice/],
      [['battle', 'stray'], /Unexpected argument/],
      [['battle', '--a', 'x', '--b', 'y', '--ascii=1'], /takes no value/],
      [['map', '--seed', '1', '--party', '9'], /between 1 and 4/],
      [['pve', '--team', 'x', '--archetype', 'a', '--type', 'huge'], /--type/],
      [['batch', '--a', 'x', '--b', 'y', '--count', '0'], /between/],
      [
        [
          'batch',
          '--a',
          'x',
          '--b',
          'y',
          '--seed',
          '4294967295',
          '--count',
          '3',
        ],
        /must stay within 4294967295/,
      ],
      [['battle', '--a=', '--b', 'y'], /non-empty/],
      [['battle', '--a', 'x', '--b', 'y', '--log', ''], /non-empty/],
      [
        ['batch', '--a', 'x', '--b', 'y', '--threat-seed', '3'],
        /only applies to a threat fight/,
      ],
      [['batch', '--a', 'x', '--b', 'y', '--type', 'easy'], /--type only/],
      [['batch', '--a', 'x', '--b', 'y', '--round', '2'], /--round only/],
    ];
    for (const [argv, pattern] of cases) {
      const e = usageError(argv);
      expect(e.message).toMatch(pattern);
      expect(e.exitCode).toBe(2);
    }
  });
});
