import { renderArenaAscii, startBattle } from '@game/core';
import { denseFourPlotTeam } from './bench-teams.js';
import { loadSimContext } from './context.js';

const ctx = loadSimContext();
const config = { sim: ctx.sim, mapgen: ctx.mapgen };
const t = denseFourPlotTeam(ctx, 1);
const s = startBattle({ teamA: t, teamB: t, seed: 1 }, ctx.content, config);
if (!s.ok) throw new Error('x');
const stop = Number(process.argv[2] ?? 1200);
let n = 0;
while (!s.battle.isOver() && n < stop) {
  s.battle.step();
  n++;
}
console.log('ticks', n, 'units', s.battle.sim.units.length);
if (process.argv[3] === 'ascii') console.log(renderArenaAscii(s.battle.sim, ctx.content));
