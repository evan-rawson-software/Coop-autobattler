/**
 * The scripted bot player (W3-2, MM-12, TA-31, TA-42, TA-46).
 *
 * `playBotRun` plays a run from the start to defeat (or a round limit) by
 * sending intents through `applyIntent`, the same interface a person's
 * screen uses: it places the Core, lays out a factory, buys from the shop,
 * draws conduits, votes on PvE difficulty and events, uses the Workshop and
 * readies up. A strategy is only a table of tastes; the bot is competent
 * enough to produce legal, varied factories, not to win.
 *
 * Determinism: the bot has its own `Rng` seeded from `options.seed`; it never
 * reads the clock or `Math.random`. The same strategy, seed and run
 * arguments give the same run.
 */
import { Rng, listLegalCorePositions, sealedProducers } from '@game/core';
import { planLayout, type LayoutStyle } from './bot-layout.js';
import { applyIntent, createRun } from './machine.js';
import { readShop } from './economy.js';
import { SKIP_CHOICE } from './events.js';
import { SELECT_GHOST } from './ghosts.js';
import { eventFollowUp, openVote } from './selectors.js';
import type { GhostSnapshot } from '@game/core';
import type {
  CreateRunArgs,
  Intent,
  Json,
  RunDeps,
  RunState,
} from './types.js';

export const BOT_STRATEGIES = ['rush', 'fortify', 'siege', 'weak'] as const;
export type BotStrategyName = (typeof BOT_STRATEGIES)[number];

export function isBotStrategy(name: string): name is BotStrategyName {
  return (BOT_STRATEGIES as readonly string[]).includes(name);
}

interface Strategy {
  readonly description: string;
  /** Which legal Core position: back row, front row, middle or random. */
  readonly core: 'back' | 'front' | 'middle' | 'random';
  /** How much the shop buys of each building definition (0 = never). */
  readonly want: Readonly<Record<string, number>>;
  /** Score added per building tier. */
  readonly tierBonus: number;
  /** Stop buying after this many purchases per shop and player. */
  readonly maxBuys: number;
  readonly maxRerolls: number;
  /** Buy at random from everything on offer, ignoring `want`. */
  readonly random: boolean;
  /** PvE difficulties in order of preference. */
  readonly pve: readonly string[];
  /** Event types in order of preference. */
  readonly events: readonly string[];
  /** Shrine modifiers in order of preference. */
  readonly modifiers: readonly string[];
  readonly layout: LayoutStyle;
}

const STRATEGIES: Readonly<Record<BotStrategyName, Strategy>> = {
  rush: {
    description: 'Extractors feeding barracks, no defenses, hard PvE.',
    core: 'front',
    want: {
      bld_barracks: 10,
      bld_extractor: 8,
      bld_armory: 4,
      bld_overclocker: 3,
      bld_turret: 1,
    },
    tierBonus: 1,
    maxBuys: 8,
    maxRerolls: 0,
    random: false,
    pve: ['hard', 'medium', 'easy'],
    events: ['windfall', 'workshop', 'shrine'],
    modifiers: ['mod_drilled_troops', 'mod_reinforced_frames'],
    layout: {
      connect: true,
      walls: false,
      placeLeftovers: true,
      priority: ['bld_barracks', 'bld_armory', 'bld_overclocker', 'bld_turret'],
    },
  },
  fortify: {
    description: 'Turrets and walls around the Core, then a slow ramp.',
    core: 'back',
    want: {
      bld_turret: 10,
      bld_wall: 8,
      bld_extractor: 7,
      bld_gate: 4,
      bld_overclocker: 5,
      bld_barracks: 4,
    },
    tierBonus: 2,
    maxBuys: 8,
    maxRerolls: 2,
    random: false,
    pve: ['medium', 'easy', 'hard'],
    events: ['shrine', 'workshop', 'windfall'],
    modifiers: [
      'mod_stout_walls',
      'mod_sharp_turrets',
      'mod_fortified_core',
      'mod_reinforced_frames',
    ],
    layout: {
      connect: true,
      walls: true,
      placeLeftovers: true,
      priority: ['bld_turret', 'bld_overclocker', 'bld_barracks', 'bld_armory'],
    },
  },
  siege: {
    description: 'Few, high-tier barracks and armories behind a wall screen.',
    core: 'middle',
    want: {
      bld_barracks: 9,
      bld_armory: 8,
      bld_extractor: 7,
      bld_wall: 5,
      bld_turret: 3,
      bld_overclocker: 2,
    },
    tierBonus: 6,
    maxBuys: 5,
    maxRerolls: 3,
    random: false,
    pve: ['medium', 'hard', 'easy'],
    events: ['workshop', 'shrine', 'windfall'],
    modifiers: ['mod_drilled_troops', 'mod_reinforced_frames'],
    layout: {
      connect: true,
      walls: true,
      placeLeftovers: true,
      priority: ['bld_barracks', 'bld_armory', 'bld_turret', 'bld_overclocker'],
    },
  },
  weak: {
    description: 'Buys one thing at random and scatters it unconnected.',
    core: 'random',
    want: {},
    tierBonus: 0,
    maxBuys: 1,
    maxRerolls: 0,
    random: true,
    pve: ['easy', 'medium', 'hard'],
    events: ['windfall', 'shrine', 'workshop'],
    modifiers: [],
    layout: {
      connect: false,
      walls: true,
      placeLeftovers: true,
      priority: [],
    },
  },
};

/** One line describing each strategy, for help text. */
export function describeBotStrategy(name: BotStrategyName): string {
  return STRATEGIES[name].description;
}

export interface BotOptions {
  readonly strategy: BotStrategyName;
  /** Seed of the bot's own generator (not the run's). */
  readonly seed: number;
  /** Stop once the run reaches a round above this one (default: play on). */
  readonly maxRounds?: number;
  /**
   * The gold a re-roll costs. Without it the bot never re-rolls (it cannot
   * know the price from the run state alone).
   */
  readonly rerollCost?: number;
  /**
   * With `deps.ghosts` on: the candidates to send with `select_ghost`
   * (default: none, so the PvP opponent is the boss).
   */
  readonly candidates?: (state: RunState) => Json;
  /** Safety bound on accepted intents (default 20000). */
  readonly maxIntents?: number;
}

export interface Rejection {
  readonly step: string;
  readonly round: number;
  readonly player: number;
  readonly intent: string;
  readonly reason: string;
  readonly detail: string;
}

export interface BotRunResult {
  readonly state: RunState;
  readonly accepted: number;
  /** Every intent the run refused; a correct bot has none. */
  readonly rejected: readonly Rejection[];
  /**
   * With `deps.ghosts` on: the snapshot taken before each PvP battle, in
   * round order (what the run controller would write to the pool).
   */
  readonly snapshots: readonly GhostSnapshot[];
  readonly strategy: BotStrategyName;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

class Driver {
  state: RunState;
  accepted = 0;
  readonly rejected: Rejection[] = [];
  readonly snapshots: GhostSnapshot[] = [];
  constructor(
    start: RunState,
    readonly deps: RunDeps,
  ) {
    this.state = start;
  }

  send(player: number, intent: Intent): boolean {
    const r = applyIntent(this.state, player, intent, this.deps);
    if (r.ok) {
      this.state = r.state;
      this.accepted++;
      for (const fx of r.effects) {
        if (fx.type === 'ghost_snapshot') this.snapshots.push(fx.snapshot);
      }
      return true;
    }
    this.rejected.push({
      step: this.state.step,
      round: this.state.round,
      player,
      intent: intent.type,
      reason: r.reason,
      detail: r.detail ?? '',
    });
    return false;
  }
}

function pickCore(
  s: Strategy,
  positions: readonly { x: number; y: number }[],
  rng: Rng,
): { x: number; y: number } | undefined {
  if (positions.length === 0) return undefined;
  switch (s.core) {
    case 'back':
      return positions[0];
    case 'front':
      return positions[positions.length - 1];
    case 'middle':
      return positions[Math.floor(positions.length / 2)];
    case 'random':
      return positions[rng.nextInt(positions.length)];
  }
}

/** The option id the strategy likes best from `options` by `field`. */
function preferred(
  options: readonly Json[],
  order: readonly string[],
  field: string,
): string | undefined {
  for (const want of order) {
    for (const o of options) {
      if (isObj(o) && o[field] === want && typeof o['id'] === 'string') {
        return o['id'];
      }
    }
  }
  const first = options[0];
  return isObj(first) && typeof first['id'] === 'string'
    ? first['id']
    : undefined;
}

function buildScore(s: Strategy, def: string, tier: number, rng: Rng): number {
  if (s.random) return 1 + rng.nextInt(10);
  const base = s.want[def] ?? 0;
  return base === 0 ? 0 : base * 10 + tier * s.tierBonus;
}

const CONSUMERS = [
  'bld_barracks',
  'bld_turret',
  'bld_armory',
  'bld_overclocker',
];

/** Buy what the strategy wants, keeping extractors and consumers balanced. */
function shop(d: Driver, s: Strategy, rng: Rng, opts: BotOptions): void {
  const n = d.state.players.length;
  for (let p = 0; p < n; p++) {
    let buys = 0;
    let rerolls = 0;
    for (let guard = 0; guard < 40 && buys < s.maxBuys; guard++) {
      const me = d.state.perPlayer[p];
      const data = me === undefined ? null : readShop(me);
      if (me === undefined || data === null) break;
      const owned = [...d.state.team.buildings, ...d.state.team.stash].filter(
        (b) => b.owner === p,
      );
      const sources = owned.filter((b) => b.def === 'bld_extractor').length;
      const users = owned.filter((b) => CONSUMERS.includes(b.def)).length;
      let best = -1;
      let bestScore = 0;
      data.offers.forEach((o, slot) => {
        if (o === null || o.price > me.gold) return;
        let score = buildScore(s, o.def, o.tier, rng);
        if (!s.random) {
          if (o.def === 'bld_extractor' && sources >= users + 1) score = 0;
          if (CONSUMERS.includes(o.def) && users >= sources + 1) score = 0;
        }
        if (score > bestScore) {
          bestScore = score;
          best = slot;
        }
      });
      if (best >= 0) {
        if (d.send(p, { type: 'buy', slot: best })) buys++;
        else break;
        continue;
      }
      const cost = opts.rerollCost;
      if (
        cost !== undefined &&
        rerolls < s.maxRerolls &&
        me.gold >= cost + 6 &&
        d.send(p, { type: 'reroll' })
      ) {
        rerolls++;
        continue;
      }
      break;
    }
  }
}

/** Lay out every player's factory, then take back anything that seals in. */
function layout(d: Driver, s: Strategy, rng: Rng): void {
  const n = d.state.players.length;
  const { plotWidth } = d.state.team.map;
  for (let p = 0; p < n; p++) {
    const intents = planLayout(
      d.state.team,
      p,
      d.deps.content,
      plotWidth,
      s.layout,
      rng,
    );
    for (const intent of intents) d.send(p, intent);
  }
  for (let guard = 0; guard < 20; guard++) {
    const sealed = sealedProducers(d.state.team, d.deps.content);
    const id = sealed[0];
    if (id === undefined) break;
    const owner = d.state.team.buildings.find((b) => b.id === id)?.owner ?? 0;
    if (!d.send(owner, { type: 'return_building', id })) break;
  }
}

function readyAll(d: Driver): void {
  const step = d.state.step;
  for (let p = 0; p < d.state.players.length; p++) {
    if (d.state.step !== step) break;
    if (d.state.perPlayer[p]?.ready === true) continue;
    d.send(p, { type: 'ready' });
  }
}

function voteAll(d: Driver, choice: string): void {
  const step = d.state.step;
  for (let p = 0; p < d.state.players.length; p++) {
    if (d.state.step !== step) break;
    d.send(p, { type: 'vote', choice });
  }
}

/** Play one step's worth of the party's moves. */
function playStep(d: Driver, s: Strategy, rng: Rng, opts: BotOptions): void {
  const st = d.state;
  switch (st.step) {
    case 'core_placement': {
      const pos = pickCore(
        s,
        listLegalCorePositions(
          st.team.map,
          d.deps.content,
          d.deps.mapgenConfig,
        ),
        rng,
      );
      if (pos === undefined) return;
      d.send(st.host, { type: 'propose_core', x: pos.x, y: pos.y });
      for (let p = 0; p < st.players.length; p++) {
        if (d.state.step !== 'core_placement') break;
        if (p !== st.host) d.send(p, { type: 'vote', choice: pos });
      }
      return;
    }
    case 'pve_choice': {
      const options = openVote(st)?.options ?? [];
      const id = preferred(options, s.pve, 'difficulty');
      if (id !== undefined) voteAll(d, id);
      return;
    }
    case 'event_choice': {
      const options = openVote(st)?.options ?? [];
      const id = preferred(options, s.events, 'type');
      if (id !== undefined) voteAll(d, id);
      return;
    }
    case 'event_resolve': {
      for (let p = 0; p < st.players.length; p++) {
        if (d.state.step !== 'event_resolve') break;
        const view = eventFollowUp(d.state, p, d.deps);
        if (view === null) break;
        const choice = view.perPlayer
          ? workshopPick(s, view.options, p, rng)
          : (preferred(view.options, s.modifiers, 'id') ?? SKIP_CHOICE);
        d.send(p, { type: 'event_choose', choice });
      }
      return;
    }
    case 'shop':
      if (st.leg === 'pve' && st.pvpOpponent === null && d.deps.ghosts) {
        const candidates = opts.candidates?.(st) ?? [];
        d.send(st.host, { type: SELECT_GHOST, candidates });
      }
      shop(d, s, rng, opts);
      layout(d, s, rng);
      readyAll(d);
      return;
    case 'build':
      layout(d, s, rng);
      readyAll(d);
      return;
    default:
      readyAll(d);
  }
}

/** The affordable Workshop upgrade the strategy likes best, or skip. */
function workshopPick(
  s: Strategy,
  options: readonly Json[],
  player: number,
  rng: Rng,
): string {
  let best: string = SKIP_CHOICE;
  let bestScore = -1;
  for (const o of options) {
    if (!isObj(o) || o['player'] !== player || o['affordable'] !== true) {
      continue;
    }
    const id = o['id'];
    const def = o['def'];
    const tier = o['tier'];
    if (typeof id !== 'string' || typeof def !== 'string') continue;
    const score = buildScore(s, def, typeof tier === 'number' ? tier : 1, rng);
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return bestScore > 0 || (s.random && bestScore >= 0) ? best : SKIP_CHOICE;
}

/**
 * Play a whole run with the bot. Throws if the run cannot be created or the
 * bot gets stuck (a step in which it makes no progress); a refused intent is
 * not an error but is listed in `rejected`.
 */
export function playBotRun(
  deps: RunDeps,
  args: CreateRunArgs,
  options: BotOptions,
): BotRunResult {
  const created = createRun(args, deps);
  if (!created.ok) throw new Error(`createRun: ${created.detail}`);
  const strategy = STRATEGIES[options.strategy];
  const rng = Rng.fromSeed(options.seed).child(options.strategy);
  const d = new Driver(created.state, deps);
  const cap = options.maxIntents ?? 20000;
  let stuck = 0;
  while (d.state.step !== 'run_over') {
    if (options.maxRounds !== undefined && d.state.round > options.maxRounds) {
      break;
    }
    if (d.accepted > cap) throw new Error('bot: too many intents');
    const before = d.state.actionCounter;
    playStep(d, strategy, rng, options);
    if (d.state.actionCounter === before) {
      stuck++;
      if (stuck >= 3) {
        throw new Error(
          `bot stuck in ${d.state.step} (round ${String(d.state.round)}): ${d.rejected
            .slice(-3)
            .map((r) => `${r.intent} ${r.reason} ${r.detail}`)
            .join('; ')}`,
        );
      }
    } else {
      stuck = 0;
    }
  }
  return {
    state: d.state,
    accepted: d.accepted,
    rejected: d.rejected,
    snapshots: d.snapshots,
    strategy: options.strategy,
  };
}
