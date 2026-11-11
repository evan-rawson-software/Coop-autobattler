import {
  buildAnyReferenceBoard,
  generateThreat,
  simulatePveBattle,
  withModifier,
  type TeamModifier,
} from '@game/core';
import { rawEvents } from '@game/content';
import { loadSimContext } from './context.js';

const ctx = loadSimContext();
const config = { sim: ctx.sim, mapgen: ctx.mapgen };
const evs = (rawEvents as { modifiers: { id: string; effects: TeamModifier['effects'] }[] }).modifiers;

function modifier(id: string): TeamModifier {
  const def = evs.find((m) => m.id === id);
  if (def === undefined) throw new Error(id);
  return { id: def.id, effects: def.effects };
}

function fight(
  board: 'rush' | 'fortify' | 'poor' | 'siege',
  archetype: string,
  type: 'easy' | 'medium' | 'hard',
  round: number,
  mods: readonly string[],
): string {
  let team = buildAnyReferenceBoard(board, ctx.content, ctx.mapgen);
  for (const m of mods) team = withModifier(team, modifier(m));
  const threat = generateThreat(
    { seed: 9, round, type, partySize: 1, archetype },
    ctx.content,
    { threats: ctx.threats, mapgen: ctx.mapgen },
  );
  const r = simulatePveBattle({ team, threat, seed: 3 }, ctx.content, config);
  if (!r.ok) throw new Error(r.error.message);
  return `${String(r.result.winner)}${String(r.summary.sides[0].unitsKilled)} `;
}

const mode = process.argv[2] ?? 'core';
const mods =
  mode === 'core'
    ? ['mod_fortified_core']
    : mode === 'turret'
      ? ['mod_sharp_turrets']
      : ['mod_drilled_troops'];
const boards = ['fortify', 'siege'] as const;
for (const board of boards) {
  for (const arch of ['arch_rusher', 'arch_fortress', 'arch_escalator']) {
    for (const type of ['easy', 'medium', 'hard'] as const) {
      const row: string[] = [];
      for (let round = 1; round <= 16; round++) {
        const a = fight(board, arch, type, round, []);
        const b = fight(board, arch, type, round, mods);
        row.push(a + b);
      }
      console.log(board, arch, type, row.join(' '));
    }
  }
}
