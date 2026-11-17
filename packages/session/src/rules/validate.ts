/**
 * `validateRunState`: checks untrusted data (a loaded save, say) and either
 * returns it as a `RunState` or lists readable problems. It never throws.
 * The JSON Schema in schemas/run-state.schema.json covers the same shape;
 * this adds the checks a schema cannot express.
 */
import {
  addableNodeCells,
  checkGhostSnapshotShape,
  ghostKey,
  placeCore,
  validateTeamState,
  sortedKeys,
  type Content,
} from '@game/core';
import { ghostContext, BOSS_LABEL } from './ghosts.js';
import {
  MAX_PLAYERS,
  RUN_STATE_FORMAT_VERSION,
  STEPS,
  TRANSIENT_STEPS,
  type RunDeps,
  type RunState,
  type Step,
} from './types.js';
import {
  DEFAULT_WORKSHOP_PERCENT,
  workshopOptionProblem,
} from './workshop-option.js';
import {
  BLUEPRINT_PROMPT,
  DRILL_PROMPT,
  RICH_VEIN_PROMPT,
  blueprintChoice,
  richVeinCell,
} from './events.js';
import { isInteger, isRecord } from './json-guards.js';
import { nextShopProblem } from './shop-effects.js';
import {
  CARAVAN_PROMPT,
  isDraft,
  parseCaravanChoice,
  readDraft,
} from './caravan.js';

export type ValidateRunStateResult =
  | { readonly ok: true; readonly state: RunState }
  | { readonly ok: false; readonly errors: readonly string[] };

type Rec = Record<string, unknown>;

function isU32(v: unknown): v is number {
  return isInteger(v) && v >= 0 && v < 2 ** 32;
}

function isJson(v: unknown, depth = 0): boolean {
  if (depth > 64) return false;
  if (v === null || typeof v === 'string' || typeof v === 'boolean')
    return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every((x) => isJson(x, depth + 1));
  if (isRecord(v)) return sortedKeys(v).every((k) => isJson(v[k], depth + 1));
  return false;
}

/** Shop data: null, or {offers: (offer | null)[], stream: 4 u32}. */
function validShop(v: unknown): boolean {
  if (v === null) return true;
  if (
    !isRecord(v) ||
    !Array.isArray(v['offers']) ||
    !Array.isArray(v['stream'])
  ) {
    return false;
  }
  const stream = v['stream'] as unknown[];
  if (stream.length !== 4 || !stream.every(isU32)) return false;
  return (v['offers'] as unknown[]).every(
    (o, slot) =>
      o === null ||
      (isRecord(o) &&
        o['slot'] === slot &&
        typeof o['def'] === 'string' &&
        isInteger(o['tier']) &&
        o['tier'] >= 1 &&
        o['tier'] <= 3 &&
        isInteger(o['price']) &&
        o['price'] >= 0),
  );
}

/** A building with a purchasable tier 1 that is not a boss-only pylon. */
function heldDefOk(content: Pick<Content, 'buildings'>, def: string): boolean {
  const b = content.buildings.get(def);
  const t = b?.tiers[0];
  return (
    b !== undefined &&
    t !== undefined &&
    'price' in t &&
    !(b.kind === 'defense' && b.defenseType === 'pylon')
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
  'pvpOpponent',
  'ghostsFought',
  'pending',
  'history',
  'thisRound',
  'actionLog',
  'outcome',
];

/** Fields that may be absent (records from before they existed stay readable). */
const OPTIONAL_KEYS = ['caravanCount', 'caravanFirst'];

/** The steps in which next-shop effects exist: set by an event, gone after the shop. */
const NEXT_SHOP_STEPS: readonly Step[] = ['event_resolve', 'shop'];

const READY_STEPS: readonly Step[] = [
  'specialist_pick',
  'core_placement',
  'build',
  'shop',
  'pve_summary',
  'pvp_summary',
];

export function validateRunState(
  data: unknown,
  deps: Pick<RunDeps, 'content' | 'mapgenConfig' | 'rules' | 'ghosts'>,
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

/** The structure of each option of a per-player raise follow-up (Workshop, Drill). */
function checkUpgradeOptions(
  opts: readonly unknown[],
  team: Parameters<typeof workshopOptionProblem>[0],
  n: number,
  only: ((def: string) => boolean) | undefined,
  err: (msg: string) => void,
): void {
  opts.forEach((o, i) => {
    const player = isRecord(o) ? o['player'] : undefined;
    const problem =
      isInteger(player) && player >= 0 && player < n
        ? workshopOptionProblem(team, player, o, only)
        : 'player: must be a player index';
    if (problem !== null) {
      err(`pending.followUp.options[${String(i)}]: ${problem}.`);
    }
  });
}

/** Whether a Rich vein vote `c<x>_<y>` names a cell stored for that player. */
function richVoteInOptions(
  vote: string,
  player: number,
  opts: readonly unknown[],
): boolean {
  const cell = richVeinCell(vote);
  if (cell === null) return false;
  return opts.some(
    (o) =>
      isRecord(o) &&
      o['player'] === player &&
      Array.isArray(o['cells']) &&
      (o['cells'] as unknown[]).some(
        (c) =>
          Array.isArray(c) &&
          c.length === 2 &&
          c[0] === cell.x &&
          c[1] === cell.y,
      ),
  );
}

/**
 * The structure of a Rich vein follow-up: the offer names a base resource,
 * and each option is one player's list of cells, every one a legal cell of
 * that player now (`addableNodeCells`), at most one option per player.
 */
function checkRichVeinOptions(
  opts: readonly unknown[],
  offer: unknown,
  team: Parameters<typeof workshopOptionProblem>[0],
  n: number,
  deps: Pick<RunDeps, 'content' | 'mapgenConfig'>,
  err: (msg: string) => void,
): void {
  const resource = isRecord(offer) ? offer['resource'] : undefined;
  if (
    typeof resource !== 'string' ||
    !deps.content.resources.listBase().some((r) => r.id === resource)
  ) {
    err('pending.offer.resource: must be a base resource.');
  }
  const seen = new Set<number>();
  opts.forEach((o, i) => {
    const at = `pending.followUp.options[${String(i)}]`;
    const player = isRecord(o) ? o['player'] : undefined;
    if (
      !isRecord(o) ||
      !isInteger(player) ||
      player < 0 ||
      player >= n ||
      o['id'] !== `cells${String(player)}` ||
      !Array.isArray(o['cells'])
    ) {
      err(
        `${at}: must be {id: "cells<player>", player, cells: [[x, y], ...]}.`,
      );
      return;
    }
    if (seen.has(player)) {
      err(`${at}: a second option for player ${String(player)}.`);
    }
    seen.add(player);
    const legal = new Set(
      addableNodeCells(team, deps.content, deps.mapgenConfig, player).map(
        (c) => `${String(c.x)},${String(c.y)}`,
      ),
    );
    const cells = o['cells'] as unknown[];
    if (cells.length === 0) err(`${at}: "cells" must not be empty.`);
    for (const c of cells) {
      if (
        !Array.isArray(c) ||
        c.length !== 2 ||
        !legal.has(`${String(c[0])},${String(c[1])}`)
      ) {
        err(`${at}: cell ${JSON.stringify(c)} is not a legal node cell.`);
        return;
      }
    }
  });
}

/**
 * A Caravan draft (RS-4h): the offer and the follow-up agree, `items` are
 * well formed (at most one party-wide), `order` is a rotation of the players,
 * the picks fill a prefix of `taken`, and each names a distinct item of the
 * list with a sub-choice that fits the taker's team.
 */
function checkDraft(
  p: Rec,
  team: Parameters<typeof workshopOptionProblem>[0] | null,
  n: number,
  deps: Pick<RunDeps, 'content' | 'mapgenConfig'>,
  err: (msg: string) => void,
): void {
  const offer = p['offer'];
  const fu = p['followUp'];
  const draft = readDraft(fu);
  if (
    !isRecord(offer) ||
    offer['type'] !== 'caravan' ||
    !isRecord(fu) ||
    fu['prompt'] !== CARAVAN_PROMPT ||
    draft === null
  ) {
    err(
      'pending: a draft needs a Caravan offer and {prompt: "caravan", mode: "draft", items, order, taken}.',
    );
    return;
  }
  const at = 'pending.followUp';
  if (
    sortedKeys(fu).some(
      (k) => !['prompt', 'mode', 'items', 'order', 'taken'].includes(k),
    )
  ) {
    err(`${at}: a draft has only prompt, mode, items, order and taken.`);
  }
  if (draft.items.length !== n + 1) {
    err(`${at}.items: must hold ${String(n + 1)} rewards.`);
  }
  let wide = 0;
  draft.items.forEach((it, i) => {
    const wideOk =
      it.kind === 'modifier'
        ? it.partyWide === true
        : it.partyWide === undefined;
    if (it.partyWide === true) wide++;
    const bad =
      !wideOk ||
      (it.kind === 'gold' && !(isInteger(it.gold) && it.gold >= 1)) ||
      (it.kind === 'building' &&
        !(typeof it.def === 'string' && heldDefOk(deps.content, it.def))) ||
      (it.kind === 'node' &&
        !(
          typeof it.resource === 'string' &&
          deps.content.resources.listBase().some((r) => r.id === it.resource)
        )) ||
      (it.kind === 'modifier' &&
        !(typeof it.modifier === 'string' && it.modifier.startsWith('mod_')));
    if (bad) err(`${at}.items[${String(i)}]: not a valid reward.`);
  });
  if (wide > 1) err(`${at}.items: at most one reward may be party-wide.`);
  if (
    draft.order.length !== n ||
    !draft.order.every(
      (q, i) => isInteger(q) && q === ((draft.order[0] ?? 0) + i) % n,
    ) ||
    (draft.order[0] ?? -1) < 0 ||
    (draft.order[0] ?? n) >= n
  ) {
    err(`${at}.order: must list every player, in turn, starting anywhere.`);
    return;
  }
  const seen = new Set<string>();
  let gap = false;
  const complete = !draft.taken.includes(null);
  draft.taken.forEach((t, i) => {
    const slot = `${at}.taken[${String(i)}]`;
    if (t === null) {
      gap = true;
      return;
    }
    if (gap) err(`${slot}: a pick after a player who has not chosen.`);
    if (t === 'skip') return;
    const c = parseCaravanChoice(t);
    const item =
      c === null ? undefined : draft.items.find((x) => x.id === c.item);
    if (c === null || item === undefined || seen.has(c.item)) {
      err(`${slot}: must be "skip" or a distinct reward of the list.`);
      return;
    }
    seen.add(c.item);
    const player = draft.order[i] as number;
    if (item.kind === 'upgrade') {
      const m = c.sub === null ? null : /^b([0-9]+)$/.exec(c.sub);
      const b =
        m === null || team === null
          ? undefined
          : (team.buildings.find((x) => x.id === Number(m[1])) ??
            team.stash.find((x) => x.id === Number(m[1])));
      if (
        m === null ||
        (team !== null &&
          (b === undefined || b.owner !== player || b.tier >= 3))
      ) {
        err(
          `${slot}: an Upgrade needs "b<id>" of a building of that player below tier 3.`,
        );
      }
    } else if (item.kind === 'node') {
      const cell = c.sub === null ? null : richVeinCell(c.sub);
      const legal =
        cell !== null &&
        team !== null &&
        addableNodeCells(team, deps.content, deps.mapgenConfig, player).some(
          (x) => x.x === cell.x && x.y === cell.y,
        );
      if (team !== null && !legal) {
        err(`${slot}: a Node needs "c<x>_<y>" of a legal cell of that player.`);
      }
    } else if (c.sub !== null) {
      err(`${slot}: this reward takes no sub-choice.`);
    }
  });
  if (complete) err(`${at}.taken: a draft that is complete must have ended.`);
}

function check(
  data: unknown,
  deps: Pick<RunDeps, 'content' | 'mapgenConfig' | 'rules' | 'ghosts'>,
  errors: string[],
): void {
  if (!isRecord(data)) {
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
  for (const k of sortedKeys(data)) {
    if (!KEYS.includes(k) && !OPTIONAL_KEYS.includes(k)) {
      err(`run state: unknown field "${k}".`);
    }
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
      if (!isRecord(p) || p['index'] !== i || typeof p['name'] !== 'string') {
        err(
          `players[${String(i)}]: must be {index: ${String(i)}, name: string}.`,
        );
      }
    });
  }
  if (!isInteger(data['host']) || data['host'] < 0 || data['host'] >= n) {
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
  if (!isInteger(data['round']) || data['round'] < 1) {
    err('round: must be an integer of at least 1.');
  }
  const leg = data['leg'];
  if (leg !== 'pve' && leg !== 'pvp') err('leg: must be "pve" or "pvp".');
  const lives = data['lives'];
  if (!isInteger(lives) || lives < 0 || lives > deps.rules.startingLives) {
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
    const coreRequired =
      st !== 'specialist_pick' && st !== 'core_placement' && st !== 'run_over';
    if (coreRequired && team.state.cores.some((c) => c === null)) {
      err(`team: every player's Core must be placed in step "${st}".`);
    }
    if (
      (st === 'core_placement' || st === 'specialist_pick') &&
      team.state.cores.some((c) => c !== null)
    ) {
      err(`team: the Core is already placed in step "${st}".`);
    }
    // Specialists (RS-13): optional, so a state from before them has none.
    // Past the pick step a state that has them has them all (Ready needs a
    // pick). A ready player has picked.
    const picks = team.state.specialists;
    if (st !== 'specialist_pick' && st !== 'run_over' && picks !== undefined) {
      if (picks.some((e) => e === null)) {
        err(`team: every player's specialist must be picked in step "${st}".`);
      }
    }
    if (st === 'specialist_pick' && Array.isArray(data['perPlayer'])) {
      (data['perPlayer'] as unknown[]).forEach((pp, i) => {
        if (isRecord(pp) && pp['ready'] === true && picks?.[i] == null) {
          err(
            `team.specialists[${String(i)}]: a ready player needs a specialist.`,
          );
        }
      });
    }
  }

  // Per player
  const perPlayer = data['perPlayer'];
  if (!Array.isArray(perPlayer) || perPlayer.length !== n) {
    err('perPlayer: must have one entry per player.');
  } else {
    perPlayer.forEach((p, i) => {
      if (
        !isRecord(p) ||
        !isInteger(p['gold']) ||
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
      } else if (
        'nextShop' in p &&
        (nextShopProblem(p['nextShop']) !== null ||
          !NEXT_SHOP_STEPS.includes(st))
      ) {
        err(
          `perPlayer[${String(i)}].nextShop: ${nextShopProblem(p['nextShop']) ?? `not possible in step "${st}"`}.`,
        );
      } else if (
        'nextShop' in p &&
        (p['nextShop'] as { kind?: unknown; def?: unknown }[]).some(
          (e) =>
            e.kind === 'held_offer' &&
            (typeof e.def !== 'string' || !heldDefOk(deps.content, e.def)),
        )
      ) {
        err(
          `perPlayer[${String(i)}].nextShop: the held_offer building must be one the shop can sell at tier 1.`,
        );
      } else if (p['ready'] && !READY_STEPS.includes(st)) {
        err(`perPlayer[${String(i)}]: ready is not possible in step "${st}".`);
      }
    });
  }

  // Votes and pending
  const expectedTopic: Partial<Record<Step, string>> = {
    pve_choice: 'pve',
    event_choice: 'event',
  };
  const votes = data['votes'];
  const topic = expectedTopic[st];
  if (topic === undefined) {
    if (votes !== null) err(`votes: must be null in step "${st}".`);
  } else if (
    !isRecord(votes) ||
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
      if (c !== null && typeof c !== 'string') {
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
      !isRecord(upcoming) ||
      !isInteger(upcoming['round']) ||
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
      isInteger(data['round']) &&
      upcoming['round'] !== (leg === 'pvp' ? data['round'] + 1 : data['round'])
    ) {
      err('upcomingPve: round does not match the coming PvE battle.');
    }
  } else if (upcomingRequired) {
    err(`upcomingPve: must be set in step "${st}" (leg "${leg as string}").`);
  }
  checkGhostFields(data, st, n, deps, err);
  const pending = data['pending'];
  if (!isJson(pending)) err('pending: must be JSON.');
  const p = isRecord(pending) ? pending : {};
  if (st === 'specialist_pick' && pending !== null) {
    err('pending: must be null in step "specialist_pick".');
  }
  if (st === 'core_placement') {
    const positions = p['positions'];
    if (!Array.isArray(positions) || positions.length !== n) {
      err(
        'pending.positions: must have one entry per player in "core_placement".',
      );
    } else if (team.ok) {
      const ready = data['perPlayer'];
      // Every position must be placeable (the legality of `placeCore`:
      // terrain, plot, buildings and conduits), or the step could not end.
      let board = team.state;
      positions.forEach((pos, i) => {
        if (!isRecord(pos) || !isInteger(pos['x']) || !isInteger(pos['y']))
          return;
        const r = placeCore(board, deps.content, deps.mapgenConfig, i, {
          x: pos['x'],
          y: pos['y'],
        });
        if (r.ok) board = r.state;
        else {
          err(
            `pending.positions[${String(i)}]: not a legal Core position (${r.reason}).`,
          );
        }
      });
      positions.forEach((pos, i) => {
        if (pos === null) {
          const row = Array.isArray(ready) ? (ready[i] as unknown) : null;
          if (isRecord(row) && row['ready'] === true) {
            err(
              `pending.positions[${String(i)}]: a ready player needs a position.`,
            );
          }
        } else if (
          !isRecord(pos) ||
          !isInteger(pos['x']) ||
          !isInteger(pos['y'])
        ) {
          err(`pending.positions[${String(i)}]: must be null or {x, y}.`);
        }
      });
    }
  }
  if (
    (st === 'pve_choice' || st === 'event_choice') &&
    !Array.isArray(p['options'])
  ) {
    err(`pending.options: must be an array in step "${st}".`);
  } else if (st === 'event_choice' && (p['options'] as unknown[]).length < 1) {
    err('pending.options: an event step needs at least one offer.');
  }
  if (st === 'event_resolve' && isDraft(p['followUp'])) {
    checkDraft(p, team.ok ? team.state : null, n, deps, err);
  } else if (st === 'event_resolve') {
    const fu = p['followUp'];
    if (
      !isRecord(p['offer']) ||
      !isRecord(fu) ||
      !Array.isArray(fu['options']) ||
      !Array.isArray(fu['votes']) ||
      fu['votes'].length !== n
    ) {
      err(
        'pending: must hold {offer, followUp: {options, votes}} in step "event_resolve".',
      );
    } else if (isRecord(fu)) {
      const opts = fu['options'] as unknown[];
      const ids = opts.map((o) => (isRecord(o) ? o['id'] : undefined));
      if (!ids.every((id) => typeof id === 'string')) {
        err('pending.followUp.options: every option needs a string id.');
      }
      const per = fu['perPlayer'] === true;
      if ('perPlayer' in fu && fu['perPlayer'] !== true) {
        err('pending.followUp.perPlayer: must be true when present.');
      }
      if (fu['prompt'] === 'workshop_building') {
        if (!per) {
          err('pending.followUp.perPlayer: a Workshop follow-up needs true.');
        }
        const offer = p['offer'];
        const pct = offer['workshopPricePercent'] ?? DEFAULT_WORKSHOP_PERCENT;
        if (!isInteger(pct) || pct < 1 || pct > 100) {
          err('pending.offer.workshopPricePercent: must be an integer 1-100.');
        } else if (team.ok) {
          checkUpgradeOptions(opts, team.state, n, undefined, err);
        }
      } else if (fu['prompt'] === DRILL_PROMPT) {
        if (!per) {
          err('pending.followUp.perPlayer: a Drill follow-up needs true.');
        } else if (team.ok) {
          checkUpgradeOptions(
            opts,
            team.state,
            n,
            (def) => deps.content.buildings.get(def)?.kind === 'source',
            err,
          );
        }
      }
      if (fu['prompt'] === RICH_VEIN_PROMPT) {
        if (!per) {
          err('pending.followUp.perPlayer: a Rich vein follow-up needs true.');
        } else if (team.ok) {
          checkRichVeinOptions(opts, p['offer'], team.state, n, deps, err);
        }
      }
      if (fu['prompt'] === BLUEPRINT_PROMPT) {
        if (!per) {
          err('pending.followUp.perPlayer: a Blueprint follow-up needs true.');
        } else {
          opts.forEach((o, i) => {
            if (
              !isRecord(o) ||
              !isInteger(o['player']) ||
              o['player'] < 0 ||
              o['player'] >= n ||
              typeof o['def'] !== 'string' ||
              deps.content.buildings.get(o['def']) === undefined ||
              o['id'] !== blueprintChoice(o['player'], o['def'])
            ) {
              err(
                `pending.followUp.options[${String(i)}]: must be {id: "p<player>:<building>", player, def: a building}.`,
              );
            }
          });
        }
      }
      (fu['votes'] as unknown[]).forEach((v, i) => {
        if (v === null) return;
        const known =
          typeof v === 'string' &&
          (per
            ? v === 'skip' ||
              opts.some(
                (o) => isRecord(o) && o['id'] === v && o['player'] === i,
              ) ||
              (fu['prompt'] === RICH_VEIN_PROMPT &&
                richVoteInOptions(v, i, opts))
            : ids.includes(v));
        if (!known) {
          err(
            `pending.followUp.votes[${String(i)}]: must be null or an option id${per ? ' of that player, or "skip"' : ''}.`,
          );
        }
      });
    }
  }
  if (st === 'pve_summary' || st === 'pvp_summary') {
    const b = p['battle'];
    if (
      !isRecord(b) ||
      typeof b['won'] !== 'boolean' ||
      !isRecord(b['opponent'])
    ) {
      err(`pending.battle: must hold the battle result in step "${st}".`);
    }
  }

  // Leg
  const pveSteps: Step[] = [
    'specialist_pick',
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
        !isRecord(h) ||
        !isInteger(h['round']) ||
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
    !isRecord(tr) ||
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
        !isRecord(a) ||
        a['n'] !== i + 1 ||
        !isInteger(a['player']) ||
        a['player'] < 0 ||
        a['player'] >= n ||
        !isRecord(a['intent']) ||
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
      !isRecord(outcome) ||
      (outcome['reason'] !== 'defeated' && outcome['reason'] !== 'abandoned') ||
      !isInteger(outcome['round'])
    ) {
      err('outcome: must be {reason, round} when the run is over.');
    } else if (outcome['reason'] === 'defeated' && lives !== 0) {
      err('outcome: a defeated run must have 0 lives.');
    }
  } else if (outcome !== null) {
    err('outcome: must be null while the run is going.');
  }

  // The Caravan rotation: both fields or neither.
  const cc = data['caravanCount'];
  const cf = data['caravanFirst'];
  if ((cc === undefined) !== (cf === undefined)) {
    err('caravanCount and caravanFirst: must be present together.');
  } else if (cc !== undefined) {
    if (!isInteger(cc) || cc < 1 || cc > 1000) {
      err('caravanCount: must be an integer from 1 to 1000.');
    }
    if (!isInteger(cf) || cf < 0 || cf >= n) {
      err('caravanFirst: must be a player index.');
    }
  }
}

function validBattleRecord(v: unknown, pve: boolean): boolean {
  if (v === null) return true;
  if (!isRecord(v) || typeof v['won'] !== 'boolean') return false;
  if (pve && typeof v['difficulty'] !== 'string') return false;
  const gp = v['goldPaid'];
  if (
    gp !== undefined &&
    (!pve || !Number.isSafeInteger(gp) || (gp as number) < 0)
  )
    return false;
  const off = v['offered'];
  if (
    off !== undefined &&
    (!pve ||
      !Array.isArray(off) ||
      off.length > 3 ||
      !off.every((x) => typeof x === 'string'))
  )
    return false;
  const o = v['opponent'];
  return (
    isRecord(o) &&
    (o['kind'] === 'pve' || o['kind'] === 'ghost' || o['kind'] === 'boss') &&
    typeof o['label'] === 'string' &&
    (o['boss'] === undefined ||
      (o['kind'] === 'boss' && typeof o['boss'] === 'string'))
  );
}

/**
 * `pvpOpponent` and `ghostsFought` (W3-1). The opponent exists only in the
 * shop of the PvE leg, for the current round; a ghost in it must pass the
 * structural checks and the fixed size cap (not the content-derived bounds,
 * which only selection applies) and be one the run could have drawn.
 */
function checkGhostFields(
  data: Rec,
  st: Step,
  n: number,
  deps: Pick<RunDeps, 'content' | 'mapgenConfig' | 'rules' | 'ghosts'>,
  err: (m: string) => void,
): void {
  const fought = data['ghostsFought'];
  if (!Array.isArray(fought) || !fought.every((k) => typeof k === 'string')) {
    err('ghostsFought: must be an array of strings.');
  } else if (new Set(fought).size !== fought.length) {
    err('ghostsFought: must not repeat a ghost.');
  }
  const o = data['pvpOpponent'];
  if (o === null) return;
  if (st !== 'shop' || data['leg'] !== 'pve') {
    err(
      `pvpOpponent: must be null in step "${st}" (leg "${String(data['leg'])}").`,
    );
    return;
  }
  if (
    !isRecord(o) ||
    !isInteger(o['round']) ||
    (o['kind'] !== 'ghost' && o['kind'] !== 'boss') ||
    typeof o['label'] !== 'string' ||
    !('ghost' in o)
  ) {
    err('pvpOpponent: must be null or { round, kind, label, ghost }.');
    return;
  }
  if (o['round'] !== data['round']) {
    err('pvpOpponent: round does not match the coming PvP battle.');
  }
  if (o['kind'] === 'boss') {
    if (o['ghost'] !== null || o['label'] !== BOSS_LABEL) {
      err('pvpOpponent: a boss has no ghost and the label "the boss".');
    }
    const boss = o['boss'];
    if (boss !== undefined) {
      if (typeof boss !== 'string') {
        err('pvpOpponent.boss: must be a string.');
      } else {
        const threats = deps.ghosts?.threats;
        if (
          threats !== undefined &&
          !threats.archetypes.some((a) => a.id === boss && a.bossOnly)
        ) {
          err('pvpOpponent.boss: not a boss-only archetype.');
        }
      }
    }
    return;
  }
  if ('boss' in o) {
    err('pvpOpponent: only a boss opponent has a "boss".');
    return;
  }
  const ctx = ghostContext(deps);
  // Already chosen: structure, the rules and the fixed size cap only; the
  // content-derived bounds (value, tiers, modifiers, derived size) are for
  // selection, and a later content version must not reject a saved opponent.
  const checked = checkGhostSnapshotShape(
    o['ghost'],
    deps.content,
    deps.mapgenConfig,
    ctx === null ? undefined : ctx.rules,
  );
  if (!checked.ok) {
    for (const e of checked.errors) err(`pvpOpponent.ghost: ${e}`);
    return;
  }
  const g = checked.snapshot;
  if (o['label'] !== g.owner.label) {
    err('pvpOpponent: the label must be the ghost owner label.');
  }
  if (
    g.gameVersion !== data['runVersion'] ||
    g.partySize !== n ||
    g.round !== data['round'] ||
    g.runId === data['runId']
  ) {
    err(
      'pvpOpponent.ghost: not eligible for this run (version, size, round or run).',
    );
  }
  if (Array.isArray(fought) && fought.includes(ghostKey(g))) {
    err('pvpOpponent.ghost: already fought in this run.');
  }
}
