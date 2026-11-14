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
import {
  Rng,
  type BuildingConfig,
  listLegalCorePositions,
  sealedProducers,
  tierPrice,
} from '@game/core';
import {
  planLayout,
  plotRoom,
  wouldPlace,
  type LayoutStyle,
} from './bot-layout.js';
import { planLinks } from './bot-links.js';
import { applyIntent, createRun } from '../rules/machine.js';
import { readShop } from '../rules/economy.js';
import { SKIP_CHOICE } from '../rules/events.js';
import { SELECT_GHOST } from '../rules/ghosts.js';
import { eventFollowUp, openVote } from '../rules/selectors.js';
import { replayLastBattle } from '../rules/replay.js';
import type { GhostSnapshot } from '@game/core';
import type {
  CreateRunArgs,
  Intent,
  Json,
  RunDeps,
  RunState,
} from '../rules/types.js';
import { isRecord } from '../rules/json-guards.js';

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
  /**
   * Stop buying walls once a player owns this many (a screen, not a hoard):
   * the gold waits for what the strategy is really after (issue #178).
   */
  readonly wallCap?: number;
  /**
   * Buy only what is certain to be used: a collector for a consumer the
   * player already owns, or for one on offer in the same shop that the gold
   * covers together (and the other way round); never for a consumer that is
   * merely imagined. A Splitter lets a collector count for two consumers, and
   * gold is kept for the missing half of a pair instead of spent on re-rolls
   * (issue #178).
   */
  readonly realOnly?: boolean;
  /** With `realOnly`: gold kept back from re-rolls while no consumer waits. */
  readonly pairReserve?: number;
}

/** The wall shapes the shop sells (issue #291); the I is the rare one. */
const WALL_SHAPES: readonly string[] = [
  'bld_wall_o',
  'bld_wall_t',
  'bld_wall_s',
  'bld_wall_z',
  'bld_wall_l',
  'bld_wall_j',
  'bld_wall_i',
];

/** Every wall shape wanted equally much. */
function wantWalls(n: number): Record<string, number> {
  return Object.fromEntries(WALL_SHAPES.map((id) => [id, n]));
}

function isWallDef(
  content: { readonly buildings: BuildingConfig },
  def: string,
): boolean {
  const d = content.buildings.get(def);
  return d !== undefined && d.kind === 'defense' && d.defenseType === 'wall';
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
      ...wantWalls(8),
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
    core: 'back',
    want: {
      bld_barracks: 9,
      bld_armory: 8,
      bld_extractor: 7,
      ...wantWalls(5),
      bld_turret: 3,
      bld_overclocker: 2,
      bld_hangar: 3,
      bld_splitter: 5,
    },
    tierBonus: 6,
    maxBuys: 5,
    maxRerolls: 3,
    random: false,
    pve: ['hard', 'medium', 'easy'],
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
    // The kit's three walls are the screen; more gold goes to what feeds
    // the Core's defence, not to a hoard of walls.
    wallCap: 3,
    realOnly: true,
    pairReserve: 20,
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
      if (isRecord(o) && o[field] === want && typeof o['id'] === 'string') {
        return o['id'];
      }
    }
  }
  const first = options[0];
  return isRecord(first) && typeof first['id'] === 'string'
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

/**
 * The gold a re-roll must leave: 6 (a cheap piece) for a strategy that buys
 * speculatively; for one that buys only what it will use, the price of the
 * collector a waiting consumer needs, or else the reserve for a pair.
 */
function rerollReserve(
  d: Driver,
  s: Strategy,
  consumersWaiting: number,
): number {
  if (s.realOnly !== true) return 6;
  return consumersWaiting > 0
    ? tierPrice(d.deps.content, 'bld_extractor', 1)
    : (s.pairReserve ?? 6);
}

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
      const walls = owned.filter((b) =>
        isWallDef(d.deps.content, b.def),
      ).length;
      const room = plotRoom(
        d.state.team,
        p,
        d.deps.content,
        d.state.team.map.plotWidth,
      );
      const openNodes = room.openNodeTotal;
      // Owned consumers by the resource they take, board and stash.
      const taking = new Map<string, number>();
      for (const b of owned) {
        const r = d.deps.content.buildings.get(b.def)?.inputs[0]?.resource;
        if (r !== undefined && CONSUMERS.includes(b.def)) {
          taking.set(r, (taking.get(r) ?? 0) + 1);
        }
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
      const splittersWaiting = d.state.team.stash.filter(
        (b) => b.owner === p && b.def === 'bld_splitter',
      ).length;
      const shareNext = splitters * 2 < users && splittersWaiting === 0;
      // What the layout step would do with a bought offer, asked of the
      // layout code itself on a copy of the team (issue #178).
      const memo = new Map<string, number>();
      // A collector is worth buying when some consumer the strategy likes
      // would use it: the best liked consumer of each resource, tier 1.
      const likedConsumers: { def: string; tier: number }[] = [];
      const seenResource = new Set<string>();
      // Most wanted first; equal wants keep the order of CONSUMERS.
      for (const def of [...CONSUMERS].sort(
        (a, b) =>
          (s.want[b] ?? 0) - (s.want[a] ?? 0) ||
          CONSUMERS.indexOf(a) - CONSUMERS.indexOf(b),
      )) {
        const res = d.deps.content.buildings.get(def)?.inputs[0]?.resource;
        if ((s.want[def] ?? 0) === 0 || res === undefined) continue;
        if (seenResource.has(res)) continue;
        seenResource.add(res);
        likedConsumers.push({ def, tier: 1 });
      }
      const placeable = (
        kind: 'collector' | 'consumer' | 'splitter',
        o: { def: string; tier: number },
        context: readonly { def: string; tier: number }[],
      ): boolean =>
        wouldPlace(
          d.state.team,
          p,
          d.deps.content,
          d.state.team.map.plotWidth,
          s.layout,
          kind,
          o,
          context,
          memo,
        );
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
          // A receiver's own collectors are fewer now that the dry run keeps
          // out those no plot cell can take, so it may hold one more consumer
          // for its neighbours' spare collectors to feed.
          const more = role === 2 ? slack + 1 : 1;
          if (o.def === 'bld_extractor' && sources >= users + extra) score = 0;
          if (CONSUMERS.includes(o.def) && users >= sources + more) {
            score = 0;
          }
          // Never buy a collector no free node can take (it would wait in the
          // stash), nor any for a style that does not connect, which places
          // none (issue #178).
          if (
            o.def === 'bld_extractor' &&
            (!s.layout.connect || extractorsWaiting >= openNodes)
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
                  splitters +
                  // One more while a share is possible, so the waiting
                  // consumer is what lets the Splitter be bought.
                  (shareNext && (room.shareable.get(res) ?? 0) > 0 ? 1 : 0)
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
              consumersWaiting === 0)
          ) {
            score = 0;
          }
          // Only what the layout could place and connect now: a collector
          // for a consumer to feed, a consumer one of the collectors can feed
          // (CB-10a), a Splitter that shares a collector between two. A
          // receiver's consumer is fed through a neighbour link instead.
          if (score > 0 && s.layout.connect) {
            const offer = { def: o.def, tier: o.tier };
            if (o.def === 'bld_extractor') {
              // A donor buys for the neighbour's consumers, which the link
              // step places (it is not a dry run of this plot); everyone
              // else for two consumers of a kind they like, so that the next
              // purchase of this shop may be the one that takes it.
              if (
                role !== 1 &&
                !(s.realOnly === true
                  ? placeable('collector', offer, []) ||
                    data.offers.some(
                      (e) =>
                        e !== null &&
                        CONSUMERS.includes(e.def) &&
                        (s.want[e.def] ?? 0) > 0 &&
                        o.price + e.price <= me.gold &&
                        placeable('collector', offer, [
                          { def: e.def, tier: e.tier },
                        ]),
                    )
                  : likedConsumers.some((c) =>
                      placeable('collector', offer, [c, c]),
                    ))
              ) {
                score = 0;
              }
            } else if (CONSUMERS.includes(o.def) && role !== 2) {
              const share =
                (s.want.bld_splitter ?? 0) > 0
                  ? [{ def: 'bld_splitter', tier: 1 }]
                  : [];
              if (
                !placeable('consumer', offer, share) &&
                !(
                  s.realOnly === true &&
                  data.offers.some(
                    (e) =>
                      e !== null &&
                      d.deps.content.buildings.get(e.def)?.kind === 'source' &&
                      o.price + e.price <= me.gold &&
                      placeable('consumer', offer, [
                        { def: e.def, tier: e.tier },
                      ]),
                  )
                )
              ) {
                score = 0;
              }
            } else if (o.def === 'bld_splitter') {
              // A strategy that buys only what it will use asks about the
              // consumers it really owns, not a liked one it might buy.
              if (
                s.realOnly === true
                  ? !placeable('splitter', offer, [])
                  : !likedConsumers.some((c) =>
                      placeable('splitter', offer, [c]),
                    )
              )
                score = 0;
            }
          }
        }
        if (
          s.wallCap !== undefined &&
          isWallDef(d.deps.content, o.def) &&
          walls >= s.wallCap
        ) {
          score = 0;
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
        me.gold >= cost + rerollReserve(d, s, consumersWaiting) &&
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
    if (!isRecord(o) || o['player'] !== player || o['affordable'] !== true) {
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
