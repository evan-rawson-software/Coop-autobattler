import { describe, expect, test } from 'vitest';
import { CliError, parseArgs } from './args.js';
import { main } from './cli.js';

function run(argv: string[]): { code: number; out: string; err: string } {
  let out = '';
  let err = '';
  const code = main(argv, {
    out: (t) => (out += `${t}\n`),
    err: (t) => (err += `${t}\n`),
  });
  return { code, out, err };
}

describe('sim bot arguments', () => {
  test('defaults: every strategy, three runs, party of one', () => {
    expect(parseArgs(['bot'])).toMatchObject({
      kind: 'bot',
      strategies: ['rush', 'fortify', 'siege', 'weak'],
      count: 3,
      seed: 1,
      party: 1,
      maxRounds: null,
      verify: false,
    });
  });

  test('options', () => {
    expect(
      parseArgs([
        'bot',
        '--strategy',
        'rush,weak',
        '--count',
        '2',
        '--seed',
        '9',
        '--party',
        '4',
        '--max-rounds',
        '3',
        '--verify',
      ]),
    ).toMatchObject({
      strategies: ['rush', 'weak'],
      count: 2,
      seed: 9,
      party: 4,
      maxRounds: 3,
      verify: true,
    });
  });

  test('bad input is a usage error', () => {
    for (const argv of [
      ['bot', '--strategy', 'nope'],
      ['bot', '--party', '5'],
      ['bot', '--count', '0'],
      ['bot', '--ascii'],
    ]) {
      expect(() => parseArgs(argv), argv.join(' ')).toThrow(CliError);
    }
  });

  test('help mentions the command', () => {
    expect(run(['--help']).out).toMatch(/\n {2}bot /);
  });
});

describe('sim bot', () => {
  test('plays short runs, reports and verifies replays', () => {
    const r = run([
      'bot',
      '--strategy',
      'rush,weak',
      '--count',
      '2',
      '--max-rounds',
      '2',
      '--verify',
    ]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/rush: depth reached/);
    expect(r.out).toMatch(/weak: depth reached/);
    expect(r.out).toMatch(/Rejected intents: 0/);
    expect(r.out).toMatch(/OK$/m);
  });

  test('is deterministic', () => {
    const argv = [
      'bot',
      '--strategy',
      'fortify',
      '--count',
      '1',
      '--seed',
      '4',
    ];
    expect(run(argv).out).toBe(run(argv).out);
  });
});
