/**
 * Build and Shop screen texts (rates, supply, border links, fallback player
 * names). The sentences live in `templates.screens` of the presentation file;
 * this module only fills their slots.
 */
import { content } from '../content.js';
import { fill } from '../shop/effect-text.js';

/** `templates.screens` of the presentation file. */
export type ScreenTexts = Readonly<Record<string, string>>;

/** The texts of the loaded presentation file. */
export const screenTexts: ScreenTexts = content.presentation.templates.screens;

/** The template `key` with its `{slot}`s filled from `values`. */
export function screenText(
  texts: ScreenTexts,
  key: string,
  values: Record<string, string> = {},
): string {
  return fill(texts[key] ?? '', values);
}

/** A player's display name, or the configured fallback ("Player 2"). */
export function playerName(
  texts: ScreenTexts,
  names: readonly (string | undefined)[],
  index: number,
): string {
  return (
    names[index] ??
    screenText(texts, 'playerFallback', { number: String(index + 1) })
  );
}
