/**
 * Small pieces the event handlers share. They live apart from `events.ts` so
 * that `caravan.ts` can use them without importing `events.ts` at run time
 * (`events.ts` imports `caravan.ts`).
 */
import { heldModifierIds } from '@game/core';
import type { EventContext } from './events.js';

/** The id of the choice that takes no upgrade (or no reward). */
export const SKIP_CHOICE = 'skip';

/**
 * Modifier IDs the party could take now, in file order: unlocked at the
 * current round (`fromRound`, default 1) and either not held or stackable.
 * Pacts (`pact: true`, RS-4i6) are never offered by the Shrine, nor by the
 * Caravan.
 */
export function eligibleModifiers(ctx: EventContext): string[] {
  const held = new Set(heldModifierIds(ctx.state.team));
  const round = ctx.state.round;
  return ctx.config.modifiers
    .filter((m) => m.pact !== true)
    .filter((m) => round >= (m.fromRound ?? 1))
    .filter((m) => m.stackable || !held.has(m.id))
    .map((m) => m.id);
}

const CELL_CHOICE = /^c(0|[1-9][0-9]{0,5})_(0|[1-9][0-9]{0,5})$/;

/** The choice id of a cell: `c<x>_<y>` (Rich vein; a Caravan Node's sub-choice). */
export function richVeinChoice(x: number, y: number): string {
  return `c${String(x)}_${String(y)}`;
}

/** The cell a choice id `c<x>_<y>` names, or null. */
export function richVeinCell(
  choice: string,
): { readonly x: number; readonly y: number } | null {
  const m = CELL_CHOICE.exec(choice);
  return m === null ? null : { x: Number(m[1]), y: Number(m[2]) };
}
