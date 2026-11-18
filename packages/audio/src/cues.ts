/**
 * The cue table, mix numbers and battle map (`content/audio.json`, AU-41)
 * and their checks. Pure: no Node API, so `@game/tools` can validate the
 * content with `loadAudio` and the web engine can read it.
 */

export const CUE_ID = /^[a-z]+\.[a-z0-9_]+$/;
export const GROUPS = ['effects', 'music'] as const;
export type CueGroup = (typeof GROUPS)[number];
export const THIN_CLASSES = ['attack', 'spawn', 'death'] as const;
export type ThinClass = (typeof THIN_CLASSES)[number];
export const TARGETS = ['unit', 'building', 'core'] as const;

export interface Duck {
  /** The music gain factor while ducked, 0 to 1. */
  gain: number;
  holdMs: number;
}

export interface Cue {
  group: CueGroup;
  priority: 1 | 2 | 3;
  minGapMs: number;
  maxVoices: number;
  /** The cue's own level, 0 to 100. */
  volume: number;
  /** The sound (or music track) ID; default: the cue ID with `.` as `_`. */
  sound?: string;
  /** Up to three sounds that play in turn. */
  variants?: string[];
  duck?: Duck;
  enabled?: boolean;
  thin?: ThinClass;
}

export interface BattleWhen {
  side?: 0 | 1;
  target?: (typeof TARGETS)[number];
  coreLow?: boolean;
  levelAtLeast?: number;
}

export interface BattleRow {
  event: string;
  when: BattleWhen;
  cue: string;
}

export interface Mix {
  effectVoices: number;
  duckAttackMs: number;
  duckReleaseMs: number;
  crossfadeMs: number;
  stingerFadeMs: number;
  lowCorePercent: number;
  thinWindowMs: Record<ThinClass, number>;
  speedFactor: Record<string, number>;
  seekJumpTicks: number;
}

export interface Volumes {
  master: number;
  music: number;
  effects: number;
}

export interface AudioConfig {
  version: number;
  groups: Volumes;
  mix: Mix;
  cues: Record<string, Cue>;
  battleMap: BattleRow[];
}

/** What the validator knows from other files; each check runs when given. */
export interface AudioContext {
  /** Sound IDs of `content/sounds.json`. */
  soundIds?: ReadonlySet<string>;
  /** Track IDs of `content/music.json` (#451). */
  trackIds?: ReadonlySet<string>;
  /** Event types of `schemas/sim-event.schema.json`. */
  eventTypes?: ReadonlySet<string>;
}

/** The sound a cue plays by default: the cue ID with `.` as `_`. */
export function cueSoundId(id: string, cue: Cue): string {
  return cue.sound ?? id.replace('.', '_');
}

/** Every sound a cue can play. */
export function cueSounds(id: string, cue: Cue): string[] {
  return cue.variants !== undefined && cue.variants.length > 0
    ? cue.variants
    : [cueSoundId(id, cue)];
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function int(v: unknown, min: number, max: number): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

function onlyKeys(
  errs: string[],
  at: string,
  o: Record<string, unknown>,
  known: readonly string[],
): void {
  for (const k of Object.keys(o))
    if (!known.includes(k)) errs.push(`${at}: unknown field "${k}"`);
}

function checkMix(errs: string[], m: unknown): void {
  if (!isObj(m)) {
    errs.push('mix must be an object');
    return;
  }
  const ints: [string, number, number][] = [
    ['effectVoices', 1, 64],
    ['duckAttackMs', 0, 5000],
    ['duckReleaseMs', 0, 5000],
    ['crossfadeMs', 0, 10000],
    ['stingerFadeMs', 0, 10000],
    ['lowCorePercent', 0, 100],
    ['seekJumpTicks', 1, 1000],
  ];
  for (const [k, lo, hi] of ints)
    if (!int(m[k], lo, hi))
      errs.push(
        `mix.${k} must be an integer from ${String(lo)} to ${String(hi)}`,
      );
  const win = m.thinWindowMs;
  if (!isObj(win)) errs.push('mix.thinWindowMs must be an object');
  else
    for (const c of THIN_CLASSES)
      if (!int(win[c], 0, 5000))
        errs.push(`mix.thinWindowMs.${c} must be an integer from 0 to 5000`);
  const sf = m.speedFactor;
  if (!isObj(sf)) errs.push('mix.speedFactor must be an object');
  else
    for (const s of ['1', '2', '4'])
      if (typeof sf[s] !== 'number' || sf[s] < 1 || sf[s] > 10)
        errs.push(`mix.speedFactor["${s}"] must be a number from 1 to 10`);
  onlyKeys(errs, 'mix', m, [
    ...ints.map((i) => i[0]),
    'thinWindowMs',
    'speedFactor',
  ]);
}

function checkCue(
  errs: string[],
  id: string,
  c: unknown,
  ctx: AudioContext,
): void {
  const at = `cue "${id}"`;
  if (!CUE_ID.test(id)) errs.push(`${at}: the ID must look like "shop.buy"`);
  if (!isObj(c)) {
    errs.push(`${at}: must be an object`);
    return;
  }
  onlyKeys(errs, at, c, [
    'group',
    'priority',
    'minGapMs',
    'maxVoices',
    'volume',
    'sound',
    'variants',
    'duck',
    'enabled',
    'thin',
  ]);
  if (!(GROUPS as readonly unknown[]).includes(c.group))
    errs.push(`${at}: group must be effects or music`);
  if (!int(c.priority, 1, 3)) errs.push(`${at}: priority must be 1, 2 or 3`);
  if (!int(c.minGapMs, 0, 60000))
    errs.push(`${at}: minGapMs must be 0 to 60000`);
  if (!int(c.maxVoices, 1, 16)) errs.push(`${at}: maxVoices must be 1 to 16`);
  if (!int(c.volume, 0, 100)) errs.push(`${at}: volume must be 0 to 100`);
  if (c.enabled !== undefined && typeof c.enabled !== 'boolean')
    errs.push(`${at}: enabled must be true or false`);
  if (
    c.thin !== undefined &&
    !(THIN_CLASSES as readonly unknown[]).includes(c.thin)
  )
    errs.push(`${at}: thin must be attack, spawn or death`);
  if (c.duck !== undefined) {
    const d = c.duck;
    if (
      !isObj(d) ||
      typeof d.gain !== 'number' ||
      d.gain < 0 ||
      d.gain > 1 ||
      !int(d.holdMs, 0, 60000)
    )
      errs.push(`${at}: duck needs gain 0 to 1 and holdMs`);
  }
  if (c.sound !== undefined && typeof c.sound !== 'string')
    errs.push(`${at}: sound must be a string`);
  if (c.variants !== undefined) {
    const v = c.variants;
    if (
      !Array.isArray(v) ||
      v.length === 0 ||
      v.length > 3 ||
      v.some((x) => typeof x !== 'string')
    )
      errs.push(`${at}: variants must list one to three sound IDs`);
  }
  // Music cues name tracks of music.json (#451).
  if (
    ctx.trackIds !== undefined &&
    c.group === 'music' &&
    c.enabled !== false &&
    errs.length === 0
  ) {
    for (const s of cueSounds(id, c as unknown as Cue))
      if (!ctx.trackIds.has(s))
        errs.push(`${at}: track "${s}" is not in music.json`);
  }
  if (
    ctx.soundIds !== undefined &&
    c.group === 'effects' &&
    c.enabled !== false &&
    errs.length === 0
  ) {
    for (const s of cueSounds(id, c as unknown as Cue))
      if (!ctx.soundIds.has(s))
        errs.push(`${at}: sound "${s}" is not in sounds.json`);
  }
}

function checkRow(
  errs: string[],
  i: number,
  r: unknown,
  cues: Record<string, unknown>,
  ctx: AudioContext,
): void {
  const at = `battleMap[${String(i)}]`;
  if (!isObj(r)) {
    errs.push(`${at}: must be an object`);
    return;
  }
  onlyKeys(errs, at, r, ['event', 'when', 'cue']);
  if (typeof r.event !== 'string') errs.push(`${at}: event must be a string`);
  else if (ctx.eventTypes !== undefined && !ctx.eventTypes.has(r.event))
    errs.push(`${at}: "${r.event}" is not a sim event type`);
  if (typeof r.cue !== 'string' || !(r.cue in cues))
    errs.push(`${at}: cue "${String(r.cue)}" does not exist`);
  const w = r.when;
  if (!isObj(w)) {
    errs.push(`${at}: when must be an object`);
    return;
  }
  onlyKeys(errs, `${at}.when`, w, [
    'side',
    'target',
    'coreLow',
    'levelAtLeast',
  ]);
  if (w.side !== undefined && w.side !== 0 && w.side !== 1)
    errs.push(`${at}.when.side must be 0 or 1`);
  if (
    w.target !== undefined &&
    !(TARGETS as readonly unknown[]).includes(w.target)
  )
    errs.push(`${at}.when.target must be unit, building or core`);
  if (w.coreLow !== undefined && typeof w.coreLow !== 'boolean')
    errs.push(`${at}.when.coreLow must be true or false`);
  if (w.levelAtLeast !== undefined && !int(w.levelAtLeast, 1, 100))
    errs.push(`${at}.when.levelAtLeast must be an integer from 1 to 100`);
}

export type LoadAudioResult =
  { ok: true; config: AudioConfig } | { ok: false; errors: string[] };

export function loadAudio(
  data: unknown,
  ctx: AudioContext = {},
): LoadAudioResult {
  if (!isObj(data)) return { ok: false, errors: ['must be an object'] };
  const errors: string[] = [];
  if (data.version !== 1) errors.push('version must be 1');
  const g = data.groups;
  if (!isObj(g)) errors.push('groups must be an object');
  else
    for (const k of ['master', 'music', 'effects'])
      if (!int(g[k], 0, 100)) errors.push(`groups.${k} must be 0 to 100`);
  checkMix(errors, data.mix);
  const cues = data.cues;
  if (!isObj(cues) || Object.keys(cues).length === 0)
    errors.push('cues must be a non-empty object');
  else for (const [id, c] of Object.entries(cues)) checkCue(errors, id, c, ctx);
  if (!Array.isArray(data.battleMap)) errors.push('battleMap must be an array');
  else if (isObj(cues))
    data.battleMap.forEach((r: unknown, i: number) => {
      checkRow(errors, i, r, cues, ctx);
    });
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, config: data as unknown as AudioConfig };
}
