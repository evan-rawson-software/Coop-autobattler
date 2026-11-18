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
import type { ModifierEffect, SpecialistEffect } from '@game/core';
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
  turret: `${content.presentation.get('bld_turret')?.name ?? 'Turret'}s`,
  source: 'Source buildings',
  route: 'Route buildings',
  unit_producer: 'Unit-producing buildings',
  economy: 'Economy buildings',
};

/** "archer", "soldier and raider": the units' display names, lower-cased. */
function unitNames(ids: readonly string[]): string {
  const names = ids.map((id) =>
    (content.presentation.get(id)?.name ?? titleCase(id)).toLowerCase(),
  );
  return names.length <= 2
    ? names.join(' and ')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

/** "+25%" or "−15%" (a real minus sign): a drawback reads as negative. */
export function signedPercent(percent: number): string {
  return `${percent < 0 ? '−' : '+'}${String(Math.abs(percent))}%`;
}

/** What one effect does, from its data. */
export function effectLine(effect: ModifierEffect): string {
  if (effect.kind === 'shop_income_flat') {
    return `Every player: +${String(effect.amount)} gold per shop`;
  }
  if (effect.kind === 'unit_armor_flat') {
    const plus = `+${String(effect.amount)}`;
    return effect.units === undefined
      ? `Your units: ${plus} armor`
      : `${plus} ${unitNames(effect.units)} armor`;
  }
  const pct = signedPercent(effect.percent);
  switch (effect.kind) {
    case 'building_health_percent':
      return `${TARGET_WORDS[effect.target] ?? effect.target}: ${pct} health`;
    case 'core_health_percent':
      return `Your Core: ${pct} health`;
    case 'unit_strength_percent':
      return effect.units === undefined
        ? `Your units: ${pct} strength`
        : `${pct} ${unitNames(effect.units)} strength`;
    case 'unit_move_speed_percent':
      return effect.units === undefined
        ? `Your units: ${pct} move speed`
        : `${pct} ${unitNames(effect.units)} move speed`;
    case 'unit_attack_speed_percent':
      return effect.units === undefined
        ? `Your units: ${pct} attack speed`
        : `${pct} ${unitNames(effect.units)} attack speed`;
    case 'unit_splash_percent':
      return effect.units === undefined
        ? `Your units: ${pct} splash`
        : `${pct} ${unitNames(effect.units)} splash`;
    case 'poi_capture_speed_percent':
      return `Your units: ${pct} point capture speed`;
    case 'turret_damage_percent':
      return `${TARGET_WORDS['turret'] ?? ''}: ${pct} damage`;
    case 'sell_refund_percent':
      return `Every player: ${pct} sell refund`;
  }
}

/** What one effect of a specialist's family bonus does (CB-51a). */
export function specialistEffectLine(effect: SpecialistEffect): string {
  const pct = signedPercent(effect.percent);
  switch (effect.kind) {
    case 'building_health_percent':
      return `${TARGET_WORDS[effect.target] ?? effect.target}: ${pct} health`;
    case 'unit_health_percent':
      return `Units from your producers: ${pct} health`;
    case 'source_speed_percent':
      return `Your collectors: ${pct} speed`;
    case 'production_speed_percent':
      return `Your refineries and ramp buildings: ${pct} speed`;
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
