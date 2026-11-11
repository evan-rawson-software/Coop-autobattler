/**
 * `validateRunState`: checks untrusted data (a loaded save, say) and either
 * returns it as a `RunState` or lists readable problems. It never throws.
 * The JSON Schema in schemas/run-state.schema.json covers the same shape;
 * this adds the checks a schema cannot express.
 */
import { validateTeamState } from '@game/core';
import {
  MAX_PLAYERS,
  RUN_STATE_FORMAT_VERSION,
  STEPS,
  TRANSIENT_STEPS,
  type RunDeps,
  type RunState,
  type Step,
} from './types.js';

export type ValidateRunStateResult =
  | { readonly ok: true; readonly state: RunState }
  | { readonly ok: false; readonly errors: readonly string[] };

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

function isU32(v: unknown): v is number {
  return isInt(v) && v >= 0 && v < 2 ** 32;
}

function isJson(v: unknown, depth = 0): boolean {
  if (depth > 64) return false;
  if (v === null || typeof v === 'string' || typeof v === 'boolean')
    return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every((x) => isJson(x, depth + 1));
  if (isRec(v)) return Object.values(v).every((x) => isJson(x, depth + 1));
  return false;
}

/** Shop data: null, or {offers: (offer | null)[], stream: 4 u32}. */
function validShop(v: unknown): boolean {
  if (v === null) return true;
  if (!isRec(v) || !Array.isArray(v['offers']) || !Array.isArray(v['stream'])) {
    return false;
  }
  const stream = v['stream'] as unknown[];
  if (stream.length !== 4 || !stream.every(isU32)) return false;
  return (v['offers'] as unknown[]).every(
    (o, slot) =>
      o === null ||
      (isRec(o) &&
        o['slot'] === slot &&
        typeof o['def'] === 'string' &&
        isInt(o['tier']) &&
        o['tier'] >= 1 &&
        o['tier'] <= 3 &&
        isInt(o['price']) &&
        o['price'] >= 0),
  );
}

const KEYS = [
  'runId',
  'runVersion',
  'formatVersion',
  'seed',
  'rng',
  'actionCounter',
  'players',
  'host',
  'round',
  'step',
  'leg',
  'lives',
  'team',
  'perPlayer',
  'votes',
  'upcomingPve',
  'pending',
  'history',
  'thisRound',
  'actionLog',
  'outcome',
];

const READY_STEPS: readonly Step[] = [
  'build',
  'shop',
  'pve_summary',
  'pvp_summary',
];

export function validateRunState(
  data: unknown,
  deps: Pick<RunDeps, 'content' | 'mapgenConfig' | 'rules'>,
): ValidateRunStateResult {
  const errors: string[] = [];
  try {
    check(data, deps, errors);
  } catch (e) {
    errors.push(
      `run state: could not be checked (${e instanceof Error ? e.message : 'unknown error'}).`,
    );
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, state: data as RunState };
}

function check(
  data: unknown,
  deps: Pick<RunDeps, 'content' | 'mapgenConfig' | 'rules'>,
  errors: string[],
): void {
  if (!isRec(data)) {
    errors.push('run state: must be an object.');
    return;
  }
  const err = (m: string): void => {
    errors.push(m);
  };
  // First, so that a state from an older format is rejected for that reason
  // and not for a field the newer format added.
  if (
    'formatVersion' in data &&
    data['formatVersion'] !== RUN_STATE_FORMAT_VERSION
  ) {
    err(
      `formatVersion: unsupported format version ${JSON.stringify(data['formatVersion'])} (this game reads version ${String(RUN_STATE_FORMAT_VERSION)}).`,
    );
    return;
  }
  for (const k of Object.keys(data)) {
    if (!KEYS.includes(k)) err(`run state: unknown field "${k}".`);
  }
  for (const k of KEYS) {
    if (!(k in data)) err(`run state: missing field "${k}".`);
  }
  if (errors.length > 0) return;

  if (typeof data['runId'] !== 'string' || data['runId'] === '') {
    err('runId: must be a non-empty string.');
  }
  if (
    typeof data['runVersion'] !== 'string' ||
    !/^\d+\.\d+$/.test(data['runVersion'])
  ) {
    err('runVersion: must look like "major.minor".');
  }
  if (!isU32(data['seed'])) err('seed: must be a u32 integer.');
  const rng = data['rng'];
  if (!Array.isArray(rng) || rng.length !== 4 || !rng.every(isU32)) {
    err('rng: must be four u32 integers.');
  } else if (rng.every((w) => w === 0)) {
    err('rng: must not be all zero.');
  }

  // Players
  const players = data['players'];
  let n = 0;
  if (
    !Array.isArray(players) ||
    players.length < 1 ||
    players.length > MAX_PLAYERS
  ) {
    err('players: must be an array of 1 to 4 players.');
  } else {
    n = players.length;
    players.forEach((p, i) => {
      if (!isRec(p) || p['index'] !== i || typeof p['name'] !== 'string') {
        err(
          `players[${String(i)}]: must be {index: ${String(i)}, name: string}.`,
        );
      }
    });
  }
  if (!isInt(data['host']) || data['host'] < 0 || data['host'] >= n) {
    err('host: must be a player index.');
  }

  // Step and counters
  const step = data['step'];
  if (
    typeof step !== 'string' ||
    !(STEPS as readonly string[]).includes(step)
  ) {
    err('step: not a known step.');
    return;
  }
  const st = step as Step;
  if (TRANSIENT_STEPS.includes(st)) {
    err(`step: "${st}" is transient and cannot be saved.`);
  }
  if (!isInt(data['round']) || data['round'] < 1) {
    err('round: must be an integer of at least 1.');
  }
  const leg = data['leg'];
  if (leg !== 'pve' && leg !== 'pvp') err('leg: must be "pve" or "pvp".');
  const lives = data['lives'];
  if (!isInt(lives) || lives < 0 || lives > deps.rules.startingLives) {
    err(
      `lives: must be an integer from 0 to ${String(deps.rules.startingLives)}.`,
    );
  }
  if (st === 'run_over') {
    // lives may be above 0 after an abandon
  } else if (lives === 0) {
    err('lives: 0 lives is only possible once the run is over.');
  }

  // Team
  const team = validateTeamState(data['team'], deps.content, deps.mapgenConfig);
  if (!team.ok) {
    for (const e of team.errors) err(`team: ${e}`);
  } else {
    if (team.state.map.partySize !== n) {
      err('team: map party size does not match the number of players.');
    }
    const coreRequired = st !== 'core_placement' && st !== 'run_over';
    if (coreRequired && team.state.core === null) {
      err(`team: the Core must be placed in step "${st}".`);
    }
    if (st === 'core_placement' && team.state.core !== null) {
      err('team: the Core is already placed in step "core_placement".');
    }
  }

  // Per player
  const perPlayer = data['perPlayer'];
  if (!Array.isArray(perPlayer) || perPlayer.length !== n) {
    err('perPlayer: must have one entry per player.');
  } else {
    perPlayer.forEach((p, i) => {
      if (
        !isRec(p) ||
        !isInt(p['gold']) ||
        p['gold'] < 0 ||
        typeof p['ready'] !== 'boolean' ||
        !('shop' in p) ||
        !isJson(p['shop'])
      ) {
        err(
          `perPlayer[${String(i)}]: must be {gold: integer >= 0, ready: boolean, shop: JSON}.`,
        );
      } else if (!validShop(p['shop'])) {
        err(
          `perPlayer[${String(i)}].shop: must be null or {offers, stream} with offers {slot, def, tier, price} or null.`,
        );
      } else if (p['ready'] && !READY_STEPS.includes(st)) {
        err(`perPlayer[${String(i)}]: ready is not possible in step "${st}".`);
      }
    });
  }

  // Votes and pending
  const expectedTopic: Partial<Record<Step, string>> = {
    core_placement: 'core',
    pve_choice: 'pve',
    event_choice: 'event',
  };
  const votes = data['votes'];
  const topic = expectedTopic[st];
  if (topic === undefined) {
    if (votes !== null) err(`votes: must be null in step "${st}".`);
  } else if (
    !isRec(votes) ||
    votes['topic'] !== topic ||
    !Array.isArray(votes['choices']) ||
    votes['choices'].length !== n
  ) {
    err(
      `votes: must be {topic: "${topic}", choices: one per player} in step "${st}".`,
    );
  } else {
    votes['choices'].forEach((c, i) => {
      if (c !== null && !isJson(c))
        err(`votes.choices[${String(i)}]: must be JSON or null.`);
      if (
        c !== null &&
        topic === 'core' &&
        (!isRec(c) || !isInt(c['x']) || !isInt(c['y']))
      ) {
        err(`votes.choices[${String(i)}]: a Core vote must be {x, y}.`);
      }
      if (c !== null && topic !== 'core' && typeof c !== 'string') {
        err(`votes.choices[${String(i)}]: must be an option id.`);
      }
    });
  }
  // The coming PvE options exist exactly from the moment they are drawn to
  // the moment `pve_choice` takes them: in the first `build` (round 1) and in
  // the shop that ends a round (the shop of the PvP leg).
  const upcoming = data['upcomingPve'];
  const upcomingRequired =
    (st === 'build' && leg === 'pve' && data['round'] === 1) ||
    (st === 'shop' && leg === 'pvp');
  if (upcoming !== null) {
    if (
      !isRec(upcoming) ||
      !isInt(upcoming['round']) ||
      upcoming['round'] < 1 ||
      !Array.isArray(upcoming['options']) ||
      !isJson(upcoming['options'])
    ) {
      err('upcomingPve: must be null or {round, options: JSON array}.');
    } else if (!upcomingRequired) {
      err(
        `upcomingPve: must be null in step "${st}" (leg "${leg as string}").`,
      );
    } else if (
      isInt(data['round']) &&
      upcoming['round'] !== (leg === 'pvp' ? data['round'] + 1 : data['round'])
    ) {
      err('upcomingPve: round does not match the coming PvE battle.');
    }
  } else if (upcomingRequired) {
    err(`upcomingPve: must be set in step "${st}" (leg "${leg as string}").`);
  }
  const pending = data['pending'];
  if (!isJson(pending)) err('pending: must be JSON.');
  const p = isRec(pending) ? pending : {};
  if (st === 'core_placement' && !Array.isArray(p['proposals'])) {
    err('pending.proposals: must be an array in step "core_placement".');
  }
  if (
    (st === 'pve_choice' || st === 'event_choice') &&
    !Array.isArray(p['options'])
  ) {
    err(`pending.options: must be an array in step "${st}".`);
  } else if (st === 'event_choice' && (p['options'] as unknown[]).length < 1) {
    err('pending.options: an event step needs at least one offer.');
  }
  if (st === 'event_resolve') {
    const fu = p['followUp'];
    if (
      !isRec(p['offer']) ||
      !isRec(fu) ||
      !Array.isArray(fu['options']) ||
      !Array.isArray(fu['votes']) ||
      fu['votes'].length !== n
    ) {
      err(
        'pending: must hold {offer, followUp: {options, votes}} in step "event_resolve".',
      );
    }
  }
  if (st === 'pve_summary' || st === 'pvp_summary') {
    const b = p['battle'];
    if (!isRec(b) || typeof b['won'] !== 'boolean' || !isRec(b['opponent'])) {
      err(`pending.battle: must hold the battle result in step "${st}".`);
    }
  }

  // Leg
  const pveSteps: Step[] = [
    'core_placement',
    'build',
    'pve_choice',
    'pve_summary',
  ];
  if (pveSteps.includes(st) && leg !== 'pve')
    err(`leg: must be "pve" in step "${st}".`);
  if (st === 'pvp_summary' && leg !== 'pvp')
    err('leg: must be "pvp" in step "pvp_summary".');

  // History and this round
  const history = data['history'];
  if (!Array.isArray(history)) {
    err('history: must be an array.');
  } else {
    let last = 0;
    history.forEach((h, i) => {
      if (
        !isRec(h) ||
        !isInt(h['round']) ||
        h['round'] <= last ||
        !validBattleRecord(h['pve'], true) ||
        !validBattleRecord(h['pvp'], false)
      ) {
        err(`history[${String(i)}]: not a valid round record.`);
      } else {
        last = h['round'];
      }
    });
  }
  const tr = data['thisRound'];
  if (
    !isRec(tr) ||
    !validBattleRecord(tr['pve'], true) ||
    !validBattleRecord(tr['pvp'], false)
  ) {
    err('thisRound: must be {pve, pvp}, each a record or null.');
  }

  // Action log
  const log = data['actionLog'];
  if (!Array.isArray(log)) {
    err('actionLog: must be an array.');
  } else {
    log.forEach((a, i) => {
      if (
        !isRec(a) ||
        a['n'] !== i + 1 ||
        !isInt(a['player']) ||
        a['player'] < 0 ||
        a['player'] >= n ||
        !isRec(a['intent']) ||
        typeof a['intent']['type'] !== 'string' ||
        !isJson(a['intent'])
      ) {
        err(
          `actionLog[${String(i)}]: must be {n: ${String(i + 1)}, player, intent: {type, ...}}.`,
        );
      }
    });
    if (data['actionCounter'] !== log.length) {
      err('actionCounter: must equal the length of actionLog.');
    }
  }

  // Outcome
  const outcome = data['outcome'];
  if (st === 'run_over') {
    if (
      !isRec(outcome) ||
      (outcome['reason'] !== 'defeated' && outcome['reason'] !== 'abandoned') ||
      !isInt(outcome['round'])
    ) {
      err('outcome: must be {reason, round} when the run is over.');
    } else if (outcome['reason'] === 'defeated' && lives !== 0) {
      err('outcome: a defeated run must have 0 lives.');
    }
  } else if (outcome !== null) {
    err('outcome: must be null while the run is going.');
  }
}

function validBattleRecord(v: unknown, pve: boolean): boolean {
  if (v === null) return true;
  if (!isRec(v) || typeof v['won'] !== 'boolean') return false;
  if (pve && typeof v['difficulty'] !== 'string') return false;
  const o = v['opponent'];
  return (
    isRec(o) &&
    (o['kind'] === 'pve' || o['kind'] === 'ghost' || o['kind'] === 'boss') &&
    typeof o['label'] === 'string'
  );
}
