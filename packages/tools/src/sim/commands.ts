/**
 * The commands of `pnpm sim` as pure functions: loaded input in, text (and the
 * event log, when there is one) out. No file or clock access here.
 */
import {
  generateMap,
  generateThreat,
  hashJson,
  listLegalCorePositions,
  maxThreatRound,
  renderArenaAscii,
  renderMapAscii,
  startBattle,
  startPveBattle,
  threatSummary,
  type ArenaEvent,
  type Battle,
  type BattleError,
  type BattleResult,
  type BattleSummary,
  type StartBattleResult,
  type TeamState,
  type ThreatProfile,
} from '@game/core';
import { CliError, type ThreatArgs } from './args.js';
import type { Board } from './boards.js';
import type { SimContext } from './context.js';

export interface CommandOutput {
  readonly text: string;
  /** The full event log, for `--log`. */
  readonly log?: readonly ArenaEvent[];
}

function errorText(error: BattleError): string {
  return `The battle could not start: ${error.message} (${error.code})`;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

/** `part / whole` as a percentage with one decimal. */
function percent(part: number, whole: number): string {
  return `${((part * 100) / whole).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// map

export function mapCommand(
  ctx: SimContext,
  args: { seed: number; party: number },
): CommandOutput {
  const map = generateMap(args.seed, args.party, ctx.content, ctx.mapgen);
  const cores = listLegalCorePositions(map, ctx.content, ctx.mapgen);
  const lines = [
    `Map: seed ${String(args.seed)}, party size ${String(args.party)}, ${String(map.width)} x ${String(map.height)} cells`,
    renderMapAscii(map, ctx.content),
    `Resource nodes: ${map.nodes.map((n) => `${n.resource}@(${String(n.x)},${String(n.y)})`).join(' ')}`,
    `Legal Core positions: ${String(cores.length)}`,
    `Map hash: ${hashJson(map)}`,
  ];
  return { text: lines.join('\n') };
}

// ---------------------------------------------------------------------------
// battle and pve

/** Evenly spaced samples of the timeline, always including first and last. */
function timelineLines(
  summary: BattleSummary,
  labelA: string,
  labelB: string,
): string[] {
  const all = summary.timeline;
  const wanted = 8;
  const picks: number[] = [];
  if (all.length <= wanted) all.forEach((_, i) => picks.push(i));
  else {
    for (let k = 0; k < wanted; k++) {
      picks.push(Math.floor((k * (all.length - 1)) / (wanted - 1)));
    }
  }
  const lines = [
    `Timeline (units / unit health / buildings):`,
    `  ${pad('tick', 6)}${pad(labelA, 22)}${labelB}`,
  ];
  for (const i of picks) {
    const s = all[i];
    if (s === undefined) continue;
    const f = (t: { units: number; unitHealth: number; buildings: number }) =>
      `${String(t.units)} / ${String(t.unitHealth)} / ${String(t.buildings)}`;
    lines.push(
      `  ${pad(String(s.tick), 6)}${pad(f(s.sides[0]), 22)}${f(s.sides[1])}`,
    );
  }
  return lines;
}

function sideSummaryLines(
  summary: BattleSummary,
  labelA: string,
  labelB: string,
): string[] {
  const row = (label: string, s: BattleSummary['sides'][0]): string =>
    `  ${pad(label, 14)}spawned ${pad(String(s.unitsSpawned), 5)} lost ${pad(String(s.unitsLost), 5)} buildings lost ${pad(String(s.buildingsLost), 4)} core ${String(s.coreHealth)}/${String(s.coreMaxHealth)} ramp steps ${String(s.rampSteps)}`;
  return [
    'Sides:',
    row(`A ${labelA}`.slice(0, 13), summary.sides[0]),
    row(`B ${labelB}`.slice(0, 13), summary.sides[1]),
  ];
}

const REASONS: Readonly<Record<string, string>> = {
  core_destroyed: 'the other Core was destroyed',
  tiebreak_overkill: 'both Cores fell; less overkill damage won',
  tiebreak_building_damage:
    'equal overkill (or equal Core health at the time limit); more damage to enemy buildings won',
  tiebreak_kills:
    'equal overkill and building damage (or the same at the time limit); more enemy units killed won',
  tiebreak_attacker: 'a complete tie on every rung; the attacker (side 0) wins',
  time_limit: 'time limit; more Core health (as a fraction) won',
};

function describeResult(
  result: BattleResult,
  labelA: string,
  labelB: string,
): string {
  const winner = result.winner === 0 ? `A (${labelA})` : `B (${labelB})`;
  return `Result: ${winner} wins at tick ${String(result.endTick)} (${result.reason}: ${REASONS[result.reason] ?? result.reason})`;
}

function finishBattle(
  ctx: SimContext,
  battle: Battle,
  header: string[],
  labelA: string,
  labelB: string,
  ascii: boolean,
): CommandOutput {
  while (!battle.isOver()) battle.step();
  const result = battle.result();
  if (result === null) throw new Error('battle ended without a result');
  const summary = battle.summary();
  const lines = [
    ...header,
    describeResult(result, labelA, labelB),
    `Neutral zone depth: ${String(battle.zone.depth)}`,
    ...sideSummaryLines(summary, labelA, labelB),
    ...timelineLines(summary, `A ${labelA}`, `B ${labelB}`),
  ];
  if (ascii) {
    lines.push('Final arena:', renderArenaAscii(battle.sim, ctx.content));
  }
  lines.push(
    `Event log: ${String(battle.eventLog.length)} events, hash ${hashJson(battle.eventLog)}`,
  );
  return { text: lines.join('\n'), log: battle.eventLog };
}

function started(r: StartBattleResult): Battle {
  if (!r.ok) throw new CliError(errorText(r.error));
  return r.battle;
}

export function battleCommand(
  ctx: SimContext,
  args: { a: Board; b: Board; seed: number; ascii: boolean },
): CommandOutput {
  const battle = started(
    startBattle(
      { teamA: args.a.team, teamB: args.b.team, seed: args.seed },
      ctx.content,
      { sim: ctx.sim, mapgen: ctx.mapgen },
    ),
  );
  return finishBattle(
    ctx,
    battle,
    [
      `Battle: A ${args.a.label} (party) vs B ${args.b.label} (defender), seed ${String(args.seed)}`,
    ],
    args.a.label,
    args.b.label,
    args.ascii,
  );
}

/** Generate the threat of a PvE command; a bad archetype is a `CliError`. */
export function makeThreat(
  ctx: SimContext,
  t: ThreatArgs,
  battleSeed: number,
  partySize: number,
): ThreatProfile {
  const known = ctx.threats.archetypes.map((a) => a.id);
  if (!known.includes(t.archetype)) {
    throw new CliError(
      `Unknown archetype "${t.archetype}". Known: ${known.join(', ')}.`,
    );
  }
  const maxRound = maxThreatRound(ctx.threats);
  if (t.round > maxRound) {
    throw new CliError(
      `--round ${String(t.round)} is above the highest supported round (${String(maxRound)}); later rounds would have the same budget.`,
      2,
    );
  }
  try {
    return generateThreat(
      {
        seed: t.threatSeed ?? battleSeed,
        round: t.round,
        type: t.type,
        partySize,
        archetype: t.archetype,
      },
      ctx.content,
      { threats: ctx.threats, mapgen: ctx.mapgen },
    );
  } catch (e) {
    throw new CliError(
      `Could not generate the threat: ${e instanceof Error ? e.message : 'unknown error'}`,
    );
  }
}

function threatLine(ctx: SimContext, threat: ThreatProfile): string {
  const s = threatSummary(threat, ctx.content);
  return `Threat: ${threat.archetype} ${threat.type} round ${String(threat.round)}: ${String(s.totalUnits)} units in ${String(threat.waves.length)} waves (first at tick ${String(s.firstWaveTick ?? 0)}), strength +${String(threat.unitStrengthPercent)}%, Core ${String(s.coreHealth)}, ${String(s.walls)} walls, ${String(s.turrets)} turrets`;
}

export function pveCommand(
  ctx: SimContext,
  args: { team: Board; threat: ThreatArgs; seed: number; ascii: boolean },
): CommandOutput {
  const threat = makeThreat(
    ctx,
    args.threat,
    args.seed,
    args.team.team.map.partySize,
  );
  const label = `${threat.archetype}/${threat.type}/r${String(threat.round)}`;
  const battle = started(
    startPveBattle(
      { team: args.team.team, threat, seed: args.seed },
      ctx.content,
      {
        sim: ctx.sim,
        mapgen: ctx.mapgen,
      },
    ),
  );
  return finishBattle(
    ctx,
    battle,
    [
      `PvE battle: A ${args.team.label} (party) vs B ${label}, seed ${String(args.seed)}`,
      threatLine(ctx, threat),
    ],
    args.team.label,
    label,
    args.ascii,
  );
}

// ---------------------------------------------------------------------------
// batch

export interface BatchStats {
  readonly count: number;
  readonly aWins: number;
  readonly ticks: readonly number[];
  readonly reasons: ReadonlyMap<string, number>;
}

/** Run `count` battles with seeds `seed .. seed + count - 1`. */
export function runBatch(
  count: number,
  seed: number,
  start: (seed: number) => StartBattleResult,
): BatchStats {
  let aWins = 0;
  const ticks: number[] = [];
  const reasons = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const battle = started(start(seed + i));
    while (!battle.isOver()) battle.step();
    const r = battle.result();
    if (r === null) throw new Error('battle ended without a result');
    if (r.winner === 0) aWins += 1;
    ticks.push(r.endTick);
    reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
  }
  return { count, aWins, ticks, reasons };
}

/** Nearest-rank percentile of a sorted array. */
function rank(sorted: readonly number[], p: number): number {
  const i = Math.max(0, Math.ceil((p * sorted.length) / 100) - 1);
  return sorted[i] ?? 0;
}

export function formatBatch(
  header: string,
  labelA: string,
  labelB: string,
  stats: BatchStats,
): string {
  const sorted = [...stats.ticks].sort((x, y) => x - y);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const bWins = stats.count - stats.aWins;
  const reasons = [...stats.reasons.entries()]
    .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))
    .map(([k, v]) => `${k} ${String(v)}`)
    .join(', ');
  return [
    header,
    `A wins (${labelA}): ${String(stats.aWins)} of ${String(stats.count)} (${percent(stats.aWins, stats.count)})`,
    `B wins (${labelB}): ${String(bWins)} of ${String(stats.count)} (${percent(bWins, stats.count)})`,
    `Battle length in ticks: mean ${(sum / stats.count).toFixed(1)}, min ${String(sorted[0] ?? 0)}, median ${String(rank(sorted, 50))}, p90 ${String(rank(sorted, 90))}, max ${String(sorted[sorted.length - 1] ?? 0)}`,
    `Ended by: ${reasons}`,
  ].join('\n');
}

export function batchCommand(
  ctx: SimContext,
  args: {
    a: Board;
    b: Board | null;
    threat: ThreatArgs | null;
    count: number;
    seed: number;
  },
): CommandOutput {
  const config = { sim: ctx.sim, mapgen: ctx.mapgen };
  const party: TeamState = args.a.team;
  if (args.b !== null) {
    const b = args.b;
    const stats = runBatch(args.count, args.seed, (seed) =>
      startBattle({ teamA: party, teamB: b.team, seed }, ctx.content, config),
    );
    return {
      text: formatBatch(
        `Batch: A ${args.a.label} (party) vs B ${b.label} (defender), ${String(args.count)} battles, seeds ${String(args.seed)}..${String(args.seed + args.count - 1)}`,
        args.a.label,
        b.label,
        stats,
      ),
    };
  }
  if (args.threat === null) throw new Error('batch needs a board or a threat');
  const t = args.threat;
  // The threat is generated once per battle seed unless --threat-seed fixes it.
  const stats = runBatch(args.count, args.seed, (seed) => {
    const threat = makeThreat(ctx, t, seed, party.map.partySize);
    return startPveBattle({ team: party, threat, seed }, ctx.content, config);
  });
  const label = `${t.archetype}/${t.type}/r${String(t.round)}`;
  return {
    text: formatBatch(
      `Batch: A ${args.a.label} (party) vs B ${label}, ${String(args.count)} battles, seeds ${String(args.seed)}..${String(args.seed + args.count - 1)}${t.threatSeed === undefined ? ' (threat seed = battle seed)' : ` (threat seed ${String(t.threatSeed)})`}`,
      args.a.label,
      label,
      stats,
    ),
  };
}
