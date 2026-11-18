/**
 * `pnpm exec tsx packages/tools/src/sim/boss-report.ts [--party 1,2,3,4]
 * [--rounds 3,5,...] [--seeds 1,2,3] [--bosses id,id] [--strategies a,b]
 * [--battles N]` (issue #403): the win rate of bot-built boards (the
 * strategies of `varied.ts`, stopped after the round fought) against each boss
 * archetype at the same round and party size, so every boss is read against
 * `arch_boss`. Prints, per party size and round, the party win rate for each
 * boss and the difference to `arch_boss`, then the same by strategy (the
 * counter reading: fortify for Brood, rush for Pylons, and so on).
 */
import {
  generateThreat,
  startBattle,
  startPveBattle,
  type StartBattleResult,
  type TeamState,
} from '@game/core';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadSimContext } from './context.js';
import { variedBoards, type VariedBoard } from './varied.js';

function list(args: string[], name: string, def: number[]): number[] {
  const i = args.indexOf(name);
  const v = i < 0 ? undefined : args[i + 1];
  return v === undefined ? def : v.split(',').map((s) => Number(s));
}
function words(args: string[], name: string, def: string[]): string[] {
  const i = args.indexOf(name);
  const v = i < 0 ? undefined : args[i + 1];
  return v === undefined ? def : v.split(',');
}

const args = process.argv.slice(2);
const ctx = loadSimContext();
const config = { sim: ctx.sim, mapgen: ctx.mapgen };
const parties = list(args, '--party', [1, 2, 3, 4]);
const rounds = list(args, '--rounds', [3, 5, 8, 12, 16, 20]);
const seeds = list(args, '--seeds', [1, 2, 3]);
const battles = list(args, '--battles', [2])[0] ?? 2;
const strategies = words(args, '--strategies', [
  'rush',
  'fortify',
  'siege',
  'weak',
]);
const bosses = words(
  args,
  '--bosses',
  ctx.threats.archetypes.filter((a) => a.bossOnly).map((a) => a.id),
);
const BASE = 'arch_boss';
// The cold-start stand-in (SC-5): the bundled bot ghosts of the same party
// size and round (they stop after round 6); where there are none, the boards
// of other bot seeds of that party size and round.
const ghostFile = JSON.parse(
  readFileSync('packages/web/src/run/bundled-ghosts.json', 'utf8'),
) as {
  ghosts: { partySize: number; round: number; team: TeamState }[];
};
const GHOST_MAX_ROUND = 8;
const minParty = (id: string): number =>
  ctx.threats.archetypes.find((a) => a.id === id)?.minPartySize ?? 1;
const fromRound = (id: string): number =>
  ctx.threats.archetypes.find((a) => a.id === id)?.fromRound ?? 1;

interface Tally {
  wins: number;
  n: number;
}
const pct = (t: Tally | undefined): string =>
  t === undefined || t.n === 0
    ? '   -'
    : String(Math.round((100 * t.wins) / t.n)).padStart(4);
const t0 = Date.now();
// Building the boards replays whole bot runs, so --cache FILE keeps them.
const cacheAt = words(args, '--cache', [''])[0] ?? '';
let cached: VariedBoard[] =
  cacheAt !== '' && existsSync(cacheAt)
    ? (JSON.parse(readFileSync(cacheAt, 'utf8')) as VariedBoard[])
    : [];
for (const party of parties)
  for (const round of rounds) {
    if (
      cached.some(
        (b) => b.party === party && b.label.includes(`/r${String(round)}/`),
      )
    )
      continue;
    cached.push(
      ...variedBoards(ctx, {
        parties: [party],
        seeds,
        rounds: [round],
        strategies: strategies as never,
      }),
    );
    if (cacheAt !== '') writeFileSync(cacheAt, JSON.stringify(cached));
  }
cached = cached.filter((b) =>
  seeds.some((s) => b.label.includes(`/s${String(s)}/`)),
);
const total = new Map<string, Tally>();
const bump = (key: string, win: boolean): void => {
  const t = total.get(key) ?? { wins: 0, n: 0 };
  t.n += 1;
  if (win) t.wins += 1;
  total.set(key, t);
};

for (const party of parties) {
  for (const round of rounds) {
    const boards = cached.filter(
      (b) => b.party === party && b.label.includes(`/r${String(round)}/`),
    );
    for (const board of boards) {
      const strategy = board.label.split('/')[0] ?? '';
      if (round <= GHOST_MAX_ROUND) {
        let foes: TeamState[] = ghostFile.ghosts
          .filter((g) => g.partySize === party && g.round === round)
          .map((g) => g.team);
        if (foes.length === 0)
          foes = boards
            .filter((o) => o !== board)
            .slice(0, 4)
            .map((o) => o.team);
        for (const [k, foe] of foes.entries()) {
          const s = startBattle(
            { teamA: board.team, teamB: foe, seed: 100 + k, round },
            ctx.content,
            config,
          );
          if (!s.ok) continue;
          const b = s.battle;
          while (!b.isOver()) b.step();
          const win = b.result()?.winner === 0;
          bump(`${String(party)}|${String(round)}|ghost|all`, win);
        }
      }
      for (const boss of [BASE, ...bosses.filter((b) => b !== BASE)]) {
        if (party < minParty(boss)) continue;
        if (round < fromRound(boss) && !args.includes('--early')) continue;
        for (let k = 0; k < battles; k++) {
          const seed = 100 + k;
          const threat = generateThreat(
            { seed, round, type: 'boss', partySize: party, archetype: boss },
            ctx.content,
            { threats: ctx.threats, mapgen: ctx.mapgen },
          );
          const s: StartBattleResult = startPveBattle(
            { team: board.team, threat, seed, round },
            ctx.content,
            config,
          );
          if (!s.ok) continue;
          const b = s.battle;
          while (!b.isOver()) b.step();
          const win = b.result()?.winner === 0;
          bump(`${String(party)}|${String(round)}|${boss}|all`, win);
          bump(`${String(party)}|${String(round)}|${boss}|${strategy}`, win);
          bump(`${String(party)}|*|${boss}|${strategy}`, win);
          bump(`${String(party)}|*|${boss}|all`, win);
          bump(`*|${String(round)}|${boss}|all`, win);
          bump(`*|*|${boss}|all`, win);
        }
      }
    }
  }
}
const all = [BASE, ...bosses.filter((b) => b !== BASE), 'ghost'];
console.log(
  `boards: parties ${parties.join(',')} rounds ${rounds.join(',')} seeds ${seeds.join(',')} strategies ${strategies.join(',')}, ${String(battles)} battle seeds each`,
);
console.log(
  'party round strat  ' +
    all.map((b) => b.replace('arch_boss', 'boss').padStart(14)).join(''),
);
const rowOf = (p: string, r: string, strat: string): void => {
  const base = total.get(`${p}|${r}|${BASE}|${strat}`);
  const cells = all.map((b) => {
    const t = total.get(`${p}|${r}|${b}|${strat}`);
    if (t === undefined) return '             -';
    const d =
      b === BASE || base === undefined
        ? '    '
        : ` (${(100 * t.wins) / t.n - (100 * base.wins) / base.n >= 0 ? '+' : ''}${String(Math.round((100 * t.wins) / t.n - (100 * base.wins) / base.n))})`;
    return `${pct(t)}${d} n${String(t.n)}`.padStart(14);
  });
  console.log(
    `${p.padStart(5)} ${r.padStart(5)} ${strat.padEnd(7)}${cells.join('')}`,
  );
};
if (!args.includes('--no-rounds'))
  for (const p of parties)
    for (const r of rounds) rowOf(String(p), String(r), 'all');
console.log('-- by party (all rounds)');
for (const p of parties) rowOf(String(p), '*', 'all');
console.log('-- by round (all parties)');
for (const r of rounds) rowOf('*', String(r), 'all');
console.log('-- by strategy (all rounds) ');
for (const p of parties) for (const s of strategies) rowOf(String(p), '*', s);
rowOf('*', '*', 'all');
console.log(`wall ${String(Math.round((Date.now() - t0) / 1000))}s`);
