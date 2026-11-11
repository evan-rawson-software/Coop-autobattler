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
  matchedBoards,
  matchedPairs,
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
        ...(args.includes('--matched')
          ? matchedBoards(ctx, list(args, '--party', [1, 2]))
          : []),
      ]
    : (JSON.parse(readFileSync(file, 'utf8')) as VariedBoard[]);
const save = text(args, '--save');
if (save !== undefined) writeFileSync(save, JSON.stringify(boards));
const isMatched = (b: VariedBoard): boolean => b.label.startsWith('matched/');
const plain = boards.filter((b) => !isMatched(b));
const matched = boards.filter(isMatched);
const pairs = [
  ...variedPairs(plain, list(args, '--opponents', [3])[0] ?? 3).map(
    ([i, j]) =>
      [
        boards.indexOf(plain[i] as VariedBoard),
        boards.indexOf(plain[j] as VariedBoard),
      ] as const,
  ),
  ...matchedPairs(matched).map(
    ([i, j]) =>
      [
        boards.indexOf(matched[i] as VariedBoard),
        boards.indexOf(matched[j] as VariedBoard),
      ] as const,
  ),
];
const t0 = Date.now();
const rows = pairs.map(([i, j], n) =>
  runVaried(ctx, boards[i] as VariedBoard, boards[j] as VariedBoard, 1 + n),
);
const dump = text(args, '--dump');
if (dump !== undefined) writeFileSync(dump, JSON.stringify(rows));
const group = (label: string): string =>
  label.startsWith('matched/')
    ? 'matched'
    : label.startsWith('dense')
      ? 'dense'
      : 'bot';
const byGroup = new Map<string, typeof rows>();
rows.forEach((row) => {
  const g = group(row.a);
  byGroup.set(g, [...(byGroup.get(g) ?? []), row]);
});
console.log(`boards ${String(boards.length)}, battles ${String(rows.length)}`);
for (const [g, r] of [...byGroup.entries()].sort((a, b) =>
  a[0] < b[0] ? -1 : 1,
)) {
  console.log(`${g}:`, JSON.stringify(summariseVaried(r)));
}
console.log('all:', JSON.stringify(summariseVaried(rows)));
console.log(`wall ${String(Date.now() - t0)} ms`);
