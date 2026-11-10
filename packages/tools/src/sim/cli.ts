/**
 * `pnpm sim`: the command-line battle runner (W1-10). Reads board files,
 * calls the pure commands in `commands.ts`, prints their text and optionally
 * writes the event log. Node I/O is allowed here (not in core).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
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

/** `rush` means `boards/rush.json` in the repository; anything else is a path. */
export function boardPath(ref: string): string {
  if (/^[a-z][a-z0-9_-]*$/.test(ref)) {
    return path.join(repoRoot, 'boards', `${ref}.json`);
  }
  return path.resolve(ref);
}

export function loadBoard(ref: string, ctx: SimContext): Board {
  const file = boardPath(ref);
  if (!existsSync(file)) {
    throw new CliError(
      `Board "${ref}" not found (looked for ${file}). Use a reference board name (rush, fortify, siege, poor) or a path to a board JSON file.`,
    );
  }
  const board = parseBoardText(readFileSync(file, 'utf8'), ref, ctx);
  return /^[a-z][a-z0-9_-]*$/.test(ref) ? { ...board, label: ref } : board;
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
    const ctx = loadSimContext();
    const t0 = performance.now();
    let output: CommandOutput;
    switch (cmd.kind) {
      case 'map':
        output = mapCommand(ctx, cmd);
        break;
      case 'battle':
        output = battleCommand(ctx, {
          a: loadBoard(cmd.a, ctx),
          b: loadBoard(cmd.b, ctx),
          seed: cmd.seed,
          ascii: cmd.ascii,
        });
        break;
      case 'pve':
        output = pveCommand(ctx, {
          team: loadBoard(cmd.team, ctx),
          threat: cmd.threat,
          seed: cmd.seed,
          ascii: cmd.ascii,
        });
        break;
      case 'batch':
        output = batchCommand(ctx, {
          a: loadBoard(cmd.a, ctx),
          b: cmd.b === null ? null : loadBoard(cmd.b, ctx),
          threat: cmd.threat,
          count: cmd.count,
          seed: cmd.seed,
        });
        break;
    }
    const ms = performance.now() - t0;
    io.out(output.text);
    if ('log' in cmd && cmd.log !== undefined && output.log !== undefined) {
      writeFileSync(cmd.log, `${JSON.stringify(output.log)}\n`);
      io.out(`Event log written to ${cmd.log}`);
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
