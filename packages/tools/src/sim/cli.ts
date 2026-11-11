/**
 * `pnpm sim`: the command-line battle runner (W1-10). Reads board files,
 * calls the pure commands in `commands.ts`, prints their text and optionally
 * writes the event log. Node I/O is allowed here (not in core).
 */
import {
  accessSync,
  constants,
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { ALL_REFERENCE_BOARDS } from '@game/core';
import { CliError, USAGE, parseArgs } from './args.js';
import { parseBoardText, type Board } from './boards.js';
import {
  batchCommand,
  battleCommand,
  mapCommand,
  pveCommand,
  type CommandOutput,
} from './commands.js';
import { loadSimContext, type SimContext } from './context.js';

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

/**
 * The directory the user ran the command from. `pnpm` runs scripts from the
 * workspace root and records the original directory in `INIT_CWD`.
 */
export function userCwd(env: NodeJS.ProcessEnv = process.env): string {
  const init = env['INIT_CWD'];
  return init !== undefined && init !== '' ? init : process.cwd();
}

/** Resolve a user-given path against the directory the command was run from. */
export function resolveUserPath(p: string, cwd: string = userCwd()): string {
  return path.resolve(cwd, p);
}

/** A bare lowercase word such as `rush` (no extension, no separators). */
const BARE_WORD = /^[a-z][a-z0-9_-]*$/;

/** The reference board file of a bare word, if it is a known board name. */
function referenceFile(ref: string): string | null {
  if (!BARE_WORD.test(ref)) return null;
  const file = path.join(repoRoot, 'boards', `${ref}.json`);
  const known: readonly string[] = ALL_REFERENCE_BOARDS;
  return known.includes(ref) || existsSync(file) ? file : null;
}

/**
 * `rush` means `boards/rush.json` in the repository when it is a known
 * reference board name (or that file exists); anything else is a path,
 * relative to the directory the command was run from.
 */
export function boardPath(ref: string, cwd: string = userCwd()): string {
  return referenceFile(ref) ?? resolveUserPath(ref, cwd);
}

function fsReason(e: unknown): string {
  return e instanceof Error ? e.message : 'unknown error';
}

/** Fail early, before any battle runs, if the `--log` file cannot be written. */
function checkLogWritable(file: string): void {
  const dir = path.dirname(file);
  try {
    accessSync(dir, constants.W_OK);
    if (existsSync(file)) accessSync(file, constants.W_OK);
    if (statSync(file, { throwIfNoEntry: false })?.isDirectory() === true) {
      throw new Error(`${file} is a directory`);
    }
  } catch (e) {
    throw new CliError(
      `Cannot write the event log to ${file}: ${fsReason(e)}.`,
    );
  }
}

export function loadBoard(
  ref: string,
  ctx: SimContext,
  note: (text: string) => void = () => undefined,
  cwd: string = userCwd(),
): Board {
  const file = boardPath(ref, cwd);
  if (!existsSync(file)) {
    const asName = BARE_WORD.test(ref)
      ? `as a reference board name it is not one of ${ALL_REFERENCE_BOARDS.join(', ')} and ${path.join(repoRoot, 'boards', `${ref}.json`)} does not exist; `
      : '';
    throw new CliError(
      `Board "${ref}" not found: ${asName}as a path, ${file} does not exist. Use a reference board name (${ALL_REFERENCE_BOARDS.join(', ')}) or a path to a board JSON file.`,
    );
  }
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    throw new CliError(`Cannot read board "${ref}" (${file}): ${fsReason(e)}.`);
  }
  const board = parseBoardText(text, ref, ctx, note);
  return referenceFile(ref) !== null ? { ...board, label: ref } : board;
}

export interface Io {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

/** Run the CLI; returns the exit code. Never throws for bad input. */
export function main(argv: readonly string[], io: Io): number {
  try {
    const cmd = parseArgs(argv);
    if (cmd.kind === 'help') {
      io.out(USAGE);
      return 0;
    }
    const logFile =
      'log' in cmd && cmd.log !== undefined
        ? resolveUserPath(cmd.log)
        : undefined;
    if (logFile !== undefined) checkLogWritable(logFile);
    const load = (ref: string): Board => loadBoard(ref, ctx, io.err);
    const ctx = loadSimContext();
    const t0 = performance.now();
    let output: CommandOutput;
    switch (cmd.kind) {
      case 'map':
        output = mapCommand(ctx, cmd);
        break;
      case 'battle':
        output = battleCommand(ctx, {
          a: load(cmd.a),
          b: load(cmd.b),
          seed: cmd.seed,
          ascii: cmd.ascii,
        });
        break;
      case 'pve':
        output = pveCommand(ctx, {
          team: load(cmd.team),
          threat: cmd.threat,
          seed: cmd.seed,
          ascii: cmd.ascii,
        });
        break;
      case 'batch':
        output = batchCommand(ctx, {
          a: load(cmd.a),
          b: cmd.b === null ? null : load(cmd.b),
          threat: cmd.threat,
          count: cmd.count,
          seed: cmd.seed,
        });
        break;
    }
    const ms = performance.now() - t0;
    io.out(output.text);
    if (logFile !== undefined && output.log !== undefined) {
      try {
        writeFileSync(logFile, `${JSON.stringify(output.log)}\n`);
      } catch (e) {
        throw new CliError(
          `Cannot write the event log to ${logFile}: ${fsReason(e)}.`,
        );
      }
      io.out(`Event log written to ${logFile}`);
    }
    if (cmd.time) io.out(`Time: ${ms.toFixed(0)} ms`);
    return 0;
  } catch (e) {
    if (e instanceof CliError) {
      io.err(`Error: ${e.message}`);
      return e.exitCode;
    }
    throw e;
  }
}

const entry = process.argv[1];
if (
  entry !== undefined &&
  path.resolve(entry) === fileURLToPath(import.meta.url)
) {
  process.exitCode = main(process.argv.slice(2), {
    out: (t) => process.stdout.write(`${t}\n`),
    err: (t) => process.stderr.write(`${t}\n`),
  });
}
