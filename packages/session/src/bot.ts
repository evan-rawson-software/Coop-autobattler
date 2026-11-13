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
import {
  MIN_COVERAGE_PERCENT,
  bestOwnedSupply,
  collectorSupply,
  consumerNeed,
  coveragePercent,
  planLayout,
  plotRoom,
  type LayoutStyle,
} from './bot-layout.js';
import { planLinks } from './bot-links.js';
import { applyIntent, createRun } from './machine.js';
import { readShop } from './economy.js';
import { SKIP_CHOICE } from './events.js';
import { SELECT_GHOST } from './ghosts.js';
import { eventFollowUp, openVote } from './selectors.js';
import { replayLastBattle } from './replay.js';
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
  /**
   * Split a party into donors and receivers (even players buy more
   * collectors, odd players more consumers). Only for a strategy whose
   * links actually form, and only with a neighbour (issue #178).
   */
  readonly roles?: boolean;
}

const STRATEGIES: Readonly<Record<BotStrategyName, Strategy>> = {
  rush: {
    description: 'Extractors feeding barracks, no defenses, hard PvE.',
    core: 'front',
    want: {
      bld_barracks: 10,
      bld_extractor: 8,
      bld_range: 4,
      bld_armory: 4,
      bld_overclocker: 3,
      bld_turret: 1,
      bld_splitter: 6,
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
      priority: [
        'bld_barracks',
        'bld_range',
        'bld_armory',
        'bld_overclocker',
        'bld_turret',
      ],
      links: true,
    },
    roles: true,
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
      bld_range: 6,
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
      priority: [
        'bld_turret',
        'bld_range',
        'bld_overclocker',
        'bld_barracks',
        'bld_armory',
      ],
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
      bld_hangar: 3,
      bld_splitter: 5,
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
      priority: [
        'bld_barracks',
        'bld_armory',
        'bld_turret',
        'bld_hangar',
        'bld_overclocker',
      ],
      links: true,
    },
    // Siege draws no border links in any bundled ghost, so no roles.
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
  /**
   * Record the length and the Cores left standing of every battle
   * (`BotRunResult.battles`). Replays each battle once, so it costs time.
   */
  readonly trackBattles?: boolean;
}

/** What the harness reads off one battle (issue #140). */
export interface BattleStat {
  readonly round: number;
  readonly kind: 'pve' | 'pvp';
  readonly partySize: number;
  readonly won: boolean;
  /** Tick on which the battle ended. */
  readonly endTick: number;
  /** Cores standing at the end, [party, opponent]. */
  readonly coresStanding: readonly [number, number];
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
  /** Border-link halves the bot drew over the run (accepted ones). */
  readonly linkHalves: number;
  /** Per battle; empty unless `trackBattles` was set. */
  readonly battles: readonly BattleStat[];
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

class Driver {
  state: RunState;
  accepted = 0;
  /** Border-link halves the bot has drawn. */
  linkHalves = 0;
  readonly battles: BattleStat[] = [];
  trackBattles = false;
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
      const before = this.state.step;
      this.state = r.state;
      this.accepted++;
      if (this.trackBattles && r.state.step !== before) this.recordBattle();
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

  /** Replay the battle that was just resolved and note how it ended. */
  private recordBattle(): void {
    const st = this.state;
    if (st.step !== 'pve_summary' && st.step !== 'pvp_summary') return;
    const rep = replayLastBattle(st, this.deps);
    if (!rep.ok) return;
    while (!rep.battle.isOver()) rep.battle.step();
    const result = rep.battle.result();
    if (result === null) return;
    const [a, b] = rep.battle.summary().sides;
    this.battles.push({
      round: st.round,
      kind: st.step === 'pve_summary' ? 'pve' : 'pvp',
      partySize: st.players.length,
      won: result.winner === 0,
      endTick: result.endTick,
      coresStanding: [a.coresStanding, b.coresStanding],
    });
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
  'bld_range',
  'bld_hangar',
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
      const splitters = owned.filter((b) => b.def === 'bld_splitter').length;
      // Upper bound for a consumer: the player's best collector, owned.
      const supply = bestOwnedSupply(d.state.team, p, d.deps.content);
      const room = plotRoom(
        d.state.team,
        p,
        d.deps.content,
        d.state.team.map.plotWidth,
      );
      const openNodes = [...room.openNodes.values()].reduce((a, b) => a + b, 0);
      // Owned consumers by the resource they take, board and stash.
      const taking = new Map<string, number>();
      for (const b of owned) {
        const r = d.deps.content.buildings.get(b.def)?.inputs[0]?.resource;
        if (r !== undefined && CONSUMERS.includes(b.def)) {
          taking.set(r, (taking.get(r) ?? 0) + 1);
        }
      }
      // Free nodes a collector could take for a consumer without one yet.
      let nodesWanted = 0;
      for (const [r, open] of room.openNodes) {
        const unserved =
          (taking.get(r) ?? 0) - (room.placedSources.get(r) ?? 0);
        nodesWanted += Math.max(0, Math.min(open, unserved));
      }
      let neighbourSpare = 0;
      for (let q = 0; q < n; q++) {
        if (q === p) continue;
        const theirs = [
          ...d.state.team.buildings,
          ...d.state.team.stash,
        ].filter((b) => b.owner === q);
        neighbourSpare += Math.max(
          0,
          theirs.filter((b) => b.def === 'bld_extractor').length -
            theirs.filter((b) => CONSUMERS.includes(b.def)).length,
        );
      }
      const extractorsWaiting = d.state.team.stash.filter(
        (b) => b.owner === p && b.def === 'bld_extractor',
      ).length;
      const consumersWaiting = d.state.team.stash.filter(
        (b) => b.owner === p && CONSUMERS.includes(b.def),
      ).length;
      // A Splitter only helps where one owned collector can feed a waiting
      // consumer and another consumer, both at the minimum coverage.
      const content = d.deps.content;
      const half =
        (k: { def: string; tier: number }) =>
        (c: { def: string; tier: number }): boolean =>
          coveragePercent(
            Math.floor(collectorSupply(content, k.def, k.tier) / 2),
            consumerNeed(content, c.def, c.tier),
          ) >= MIN_COVERAGE_PERCENT;
      const inputOf = (def: string): string =>
        content.buildings.get(def)?.inputs[0]?.resource ?? '';
      const consumersOwned = owned.filter((b) => CONSUMERS.includes(b.def));
      const consumersStashed = d.state.team.stash.filter(
        (b) => b.owner === p && CONSUMERS.includes(b.def),
      );
      // The weakest collector is the test: the layout may split any of them.
      const weakest = owned
        .filter((k) => k.def === 'bld_extractor')
        .sort((x, y) => x.tier - y.tier)[0];
      const fits = weakest === undefined ? null : half(weakest);
      const canSplit =
        fits !== null &&
        consumersStashed.some(
          (c) =>
            (room.shareable.get(inputOf(c.def)) ?? 0) +
              (room.openNodes.get(inputOf(c.def)) ?? 0) >
              0 &&
            fits(c) &&
            consumersOwned.some(
              (m) =>
                m.id !== c.id && inputOf(m.def) === inputOf(c.def) && fits(m),
            ),
        );
      const splittersWaiting = d.state.team.stash.filter(
        (b) => b.owner === p && b.def === 'bld_splitter',
      ).length;
      // With links and a neighbour, even players are donors (more collectors)
      // and odd players receivers (more consumers); everyone else balances
      // their own.
      const role = s.roles === true && n >= 2 ? (p % 2 === 0 ? 1 : 2) : 0;
      const slack = role === 0 ? 1 : 3;
      let best = -1;
      let bestScore = 0;
      data.offers.forEach((o, slot) => {
        if (o === null || o.price > me.gold) return;
        let score = buildScore(s, o.def, o.tier, rng);
        if (!s.random) {
          const extra = role === 1 ? slack : 1;
          const more = role === 2 ? slack : 1;
          if (o.def === 'bld_extractor' && sources >= users + extra) score = 0;
          if (CONSUMERS.includes(o.def) && users >= sources + more) score = 0;
          // Never buy a collector that cannot be placed: the layout puts a
          // collector on a free node of a resource some consumer is waiting
          // for (a donor's spare ones go to a neighbour, so any free node
          // does; so does one while the player has no consumer), and a
          // style that does not connect places none (issue #178).
          if (
            o.def === 'bld_extractor' &&
            (!s.layout.connect ||
              extractorsWaiting >=
                (users === 0 || role === 1 ? openNodes : nodesWanted))
          ) {
            score = 0;
          }
          // Nor a consumer whose resource has no collector or free node left
          // for it, counting the Splitters that let a collector serve two.
          if (CONSUMERS.includes(o.def) && s.layout.connect && role === 2) {
            // A receiver lives on its neighbours' spare collectors: not more
            // waiting consumers than those can feed.
            if (consumersWaiting >= Math.max(1, neighbourSpare)) score = 0;
          } else if (CONSUMERS.includes(o.def) && s.layout.connect) {
            const res = d.deps.content.buildings.get(o.def)?.inputs[0]
              ?.resource;
            if (
              res !== undefined &&
              (taking.get(res) ?? 0) >=
                (room.openNodes.get(res) ?? 0) +
                  (room.placedSources.get(res) ?? 0) +
                  splitters
            ) {
              score = 0;
            }
          }
          // One Splitter per two consumers, no more, and only while a
          // consumer waits in the stash for it: a Splitter only shares a
          // collector between a consumer on the board and one still to place,
          // and a Splitter that found no place stays unbought (issue #178).
          if (
            o.def === 'bld_splitter' &&
            (splitters * 2 >= users ||
              splittersWaiting > 0 ||
              consumersWaiting === 0 ||
              // A receiver's waiting consumers are fed over a border link.
              role === 2 ||
              !canSplit)
          ) {
            score = 0;
          }
          // Never buy a consumer the collectors cannot feed (CB-10a). The
          // supply is the player's own best collectors (`bestOwnedSupply`);
          // a neighbour's collectors are not counted.
          if (
            CONSUMERS.includes(o.def) &&
            coveragePercent(
              supply,
              consumerNeed(d.deps.content, o.def, o.tier),
            ) < MIN_COVERAGE_PERCENT
          ) {
            score = 0;
          }
        }
        // A style that does not connect places no collector at all.
        if (o.def === 'bld_extractor' && !s.layout.connect) score = 0;
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
  if (s.layout.links === true) {
    const steps = planLinks(
      d.state.team,
      d.deps.content,
      plotWidth,
      s.layout,
      rng,
    );
    for (const step of steps) {
      if (
        d.send(step.player, step.intent) &&
        step.intent.type === 'add_conduit'
      ) {
        d.linkHalves++;
      }
    }
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
      // Each player places their own Core in their own plot, then readies.
      for (let p = 0; p < st.players.length; p++) {
        const pos = pickCore(
          s,
          listLegalCorePositions(
            st.team.map,
            d.deps.content,
            d.deps.mapgenConfig,
            p,
          ),
          rng,
        );
        if (pos === undefined) return;
        d.send(p, { type: 'place_core', x: pos.x, y: pos.y });
      }
      for (let p = 0; p < st.players.length; p++) {
        if (d.state.step !== 'core_placement') break;
        d.send(p, { type: 'ready' });
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
  d.trackBattles = options.trackBattles === true;
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
    linkHalves: d.linkHalves,
    battles: d.battles,
  };
}
