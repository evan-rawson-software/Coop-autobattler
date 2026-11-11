/** Command-line argument parsing for `pnpm sim` (pure; no I/O). */
import { BOT_STRATEGIES, isBotStrategy } from '@game/session';

export class CliError extends Error {
  constructor(
    message: string,
    /** 2 for a usage error, 1 for a failure while running. */
    readonly exitCode: 1 | 2 = 1,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

export type ThreatTypeName = 'easy' | 'medium' | 'hard' | 'boss';
const TYPES: readonly string[] = ['easy', 'medium', 'hard', 'boss'];

export interface ThreatArgs {
  /** Archetype ID; the `arch_` prefix is added if missing. */
  readonly archetype: string;
  readonly type: ThreatTypeName;
  readonly round: number;
  /** Seed of the threat generator; defaults to the battle seed. */
  readonly threatSeed: number | undefined;
}

export type Command =
  | { readonly kind: 'help' }
  | {
      readonly kind: 'map';
      readonly seed: number;
      readonly party: number;
      readonly time: boolean;
    }
  | {
      readonly kind: 'battle';
      readonly a: string;
      readonly b: string;
      readonly seed: number;
      readonly log: string | undefined;
      readonly ascii: boolean;
      readonly time: boolean;
    }
  | {
      readonly kind: 'pve';
      readonly team: string;
      readonly threat: ThreatArgs;
      readonly seed: number;
      readonly log: string | undefined;
      readonly ascii: boolean;
      readonly time: boolean;
    }
  | {
      readonly kind: 'batch';
      readonly a: string;
      /** A board to fight, or null when `threat` is given. */
      readonly b: string | null;
      readonly threat: ThreatArgs | null;
      readonly count: number;
      readonly seed: number;
      readonly time: boolean;
    }
  | {
      readonly kind: 'bot';
      /** Strategy names, in the order given. */
      readonly strategies: readonly string[];
      readonly count: number;
      readonly seed: number;
      readonly party: number;
      /** Stop each run after this round; null plays to defeat. */
      readonly maxRounds: number | null;
      /** Also play every run again and compare (fails on any difference). */
      readonly verify: boolean;
      readonly time: boolean;
    }
  | {
      readonly kind: 'ghosts';
      /** Where to write the file; null: the bundled file in the repository. */
      readonly out: string | null;
      /** Do not write: fail if the file on disk differs from a new one. */
      readonly check: boolean;
      readonly time: boolean;
    };

export const USAGE = `Usage: pnpm sim <command> [options]

Commands:
  map     --seed N [--party N]
            Generate a map from a seed and print it.
  battle  --a BOARD --b BOARD [--seed N] [--log FILE] [--ascii]
            Fight two boards (A is the party, B the defender).
  pve     --team BOARD --archetype ID [--type easy|medium|hard|boss]
          [--round N] [--seed N] [--threat-seed N] [--log FILE] [--ascii]
            Fight a board against a generated threat.
  batch   --a BOARD (--b BOARD | --archetype ID [--type T] [--round N])
          [--count N] [--seed N]
            Run N battles with seeds seed .. seed+N-1; report win rate and length.
  bot     [--strategy NAME[,NAME...]|all] [--count N] [--seed N] [--party N]
          [--max-rounds N] [--verify]
            Let the scripted bot play whole runs (strategies: ${BOT_STRATEGIES.join(', ')})
            with seeds seed .. seed+count-1; report depth reached, win rate by
            round, where each run ended and the number of rejected intents
            (exit code 1 if any, or with --verify if a replay differs).
  ghosts  [--out FILE] [--check]
            Play bot runs with ghosts on and write their PvP snapshots to the
            bundled ghost file (default packages/web/src/run/bundled-ghosts.json).
            Same output every time. With --check, write nothing and exit 1 if
            the file on disk is not what a new run would write.

BOARD is a path to a board JSON file, or a reference board name (rush,
fortify, siege, poor) which means boards/<name>.json.

Options:
  --seed N     battle seed (default 1); a batch or bot play uses N, N+1, ...
  --time       also print the wall time (the only non-deterministic output)
  --help       show this text

Examples: pnpm sim battle --a rush --b fortify --seed 1
          pnpm sim bot --strategy all --count 3 --party 2 --verify
`;

const FLAGS: Readonly<Record<string, readonly string[]>> = {
  map: ['seed', 'party', 'time'],
  battle: ['a', 'b', 'seed', 'log', 'ascii', 'time'],
  pve: [
    'team',
    'archetype',
    'type',
    'round',
    'seed',
    'threat-seed',
    'log',
    'ascii',
    'time',
  ],
  batch: [
    'a',
    'b',
    'archetype',
    'type',
    'round',
    'count',
    'seed',
    'threat-seed',
    'time',
  ],
  bot: ['strategy', 'count', 'seed', 'party', 'max-rounds', 'verify', 'time'],
  ghosts: ['out', 'check', 'time'],
};
/** The largest seed (an unsigned 32-bit integer, as core requires). */
const MAX_SEED = 0xffffffff;
/**
 * Sanity bound for `--round` at parse time; the real limit is core's
 * `maxThreatRound` for the loaded content, checked when the command runs.
 */
const MAX_ROUND_PARSE = 1000;
const BOOLEAN_FLAGS: readonly string[] = ['ascii', 'time', 'verify', 'check'];

function usageError(message: string): CliError {
  return new CliError(`${message}\n\n${USAGE}`, 2);
}

function parseInteger(
  name: string,
  value: string,
  min: number,
  max: number,
): number {
  if (!/^-?\d+$/.test(value)) {
    throw usageError(`--${name} must be an integer, got "${value}".`);
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw usageError(
      `--${name} must be between ${String(min)} and ${String(max)}, got ${value}.`,
    );
  }
  return n;
}

type Flags = Map<string, string>;

function collectFlags(command: string, rest: readonly string[]): Flags {
  const allowed = FLAGS[command] ?? [];
  const flags: Flags = new Map();
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i] as string;
    if (!token.startsWith('--')) {
      throw usageError(`Unexpected argument "${token}".`);
    }
    const eq = token.indexOf('=');
    const name = eq === -1 ? token.slice(2) : token.slice(2, eq);
    if (!allowed.includes(name)) {
      throw usageError(`Unknown option "--${name}" for "${command}".`);
    }
    if (flags.has(name)) throw usageError(`--${name} given twice.`);
    if (BOOLEAN_FLAGS.includes(name)) {
      if (eq !== -1) throw usageError(`--${name} takes no value.`);
      flags.set(name, 'true');
      continue;
    }
    let value: string | undefined;
    if (eq !== -1) value = token.slice(eq + 1);
    else {
      value = rest[i + 1];
      i += 1;
    }
    if (value === undefined || (eq === -1 && value.startsWith('--'))) {
      throw usageError(`--${name} needs a value.`);
    }
    if (value === '') throw usageError(`--${name} needs a non-empty value.`);
    flags.set(name, value);
  }
  return flags;
}

function required(flags: Flags, name: string): string {
  const v = flags.get(name);
  if (v === undefined) throw usageError(`--${name} is required.`);
  return v;
}

function seedOf(flags: Flags, name = 'seed', fallback = 1): number {
  const v = flags.get(name);
  return v === undefined ? fallback : parseInteger(name, v, 0, MAX_SEED);
}

function threatOf(flags: Flags): ThreatArgs {
  const type = flags.get('type') ?? 'medium';
  if (!TYPES.includes(type)) {
    throw usageError(
      `--type must be one of ${TYPES.join(', ')}, got "${type}".`,
    );
  }
  const archetype = required(flags, 'archetype');
  const ts = flags.get('threat-seed');
  return {
    archetype: archetype.startsWith('arch_') ? archetype : `arch_${archetype}`,
    type: type as ThreatTypeName,
    round: parseInteger('round', flags.get('round') ?? '1', 1, MAX_ROUND_PARSE),
    threatSeed:
      ts === undefined
        ? undefined
        : parseInteger('threat-seed', ts, 0, MAX_SEED),
  };
}

/** Parse `process.argv.slice(2)`. Throws `CliError` (exit code 2) on bad input. */
export function parseArgs(argv: readonly string[]): Command {
  const [command, ...rest] = argv;
  if (command === undefined || command === '--help' || command === 'help') {
    return { kind: 'help' };
  }
  if (rest.includes('--help')) return { kind: 'help' };
  if (!Object.hasOwn(FLAGS, command)) {
    throw usageError(`Unknown command "${command}".`);
  }
  const flags = collectFlags(command, rest);
  const time = flags.has('time');
  switch (command) {
    case 'map':
      return {
        kind: 'map',
        seed: seedOf(flags),
        party: parseInteger('party', flags.get('party') ?? '1', 1, 4),
        time,
      };
    case 'battle':
      return {
        kind: 'battle',
        a: required(flags, 'a'),
        b: required(flags, 'b'),
        seed: seedOf(flags),
        log: flags.get('log'),
        ascii: flags.has('ascii'),
        time,
      };
    case 'pve':
      return {
        kind: 'pve',
        team: required(flags, 'team'),
        threat: threatOf(flags),
        seed: seedOf(flags),
        log: flags.get('log'),
        ascii: flags.has('ascii'),
        time,
      };
    case 'bot': {
      const raw = flags.get('strategy') ?? 'all';
      const names = raw === 'all' ? [...BOT_STRATEGIES] : raw.split(',');
      for (const n of names) {
        if (!isBotStrategy(n)) {
          throw usageError(
            `Unknown strategy "${n}"; use ${BOT_STRATEGIES.join(', ')} or all.`,
          );
        }
      }
      const count = parseInteger('count', flags.get('count') ?? '3', 1, 1000);
      const seed = seedOf(flags);
      if (seed + count - 1 > MAX_SEED) {
        throw usageError(
          `Seeds seed .. seed+count-1 must stay within ${String(MAX_SEED)}.`,
        );
      }
      const mr = flags.get('max-rounds');
      return {
        kind: 'bot',
        strategies: names,
        count,
        seed,
        party: parseInteger('party', flags.get('party') ?? '1', 1, 4),
        maxRounds:
          mr === undefined
            ? null
            : parseInteger('max-rounds', mr, 1, MAX_ROUND_PARSE),
        verify: flags.has('verify'),
        time,
      };
    }
    case 'ghosts':
      return {
        kind: 'ghosts',
        out: flags.get('out') ?? null,
        check: flags.has('check'),
        time,
      };
    default: {
      const b = flags.get('b');
      const hasThreat = flags.has('archetype');
      if (b !== undefined && hasThreat) {
        throw usageError('Give either --b or --archetype, not both.');
      }
      if (b === undefined && !hasThreat) {
        throw usageError('Give --b BOARD or --archetype ID to fight.');
      }
      if (!hasThreat) {
        for (const name of ['type', 'round', 'threat-seed']) {
          if (flags.has(name)) {
            throw usageError(
              `--${name} only applies to a threat fight; give --archetype ID (it is ignored with --b).`,
            );
          }
        }
      }
      const count = parseInteger(
        'count',
        flags.get('count') ?? '300',
        1,
        100000,
      );
      const seed = seedOf(flags);
      if (seed + count - 1 > MAX_SEED) {
        throw usageError(
          `A batch uses seeds seed .. seed+count-1, which must stay within ${String(MAX_SEED)}; got --seed ${String(seed)} --count ${String(count)} (last seed ${String(seed + count - 1)}).`,
        );
      }
      return {
        kind: 'batch',
        a: required(flags, 'a'),
        b: b ?? null,
        threat: hasThreat ? threatOf(flags) : null,
        count,
        seed,
        time,
      };
    }
  }
}
