/**
 * Display text for archetypes, event types and run modifiers, read from
 * `content/presentation.en.json` through the loaded content. An ID with no
 * entry (content that was not given text) falls back to a title-cased ID so
 * a screen never shows an empty name; the content validator and a test make
 * sure no shipped ID reaches the fallback.
 *
 * What an event or modifier DOES is never written in content: card text is
 * built from the offer's own data (the tier count, the gold, the modifier
 * effects).
 */
import type { ModifierEffect } from '@game/core';
import { content } from '../content.js';

export interface ArchetypeText {
  readonly name: string;
  /** What the archetype does, in plain words. */
  readonly description: string;
  /** What it tests of the player's factory. */
  readonly tests: string;
}

function titleCase(id: string): string {
  const words = id
    .replace(/^(arch|evt|mod)_/, '')
    .split('_')
    .filter((w) => w.length > 0);
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function archetypeText(id: string): ArchetypeText {
  return (
    content.presentation.archetype(id) ?? {
      name: titleCase(id),
      description: 'A generated enemy stronghold.',
      tests: 'your factory',
    }
  );
}

/** Display name, icon and one-line flavour of an event type. */
export function eventText(type: string): {
  readonly name: string;
  readonly icon: string;
  readonly flavour: string;
} {
  return (
    content.presentation.event(type) ?? {
      name: titleCase(type),
      icon: titleCase(type).charAt(0),
      flavour: '',
    }
  );
}

export function modifierName(id: string): string {
  return content.presentation.modifier(id)?.name ?? titleCase(id);
}

const TARGET_WORDS: Readonly<Record<string, string>> = {
  all: 'All buildings except the Core',
  wall: 'Walls',
  gate: 'Gates',
  turret: 'Turrets',
  source: 'Source buildings',
  route: 'Route buildings',
  unit_producer: 'Unit-producing buildings',
  economy: 'Economy buildings',
};

/** What one effect does, from its data. */
export function effectLine(effect: ModifierEffect): string {
  switch (effect.kind) {
    case 'building_health_percent':
      return `${TARGET_WORDS[effect.target] ?? effect.target}: +${String(effect.percent)}% health`;
    case 'core_health_percent':
      return `Your Core: +${String(effect.percent)}% health`;
    case 'unit_strength_percent':
      return `Your units: +${String(effect.percent)}% strength`;
    case 'turret_damage_percent':
      return `Turrets: +${String(effect.percent)}% damage`;
  }
}

/** "the boss", or "the boss (Fortress)" when the archetype adds a name. */
export function bossName(archetype: string): string {
  return archetype === bossLabel() || archetype === ''
    ? 'the boss'
    : `the boss (${archetype})`;
}

/**
 * What a ghost opponent is called on screen: never its internal label
 * ("Bundled weak bot"), only a strength word when the label carries one.
 */
export function ghostDisplayName(label: string): string {
  const word = /\b(weak|medium|strong)\b/i.exec(label)?.[1]?.toLowerCase();
  return word === undefined ? 'Rival party' : `Rival party (${word})`;
}

/** The label of a boss opponent: the Boss archetype's display name. */
export function bossLabel(): string {
  return archetypeText('arch_boss').name;
}
