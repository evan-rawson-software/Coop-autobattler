import {
  ALL_REFERENCE_BOARDS,
  buildAnyReferenceBoard,
  startBattle,
  type TeamState,
} from '@game/core';
import { loadSimContext } from './context.js';

const ctx = loadSimContext();
const config = { sim: ctx.sim, mapgen: ctx.mapgen };
const boards = ALL_REFERENCE_BOARDS.map((n) =>
  buildAnyReferenceBoard(n, ctx.content, ctx.mapgen),
);
const pairs: [TeamState, TeamState, number][] = [];
for (let seed = 1; seed <= 8; seed++) {
  for (const a of boards) for (const b of boards) pairs.push([a, b, seed]);
}
let ticks = 0;
for (let round = 0; round < 2; round++) {
  for (const [a, b, s] of pairs) {
    const r = startBattle({ teamA: a, teamB: b, seed: s }, ctx.content, config);
    if (!r.ok) throw new Error('x');
    while (!r.battle.isOver()) {
      r.battle.step();
      ticks++;
    }
  }
}
console.log('ticks', ticks);
