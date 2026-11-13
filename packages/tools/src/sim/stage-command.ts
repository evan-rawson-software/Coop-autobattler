/**
 * `pnpm sim stage` (issue #145): five hand-built solo boards, from the
 * starting kit to a full board at tiers 1, 2 and 3, fought against generated
 * PvE threats to see how far each one gets. Built with the ordinary team
 * state operations on the generated map of seed 5. Pure: content in, text out.
 */
import {
  addConduit,
  addToStash,
  createTeamState,
  generateMap,
  generateThreat,
  listLegalCorePositions,
  placeCore,
  placeFromStash,
  startBattle,
  startPveBattle,
  type Content,
  type Side,
  type TeamState,
  type ThreatProfile,
} from '@game/core';
import { CliError, type ThreatTypeName } from './args.js';
import type { CommandOutput } from './commands.js';
import type { SimContext } from './context.js';

export interface StageArgs {
  readonly rounds: number;
  readonly seeds: number;
}

export const STAGE_MAP_SEED = 5;
/** The Core position of the reference boards; used when it is legal. */
const WANTED_CORE = { x: 11, y: 5 };
export const PASSIVE_TICKS = 1000;

export type StageBoardName = 'kit' | 'half' | 'full1' | 'full2' | 'full3';
export const STAGE_BOARDS: readonly StageBoardName[] = [
  'kit',
  'half',
  'full1',
  'full2',
  'full3',
];

interface StageSpec {
  readonly name: StageBoardName;
  readonly tier: number;
  readonly barracks: number;
  readonly turrets: number;
  readonly walls: number;
}

const SPECS: readonly StageSpec[] = [
  { name: 'kit', tier: 1, barracks: 1, turrets: 1, walls: 3 },
  { name: 'half', tier: 1, barracks: 2, turrets: 2, walls: 3 },
  { name: 'full1', tier: 1, barracks: 3, turrets: 3, walls: 7 },
  { name: 'full2', tier: 2, barracks: 3, turrets: 3, walls: 7 },
  { name: 'full3', tier: 3, barracks: 3, turrets: 3, walls: 7 },
];

type Point = readonly [number, number];

/** Ore collector and Barracks (the collector's output meets the Barracks). */
const BARRACKS_SITES: readonly {
  readonly collector: Point;
  readonly barracks: Point;
}[] = [
  { collector: [10, 1], barracks: [9, 2] },
  { collector: [8, 8], barracks: [8, 9] },
  { collector: [21, 4], barracks: [21, 5] },
];

/** Power collector, turret next to the Core and the conduit between them. */
const TURRET_SITES: readonly {
  readonly collector: Point;
  readonly turret: Point;
  readonly path: readonly Point[];
}[] = [
  {
    collector: [19, 5],
    turret: [13, 7],
    path: [
      [19, 6],
      [13, 6],
    ],
  },
  {
    collector: [1, 2],
    turret: [10, 7],
    path: [
      [1, 3],
      [1, 6],
      [10, 6],
    ],
  },
  {
    collector: [23, 6],
    turret: [16, 8],
    path: [
      [23, 7],
      [16, 7],
    ],
  },
];

const WALL_SITES: readonly Point[] = [
  [10, 8],
  [13, 8],
  [9, 8],
  [14, 8],
  [9, 7],
  [14, 7],
  [9, 4],
];

export interface StageBoard {
  readonly name: StageBoardName;
  readonly team: TeamState;
  /** Sum of the shop prices of every placed building. */
  readonly value: number;
  readonly counts: string;
}

/** Where the Core goes: the wanted spot when legal, else the nearest legal one. */
export function stageCore(ctx: SimContext): {
  readonly x: number;
  readonly y: number;
  readonly note: string;
} {
  const map = generateMap(STAGE_MAP_SEED, 1, ctx.content, ctx.mapgen);
  const legal = listLegalCorePositions(map, ctx.content, ctx.mapgen, 0);
  if (legal.some((c) => c.x === WANTED_CORE.x && c.y === WANTED_CORE.y)) {
    return { ...WANTED_CORE, note: 'legal' };
  }
  let best = legal[0];
  let bestD = Number.POSITIVE_INFINITY;
  for (const c of legal) {
    const d = (c.x - WANTED_CORE.x) ** 2 + (c.y - WANTED_CORE.y) ** 2;
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  if (best === undefined) throw new Error('stage: the map has no legal Core');
  return { x: best.x, y: best.y, note: 'nearest legal position' };
}

function priceOf(content: Content, def: string, tier: number): number {
  const d = content.buildings.get(def);
  const t = d?.tiers[tier - 1] as { price?: number } | undefined;
  if (t?.price === undefined) throw new Error(`stage: no price for ${def}`);
  return t.price;
}

export function buildStageBoard(
  ctx: SimContext,
  name: StageBoardName,
): StageBoard {
  const spec = SPECS.find((s) => s.name === name);
  if (spec === undefined) throw new Error(`stage: unknown board ${name}`);
  const core = stageCore(ctx);
  let state = createTeamState(
    generateMap(STAGE_MAP_SEED, 1, ctx.content, ctx.mapgen),
  );
  const fail = (what: string, reason: string): never => {
    throw new Error(`stage board ${name}: ${what}: ${reason}`);
  };
  const c = placeCore(state, ctx.content, ctx.mapgen, 0, core);
  if (!c.ok) fail('core', c.reason);
  else state = c.state;
  let value = 0;
  const put = (def: string, [x, y]: Point): number => {
    const s = addToStash(state, ctx.content, {
      def,
      tier: spec.tier,
      owner: 0,
    });
    if (!s.ok) return fail(def, s.reason);
    const p = placeFromStash(s.state, ctx.content, {
      actor: 0,
      id: s.id,
      x,
      y,
      rotation: 0,
    });
    if (!p.ok) return fail(`${def} at ${String(x)},${String(y)}`, p.reason);
    state = p.state;
    value += priceOf(ctx.content, def, spec.tier);
    return s.id;
  };
  const link = (
    from: number,
    fromSide: Side,
    to: number,
    toSide: Side,
    path: readonly Point[] = [],
  ): void => {
    const cells: { x: number; y: number }[] = [];
    path.forEach((p, i) => {
      const prev = path[i - 1];
      if (prev === undefined) {
        cells.push({ x: p[0], y: p[1] });
        return;
      }
      const dx = Math.sign(p[0] - prev[0]);
      const dy = Math.sign(p[1] - prev[1]);
      for (let x = prev[0] + dx, y = prev[1] + dy; ; x += dx, y += dy) {
        cells.push({ x, y });
        if (x === p[0] && y === p[1]) break;
      }
    });
    const r = addConduit(state, ctx.content, {
      actor: 0,
      from: { building: from, side: fromSide },
      to: { building: to, side: toSide },
      cells,
    });
    if (!r.ok) fail('conduit', r.reason);
    else state = r.state;
  };
  for (const site of TURRET_SITES.slice(0, spec.turrets)) {
    const t = put('bld_turret', site.turret);
    const x = put('bld_extractor', site.collector);
    link(x, 'north', t, 'south', site.path);
  }
  for (const site of BARRACKS_SITES.slice(0, spec.barracks)) {
    const x = put('bld_extractor', site.collector);
    const b = put('bld_barracks', site.barracks);
    link(x, 'north', b, 'south');
  }
  for (const w of WALL_SITES.slice(0, spec.walls)) put('bld_wall', w);
  const collectors = spec.barracks + spec.turrets;
  return {
    name,
    team: state,
    value,
    counts: `${String(collectors)} collectors, ${String(spec.barracks)} Barracks, ${String(spec.turrets)} turret${spec.turrets === 1 ? '' : 's'}, ${String(spec.walls)} walls, tier ${String(spec.tier)}`,
  };
}

/** The checks of the real starting kit against the `kit` board. */
export function kitMatchesContent(ctx: SimContext): boolean {
  const want = new Map<string, number>();
  for (const k of ctx.economy.startingKit) {
    want.set(k.def, (want.get(k.def) ?? 0) + k.count);
  }
  const board = buildStageBoard(ctx, 'kit');
  const have = new Map<string, number>();
  for (const b of board.team.buildings) {
    have.set(b.def, (have.get(b.def) ?? 0) + 1);
  }
  return (
    want.size === have.size &&
    [...want].every(([def, n]) => have.get(def) === n)
  );
}

const TYPES: readonly ThreatTypeName[] = ['easy', 'medium', 'hard', 'boss'];

function threatFor(
  ctx: SimContext,
  type: ThreatTypeName,
  archetype: string,
  round: number,
  seed: number,
): ThreatProfile {
  return generateThreat(
    { seed, round, type, partySize: 1, archetype },
    ctx.content,
    { threats: ctx.threats, mapgen: ctx.mapgen },
  );
}

function wins(
  ctx: SimContext,
  team: TeamState,
  type: ThreatTypeName,
  archetype: string,
  round: number,
  seed: number,
): boolean {
  const threat = threatFor(ctx, type, archetype, round, seed);
  const started = startPveBattle({ team, threat, seed }, ctx.content, {
    sim: ctx.sim,
    mapgen: ctx.mapgen,
  });
  if (!started.ok) throw new CliError(started.error.message);
  const battle = started.battle;
  while (!battle.isOver()) battle.step();
  return battle.result()?.winner === 0;
}

/** Won battles of one board, type and archetype by round (index 0 = round 1). */
interface Tally {
  readonly won: number[];
  readonly total: number[];
}

function lastHalf(t: Tally): number {
  let last = 0;
  t.won.forEach((w, i) => {
    if (w * 2 >= (t.total[i] ?? 0) && (t.total[i] ?? 0) > 0) last = i + 1;
  });
  return last;
}

function lastText(t: Tally): string {
  const last = lastHalf(t);
  return last === t.won.length ? `${String(last)}+` : String(last);
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

/** Soldiers a board makes in `PASSIVE_TICKS` ticks against a passive Core. */
export function soldiersMade(ctx: SimContext, team: TeamState): number {
  const map = team.map;
  let passive = createTeamState(map);
  const core = stageCore(ctx);
  const c = placeCore(passive, ctx.content, ctx.mapgen, 0, core);
  if (!c.ok) throw new Error(`stage: passive Core: ${c.reason}`);
  passive = c.state;
  const started = startBattle(
    {
      teamA: team,
      teamB: passive,
      seed: 1,
      // A Core too strong to fall inside the measurement.
      sideOptions: [null, { coreHealths: [1_000_000] }],
    },
    ctx.content,
    { sim: ctx.sim, mapgen: ctx.mapgen },
  );
  if (!started.ok) throw new CliError(started.error.message);
  const battle = started.battle;
  while (!battle.isOver() && battle.sim.tick < PASSIVE_TICKS) battle.step();
  return battle.eventLog.filter(
    (e) => e.type === 'unit_spawned' && e.side === 0,
  ).length;
}

/** Soldiers per 1000 ticks if every Barracks made one per interval. */
function topSpeed(ctx: SimContext, team: TeamState): number {
  let n = 0;
  for (const b of team.buildings) {
    const def = ctx.content.buildings.get(b.def);
    if (def?.kind !== 'unit_producer') continue;
    const tier = def.tiers[b.tier - 1];
    if (tier !== undefined) {
      n += Math.floor(PASSIVE_TICKS / tier.productionIntervalTicks);
    }
  }
  return n;
}

export function stageCommand(ctx: SimContext, args: StageArgs): CommandOutput {
  const boards = STAGE_BOARDS.map((n) => buildStageBoard(ctx, n));
  const core = stageCore(ctx);
  const regular = ctx.threats.archetypes.filter((a) => !a.bossOnly);
  const bossOnly = ctx.threats.archetypes.filter((a) => a.bossOnly);
  const bosses = bossOnly.length > 0 ? bossOnly : ctx.threats.archetypes;
  const seeds = Array.from({ length: args.seeds }, (_, i) => i + 1);
  const lines = [
    `Stage boards: solo, generated map of seed ${String(STAGE_MAP_SEED)}, Core at (${String(core.x)}, ${String(core.y)}) (${core.note}); rounds 1..${String(args.rounds)}, ${String(args.seeds)} seed${args.seeds === 1 ? '' : 's'} (1..${String(args.seeds)}) per threat`,
    `Starting kit of the content ${kitMatchesContent(ctx) ? 'matches' : 'DIFFERS from'} the kit board`,
    '',
    'Boards (shop value = sum of the shop prices of every building):',
    ...boards.map(
      (b) => `  ${pad(b.name, 7)}value ${pad(String(b.value), 5)}${b.counts}`,
    ),
  ];
  // tally[board][type] and the per-archetype tally of hard.
  const tally = new Map<string, Tally>();
  const key = (b: string, t: string, a = ''): string => `${b}|${t}|${a}`;
  const fresh = (): Tally => ({
    won: new Array<number>(args.rounds).fill(0),
    total: new Array<number>(args.rounds).fill(0),
  });
  for (const b of boards) {
    for (const type of TYPES) {
      const pool = type === 'boss' ? bosses : regular;
      for (const arch of pool) {
        const byArch = fresh();
        tally.set(key(b.name, type, arch.id), byArch);
        for (let round = 1; round <= args.rounds; round++) {
          for (const seed of seeds) {
            const won = wins(ctx, b.team, type, arch.id, round, seed);
            byArch.total[round - 1] = (byArch.total[round - 1] ?? 0) + 1;
            if (won) byArch.won[round - 1] = (byArch.won[round - 1] ?? 0) + 1;
          }
        }
      }
      const all = fresh();
      for (const arch of pool) {
        const t = tally.get(key(b.name, type, arch.id));
        if (t === undefined) continue;
        for (let i = 0; i < args.rounds; i++) {
          all.total[i] = (all.total[i] ?? 0) + (t.total[i] ?? 0);
          all.won[i] = (all.won[i] ?? 0) + (t.won[i] ?? 0);
        }
      }
      tally.set(key(b.name, type), all);
    }
  }
  const get = (b: string, t: string, a = ''): Tally => {
    const v = tally.get(key(b, t, a));
    if (v === undefined) throw new Error('stage: missing tally');
    return v;
  };
  const perType = (type: string): string =>
    type === 'boss'
      ? `${String(bosses.length * args.seeds)} battles per round`
      : `${String(regular.length * args.seeds)} battles per round`;
  lines.push(
    '',
    'Last round in which the board wins at least half of its battles (N+ = every tested round; 0 = none):',
    `  ${pad('board', 7)}${TYPES.map((t) => pad(t, 8)).join('')}`,
    ...boards.map(
      (b) =>
        `  ${pad(b.name, 7)}${TYPES.map((t) => pad(lastText(get(b.name, t)), 8)).join('')}`,
    ),
    `  (easy, medium, hard: ${perType('hard')}, every archetype x ${String(args.seeds)} seed${args.seeds === 1 ? '' : 's'}; boss: ${perType('boss')})`,
    '',
    'Hard, last round won at least half by archetype:',
    `  ${pad('board', 7)}${regular.map((a) => pad(a.id.replace(/^arch_/, ''), 12)).join('')}`,
    ...boards.map(
      (b) =>
        `  ${pad(b.name, 7)}${regular.map((a) => pad(lastText(get(b.name, 'hard', a.id)), 12)).join('')}`,
    ),
  );
  for (const type of TYPES) {
    lines.push(
      '',
      `Win % by round, ${type}:`,
      `  ${pad('board', 7)}${Array.from({ length: args.rounds }, (_, i) => pad(`r${String(i + 1)}`, 5)).join('')}`,
      ...boards.map((b) => {
        const t = get(b.name, type);
        return `  ${pad(b.name, 7)}${t.won.map((w, i) => pad(String(Math.round((w * 100) / (t.total[i] ?? 1))), 5)).join('')}`;
      }),
    );
  }
  lines.push(
    '',
    `Supply check: soldiers made in ${String(PASSIVE_TICKS)} ticks against a passive opponent (a lone Core that cannot fall in that time), and the most the Barracks could make (one per production interval):`,
    `  ${pad('board', 7)}${pad('made', 7)}${pad('top speed', 11)}share`,
    ...boards.map((b) => {
      const made = soldiersMade(ctx, b.team);
      const top = topSpeed(ctx, b.team);
      return `  ${pad(b.name, 7)}${pad(String(made), 7)}${pad(String(top), 11)}${top === 0 ? '-' : `${((made * 100) / top).toFixed(1)}%`}`;
    }),
  );
  return { text: lines.join('\n') };
}
