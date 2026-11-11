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

/**
 * The slack, in percent, added to the building-value bound (see
 * `ghostValueBound`): upgrades at a Workshop turn gold into slightly more
 * value than gold, and the bound assumes every best-case reward.
 */
export const GHOST_VALUE_MARGIN_PERCENT = 25;

/** Longest owner id, owner label and run id accepted. */
export const GHOST_MAX_ID_LENGTH = 128;
export const GHOST_MAX_LABEL_LENGTH = 40;

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
  /** Reserved (TA-22b): the run's seed. Not written yet. */
  readonly runSeed?: number;
  /** Reserved (TA-22b): the run's action log. Not written yet. */
  readonly actionLog?: readonly unknown[];
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
  /** `partySize * (goldPerPlayer + kitPerPlayer)`, before the margin. */
  readonly raw: number;
  /** `raw` plus `GHOST_VALUE_MARGIN_PERCENT`, rounded down: the limit. */
  readonly limit: number;
}

/**
 * The most building value (the sum of the shop prices of every building at
 * its tier, placed or stashed) a party can own at the start of the PvP battle
 * of `round`, with the margin. Per player:
 *
 *   startingGold
 *   + baseIncomePerShop * (2 * round - 1)          shops entered so far
 *   + pveWin.hard * round                          best PvE win in each round up to this one
 *   + pvpWin * (round - 1)                         PvP wins in the rounds before
 *   + maxEventGold * (2 * round - 1)               every event a Windfall
 *   + kit                                          price of the starting kit
 *
 * times the party size, times (100 + margin) / 100. Spending, selling at a
 * loss and consolation gold only lower the real figure. It is deliberately
 * generous: it rejects the impossible, not the strong.
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
    rewards.pveWin.hard * round +
    rewards.pvpWin * (round - 1) +
    maxEventGold(events) * shops;
  let kitPerPlayer = 0;
  for (const k of economy.startingKit) {
    kitPerPlayer += tierPrice(content, k.def, k.tier) * k.count;
  }
  const raw = partySize * (goldPerPlayer + kitPerPlayer);
  const limit = Math.floor((raw * (100 + GHOST_VALUE_MARGIN_PERCENT)) / 100);
  return { goldPerPlayer, kitPerPlayer, raw, limit };
}

// ---------------------------------------------------------------------------
// Validation

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
  'runSeed',
  'actionLog',
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
    if (!KEYS.has(k)) errors.push(`snapshot: unknown field "${k}".`);
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
  if (raw['runSeed'] !== undefined && !isU32(raw['runSeed'])) {
    errors.push('runSeed: must be a u32 integer when present.');
  }
  if (raw['actionLog'] !== undefined && !Array.isArray(raw['actionLog'])) {
    errors.push('actionLog: must be an array when present.');
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
 * the building value within `ghostValueBound`, and the modifiers known to
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
