/**
 * What the player is told about a boss: its name, one line on its mechanic and
 * one line of counter advice. The words live in `content/presentation.en.json`
 * (screens `bossMechanic*` and `bossCounter*`); this only picks the keys by
 * archetype ID. A boss the table does not know, or a run saved before the boss
 * was chosen in the shop, gets the generic lines.
 */

import { screenText, screenTexts, type ScreenTexts } from '../build/texts.js';
import { archetypeText, bossLabel } from './display-text.js';

/** The key suffix of each boss archetype's lines. */
const SUFFIX: Readonly<Record<string, string>> = {
  arch_boss: 'Plain',
  arch_boss_brood: 'Burst',
  arch_boss_linked: 'Pool',
  arch_boss_pylons: 'Shield',
  arch_boss_warlord: 'Champion',
};

export interface BossInfo {
  /** The archetype ID, or null when the boss is not known (an older save). */
  readonly id: string | null;
  /** "Brood", "Bonded", ...; the Boss archetype's name when unknown. */
  readonly name: string;
  readonly mechanic: string;
  /** The counter advice with its "Counter:" lead. */
  readonly counter: string;
}

/** The boss named by a stored archetype ID (undefined: not recorded). */
export function bossInfo(
  id: string | undefined,
  texts: ScreenTexts = screenTexts,
): BossInfo {
  const suffix = id === undefined ? undefined : SUFFIX[id];
  const word = suffix ?? 'Unknown';
  return {
    id: id ?? null,
    name: id === undefined ? bossLabel() : archetypeText(id).name,
    mechanic: screenText(texts, `bossMechanic${word}`),
    counter: screenText(texts, 'uiNextBossCounter', {
      advice: screenText(texts, `bossCounter${word}`),
    }),
  };
}

/** The mechanic line alone, for the battle summary. */
export function bossMechanic(
  id: string | undefined,
  texts: ScreenTexts = screenTexts,
): string {
  return bossInfo(id, texts).mechanic;
}
