/**
 * `tsx packages/tools/src/sim/varied-report.ts [--boards file] [--save file]
 * [--party 1,2] [--seeds 1,2,3] [--rounds 2,4,6] [--opponents 3]`: play the
 * battles of unequal bot-built boards (see varied.ts) and print the outcome
 * and front-width table. `--save` writes the generated boards, `--boards`
 * plays saved ones (so a before and an after run use the same factories).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { loadSimContext } from './context.js';
import {
  runVaried,
  summariseVaried,
  denseBoards,
  variedBoards,
  variedPairs,
  type VariedBoard,
} from './varied.js';

function list(args: string[], name: string, def: number[]): number[] {
  const i = args.indexOf(name);
  const v = i < 0 ? undefined : args[i + 1];
  return v === undefined ? def : v.split(',').map((s) => Number(s));
}

function text(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
}

const args = process.argv.slice(2);
const ctx = loadSimContext();
const file = text(args, '--boards');
const boards: readonly VariedBoard[] =
  file === undefined
    ? [
        ...variedBoards(ctx, {
          parties: list(args, '--party', [1, 2]),
          seeds: list(args, '--seeds', [1, 2, 3]),
          rounds: list(args, '--rounds', [2, 4, 6]),
        }),
        ...(args.includes('--dense')
          ? denseBoards(ctx, list(args, '--party', [1, 2]))
          : []),
      ]
    : (JSON.parse(readFileSync(file, 'utf8')) as VariedBoard[]);
const save = text(args, '--save');
if (save !== undefined) writeFileSync(save, JSON.stringify(boards));
const pairs = variedPairs(boards, list(args, '--opponents', [3])[0] ?? 3);
const t0 = Date.now();
const rows = pairs.map(([i, j], n) =>
  runVaried(ctx, boards[i] as VariedBoard, boards[j] as VariedBoard, 1 + n),
);
const byParty = new Map<number, typeof rows>();
pairs.forEach(([i], n) => {
  const p = (boards[i] as VariedBoard).party;
  const row = rows[n];
  if (row === undefined) return;
  byParty.set(p, [...(byParty.get(p) ?? []), row]);
});
console.log(`boards ${String(boards.length)}, battles ${String(rows.length)}`);
for (const [p, r] of [...byParty.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`party ${String(p)}:`, JSON.stringify(summariseVaried(r)));
}
console.log('all:', JSON.stringify(summariseVaried(rows)));
console.log(`wall ${String(Date.now() - t0)} ms`);
