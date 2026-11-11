import {
  ALL_REFERENCE_BOARDS,
  buildAnyReferenceBoard,
  fits,
  startBattle,
  type TeamState,
} from '@game/core';
import { denseFourPlotTeam } from './bench-teams.js';
import { loadSimContext } from './context.js';

const ctx = loadSimContext();
const config = { sim: ctx.sim, mapgen: ctx.mapgen };

function check(a: TeamState, b: TeamState, seed: number): string {
  const s = startBattle({ teamA: a, teamB: b, seed }, ctx.content, config);
  if (!s.ok) throw new Error(s.error.message);
  const battle = s.battle;
  let bad = 0;
  let maxUnits = 0;
  while (!battle.isOver()) {
    battle.step();
    const us = battle.sim.units;
    maxUnits = Math.max(maxUnits, us.length);
    for (let i = 0; i < us.length; i++) {
      const u = us[i];
      if (u === undefined) continue;
      const d = ctx.content.units.get(u.def);
      if (d === undefined) continue;
      if (!fits(battle.ctx.world, u.side, d.collisionRadius, u.px, u.py)) bad++;
      for (let j = i + 1; j < us.length; j++) {
        const v = us[j];
        if (v === undefined) continue;
        const e = ctx.content.units.get(v.def);
        if (e === undefined) continue;
        const r = d.collisionRadius + e.collisionRadius;
        const dx = u.px - v.px;
        const dy = u.py - v.py;
        if (dx * dx + dy * dy < r * r) bad++;
      }
    }
  }
  return `ticks ${battle.sim.tick} maxUnits ${maxUnits} violations ${bad} ${battle.result()?.reason}`;
}

const boards = ALL_REFERENCE_BOARDS.map((n) =>
  buildAnyReferenceBoard(n, ctx.content, ctx.mapgen),
);
for (const a of boards) {
  for (const b of boards) console.log(check(a, b, 3));
}
const t = denseFourPlotTeam(ctx, 1);
console.log('dense', check(t, t, 1));
