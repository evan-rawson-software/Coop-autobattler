/**
 * TEMPORARY: display text that content does not carry yet.
 *
 * `content/presentation.en.json` has names and descriptions for buildings,
 * units and terrain only. Until issue #57 moves archetypes, events and run
 * modifiers into content, their display names and descriptions live here, in
 * this one file, so no screen invents its own. Delete this file when #57
 * lands and read the same texts from content.
 *
 * What an event or modifier DOES is never written here: card text is built
 * from the offer's own data (the tier count, the gold, the modifier effects).
 * Only the names and the one-line flavour of each kind are.
 */
import type { ModifierEffect } from '@game/core';

export interface ArchetypeText {
  readonly name: string;
  /** What the archetype does, in plain words. */
  readonly description: string;
  /** What it tests of the player's factory. */
  readonly tests: string;
}

export const ARCHETYPE_TEXT: Readonly<Record<string, ArchetypeText>> = {
  arch_rusher: {
    name: 'Rusher',
    description:
      'Heavy waves from the first seconds against a stronghold with almost no defenses.',
    tests: 'defense',
  },
  arch_fortress: {
    name: 'Fortress',
    description:
      'A heavily defended stronghold ringed with walls and turrets. Light waves that arrive late.',
    tests: 'ramp and siege',
  },
  arch_escalator: {
    name: 'Escalator',
    description:
      'Waves that grow quickly, behind a line of walls and turrets.',
    tests: 'speed',
  },
  arch_boss: {
    name: 'Boss',
    description:
      'A strong stronghold with steady waves and a signature unit every few waves.',
    tests: 'everything at once',
  },
};

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
    ARCHETYPE_TEXT[id] ?? {
      name: titleCase(id),
      description: 'A generated enemy stronghold.',
      tests: 'your factory',
    }
  );
}

/** Display name and one-line flavour of an event type. */
export const EVENT_TEXT: Readonly<
  Record<string, { readonly name: string; readonly flavour: string }>
> = {
  workshop: {
    name: 'Workshop',
    flavour: 'The party chooses which building.',
  },
  shrine: {
    name: 'Shrine',
    flavour: 'It lasts until the run ends.',
  },
  windfall: {
    name: 'Windfall',
    flavour: 'No choice to make.',
  },
};

export function eventText(type: string): {
  readonly name: string;
  readonly flavour: string;
} {
  return EVENT_TEXT[type] ?? { name: titleCase(type), flavour: '' };
}

/** Display names of run modifiers, by id. */
export const MODIFIER_NAMES: Readonly<Record<string, string>> = {
  mod_stout_walls: 'Stout walls',
  mod_sharp_turrets: 'Sharp turrets',
  mod_fortified_core: 'Fortified Core',
  mod_drilled_troops: 'Drilled troops',
  mod_reinforced_frames: 'Reinforced frames',
};

export function modifierName(id: string): string {
  return MODIFIER_NAMES[id] ?? titleCase(id);
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
