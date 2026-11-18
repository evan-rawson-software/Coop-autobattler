/**
 * `pnpm sim stage --chains` (issue #386): reference boards for the refining
 * comparisons. One plot of two collectors is added to the starting-kit board
 * and fed to (a) a refining chain, (b) the base buildings on the same
 * collectors, (c) a Foundry or (d) an Overclocker on the same Flux. Each is
 * measured against a passive Core (supply, first production tick, units per
 * 1000 supply items) and against generated PvE threats (win rate, Core damage
 * taken, damage dealt by unit type, damage armor prevents, splash). Pure:
 * content in, text out.
 */
import {
  addConduit,
  addToStash,
  createTeamState,
  generateMap,
  generateThreat,
  placeCore,
  placeFromStash,
  Rng,
  rollOffers,
  startBattle,
  startPveBattle,
  type ArenaEvent,
  type Cell,
  type Content,
  type Side,
  type TeamState,
} from '@game/core';
import { CliError, type ThreatTypeName } from './args.js';
import type { CommandOutput } from './commands.js';
import type { SimContext } from './context.js';
import { buildStageBoard, stageCore, STAGE_MAP_SEED } from './stage-command.js';

/** Where the plot of two collectors goes (a free area of the stage map). */
const SOUTH_NODE: Cell = { x: 5, y: 4 };
const WEST_NODE: Cell = { x: 3, y: 5 };
/** The main building (refinery, Foundry, Barracks or Hangar) and what is north of it. */
const MAIN: Cell = { x: 5, y: 5 };
const NEXT: Cell = { x: 5, y: 7 };
/** The building fed straight from the west collector (a Hangar or an Overclocker). */
const SIDE: Cell = { x: 3, y: 6 };

export interface ChainBoardSpec {
  readonly name: string;
  readonly south: string;
  readonly west: string;
  /** The building on the main spot, then the building it feeds (north of it). */
  readonly main: string | null;
  readonly next: string | null;
  /** The building the west collector feeds straight. */
  readonly side: string | null;
  readonly note: string;
}

export const CHAIN_BOARDS: readonly ChainBoardSpec[] = [
  {
    name: 'base',
    south: '',
    west: '',
    main: null,
    next: null,
    side: null,
    note: 'the starting kit, no plot',
  },
  {
    name: 'ab_chain',
    south: 'res_a',
    west: 'res_b',
    main: 'bld_refinery_ab',
    next: 'bld_golem_forge',
    side: null,
    note: 'Ore + Spark -> Sparksteel refinery -> Golem forge',
  },
  {
    name: 'ab_base',
    south: 'res_a',
    west: 'res_b',
    main: 'bld_barracks',
    next: null,
    side: 'bld_hangar',
    note: 'the same collectors: Ore -> Barracks, Spark -> Hangar',
  },
  {
    name: 'ab_foundry',
    south: 'res_a',
    west: 'res_b',
    main: 'bld_foundry',
    next: null,
    side: null,
    note: 'the same collectors -> Foundry',
  },
  {
    name: 'bc_chain',
    south: 'res_b',
    west: 'res_c',
    main: 'bld_refinery_bc',
    next: 'bld_spire',
    side: null,
    note: 'Spark + Flux -> Aether refinery -> Spire',
  },
  {
    name: 'bc_base',
    south: 'res_b',
    west: 'res_c',
    main: 'bld_hangar',
    next: null,
    side: 'bld_overclocker',
    note: 'the same collectors: Spark -> Hangar, Flux -> Overclocker',
  },
];

type Point = Cell;

function priceOf(content: Content, def: string, tier: number): number {
  const d = content.buildings.get(def);
  const t = d?.tiers[tier - 1] as { price?: number } | undefined;
  return t?.price ?? 0;
}

export interface ChainBoard {
  readonly spec: ChainBoardSpec;
  readonly team: TeamState;
  /** Shop value of the plot only (collectors and buildings). */
  readonly plotValue: number;
}

/** The kit board with the plot of `spec` added; the tier of the plot is 1. */
export function buildChainBoard(
  ctx: SimContext,
  spec: ChainBoardSpec,
): ChainBoard {
  const kit = buildStageBoard(ctx, 'kit');
  if (spec.main === null) return { spec, team: kit.team, plotValue: 0 };
  let state: TeamState = {
    ...kit.team,
    addedNodes: [
      ...(kit.team.addedNodes ?? []),
      { ...SOUTH_NODE, resource: spec.south, owner: 0, round: 1 },
      { ...WEST_NODE, resource: spec.west, owner: 0, round: 1 },
    ],
  };
  let value = 0;
  const fail = (what: string, reason: string): never => {
    throw new Error(`chain board ${spec.name}: ${what}: ${reason}`);
  };
  const put = (def: string, at: Point): number => {
    const s = addToStash(state, ctx.content, { def, tier: 1, owner: 0 });
    if (!s.ok) return fail(def, s.reason);
    const p = placeFromStash(s.state, ctx.content, {
      actor: 0,
      id: s.id,
      x: at.x,
      y: at.y,
      rotation: 0,
    });
    if (!p.ok)
      return fail(`${def} at ${String(at.x)},${String(at.y)}`, p.reason);
    state = p.state;
    value += priceOf(ctx.content, def, 1);
    return s.id;
  };
  const link = (
    from: number,
    to: number,
    toSide: Side,
    cells: readonly Point[] = [],
  ): void => {
    const r = addConduit(state, ctx.content, {
      actor: 0,
      from: { building: from, side: 'north' },
      to: { building: to, side: toSide },
      cells,
    });
    if (!r.ok) fail('conduit', r.reason);
    else state = r.state;
  };
  const south = put('bld_extractor', SOUTH_NODE);
  const west = put('bld_extractor', WEST_NODE);
  const main = put(spec.main, MAIN);
  link(south, main, 'south');
  if (spec.side !== null) {
    link(west, put(spec.side, SIDE), 'south');
  } else {
    link(west, main, 'west', [
      { x: WEST_NODE.x, y: WEST_NODE.y + 1 },
      { x: WEST_NODE.x + 1, y: WEST_NODE.y + 1 },
    ]);
  }
  if (spec.next !== null) {
    const next = put(spec.next, NEXT);
    const r = addConduit(state, ctx.content, {
      actor: 0,
      from: { building: main, side: 'north' },
      to: { building: next, side: 'south' },
      cells: [],
    });
    if (!r.ok) fail('refinery output', r.reason);
    else state = r.state;
  }
  return { spec, team: state, plotValue: value };
}

/** What one battle (or passive run) gave, by unit definition. */
interface Counts {
  spawned: Map<string, number>;
  firstSpawn: Map<string, number>;
  produced: Map<string, number>;
  /** Damage the party's units dealt, by attacker definition (units, buildings, Cores, splash). */
  dealt: Map<string, number>;
  splashDealt: Map<string, number>;
  splashCasts: Map<string, number>;
  splashHit: Map<string, number>;
  /** Damage the party's units took (after armor) and raw (before armor), by definition. */
  taken: Map<string, number>;
  raw: Map<string, number>;
  lifeTicks: Map<string, number>;
  died: Map<string, number>;
  coreDamage: number;
  ticks: number;
  won: boolean;
}

function fresh(): Counts {
  return {
    spawned: new Map(),
    firstSpawn: new Map(),
    produced: new Map(),
    dealt: new Map(),
    splashDealt: new Map(),
    splashCasts: new Map(),
    splashHit: new Map(),
    taken: new Map(),
    raw: new Map(),
    lifeTicks: new Map(),
    died: new Map(),
    coreDamage: 0,
    ticks: 0,
    won: false,
  };
}

function add(m: Map<string, number>, k: string, v: number): void {
  m.set(k, (m.get(k) ?? 0) + v);
}

/** Tally the events of one battle, from the point of view of side 0. */
function tally(
  ctx: SimContext,
  events: readonly ArenaEvent[],
  endTick: number,
): Counts {
  const c = fresh();
  c.ticks = endTick;
  const defOf = new Map<number, string>();
  const sideOf = new Map<number, number>();
  const born = new Map<number, number>();
  const overload = ctx.sim.overloadStartTick;
  for (const e of events) {
    switch (e.type) {
      case 'unit_spawned':
        defOf.set(e.unit, e.def);
        sideOf.set(e.unit, e.side);
        born.set(e.unit, e.tick);
        if (e.side === 0) {
          add(c.spawned, e.def, 1);
          if (!c.firstSpawn.has(e.def)) c.firstSpawn.set(e.def, e.tick);
        }
        break;
      case 'produced':
        add(c.produced, e.resource, 1);
        break;
      case 'unit_died': {
        const d = defOf.get(e.unit);
        if (d !== undefined && sideOf.get(e.unit) === 0) {
          add(c.died, d, 1);
          add(c.lifeTicks, d, e.tick - (born.get(e.unit) ?? e.tick));
        }
        break;
      }
      case 'unit_attacked': {
        const a = defOf.get(e.unit);
        const side = sideOf.get(e.unit);
        if (a === undefined) break;
        if (side === 0) add(c.dealt, a, e.damage);
        if (e.target.kind === 'core' && e.target.side === 0 && side !== 0) {
          c.coreDamage += e.damage;
        }
        if (e.target.kind === 'unit' && side !== 0) {
          const t = defOf.get(e.target.unit);
          if (t !== undefined && sideOf.get(e.target.unit) === 0) {
            add(c.taken, t, e.damage);
            // The hit before armor; Overload scaling is not undone, so only
            // hits before Overload count for the "raw" side.
            if (e.tick < overload) {
              add(c.raw, t, ctx.content.units.get(a)?.damage ?? e.damage);
            } else {
              add(c.raw, t, e.damage);
            }
          }
        }
        break;
      }
      case 'splash': {
        const a = defOf.get(e.attacker);
        if (a === undefined || sideOf.get(e.attacker) !== 0) {
          for (const t of e.targets) {
            const d = defOf.get(t.unit);
            if (d !== undefined && sideOf.get(t.unit) === 0) {
              add(c.taken, d, t.damage);
              add(c.raw, d, t.damage);
            }
          }
          break;
        }
        add(c.splashCasts, a, 1);
        add(c.splashHit, a, e.targets.length);
        for (const t of e.targets) add(c.splashDealt, a, t.damage);
        break;
      }
      default:
        break;
    }
  }
  return c;
}

function merge(into: Counts, from: Counts): void {
  for (const k of [
    'spawned',
    'produced',
    'dealt',
    'splashDealt',
    'splashCasts',
    'splashHit',
    'taken',
    'raw',
    'lifeTicks',
    'died',
  ] as const) {
    for (const [d, v] of from[k]) add(into[k], d, v);
  }
  for (const [d, t] of from.firstSpawn) {
    const old = into.firstSpawn.get(d);
    if (old === undefined || t < old) into.firstSpawn.set(d, t);
  }
  into.coreDamage += from.coreDamage;
  into.ticks += from.ticks;
}

function passiveCounts(
  ctx: SimContext,
  team: TeamState,
  ticks: number,
): Counts {
  const core = stageCore(ctx);
  let passive = createTeamState(
    generateMap(STAGE_MAP_SEED, 1, ctx.content, ctx.mapgen),
  );
  const c = placeCore(passive, ctx.content, ctx.mapgen, 0, core);
  if (!c.ok) throw new Error(`chains: passive Core: ${c.reason}`);
  passive = c.state;
  const started = startBattle(
    {
      teamA: team,
      teamB: passive,
      seed: 1,
      round: 1,
      sideOptions: [null, { coreHealths: [1_000_000] }],
    },
    ctx.content,
    { sim: ctx.sim, mapgen: ctx.mapgen },
  );
  if (!started.ok) throw new CliError(started.error.message);
  const battle = started.battle;
  while (!battle.isOver() && battle.sim.tick < ticks) battle.step();
  return tally(ctx, battle.eventLog, battle.sim.tick);
}

const TYPES: readonly ThreatTypeName[] = ['easy', 'medium', 'hard'];

interface PveRow {
  wins: number;
  battles: number;
  counts: Counts;
  /** Wins and battles by archetype. */
  byArch: Map<string, { wins: number; battles: number }>;
}

function pveRow(
  ctx: SimContext,
  team: TeamState,
  rounds: readonly number[],
  seeds: number,
): PveRow {
  const row: PveRow = {
    wins: 0,
    battles: 0,
    counts: fresh(),
    byArch: new Map(),
  };
  const regular = ctx.threats.archetypes.filter((a) => !a.bossOnly);
  for (const round of rounds) {
    for (const type of TYPES) {
      for (const arch of regular) {
        for (let seed = 1; seed <= seeds; seed++) {
          const threat = generateThreat(
            { seed, round, type, partySize: 1, archetype: arch.id },
            ctx.content,
            { threats: ctx.threats, mapgen: ctx.mapgen },
          );
          const started = startPveBattle(
            { team, threat, seed, round },
            ctx.content,
            { sim: ctx.sim, mapgen: ctx.mapgen },
          );
          if (!started.ok) throw new CliError(started.error.message);
          const battle = started.battle;
          while (!battle.isOver()) battle.step();
          row.battles++;
          const won = battle.result()?.winner === 0;
          if (won) row.wins++;
          const a = row.byArch.get(arch.id) ?? { wins: 0, battles: 0 };
          a.battles++;
          if (won) a.wins++;
          row.byArch.set(arch.id, a);
          merge(row.counts, tally(ctx, battle.eventLog, battle.sim.tick));
        }
      }
    }
  }
  return row;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

const f1 = (n: number): string => n.toFixed(1);
const f2 = (n: number): string => n.toFixed(2);
const get = (m: Map<string, number>, k: string): number => m.get(k) ?? 0;

export interface ChainsArgs {
  readonly rounds: number;
  readonly seeds: number;
}

/** Passive-run window: before Overload, long enough for a cold start. */
const PASSIVE_WINDOW = 1700;

export function chainsCommand(
  ctx: SimContext,
  args: ChainsArgs,
): CommandOutput {
  const boards = CHAIN_BOARDS.map((s) => buildChainBoard(ctx, s));
  const rounds = Array.from(
    { length: Math.max(0, args.rounds - 2) },
    (_, i) => i + 3,
  );
  const units = [
    'unit_soldier',
    'unit_drone',
    'unit_heavy',
    'unit_golem',
    'unit_caster',
  ];
  const short = (d: string): string => d.replace(/^unit_/, '');
  const lines: string[] = [
    `Chain reference boards: the starting-kit board of the stage map (seed ${String(STAGE_MAP_SEED)}) plus one plot of two tier 1 collectors; passive window ${String(PASSIVE_WINDOW)} ticks; PvE rounds ${String(rounds[0] ?? 0)}..${String(rounds[rounds.length - 1] ?? 0)}, easy/medium/hard, every archetype, ${String(args.seeds)} seed${args.seeds === 1 ? '' : 's'} (1..${String(args.seeds)})`,
    '',
    'Boards:',
    ...boards.map(
      (b) =>
        `  ${pad(b.spec.name, 11)}plot value ${pad(String(b.plotValue), 5)}${b.spec.note}`,
    ),
  ];
  const passive = boards.map((b) => ({
    b,
    c: passiveCounts(ctx, b.team, PASSIVE_WINDOW),
  }));
  lines.push(
    '',
    `Passive run, ${String(PASSIVE_WINDOW)} ticks (units made, first production tick, the plot's raw supply and compound made):`,
    `  ${pad('board', 11)}${units.map((u) => pad(short(u), 14)).join('')}raw items  compound`,
  );
  for (const { b, c } of passive) {
    const raw =
      get(c.produced, 'res_a') +
      get(c.produced, 'res_b') +
      get(c.produced, 'res_c');
    const comp =
      get(c.produced, 'res_ab_refined') + get(c.produced, 'res_bc_refined');
    lines.push(
      `  ${pad(b.spec.name, 11)}${units
        .map((u) => {
          const n = get(c.spawned, u);
          const t = c.firstSpawn.get(u);
          return pad(n === 0 ? '-' : `${String(n)} @${String(t)}`, 14);
        })
        .join('')}${pad(String(raw), 11)}${String(comp)}`,
    );
  }
  lines.push(
    '',
    'Per 1000 plot supply items (raw items the two plot collectors make; units from the passive run; the kit board is subtracted):',
    `  ${pad('board', 11)}${pad('hp', 8)}${pad('damage/s', 10)}units`,
  );
  const baseP = passive[0]?.c;
  for (const { b, c } of passive.slice(1)) {
    if (baseP === undefined) continue;
    const plotRaw = (PASSIVE_WINDOW / 20) * 2;
    let hp = 0;
    let dps = 0;
    const parts: string[] = [];
    for (const u of units) {
      const n = get(c.spawned, u) - get(baseP.spawned, u);
      const def = ctx.content.units.get(u);
      if (def === undefined || n <= 0) continue;
      hp += n * def.health;
      dps +=
        (n * def.damage * ctx.sim.ticksPerSecond) / def.attackCooldownTicks;
      parts.push(`${String(n)} ${short(u)}`);
    }
    lines.push(
      `  ${pad(b.spec.name, 11)}${pad(f1((hp * 1000) / plotRaw), 8)}${pad(f1((dps * 1000) / plotRaw), 10)}${parts.join(', ')}`,
    );
  }
  const rows = boards.map((b) => ({
    b,
    r: pveRow(ctx, b.team, rounds, args.seeds),
  }));
  lines.push(
    '',
    'PvE: wins, Core damage taken per battle, and damage dealt per battle by type (units, buildings and Cores; splash shown apart):',
    `  ${pad('board', 11)}${pad('win %', 8)}${pad('core dmg', 10)}${units.map((u) => pad(short(u), 9)).join('')}`,
  );
  for (const { b, r } of rows) {
    const n = r.battles;
    lines.push(
      `  ${pad(b.spec.name, 11)}${pad(f1((r.wins * 100) / n), 8)}${pad(f1(r.counts.coreDamage / n), 10)}${units
        .map((u) => pad(f1(get(r.counts.dealt, u) / n), 9))
        .join('')}`,
    );
  }
  const rowOf = (name: string): PveRow | undefined =>
    rows.find((x) => x.b.spec.name === name)?.r;
  const baseRow = rowOf('base');
  if (baseRow !== undefined) {
    const lift = (r: PveRow): number =>
      ((r.wins - baseRow.wins) * 100) / r.battles;
    const cut = (r: PveRow): number =>
      (baseRow.counts.coreDamage - r.counts.coreDamage) / r.battles;
    lines.push(
      '',
      'Premium: what the plot adds to the kit board, and the chain against the base buildings on the same collectors (1.30 = 30% more):',
      `  ${pad('pair', 26)}${pad('win pts', 16)}${pad('x win', 8)}${pad('core dmg cut', 20)}x core`,
    );
    for (const [chain, alt] of [
      ['ab_chain', 'ab_base'],
      ['ab_foundry', 'ab_base'],
      ['bc_chain', 'bc_base'],
      ['bc_chain', 'ab_base'],
    ] as const) {
      const c = rowOf(chain);
      const a = rowOf(alt);
      if (c === undefined || a === undefined) continue;
      lines.push(
        `  ${pad(`${chain} / ${alt}`, 26)}${pad(`+${f1(lift(c))} / +${f1(lift(a))}`, 16)}${pad(f2(lift(c) / lift(a)), 8)}${pad(`${f1(cut(c))} / ${f1(cut(a))}`, 20)}${f2(cut(c) / cut(a))}`,
      );
    }
    const archs = [...baseRow.byArch.keys()];
    lines.push(
      '',
      'PvE win % by archetype:',
      `  ${pad('board', 11)}${archs.map((a) => pad(a.replace(/^arch_/, ''), 12)).join('')}`,
    );
    for (const { b, r } of rows) {
      lines.push(
        `  ${pad(b.spec.name, 11)}${archs
          .map((a) => {
            const x = r.byArch.get(a);
            return pad(
              x === undefined ? '-' : f1((x.wins * 100) / x.battles),
              12,
            );
          })
          .join('')}`,
      );
    }
  }
  lines.push(
    '',
    'PvE: units made per battle and mean lifetime (ticks), and the armor check (raw hits taken / hits taken after armor):',
    `  ${pad('board', 11)}${units.map((u) => pad(short(u), 16)).join('')}`,
  );
  for (const { b, r } of rows) {
    const n = r.battles;
    lines.push(
      `  ${pad(b.spec.name, 11)}${units
        .map((u) => {
          const made = get(r.counts.spawned, u);
          if (made === 0) return pad('-', 16);
          const died = get(r.counts.died, u);
          const life = died === 0 ? 0 : get(r.counts.lifeTicks, u) / died;
          const taken = get(r.counts.taken, u);
          const ratio = taken === 0 ? 0 : get(r.counts.raw, u) / taken;
          return pad(
            `${f2(made / n)} L${String(Math.round(life))} x${f2(ratio)}`,
            14,
          );
        })
        .join('')}`,
    );
  }
  const casters = rows.filter(
    (x) => get(x.r.counts.splashCasts, 'unit_caster') > 0,
  );
  if (casters.length > 0) {
    lines.push(
      '',
      'Casters: splash casts, units hit per cast, splash damage per cast and in total per battle:',
    );
    for (const { b, r } of casters) {
      const casts = get(r.counts.splashCasts, 'unit_caster');
      lines.push(
        `  ${pad(b.spec.name, 11)}casts/battle ${f1(casts / r.battles)}, hit/cast ${f2(get(r.counts.splashHit, 'unit_caster') / casts)}, splash dmg/cast ${f1(get(r.counts.splashDealt, 'unit_caster') / casts)}, splash dmg/battle ${f1(get(r.counts.splashDealt, 'unit_caster') / r.battles)}`,
      );
    }
  }
  lines.push('', ...shopChainLines(ctx, 2000));
  return { text: lines.join('\n') };
}

/** The two refining chains: the refinery and the building that uses it. */
const SHOP_CHAINS: readonly (readonly [string, string])[] = [
  ['bld_refinery_ab', 'bld_golem_forge'],
  ['bld_refinery_bc', 'bld_spire'],
];

interface ShopOutcome {
  /** Round in which a whole chain was held (0: not within the last round). */
  readonly round: number;
  readonly gold: number;
  readonly rolls: number;
}

/**
 * One player who commits from round 3: a free roll each shop, `rerolls`
 * re-rolls at most per shop (1 gold each) while no whole chain is held, and
 * every piece of a chain seen is bought (gold for the pieces is not counted).
 * Uses the real offer roll, wall-shape limit included.
 */
function shopTrial(
  ctx: SimContext,
  seed: number,
  rerolls: number,
  lastRound: number,
  budget = Number.POSITIVE_INFINITY,
): ShopOutcome {
  const rng = Rng.fromSeed(seed);
  const have = new Set<string>();
  const complete = (): boolean =>
    SHOP_CHAINS.some(([a, b]) => have.has(a) && have.has(b));
  let gold = 0;
  let rolls = 0;
  for (let round = 3; round <= lastRound; round++) {
    for (let k = 0; k <= rerolls; k++) {
      if (k > 0) {
        if (complete() || gold + ctx.economy.rerollCost > budget) break;
        gold += ctx.economy.rerollCost;
      }
      rolls++;
      for (const o of rollOffers(rng, round, ctx.content, ctx.economy)) {
        if (SHOP_CHAINS.some((c) => c.includes(o.def))) have.add(o.def);
      }
      if (complete()) return { round, gold, rolls };
    }
  }
  return { round: 0, gold, rolls };
}

/** Rolls, gold and the round until a whole chain is held, by re-roll habit. */
export function shopChainLines(ctx: SimContext, trials: number): string[] {
  const total = ctx.economy.offerWeights
    .filter((w) => w.fromRound <= 3 && w.specialist === undefined)
    .reduce((n, w) => n + w.weight, 0);
  const lines = [
    `Shop: a player who commits to a refining chain from round 3 (offer roll of the real shop, ${String(trials)} players, rerollCost ${String(ctx.economy.rerollCost)}, first shop rolls at round 3; weights ${SHOP_CHAINS.map(([a, b]) => `${String(ctx.economy.offerWeights.find((w) => w.def === a)?.weight)}/${String(ctx.economy.offerWeights.find((w) => w.def === b)?.weight)}`).join(' and ')}, total ${String(total)} at round 3, no specialist)`,
    `  ${pad('re-rolls per shop', 22)}${pad('by r6', 8)}${pad('by r8', 8)}${pad('by r10', 8)}${pad('by r12', 8)}${pad('median round', 14)}${pad('mean gold', 11)}mean rolls`,
  ];
  const policies: readonly (readonly [string, number, number])[] = [
    ['0 (never)', 0, 0],
    ['2', 2, Number.POSITIVE_INFINITY],
    ['up to 10 gold in all', 20, 10],
    ['20 (any)', 20, Number.POSITIVE_INFINITY],
  ];
  for (const [label, rr, budget] of policies) {
    const out = Array.from({ length: trials }, (_, i) =>
      shopTrial(ctx, 1000 + i, rr, 12, budget),
    );
    const by = (r: number): string =>
      f1(
        (out.filter((o) => o.round > 0 && o.round <= r).length * 100) / trials,
      );
    const done = out.filter((o) => o.round > 0);
    const rounds = done.map((o) => o.round).sort((a, b) => a - b);
    const med = rounds[Math.floor(rounds.length / 2)];
    const mean = (f: (o: ShopOutcome) => number): string =>
      done.length === 0
        ? '-'
        : f1(done.reduce((n, o) => n + f(o), 0) / done.length);
    lines.push(
      `  ${pad(label, 22)}${pad(by(6), 8)}${pad(by(8), 8)}${pad(by(10), 8)}${pad(by(12), 8)}${pad(String(med ?? '-'), 14)}${pad(
        mean((o) => o.gold),
        11,
      )}${mean((o) => o.rolls)}`,
    );
  }
  lines.push(
    '  (percent of players holding a whole chain by that round; the last two columns are over those who got one by round 12)',
  );
  return lines;
}
