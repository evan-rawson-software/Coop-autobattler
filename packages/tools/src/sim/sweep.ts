/**
 * Prints the PvE sweep of pve-battle.test.ts (reference boards against every
 * threat, rounds 1 to 20) as JSON rows plus the summary numbers the test pins.
 */
import {
  REFERENCE_BOARDS,
  buildReferenceBoard,
  generateThreat,
  simulatePveBattle,
  THREAT_TYPES,
} from '@game/core';
import { loadSimContext } from './context.js';

const ctx = loadSimContext();
const config = { sim: ctx.sim, mapgen: ctx.mapgen };
const MAX_ROUND = 20;

interface Row {
  board: string;
  arch: string;
  type: string;
  round: number;
  won: boolean;
  endTick: number;
  reason: string;
}
const rows: Row[] = [];
for (const arch of ctx.threats.archetypes.map((a) => a.id)) {
  for (const type of THREAT_TYPES) {
    for (const board of REFERENCE_BOARDS) {
      const team = buildReferenceBoard(board, ctx.content, ctx.mapgen);
      for (let round = 1; round <= MAX_ROUND; round++) {
        const t = generateThreat(
          { seed: 100 + round, round, type, partySize: 1, archetype: arch },
          ctx.content,
          { threats: ctx.threats, mapgen: ctx.mapgen },
        );
        const r = simulatePveBattle(
          { team, threat: t, seed: 7 + round },
          ctx.content,
          config,
        );
        if (!r.ok) throw new Error(r.error.message);
        rows.push({
          board,
          arch,
          type,
          round,
          won: r.result.winner === 0,
          endTick: r.result.endTick,
          reason: r.result.reason,
        });
      }
    }
  }
}
for (const board of REFERENCE_BOARDS) {
  const mine = rows.filter((r) => r.board === board);
  const won = mine.filter((r) => r.won).map((r) => r.round);
  console.log('LAST_WIN', board, Math.max(...won, 0), 'wins', won.length);
}
const winsIn = (lo: number, hi: number): number =>
  rows.filter((r) => r.won && r.round >= lo && r.round <= hi).length;
console.log(
  'blocks',
  winsIn(1, 5),
  winsIn(6, 10),
  winsIn(11, 15),
  winsIn(16, 20),
);
const reasons: Record<string, number> = {};
for (const r of rows) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
console.log('reasons', JSON.stringify(reasons));
const get = (b: string, a: string, t: string, round: number): Row | undefined =>
  rows.find(
    (r) => r.board === b && r.arch === a && r.type === t && r.round === round,
  );
for (const type of ['medium', 'hard']) {
  console.log(
    'rush vs rusher r5',
    type,
    get('rush', 'arch_rusher', type, 5)?.won,
    'fortify',
    get('fortify', 'arch_rusher', type, 5)?.won,
  );
}
for (const type of ['medium', 'hard']) {
  for (let round = 4; round <= 9; round++) {
    console.log(
      'rusher',
      type,
      round,
      'rush',
      get('rush', 'arch_rusher', type, round)?.won,
      'fortify',
      get('fortify', 'arch_rusher', type, round)?.won,
    );
  }
}
for (const type of ['easy', 'medium', 'hard']) {
  for (const round of [1, 2, 3]) {
    const a = get('rush', 'arch_fortress', type, round);
    const b = get('fortify', 'arch_fortress', type, round);
    console.log(
      'fortress',
      type,
      round,
      a?.won,
      a?.endTick,
      b?.won,
      b?.endTick,
    );
  }
}
