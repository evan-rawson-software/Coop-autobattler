/**
 * What the held run modifiers look like on screen: the totals the simulation
 * applies and the list of held modifiers with their stacks. Pure data in,
 * display data out; the text comes from `effectLine` and the presentation.
 */
import {
  clampModifierSum,
  type ModifierEffect,
  type TeamModifier,
} from '@game/core';
import { simConfig } from '../build/setup.js';
import { effectLine, modifierName } from './display-text.js';

/** One line of the bonuses list; a drawback (a negative percent) is flagged. */
export interface BonusLine {
  readonly text: string;
  readonly negative: boolean;
}

export interface HeldModifier {
  readonly id: string;
  readonly name: string;
  /** How many copies are held (stacks). */
  readonly count: number;
  /** The effect lines of one copy. */
  readonly lines: readonly BonusLine[];
}

export interface BonusView {
  /** Every held modifier, stacks counted each. */
  readonly count: number;
  /** The combined effects, as the simulation applies them. */
  readonly totals: readonly BonusLine[];
  readonly held: readonly HeldModifier[];
}

function line(effect: ModifierEffect): BonusLine {
  return { text: effectLine(effect), negative: effect.percent < 0 };
}

/** What a sum is kept apart by: effect kind, target and unit set. */
function totalKey(e: ModifierEffect): string {
  switch (e.kind) {
    case 'building_health_percent':
      return `${e.kind}|${e.target}`;
    case 'unit_strength_percent':
      return `${e.kind}|${(e.units ?? []).join(',')}`;
    default:
      return e.kind;
  }
}

/**
 * The effects summed per kind and target (a targeted unit strength apart from
 * the untargeted one), each applied once (RS-4e). First appearance orders
 * them; a sum of zero says nothing and is left out. A sum below the content's
 * `minModifierSumPercent` is shown at that bound, as the simulation applies it.
 */
export function totalEffects(
  modifiers: readonly TeamModifier[],
): readonly ModifierEffect[] {
  const sums = new Map<string, ModifierEffect>();
  for (const m of modifiers) {
    for (const e of m.effects) {
      const key = totalKey(e);
      const prev = sums.get(key);
      sums.set(
        key,
        prev === undefined ? e : { ...prev, percent: prev.percent + e.percent },
      );
    }
  }
  return [...sums.values()]
    .map((e) => ({
      ...e,
      percent: clampModifierSum(e.percent, simConfig.minModifierSumPercent),
    }))
    .filter((e) => e.percent !== 0);
}

/** The modifiers grouped by id in the order first taken, with their counts. */
export function bonusView(
  modifiers: readonly TeamModifier[] | undefined,
): BonusView {
  const mods = modifiers ?? [];
  const held: HeldModifier[] = [];
  for (const m of mods) {
    const at = held.findIndex((h) => h.id === m.id);
    const prev = at < 0 ? undefined : held[at];
    if (prev !== undefined) {
      held[at] = { ...prev, count: prev.count + 1 };
    } else {
      held.push({
        id: m.id,
        name: modifierName(m.id),
        count: 1,
        lines: m.effects.map(line),
      });
    }
  }
  return {
    count: mods.length,
    totals: totalEffects(mods).map(line),
    held,
  };
}
