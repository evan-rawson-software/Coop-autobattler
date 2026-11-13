/**
 * Measurements of the battles of bot runs (issue #145): how battles end, how
 * many reach Overload, how often the party's producers and turrets wait for
 * resources, and what the first lost Core says about the result.
 *
 * The bot's run state keeps only a small detail of each battle, so the tool
 * wraps the run's battle resolver (`recordingDeps`), keeps every battle's
 * input and result, and replays each battle tick by tick afterwards
 * (`measureBattle`). Nothing in core or session changes.
 */
import type { ArenaEvent, Battle, BattleReason, Content } from '@game/core';
import type { Json, RunDeps, RunState } from '@game/session';

export const BATTLE_REASONS: readonly BattleReason[] = [
  'core_destroyed',
  'tiebreak_overkill',
  'tiebreak_building_damage',
  'tiebreak_kills',
  'tiebreak_attacker',
  'time_limit',
];

/** One resolved battle, as the resolver saw it. */
export interface BattleRecord {
  readonly kind: 'pve' | 'pvp';
  readonly round: number;
  readonly partySize: number;
  /** The run state the battle was fought from (the team that fought). */
  readonly state: RunState;
  readonly option: Json | null;
  /** What the resolver returned (stored as `pending.battle`). */
  readonly result: Json;
}

/** Everything measured on one battle. */
export interface BattleMetrics {
  readonly kind: 'pve' | 'pvp';
  readonly round: number;
  readonly partySize: number;
  readonly won: boolean;
  readonly reason: BattleReason;
  readonly endTick: number;
  readonly coresStanding: readonly [number, number];
  /** The tick the battle ended on or after the Overload start. */
  readonly overloaded: boolean;
  /** Party producer-ticks (a living producer on a tick counts once). */
  readonly producerTicks: number;
  /** Producer-ticks spent ready but short of resources. */
  readonly producerWaiting: number;
  /** Units the party's producers made. */
  readonly unitsMade: number;
  /** Units they could have made at top speed: sum of floor(life / interval). */
  readonly unitsTopSpeed: number;
  readonly turretTicks: number;
  readonly turretWaiting: number;
  /** Side of the first Core destroyed (0 party, 1 opponent), or null. */
  readonly firstCoreLost: 0 | 1 | null;
  /** More than one side lost a Core on that first tick. */
  readonly firstCoreTie: boolean;
}

function isRecord(v: unknown): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * The run dependencies with a battle resolver that notes every battle into
 * `sink`. The wrapped resolver gives the same results as the original.
 */
export function recordingDeps(deps: RunDeps, sink: BattleRecord[]): RunDeps {
  const inner = deps.battle;
  return {
    ...deps,
    battle: {
      ...(inner.replay === undefined
        ? {}
        : { replay: inner.replay.bind(inner) }),
      resolve(input) {
        const result = inner.resolve(input);
        sink.push({
          kind: input.kind,
          round: input.state.round,
          partySize: input.state.players.length,
          state: input.state,
          option: input.option,
          result: result as unknown as Json,
        });
        return result;
      },
    },
  };
}

interface Tracked {
  readonly need: number;
  readonly interval: number;
}

/** The party's producers and turrets with their cost and interval. */
function trackedBuildings(
  battle: Battle,
  content: Content,
): { producers: Map<number, Tracked>; turrets: Map<number, Tracked> } {
  const producers = new Map<number, Tracked>();
  const turrets = new Map<number, Tracked>();
  for (const b of battle.sim.teams[0].buildings) {
    const def = content.buildings.get(b.def);
    if (def === undefined) continue;
    if (def.kind === 'unit_producer') {
      const tier = def.tiers[b.tier - 1];
      if (tier !== undefined) {
        producers.set(b.id, {
          need: tier.costPerUnit,
          interval: tier.productionIntervalTicks,
        });
      }
    } else if (def.kind === 'defense' && def.defenseType === 'turret') {
      const tier = def.tiers[b.tier - 1];
      if (tier !== undefined) {
        turrets.set(b.id, { need: tier.costPerShot, interval: 1 });
      }
    }
  }
  return { producers, turrets };
}

/**
 * Run a started battle to its end tick by tick and measure it. Under-supply
 * counts, for each living party producer (and turret) on each tick, whether
 * it was ready to act (cooldown 0) but did not act and did not yet hold its
 * full cost (`progress < costPerUnit`, `charge < costPerShot`): it was waiting
 * for resources. A producer holding a finished unit, one in cooldown and a
 * charged turret without a target do not count.
 */
export function measureBattle(
  battle: Battle,
  content: Content,
  overloadStartTick: number,
  meta: Pick<BattleRecord, 'kind' | 'round' | 'partySize'>,
): BattleMetrics {
  const { producers, turrets } = trackedBuildings(battle, content);
  const life = new Map<number, number>();
  let producerTicks = 0;
  let producerWaiting = 0;
  let turretTicks = 0;
  let turretWaiting = 0;
  let unitsMade = 0;
  while (!battle.isOver()) {
    const sim = battle.sim;
    const readyProducers = new Map<number, boolean>();
    for (const p of sim.producers) {
      if (p.side !== 0 || !producers.has(p.building)) continue;
      readyProducers.set(p.building, p.cooldown === 0);
      life.set(p.building, (life.get(p.building) ?? 0) + 1);
    }
    const readyTurrets = new Map<number, boolean>();
    for (const t of sim.turrets) {
      if (t.side !== 0 || !turrets.has(t.building)) continue;
      readyTurrets.set(t.building, t.cooldown === 0);
    }
    const from = battle.eventLog.length;
    battle.step();
    const acted = new Set<number>();
    const fired = new Set<number>();
    for (let i = from; i < battle.eventLog.length; i++) {
      const e = battle.eventLog[i] as ArenaEvent;
      if (e.type === 'unit_spawned' && e.side === 0) {
        acted.add(e.building);
        if (producers.has(e.building)) unitsMade++;
      } else if (e.type === 'turret_fired' && e.side === 0) {
        fired.add(e.building);
      }
    }
    producerTicks += readyProducers.size;
    for (const p of battle.sim.producers) {
      if (p.side !== 0 || readyProducers.get(p.building) !== true) continue;
      const need = producers.get(p.building)?.need ?? 0;
      if (!acted.has(p.building) && p.progress < need) producerWaiting++;
    }
    turretTicks += readyTurrets.size;
    for (const t of battle.sim.turrets) {
      if (t.side !== 0 || readyTurrets.get(t.building) !== true) continue;
      const need = turrets.get(t.building)?.need ?? 0;
      if (!fired.has(t.building) && t.charge < need) turretWaiting++;
    }
  }
  const result = battle.result();
  if (result === null) throw new Error('battle ended without a result');
  let unitsTopSpeed = 0;
  for (const [id, ticks] of life) {
    const interval = producers.get(id)?.interval ?? 0;
    if (interval > 0) unitsTopSpeed += Math.floor(ticks / interval);
  }
  let firstTick = Number.POSITIVE_INFINITY;
  const firstSides = new Set<number>();
  for (const e of battle.eventLog) {
    if (e.type !== 'core_destroyed') continue;
    if (e.tick < firstTick) {
      firstTick = e.tick;
      firstSides.clear();
    }
    if (e.tick === firstTick) firstSides.add(e.side);
  }
  const [a, b] = battle.summary().sides;
  const only = firstSides.size === 1 ? [...firstSides][0] : undefined;
  return {
    kind: meta.kind,
    round: meta.round,
    partySize: meta.partySize,
    won: result.winner === 0,
    reason: result.reason,
    endTick: result.endTick,
    coresStanding: [a.coresStanding, b.coresStanding],
    overloaded: result.endTick >= overloadStartTick,
    producerTicks,
    producerWaiting,
    unitsMade,
    unitsTopSpeed,
    turretTicks,
    turretWaiting,
    firstCoreLost: only === 0 ? 0 : only === 1 ? 1 : null,
    firstCoreTie: firstSides.size > 1,
  };
}

/** Replay a recorded battle with `deps.battle.replay` and measure it. */
export function measureRecord(
  rec: BattleRecord,
  deps: RunDeps,
  content: Content,
  overloadStartTick: number,
): BattleMetrics {
  const pending = isRecord(rec.state.pending) ? rec.state.pending : {};
  const state: RunState = {
    ...rec.state,
    pending: { ...pending, option: rec.option, battle: rec.result },
  };
  const replayed = deps.battle.replay?.(state);
  if (replayed === undefined || !replayed.ok) {
    throw new Error(
      `cannot replay a battle of round ${String(rec.round)}: ${replayed === undefined ? 'no replay' : replayed.reason}`,
    );
  }
  return measureBattle(replayed.battle, content, overloadStartTick, rec);
}

// ---------------------------------------------------------------------------
// Aggregation and text

function share(part: number, whole: number): string {
  return whole === 0 ? '-' : `${((part * 100) / whole).toFixed(1)}%`;
}

/** Counts of end reasons, in the fixed order, as `reason n (share)`. */
function reasonText(ms: readonly BattleMetrics[]): string {
  if (ms.length === 0) return '-';
  const parts: string[] = [];
  for (const r of BATTLE_REASONS) {
    const n = ms.filter((m) => m.reason === r).length;
    if (n > 0) parts.push(`${r} ${String(n)} (${share(n, ms.length)})`);
  }
  return parts.join(', ');
}

/** The lines added to the report of one strategy (no leading blank). */
export function metricLines(
  ms: readonly BattleMetrics[],
  overloadStartTick: number,
): string[] {
  const pve = ms.filter((m) => m.kind === 'pve');
  const pvp = ms.filter((m) => m.kind === 'pvp');
  const over = (xs: readonly BattleMetrics[]): string =>
    `${share(xs.filter((m) => m.overloaded).length, xs.length)} of ${String(xs.length)}`;
  const sum = (f: (m: BattleMetrics) => number): number =>
    ms.reduce((a, m) => a + f(m), 0);
  const lines = [
    `  End reason, pve (${String(pve.length)} battles): ${reasonText(pve)}`,
    `  End reason, boss/pvp (${String(pvp.length)} battles): ${reasonText(pvp)}`,
    `  Overload share (battle ends at tick ${String(overloadStartTick)} or later): pve ${over(pve)}, boss/pvp ${over(pvp)}, all ${over(ms)}`,
    `  Under-supply (party producers ready but short of resources, share of producer-ticks): barracks-type ${share(
      sum((m) => m.producerWaiting),
      sum((m) => m.producerTicks),
    )} of ${String(sum((m) => m.producerTicks))} ticks; turrets ${share(
      sum((m) => m.turretWaiting),
      sum((m) => m.turretTicks),
    )} of ${String(sum((m) => m.turretTicks))} ticks`,
    `  Units made as a share of top-speed output (one per production interval): ${share(
      sum((m) => m.unitsMade),
      sum((m) => m.unitsTopSpeed),
    )} (${String(sum((m) => m.unitsMade))} of ${String(sum((m) => m.unitsTopSpeed))})`,
  ];
  const multi = ms.filter((m) => m.partySize >= 2);
  if (multi.length === 0) {
    lines.push('  First Core lost: - (needs a party of 2 or more)');
  } else {
    const known = multi.filter((m) => m.firstCoreLost !== null);
    const lostFirst = known.filter((m) => m.firstCoreLost === 0);
    const tookFirst = known.filter((m) => m.firstCoreLost === 1);
    const loserLost = known.filter(
      (m) => (m.firstCoreLost === 0) === !m.won,
    ).length;
    lines.push(
      `  First Core lost (${String(multi.length)} battles of 2+ players; ${String(multi.length - known.length)} with no Core lost or lost on the same tick by both sides): the side that lost a Core first lost the battle ${share(loserLost, known.length)} of ${String(known.length)}; party lost the first Core in ${String(lostFirst.length)} and then lost the battle ${share(lostFirst.filter((m) => !m.won).length, lostFirst.length)}; party took the first Core in ${String(tookFirst.length)} and then won ${share(tookFirst.filter((m) => m.won).length, tookFirst.length)}`,
    );
  }
  return lines;
}
