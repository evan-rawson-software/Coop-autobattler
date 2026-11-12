/**
 * Varied, unequal boards for outcome and front-width measurements (issue #82,
 * owner decision: exact mirror matchups are not a realistic case). The boards
 * are the factories the scripted bot (`playBotRun`) builds with different
 * strategies and seeds, stopped after different rounds; battles pair each
 * board with boards of other strategies and seeds. Pure: loaded input in,
 * numbers out; everything is deterministic.
 */
import {
  addConduit,
  addToStash,
  createTeamState,
  listLegalCorePositions,
  placeCore,
  placeFromStash,
  startBattle,
  type Battle,
  type BattleReason,
  type GameMap,
  type Side,
  type TeamState,
} from '@game/core';
import {
  playBotRun,
  BOT_STRATEGIES,
  type BotStrategyName,
} from '@game/session';
import { botDeps } from './bot-command.js';
import type { SimContext } from './context.js';

const NAMES = ['Ann', 'Bo', 'Cy', 'Di'];
const CELL = 240;

export interface VariedBoard {
  readonly label: string;
  readonly party: number;
  readonly team: TeamState;
}

export interface VariedSpec {
  readonly parties: readonly number[];
  readonly seeds: readonly number[];
  readonly rounds: readonly number[];
  readonly strategies?: readonly BotStrategyName[];
}

/** The boards the bot builds: party size x strategy x seed x round. */
export function variedBoards(
  ctx: SimContext,
  spec: VariedSpec,
): readonly VariedBoard[] {
  const deps = botDeps(ctx);
  const out: VariedBoard[] = [];
  for (const party of spec.parties) {
    for (const strategy of spec.strategies ?? BOT_STRATEGIES) {
      for (const seed of spec.seeds) {
        for (const round of spec.rounds) {
          const r = playBotRun(
            deps,
            {
              runId: `varied-${strategy}-${String(seed)}`,
              runVersion: '0.1',
              seed,
              players: NAMES.slice(0, party),
              host: 0,
            },
            {
              strategy,
              seed,
              rerollCost: ctx.economy.rerollCost,
              maxRounds: round,
            },
          );
          const team = r.state.team;
          if (team.core === null) continue;
          out.push({
            label: `${strategy}/s${String(seed)}/r${String(round)}/p${String(party)}`,
            party,
            team,
          });
        }
      }
    }
  }
  return out;
}

/** A deterministic 32-bit mix (no clock, no random numbers). */
function mix(a: number, b: number, c: number): number {
  let h =
    Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^
    Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x27d4eb2f) ^ c;
  h = Math.imul(h ^ (h >>> 13), 0x165667b1);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * A dense factory on a flat map of `party` plots (24 x 16 cells each): up to
 * 12 modules per plot (extractor, splitter, two barracks), each kept with
 * probability `keepPercent` and given a tier between `tierLow` and `tierHigh`
 * by a fixed mix of `variant`; the Core is the `corePick`-th legal position
 * (modulo the count) after the modules are placed.
 */
export function denseVariant(
  ctx: SimContext,
  party: number,
  variant: number,
  tierLow: number,
  tierHigh: number,
  keepPercent: number,
  corePick: number,
): TeamState {
  const cols = 6 * party;
  const nodes: { x: number; y: number; resource: string }[] = [];
  for (let col = 0; col < cols; col++) {
    for (const y0 of [0, 8])
      nodes.push({ x: col * 4, y: y0, resource: 'res_a' });
  }
  const map: GameMap = {
    width: 24 * party,
    height: 16,
    partySize: party,
    plotWidth: 24,
    features: [],
    nodes: nodes.sort((p, q) => p.y - q.y || p.x - q.x),
  };
  let state = createTeamState(map);
  const fail = (what: string, reason: string): never => {
    throw new Error(`dense variant: ${what}: ${reason}`);
  };
  const put = (
    def: string,
    tier: number,
    x: number,
    y: number,
    rot = 0,
  ): number => {
    const t = def === 'bld_splitter' ? 1 : tier;
    const s = addToStash(state, ctx.content, { def, tier: t, owner: 0 });
    if (!s.ok) return fail(def, s.reason);
    const p = placeFromStash(s.state, ctx.content, {
      id: s.id,
      x,
      y,
      rotation: rot,
    });
    if (!p.ok) return fail(def, p.reason);
    state = p.state;
    return s.id;
  };
  const link = (
    from: number,
    fromSide: Side,
    to: number,
    toSide: Side,
    cells: readonly (readonly [number, number])[] = [],
  ): void => {
    const r = addConduit(state, ctx.content, {
      from: { building: from, side: fromSide },
      to: { building: to, side: toSide },
      cells: cells.map(([x, y]) => ({ x, y })),
    });
    if (!r.ok) return fail('conduit', r.reason);
    state = r.state;
  };
  for (let col = 0; col < cols; col++) {
    for (const [row, y0] of [0, 8].entries()) {
      const h = mix(variant, col, row);
      if (h % 100 >= keepPercent) continue;
      const tier = tierLow + (mix(h, variant, 5) % (tierHigh - tierLow + 1));
      const x0 = col * 4;
      const src = put('bld_extractor', tier, x0, y0);
      const sp = put('bld_splitter', 1, x0, y0 + 3);
      const a = put('bld_barracks', tier, x0, y0 + 4);
      const b = put('bld_barracks', tier, x0 + 2, y0 + 2, 90);
      link(src, 'north', sp, 'south', [
        [x0, y0 + 1],
        [x0, y0 + 2],
      ]);
      link(sp, 'north', a, 'south');
      link(sp, 'east', b, 'west', [[x0 + 1, y0 + 3]]);
    }
  }
  const legal = listLegalCorePositions(state.map, ctx.content, ctx.mapgen);
  for (let t = 0; t < legal.length; t++) {
    const pos = legal[(corePick + t) % legal.length];
    if (pos === undefined) break;
    const c = placeCore(state, ctx.content, ctx.mapgen, pos);
    if (c.ok) return c.state;
  }
  return fail('core', 'no legal position');
}

/** The dense boards: six variants per party size, tiers 1 to 3. */
export function denseBoards(
  ctx: SimContext,
  parties: readonly number[],
): readonly VariedBoard[] {
  const shapes: readonly (readonly [number, number, number, number])[] = [
    [1, 1, 100, 3],
    [1, 2, 70, 11],
    [2, 3, 55, 5],
    [1, 3, 85, 17],
    [3, 3, 100, 29],
    [2, 2, 40, 2],
  ];
  const out: VariedBoard[] = [];
  for (const party of parties) {
    shapes.forEach(([lo, hi, keep, core], v) => {
      out.push({
        label: `dense${String(v)}/t${String(lo)}-${String(hi)}/k${String(keep)}/p${String(party)}`,
        party,
        team: denseVariant(ctx, party, v + 1, lo, hi, keep, core),
      });
    });
  }
  return out;
}

/**
 * Evenly matched boards: the full dense factory of one tier (1, 2 or 3) with
 * the Core in one of three places. Two of them differ only in where the Core
 * is, so the armies are equal but the battle is not a mirror image.
 */
export function matchedBoards(
  ctx: SimContext,
  parties: readonly number[],
): readonly VariedBoard[] {
  const out: VariedBoard[] = [];
  for (const party of parties) {
    for (const tier of [1, 2, 3]) {
      for (const [n, core] of [3, 17, 41].entries()) {
        out.push({
          label: `matched/t${String(tier)}/c${String(n)}/p${String(party)}`,
          party,
          team: denseVariant(ctx, party, 99, tier, tier, 100, core),
        });
      }
    }
  }
  return out;
}

/** Every ordered pair of matched boards of one tier and party size whose Cores differ. */
export function matchedPairs(
  boards: readonly VariedBoard[],
): readonly (readonly [number, number])[] {
  const pairs: [number, number][] = [];
  boards.forEach((a, i) => {
    boards.forEach((b, j) => {
      if (i === j) return;
      const ta = a.label.split('/')[1];
      const tb = b.label.split('/')[1];
      if (ta === tb && a.party === b.party) pairs.push([i, j]);
    });
  });
  return pairs;
}

/**
 * The pairs (attacker index, defender index) of battles on `boards`: each
 * board meets `opponents` others of its own party size, picked by a fixed
 * stride; never itself and never an identical factory.
 */
export function variedPairs(
  boards: readonly VariedBoard[],
  opponents: number,
): readonly (readonly [number, number])[] {
  const pairs: [number, number][] = [];
  for (let i = 0; i < boards.length; i++) {
    const a = boards[i];
    if (a === undefined) continue;
    let tried = 0;
    for (let step = 1; tried < opponents && step <= boards.length; step++) {
      const j = (i + step * 5 + Math.floor(step / 3)) % boards.length;
      const b = boards[j];
      if (b === undefined || j === i || b.party !== a.party) continue;
      if (JSON.stringify(b.team) === JSON.stringify(a.team)) continue;
      pairs.push([i, j]);
      tried++;
    }
  }
  return pairs;
}

export interface Contact {
  /** First tick at which opposing units touch. */
  readonly tick: number;
  /** Per side: distinct columns among the units in the leading band. */
  readonly columns: readonly [number, number];
  /** Per side: units in the leading band. */
  readonly band: readonly [number, number];
}

/** Depth of the leading band, in cells. */
const BAND_CELLS = 8;

/** Whether any opposing pair is in contact (gap at most `reach`). */
function anyContact(battle: Battle, ctx: SimContext): boolean {
  const units = battle.sim.units;
  const buckets = new Map<number, number[]>();
  units.forEach((u, i) => {
    const k = Math.floor(u.px / 480) * 65536 + Math.floor(u.py / 480);
    const l = buckets.get(k);
    if (l === undefined) buckets.set(k, [i]);
    else l.push(i);
  });
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u === undefined) continue;
    const du = ctx.content.units.get(u.def);
    if (du === undefined) continue;
    const gx = Math.floor(u.px / 480);
    const gy = Math.floor(u.py / 480);
    for (let x = gx - 1; x <= gx + 1; x++) {
      for (let y = gy - 1; y <= gy + 1; y++) {
        for (const j of buckets.get(x * 65536 + y) ?? []) {
          const v = units[j];
          if (v === undefined || v.side === u.side || j < i) continue;
          const dv = ctx.content.units.get(v.def);
          if (dv === undefined) continue;
          const r = du.reach + du.radius + dv.radius;
          if ((u.px - v.px) ** 2 + (u.py - v.py) ** 2 <= r * r) return true;
        }
      }
    }
  }
  return false;
}

function contactShape(battle: Battle, height: number): Contact {
  const units = battle.sim.units;
  const columns: [number, number] = [0, 0];
  const band: [number, number] = [0, 0];
  for (const side of [0, 1] as const) {
    const fwd = (py: number): number => (side === 0 ? py : height * CELL - py);
    let top = -1;
    for (const u of units) if (u.side === side) top = Math.max(top, fwd(u.py));
    if (top < 0) continue;
    const cols = new Set<number>();
    let n = 0;
    for (const u of units) {
      if (u.side !== side || fwd(u.py) < top - BAND_CELLS * CELL) continue;
      cols.add(Math.floor(u.px / CELL));
      n++;
    }
    columns[side] = cols.size;
    band[side] = n;
  }
  return { tick: battle.sim.tick, columns, band };
}

export interface VariedBattle {
  readonly a: string;
  readonly b: string;
  readonly winner: number;
  readonly reason: BattleReason;
  readonly ticks: number;
  readonly contact: Contact | null;
  /**
   * Every 10 ticks, for each side with at least 8 units that have left their
   * own board (in the neutral zone or beyond): the number of such units and
   * the distinct columns they stand in, summed over the samples.
   */
  readonly advanced: {
    readonly samples: number;
    readonly units: number;
    readonly columns: number;
  };
}

export function runVaried(
  ctx: SimContext,
  a: VariedBoard,
  b: VariedBoard,
  seed: number,
): VariedBattle {
  const s = startBattle({ teamA: a.team, teamB: b.team, seed }, ctx.content, {
    sim: ctx.sim,
    mapgen: ctx.mapgen,
  });
  if (!s.ok) throw new Error(s.error.message);
  const battle = s.battle;
  const height = battle.ctx.arena.geom.height;
  const boardRows = battle.ctx.arena.geom.boardHeight;
  let contact: Contact | null = null;
  let samples = 0;
  let advUnits = 0;
  let advCols = 0;
  while (!battle.isOver()) {
    battle.step();
    if (battle.sim.tick % 10 === 0) {
      for (const side of [0, 1] as const) {
        const cols = new Set<number>();
        let n = 0;
        for (const u of battle.sim.units) {
          if (u.side !== side) continue;
          const fwd = side === 0 ? u.py : height * CELL - u.py;
          if (fwd <= boardRows * CELL) continue;
          cols.add(Math.floor(u.px / CELL));
          n++;
        }
        if (n < 8) continue;
        samples++;
        advUnits += n;
        advCols += cols.size;
      }
    }
    if (
      contact === null &&
      battle.sim.units.length > 1 &&
      anyContact(battle, ctx)
    ) {
      contact = contactShape(battle, height);
    }
  }
  const r = battle.result();
  if (r === null) throw new Error('battle not over');
  return {
    a: a.label,
    b: b.label,
    winner: r.winner,
    reason: r.reason,
    ticks: r.endTick,
    contact,
    advanced: { samples, units: advUnits, columns: advCols },
  };
}

export interface VariedStats {
  readonly battles: number;
  readonly coreKillShare: number;
  readonly overloadShare: number;
  readonly attackerShare: number;
  readonly meanTicks: number;
  readonly contacts: number;
  /** Mean distinct columns in the leading band at first contact. */
  readonly meanColumns: number;
  /** Mean number of units in the leading band. */
  readonly meanBand: number;
  /** Columns per band unit, as a mean over sides with a band. */
  readonly meanColumnsPerUnit: number;
  /** Advancing units (past their own board) per sample, mean. */
  readonly advancedUnits: number;
  /** Distinct columns they occupy per sample, mean. */
  readonly advancedColumns: number;
  /** Columns per advancing unit (sum over samples / sum over samples). */
  readonly advancedColumnsPerUnit: number;
  readonly reasons: Readonly<Record<string, number>>;
}

export function summariseVaried(rows: readonly VariedBattle[]): VariedStats {
  const n = rows.length;
  const reasons = new Map<string, number>();
  let core = 0;
  let att = 0;
  let ticks = 0;
  let contacts = 0;
  let cols = 0;
  let band = 0;
  let cpu = 0;
  let sides = 0;
  let aSamples = 0;
  let aUnits = 0;
  let aCols = 0;
  for (const r of rows) {
    aSamples += r.advanced.samples;
    aUnits += r.advanced.units;
    aCols += r.advanced.columns;
    reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
    if (r.reason === 'core_destroyed') core++;
    if (r.winner === 0) att++;
    ticks += r.ticks;
    if (r.contact !== null) {
      contacts++;
      for (const s of [0, 1] as const) {
        const nb = r.contact.band[s];
        if (nb < 2) continue;
        sides++;
        cols += r.contact.columns[s];
        band += nb;
        cpu += r.contact.columns[s] / nb;
      }
    }
  }
  const sorted = [...reasons.entries()].sort((p, q) =>
    p[0] < q[0] ? -1 : p[0] > q[0] ? 1 : 0,
  );
  return {
    battles: n,
    coreKillShare: n === 0 ? 0 : core / n,
    overloadShare: n === 0 ? 0 : (n - core) / n,
    attackerShare: n === 0 ? 0 : att / n,
    meanTicks: n === 0 ? 0 : ticks / n,
    contacts,
    meanColumns: sides === 0 ? 0 : cols / sides,
    meanBand: sides === 0 ? 0 : band / sides,
    meanColumnsPerUnit: sides === 0 ? 0 : cpu / sides,
    advancedUnits: aSamples === 0 ? 0 : aUnits / aSamples,
    advancedColumns: aSamples === 0 ? 0 : aCols / aSamples,
    advancedColumnsPerUnit: aUnits === 0 ? 0 : aCols / aUnits,
    reasons: Object.fromEntries(sorted),
  };
}
