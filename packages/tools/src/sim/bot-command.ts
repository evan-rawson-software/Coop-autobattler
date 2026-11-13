/**
 * `pnpm sim bot`: let the scripted bot (W3-2) play whole runs and report how
 * far each strategy got. Pure: loaded input in, text out. Fails (`failed`)
 * on any rejected intent, crash, or a run that differs when played again
 * with the same seed (`verify`).
 */
import {
  brokenLinks,
  hashJson,
  isBorderEnd,
  type TeamContent,
} from '@game/core';
import {
  createGameDeps,
  playBotRun,
  replayRun,
  type BotRunResult,
  type BotStrategyName,
  type RunDeps,
  type RunState,
} from '@game/session';
import {
  measureRecord,
  metricLines,
  recordingDeps,
  type BattleMetrics,
  type BattleRecord,
} from './bot-metrics.js';
import type { CommandOutput } from './commands.js';
import type { SimContext } from './context.js';

export interface BotCommandArgs {
  readonly strategies: readonly string[];
  readonly count: number;
  readonly seed: number;
  readonly party: number;
  readonly maxRounds: number | null;
  readonly verify: boolean;
}

const NAMES = ['Ann', 'Bo', 'Cy', 'Di'];

/** The fully wired run dependencies for the repository content. */
export function botDeps(ctx: SimContext): RunDeps {
  return createGameDeps(ctx.content, {
    mapgen: ctx.mapgen,
    economy: ctx.economy,
    events: ctx.events,
    threats: ctx.threats,
    sim: ctx.sim,
  });
}

/** Border links that are joined (a sending and a receiving half at a spot). */
export function joinedLinks(state: RunState, content: TeamContent): number {
  const sending = new Set<string>();
  const receiving = new Set<string>();
  for (const c of state.team.conduits) {
    if (isBorderEnd(c.to))
      sending.add(`${String(c.to.border)}:${String(c.to.y)}`);
    if (isBorderEnd(c.from))
      receiving.add(`${String(c.from.border)}:${String(c.from.y)}`);
  }
  let n = 0;
  for (const k of sending) if (receiving.has(k)) n++;
  // A spot with both halves whose link is broken is not joined.
  return n - brokenLinks(state.team, content).length;
}

function meanOf(values: readonly number[]): string {
  if (values.length === 0) return '-';
  const sum = values.reduce((a, b) => a + b, 0);
  return (sum / values.length).toFixed(1);
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function pct(won: number, total: number): string {
  return total === 0 ? '-' : `${String(won)}/${String(total)}`;
}

/** One run: its result, or why it crashed. */
interface Played {
  readonly seed: number;
  readonly result: BotRunResult | null;
  /** Measurements of every battle of the run (empty if it crashed). */
  readonly metrics: readonly BattleMetrics[];
  readonly problems: string[];
}

function depthOf(state: RunState): number {
  return state.outcome?.round ?? state.round;
}

/** How and where a run ended, in words. */
function endingOf(state: RunState): string {
  if (state.step !== 'run_over') {
    return `stopped in round ${String(state.round)} (round limit)`;
  }
  const last = state.history[state.history.length - 1];
  if (state.outcome?.reason === 'abandoned') return 'abandoned';
  if (last?.pvp !== null && last?.pvp !== undefined && !last.pvp.won) {
    return `lost in PvP to ${last.pvp.opponent.label}`;
  }
  return 'out of lives';
}

function playOne(
  deps: RunDeps,
  ctx: SimContext,
  strategy: BotStrategyName,
  seed: number,
  args: BotCommandArgs,
): Played {
  const run = {
    runId: `bot-${strategy}-${String(seed)}`,
    runVersion: '1.0',
    seed,
    players: NAMES.slice(0, args.party),
    host: 0,
  };
  const options = {
    strategy,
    seed,
    rerollCost: ctx.economy.rerollCost,
    ...(args.maxRounds === null ? {} : { maxRounds: args.maxRounds }),
  };
  const problems: string[] = [];
  const records: BattleRecord[] = [];
  try {
    const result = playBotRun(recordingDeps(deps, records), run, options);
    for (const r of result.rejected) {
      problems.push(
        `rejected ${r.intent} (${r.reason}${r.detail === '' ? '' : `: ${r.detail}`}) from player ${String(r.player)} in ${r.step}, round ${String(r.round)}`,
      );
    }
    if (args.verify) {
      const again = playBotRun(botDeps(ctx), run, options);
      if (hashJson(again.state) !== hashJson(result.state)) {
        problems.push('a second play with the same seed gave another run');
      }
      const replayed = replayRun(run, result.state.actionLog, botDeps(ctx));
      if (!replayed.ok) {
        problems.push(`the action log does not replay: ${replayed.reason}`);
      } else if (hashJson(replayed.state) !== hashJson(result.state)) {
        problems.push('replaying the action log gave another state');
      }
    }
    const metrics = records.map((r) =>
      measureRecord(r, deps, ctx.content, ctx.sim.overloadStartTick),
    );
    return { seed, result, metrics, problems };
  } catch (e) {
    problems.push(`crash: ${e instanceof Error ? e.message : String(e)}`);
    return { seed, result: null, metrics: [], problems };
  }
}

export function botCommand(
  ctx: SimContext,
  args: BotCommandArgs,
): CommandOutput & { readonly failed: boolean } {
  const deps = botDeps(ctx);
  const last = args.seed + args.count - 1;
  const lines = [
    `Bot play: ${String(args.strategies.length)} strateg${args.strategies.length === 1 ? 'y' : 'ies'} x ${String(args.count)} run${args.count === 1 ? '' : 's'} (seeds ${String(args.seed)}..${String(last)}), party size ${String(args.party)}${args.maxRounds === null ? '' : `, stop after round ${String(args.maxRounds)}`}${args.verify ? ', verifying replays' : ''}`,
  ];
  let rejected = 0;
  let failedRuns = 0;
  const detail: string[] = [];
  for (const name of args.strategies) {
    const strategy = name as BotStrategyName;
    const runs: Played[] = [];
    for (let i = 0; i < args.count; i++) {
      runs.push(playOne(deps, ctx, strategy, args.seed + i, args));
    }
    const done = runs.filter((r) => r.result !== null);
    const depths = done.map((r) => depthOf((r.result as BotRunResult).state));
    const sum = depths.reduce((a, b) => a + b, 0);
    const mean = depths.length === 0 ? '-' : (sum / depths.length).toFixed(1);
    const nRejected = done.reduce(
      (a, r) => a + (r.result as BotRunResult).rejected.length,
      0,
    );
    rejected += nRejected;
    failedRuns += runs.filter((r) => r.problems.length > 0).length;
    lines.push(
      '',
      `${strategy}: depth reached mean ${mean}, min ${String(depths.length === 0 ? '-' : Math.min(...depths))}, max ${String(depths.length === 0 ? '-' : Math.max(...depths))}; rejected intents ${String(nRejected)}`,
      `  ${pad('round', 7)}${pad('PvE won', 10)}${pad('PvP won', 10)}runs`,
    );
    const maxRound = depths.length === 0 ? 0 : Math.max(...depths);
    for (let round = 1; round <= maxRound; round++) {
      let pveWon = 0;
      let pve = 0;
      let pvpWon = 0;
      let pvp = 0;
      let reached = 0;
      for (const r of done) {
        const rec = (r.result as BotRunResult).state.history.find(
          (h) => h.round === round,
        );
        if (rec === undefined) continue;
        reached++;
        if (rec.pve !== null) {
          pve++;
          if (rec.pve.won) pveWon++;
        }
        if (rec.pvp !== null) {
          pvp++;
          if (rec.pvp.won) pvpWon++;
        }
      }
      lines.push(
        `  ${pad(String(round), 7)}${pad(pct(pveWon, pve), 10)}${pad(pct(pvpWon, pvp), 10)}${String(reached)}`,
      );
    }
    const battles = done.flatMap((r) => r.metrics);
    const links = done.map((r) =>
      joinedLinks((r.result as BotRunResult).state, ctx.content),
    );
    lines.push(
      `  Battle length (ticks) by party size ${String(args.party)}: pve mean ${meanOf(battles.filter((b) => b.kind === 'pve').map((b) => b.endTick))}, pvp mean ${meanOf(battles.filter((b) => b.kind === 'pvp').map((b) => b.endTick))} (${String(battles.length)} battles)`,
      `  Cores standing at the end: party mean ${meanOf(battles.map((b) => b.coresStanding[0]))}, opponent mean ${meanOf(battles.map((b) => b.coresStanding[1]))}`,
      `  Border links joined at the end of the run: mean ${meanOf(links)}`,
      ...metricLines(battles, ctx.sim.overloadStartTick),
      '  Runs:',
    );
    for (const r of runs) {
      if (r.result === null) {
        lines.push(`    seed ${String(r.seed)}: did not finish`);
        continue;
      }
      const s = r.result.state;
      lines.push(
        `    seed ${pad(String(r.seed) + ':', 6)} round ${String(depthOf(s))}, ${endingOf(s)}, ${String(r.result.accepted)} intents, state ${hashJson(s)}`,
      );
    }
    for (const r of runs) {
      for (const p of r.problems) {
        detail.push(`${strategy} seed ${String(r.seed)}: ${p}`);
      }
    }
  }
  lines.push('', `Rejected intents: ${String(rejected)}`);
  if (detail.length > 0) {
    lines.push('Problems:', ...detail.map((d) => `  ${d}`));
  }
  const failed = failedRuns > 0;
  lines.push(failed ? 'FAILED' : 'OK');
  return { text: lines.join('\n'), failed };
}
