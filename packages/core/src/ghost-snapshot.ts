/**
 * Ghost snapshots (W3-1, MM-1..MM-17): the format and every check a snapshot
 * must pass before it may be used as an opponent. Pure; no I/O.
 *
 * A snapshot is a party's whole team state taken at the start of a PvP
 * battle, plus enough context to match it (game version, party size, round)
 * and to judge it (the map seed, lives, PvP record). The pool is external,
 * mutable, untrusted data, so every candidate goes through
 * `validateGhostSnapshot` first. See docs/rules-reference.md, "Ghosts".
 */

import { canonicalJson, sortedKeys } from './hash.js';
import type { Content } from './content.js';
import type { EconomyConfig } from './economy.js';
import { findModifier, type EventsConfig } from './events.js';
import { generateMap } from './generate-map.js';
import { isRecord } from './load-util.js';
import type { MapgenConfig } from './mapgen.js';
import { tierPrice } from './shop.js';
import { validateTeamState, type TeamState } from './team-state.js';

/** The snapshot format. Bump when a field changes meaning. */
export const GHOST_SNAPSHOT_FORMAT_VERSION = 1;

/** Longest owner id, owner label and run id accepted. */
export const GHOST_MAX_ID_LENGTH = 128;
export const GHOST_MAX_LABEL_LENGTH = 40;

/**
 * Hardening limits for untrusted snapshots (the pool is external data).
 *
 * A snapshot's size is the length of its canonical JSON text. Real ones were
 * measured with a buying bot at 13 rounds: about 1.7 KB at round 1 and 2.8 KB
 * at round 13 for a party of one, 6.4 KB and 9.7 KB for a party of four (the
 * map is most of it; every building adds about 30 to 70 bytes). The limit is
 * `GHOST_MAX_BYTES_BASE + GHOST_MAX_BYTES_PER_PLAYER * partySize`, which is
 * about 5 to 6 times the measured figure at every party size, so a long run
 * with many placed buildings fits and a payload that is mostly padding does
 * not.
 */
export const GHOST_MAX_BYTES_BASE = 4096;
export const GHOST_MAX_BYTES_PER_PLAYER = 12288;
/** Deepest nesting of a snapshot (the real one is under 8 levels). */
export const GHOST_MAX_DEPTH = 16;
/** Longest string anywhere in a snapshot (ids, labels, terrain and building names). */
export const GHOST_MAX_STRING_LENGTH = 128;

/** The largest accepted serialized size of a snapshot of a party of `partySize`. */
export function ghostMaxSerializedSize(partySize: number): number {
  return GHOST_MAX_BYTES_BASE + GHOST_MAX_BYTES_PER_PLAYER * partySize;
}

export interface GhostOwner {
  /** A stable identifier of the player (a device id, later a Steam id). */
  readonly id: string;
  /** What the opponent is called on screen. */
  readonly label: string;
}

export interface GhostPvpRecord {
  readonly wins: number;
  readonly losses: number;
}

export interface GhostSnapshot {
  readonly formatVersion: 1;
  /** The game version (`major.minor`) the run was played on. */
  readonly gameVersion: string;
  readonly partySize: number;
  /** The round whose PvP battle this was taken at the start of. */
  readonly round: number;
  /** The seed the team's map was generated from (`generateMap(mapSeed, partySize)`). */
  readonly mapSeed: number;
  readonly team: TeamState;
  readonly owner: GhostOwner;
  /** The run it was taken from. */
  readonly runId: string;
  /** Lives the run had when the snapshot was taken. */
  readonly lives: number;
  /** PvP battles won and lost in the rounds before this one. */
  readonly pvpRecord: GhostPvpRecord;
  // Reserved for TA-22b and NOT accepted yet: `runSeed` (the run's seed) and
  // `actionLog` (its action log). `snapshotOf` never writes them and
  // `validateGhostSnapshot` rejects a snapshot that has either, so an
  // unbounded value cannot ride along into a run's state and save.
}

/** Which snapshots can meet each other: same version, party size and round. */
export interface GhostBucket {
  readonly gameVersion: string;
  readonly partySize: number;
  readonly round: number;
}

/** `version|partySize|round`; stable text for a bucket. */
export function ghostBucketKey(b: GhostBucket): string {
  return `${b.gameVersion}|${String(b.partySize)}|${String(b.round)}`;
}

export function ghostBucketOf(s: GhostBucket): GhostBucket {
  return {
    gameVersion: s.gameVersion,
    partySize: s.partySize,
    round: s.round,
  };
}

/** Identity of one snapshot: owner and run (a run takes one per round). */
export function ghostKey(s: Pick<GhostSnapshot, 'owner' | 'runId'>): string {
  return JSON.stringify([s.owner.id, s.runId]);
}

/** Canonical order of candidates: by owner id, then run id (code units). */
export function compareGhosts(
  a: Pick<GhostSnapshot, 'owner' | 'runId'>,
  b: Pick<GhostSnapshot, 'owner' | 'runId'>,
): number {
  const x = a.owner.id;
  const y = b.owner.id;
  if (x !== y) return x < y ? -1 : 1;
  if (a.runId === b.runId) return 0;
  return a.runId < b.runId ? -1 : 1;
}

/** What validation needs to know. */
export interface GhostValidationContext {
  readonly content: Content;
  readonly mapgen: MapgenConfig;
  readonly economy: EconomyConfig;
  readonly events: EventsConfig;
  readonly rules: {
    readonly startingLives: number;
    readonly pvpLossLifeCost: number;
  };
}

export type GhostValidationResult =
  | { readonly ok: true; readonly snapshot: GhostSnapshot }
  | { readonly ok: false; readonly errors: readonly string[] };

// ---------------------------------------------------------------------------
// Value bound

/** Gold value of everything a team owns (placed and stashed), by tier price. */
export function teamBuildingValue(team: TeamState, content: Content): number {
  let total = 0;
  for (const b of team.buildings) total += tierPrice(content, b.def, b.tier);
  for (const b of team.stash) total += tierPrice(content, b.def, b.tier);
  return total;
}

/** The largest `gold` event parameter (a Windfall pays this), else 0. */
function maxEventGold(events: EventsConfig): number {
  let max = 0;
  for (const e of events.events) {
    const g = e.params['gold'];
    if (typeof g === 'number' && g > max) max = g;
  }
  return max;
}

export interface GhostValueBound {
  /** Gold one player can have received by the start of the PvP battle of the round. */
  readonly goldPerPlayer: number;
  /** Price of the starting kit, per player. */
  readonly kitPerPlayer: number;
  /** `partySize * (goldPerPlayer + kitPerPlayer)`: the limit. */
  readonly limit: number;
}

/**
 * The most building value (the sum of the shop prices of every building at
 * its tier, placed or stashed) a party can own at the start of the PvP battle
 * of `round`. Per player:
 *
 *   startingGold
 *   + baseIncomePerShop * (2 * round - 1)          shops entered so far
 *   + bestPveWin * round                           best PvE reward in each round up to this one
 *   + bestPvpGold * (round - 1)                    best PvP reward in the rounds before
 *   + maxEventGold * (2 * round - 1)               every event a Windfall
 *   + kit                                          price of the starting kit
 *
 * times the party size. There is no margin: every gold source is counted at
 * its best case, buying converts gold to value one to one, selling returns
 * less than was paid, and a Workshop upgrade adds less building value
 * (`price(t+1) - price(t)`) than it costs (`floor(price(t+1) * percent / 100)`)
 * for every building and tier of the shipped content (a test checks this).
 * It rejects the impossible, not the strong.
 */
export function ghostValueBound(
  round: number,
  partySize: number,
  content: Content,
  economy: EconomyConfig,
  events: EventsConfig,
): GhostValueBound {
  const shops = 2 * round - 1;
  const rewards = economy.rewards;
  const goldPerPlayer =
    economy.startingGold +
    economy.baseIncomePerShop * shops +
    Math.max(rewards.pveWin.easy, rewards.pveWin.medium, rewards.pveWin.hard) *
      round +
    Math.max(rewards.pvpWin, rewards.pvpLoss) * (round - 1) +
    maxEventGold(events) * shops;
  let kitPerPlayer = 0;
  for (const k of economy.startingKit) {
    kitPerPlayer += tierPrice(content, k.def, k.tier) * k.count;
  }
  return {
    goldPerPlayer,
    kitPerPlayer,
    limit: partySize * (goldPerPlayer + kitPerPlayer),
  };
}

// ---------------------------------------------------------------------------
// Tier bound

export interface GhostTierBound {
  /** The highest tier the shop could have offered by the PvP battle of the round. */
  readonly shopTier: number;
  /** Workshop raises one owner can have had by then (0 without a Workshop event). */
  readonly upgradesPerOwner: number;
}

/**
 * The tier rule, derived from `economy.tierOdds`, the starting kit and
 * `events.json`, with no round numbers written into the code:
 *
 *  - `shopTier`: the highest tier with a non-zero weight in any `tierOdds`
 *    row that applies in some round up to `round` (the shop of round `r`
 *    offers tiers by the row `tierOddsFor(r)`; shops of later rounds are not
 *    reached), at least the tier of every kit entry, at least 1.
 *  - `upgradesPerOwner`: `2 * round - 1` (the event steps before the PvP
 *    battle of `round`) if some configured event has type `workshop`, else 0.
 *    Each Workshop event raises at most one building per player by one tier.
 *
 * A snapshot passes if, for every owner, the sum over that owner's buildings
 * (placed and stashed) of `max(0, tier - shopTier)` is at most
 * `upgradesPerOwner`: every tier above what the shop sold must have been
 * paid for by one Workshop raise of that owner.
 */
export function ghostTierBound(
  round: number,
  economy: EconomyConfig,
  events: EventsConfig,
): GhostTierBound {
  let shopTier = 1;
  for (const k of economy.startingKit) shopTier = Math.max(shopTier, k.tier);
  const first = economy.tierOdds[0];
  for (const row of economy.tierOdds) {
    if (row !== first && row.fromRound > round) continue;
    row.weights.forEach((w, i) => {
      if (w > 0) shopTier = Math.max(shopTier, i + 1);
    });
  }
  const workshop = events.events.some((e) => e.type === 'workshop');
  return { shopTier, upgradesPerOwner: workshop ? 2 * round - 1 : 0 };
}

// ---------------------------------------------------------------------------
// Validation

/** The two fields reserved for TA-22b: not accepted yet. */
const RESERVED = ['runSeed', 'actionLog'];

const KEYS = new Set([
  'formatVersion',
  'gameVersion',
  'partySize',
  'round',
  'mapSeed',
  'team',
  'owner',
  'runId',
  'lives',
  'pvpRecord',
]);

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v);
}

function isU32(v: unknown): v is number {
  return isInt(v) && v >= 0 && v < 2 ** 32;
}

// Printable text: no control characters, no leading/trailing space.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

function textProblem(v: unknown, max: number): string | null {
  if (typeof v !== 'string' || v === '') return 'must be a non-empty string';
  if (v.length > max) return `must be at most ${String(max)} characters`;
  if (CONTROL.test(v)) return 'must not contain control characters';
  if (v !== v.trim()) return 'must not start or end with a space';
  return null;
}

/**
 * The generic limits, checked on the raw value before anything else reads it:
 * plain JSON only (objects, arrays, strings, booleans, null, safe integers;
 * no `undefined`, floats, NaN, Infinity, class instances), nesting at most
 * `GHOST_MAX_DEPTH`, every string at most `GHOST_MAX_STRING_LENGTH`, and a
 * serialized length (counted as the canonical JSON text would be) at most
 * `maxSize`. Stops at the first violation, so a huge or deep value costs
 * little. Returns the problem, or null.
 */
function structureProblem(root: unknown, maxSize: number): string | null {
  let size = 0;
  const visit = (v: unknown, depth: number): string | null => {
    if (depth > GHOST_MAX_DEPTH) {
      return `nested deeper than ${String(GHOST_MAX_DEPTH)} levels`;
    }
    if (v === null) size += 4;
    else if (typeof v === 'boolean') size += v ? 4 : 5;
    else if (typeof v === 'number') {
      if (!Number.isSafeInteger(v)) return 'numbers must be safe integers';
      size += String(v).length;
    } else if (typeof v === 'string') {
      if (v.length > GHOST_MAX_STRING_LENGTH) {
        return `a string is longer than ${String(GHOST_MAX_STRING_LENGTH)} characters`;
      }
      size += v.length + 2;
    } else if (Array.isArray(v)) {
      size += 2;
      for (const item of v as unknown[]) {
        const p = visit(item, depth + 1);
        if (p !== null) return p;
        size += 1;
        if (size > maxSize) break;
      }
    } else if (isRecord(v)) {
      size += 2;
      for (const k of sortedKeys(v)) {
        if (k.length > GHOST_MAX_STRING_LENGTH) return 'a key is too long';
        size += k.length + 3;
        const p = visit(v[k], depth + 1);
        if (p !== null) return p;
        size += 1;
        if (size > maxSize) break;
      }
    } else {
      return 'only plain JSON values are allowed';
    }
    return size > maxSize
      ? `larger than the ${String(maxSize)} characters allowed`
      : null;
  };
  return visit(root, 0);
}

/**
 * Check shape, team state, map, and consistency of a snapshot, without the
 * economy bound. Never throws. Used by `validateRunState`, which has no
 * economy configuration; everything else uses `validateGhostSnapshot`.
 */
export function checkGhostSnapshotShape(
  raw: unknown,
  content: Content,
  mapgen: MapgenConfig,
  rules?: GhostValidationContext['rules'],
): GhostValidationResult {
  const errors: string[] = [];
  try {
    const s = shapeInner(raw, content, mapgen, rules, errors);
    if (errors.length === 0 && s !== undefined)
      return { ok: true, snapshot: s };
  } catch (e) {
    errors.push(
      `snapshot: could not be checked (${e instanceof Error ? e.message : 'unknown error'}).`,
    );
  }
  if (errors.length === 0) errors.push('snapshot: invalid.');
  return { ok: false, errors };
}

function shapeInner(
  raw: unknown,
  content: Content,
  mapgen: MapgenConfig,
  rules: GhostValidationContext['rules'] | undefined,
  errors: string[],
): GhostSnapshot | undefined {
  if (!isRecord(raw)) {
    errors.push('snapshot: must be an object.');
    return undefined;
  }
  for (const k of sortedKeys(raw)) {
    if (RESERVED.includes(k)) {
      errors.push(`snapshot: "${k}" is reserved and not accepted yet.`);
    } else if (!KEYS.has(k)) {
      errors.push(`snapshot: unknown field "${k}".`);
    }
  }
  // Before anything reads into the value: its size, depth and numbers.
  const declared = raw['partySize'];
  const sizeProblem = structureProblem(
    raw,
    ghostMaxSerializedSize(
      isInt(declared) && declared >= 1 && declared <= mapgen.maxPartySize
        ? declared
        : mapgen.maxPartySize,
    ),
  );
  if (sizeProblem !== null) {
    errors.push(`snapshot: ${sizeProblem}.`);
    return undefined;
  }
  if (raw['formatVersion'] !== GHOST_SNAPSHOT_FORMAT_VERSION) {
    errors.push(
      `formatVersion: unsupported (this game reads ${String(GHOST_SNAPSHOT_FORMAT_VERSION)}).`,
    );
    return undefined;
  }
  const version = raw['gameVersion'];
  if (
    typeof version !== 'string' ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)
  ) {
    errors.push('gameVersion: must look like "major.minor".');
  }
  const partySize = raw['partySize'];
  if (!isInt(partySize) || partySize < 1 || partySize > mapgen.maxPartySize) {
    errors.push(
      `partySize: must be an integer from 1 to ${String(mapgen.maxPartySize)}.`,
    );
  }
  const round = raw['round'];
  if (!isInt(round) || round < 1)
    errors.push('round: must be an integer >= 1.');
  const mapSeed = raw['mapSeed'];
  if (!isU32(mapSeed)) errors.push('mapSeed: must be a u32 integer.');
  const runId = raw['runId'];
  const runIdProblem = textProblem(runId, GHOST_MAX_ID_LENGTH);
  if (runIdProblem !== null) errors.push(`runId: ${runIdProblem}.`);

  const owner = raw['owner'];
  if (!isRecord(owner)) {
    errors.push('owner: must be { id, label }.');
  } else {
    for (const k of sortedKeys(owner)) {
      if (k !== 'id' && k !== 'label')
        errors.push(`owner: unknown field "${k}".`);
    }
    const idProblem = textProblem(owner['id'], GHOST_MAX_ID_LENGTH);
    if (idProblem !== null) errors.push(`owner.id: ${idProblem}.`);
    const labelProblem = textProblem(owner['label'], GHOST_MAX_LABEL_LENGTH);
    if (labelProblem !== null) errors.push(`owner.label: ${labelProblem}.`);
  }

  const lives = raw['lives'];
  if (!isInt(lives) || lives < 1)
    errors.push('lives: must be an integer >= 1.');
  const record = raw['pvpRecord'];
  let wins = -1;
  let losses = -1;
  if (
    !isRecord(record) ||
    !isInt(record['wins']) ||
    !isInt(record['losses']) ||
    record['wins'] < 0 ||
    record['losses'] < 0
  ) {
    errors.push('pvpRecord: must be { wins, losses } of integers >= 0.');
  } else {
    wins = record['wins'];
    losses = record['losses'];
    for (const k of sortedKeys(record)) {
      if (k !== 'wins' && k !== 'losses') {
        errors.push(`pvpRecord: unknown field "${k}".`);
      }
    }
  }

  if (errors.length > 0) return undefined;
  const size = partySize as number;
  const r = round as number;

  // Consistency of the numbers with the round.
  if (wins + losses !== r - 1) {
    errors.push(
      `pvpRecord: wins + losses must be ${String(r - 1)} (the PvP battles before round ${String(r)}).`,
    );
  }
  if (rules !== undefined) {
    if ((lives as number) > rules.startingLives) {
      errors.push(`lives: at most ${String(rules.startingLives)}.`);
    }
    if (
      losses * rules.pvpLossLifeCost !==
      rules.startingLives - (lives as number)
    ) {
      errors.push('lives: does not match the PvP losses in pvpRecord.');
    }
  }

  const team = validateTeamState(raw['team'], content, mapgen);
  if (!team.ok) {
    for (const e of team.errors) errors.push(`team: ${e}`);
    return undefined;
  }
  const t = team.state;
  if (t.core === null) errors.push('team: the Core must be placed.');
  if (t.map.partySize !== size) {
    errors.push('team: map party size does not match partySize.');
  }
  let expected;
  try {
    expected = generateMap(mapSeed as number, size, content, mapgen);
  } catch (e) {
    errors.push(
      `map: cannot be regenerated (${e instanceof Error ? e.message : 'unknown error'}).`,
    );
  }
  if (
    expected !== undefined &&
    canonicalJson(expected) !== canonicalJson(t.map)
  ) {
    errors.push('map: differs from the map generated from mapSeed.');
  }
  if (errors.length > 0) return undefined;
  return { ...(raw as object), team: t } as unknown as GhostSnapshot;
}

/**
 * Validate untrusted data as a ghost snapshot: the schema-level shape, the
 * whole team state (legal placement on its own map), the map equal to
 * `generateMap(mapSeed, partySize)`, the numbers consistent with the round,
 * the building value within `ghostValueBound`, the tiers within
 * `ghostTierBound`, and the modifiers known to
 * content and within what the events of the round allow. Never throws.
 */
export function validateGhostSnapshot(
  raw: unknown,
  ctx: GhostValidationContext,
): GhostValidationResult {
  const shape = checkGhostSnapshotShape(
    raw,
    ctx.content,
    ctx.mapgen,
    ctx.rules,
  );
  if (!shape.ok) return shape;
  const errors: string[] = [];
  try {
    plausibility(shape.snapshot, ctx, errors);
  } catch (e) {
    errors.push(
      `snapshot: could not be checked (${e instanceof Error ? e.message : 'unknown error'}).`,
    );
  }
  return errors.length === 0 ? shape : { ok: false, errors };
}

function plausibility(
  s: GhostSnapshot,
  ctx: GhostValidationContext,
  errors: string[],
): void {
  const value = teamBuildingValue(s.team, ctx.content);
  const bound = ghostValueBound(
    s.round,
    s.partySize,
    ctx.content,
    ctx.economy,
    ctx.events,
  );
  if (value > bound.limit) {
    errors.push(
      `team: building value ${String(value)} is more than the ${String(bound.limit)} possible by round ${String(s.round)}.`,
    );
  }
  const tiers = ghostTierBound(s.round, ctx.economy, ctx.events);
  const excess = new Map<number, number>();
  for (const b of [...s.team.buildings, ...s.team.stash]) {
    if (b.tier > tiers.shopTier) {
      excess.set(b.owner, (excess.get(b.owner) ?? 0) + b.tier - tiers.shopTier);
    }
  }
  for (const [owner, n] of [...excess].sort((a, b) => a[0] - b[0])) {
    if (n > tiers.upgradesPerOwner) {
      errors.push(
        `team: player ${String(owner)} has ${String(n)} tiers above the shop's tier ${String(tiers.shopTier)}, at most ${String(tiers.upgradesPerOwner)} possible by round ${String(s.round)} (Workshop raises).`,
      );
    }
  }
  const held = s.team.modifiers ?? [];
  const events = 2 * s.round - 1;
  if (held.length > events) {
    errors.push(
      `modifiers: ${String(held.length)} held, at most ${String(events)} possible by round ${String(s.round)}.`,
    );
  }
  const seen = new Set<string>();
  held.forEach((m, i) => {
    const def = findModifier(ctx.events, m.id);
    if (def === undefined) {
      errors.push(`modifiers[${String(i)}]: unknown modifier "${m.id}".`);
      return;
    }
    if (canonicalJson(def.effects) !== canonicalJson(m.effects)) {
      errors.push(`modifiers[${String(i)}]: effects differ from "${m.id}".`);
    }
    if (!def.stackable && seen.has(m.id)) {
      errors.push(`modifiers[${String(i)}]: "${m.id}" cannot be held twice.`);
    }
    seen.add(m.id);
  });
}
