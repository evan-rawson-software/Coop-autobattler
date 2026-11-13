/**
 * Build and Shop screen texts (rates, supply, border links, fallback player
 * names). The sentences live in `templates.screens` of the presentation file;
 * this module only fills their slots.
 */
import type { ComponentChildren } from 'preact';
import { content } from '../content.js';
import { fill } from '../shop/effect-text.js';

/** `templates.screens` of the presentation file. */
export type ScreenTexts = Readonly<Record<string, string>>;

/** The texts of the loaded presentation file. */
export const screenTexts: ScreenTexts = content.presentation.templates.screens;

/**
 * The template `key` with its `{slot}`s filled from `values`. An unknown key
 * throws in development and tests and gives '' in a production build.
 */
export function screenText(
  texts: ScreenTexts,
  key: string,
  values: Record<string, string> = {},
): string {
  const template = texts[key];
  if (template === undefined) {
    // The loader guarantees every key, so this is a typo in the code. Fail
    // loudly in development and tests; a player sees an empty text instead
    // of a broken screen.
    if (import.meta.env.DEV) throw new Error(`Unknown screen text "${key}".`);
    return '';
  }
  return fill(template, values);
}

/**
 * The template `key` as render nodes: each `{slot}` is replaced by the node
 * given for it (for a sentence that holds markup such as `<strong>`).
 */
export function screenNodes(
  texts: ScreenTexts,
  key: string,
  values: Record<string, ComponentChildren>,
): ComponentChildren[] {
  const template = texts[key];
  if (template === undefined) {
    if (import.meta.env.DEV) throw new Error(`Unknown screen text "${key}".`);
    return [];
  }
  return template
    .split(/\{([a-z]+)\}/)
    .map((part, i) => (i % 2 === 0 ? part : (values[part] ?? `{${part}}`)));
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

/** Label of a player's Core on the board ("Player 2's Core"). */
export function coreLabel(
  player: number,
  texts: ScreenTexts = screenTexts,
): string {
  return screenText(texts, 'coreLabel', {
    name: playerName(texts, [], player),
  });
}
