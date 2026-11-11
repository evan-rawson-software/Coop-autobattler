/**
 * The playback engine of the battle screen (pure; no DOM).
 *
 * Two things, kept apart on purpose:
 *
 * 1. `simulateRecord` runs the whole battle up front. Its result, summary,
 *    event log and zone are the only source of anything the screen reports
 *    as an outcome.
 * 2. `Playback` re-steps a second instance of the same battle to the current
 *    tick for the pictures (unit positions, flow in conduits, health). It never
 *    decides anything: pausing, speed, skipping and seeking only change how
 *    many ticks that instance has been stepped.
 */

import {
  startBattle,
  startPveBattle,
  type ArenaEvent,
  type ArenaSim,
  type Battle,
  type BattleConfig,
  type BattleError,
  type BattleResult,
  type BattleSummary,
  type HealthSim,
  type NeutralZone,
  type TeamState,
  type UnitSim,
} from '@game/core';
import type { WebContent } from '../content.js';
import type { BattleDescription } from './types.js';

export type PlaybackSpeed = 1 | 2 | 4;
export const SPEEDS: readonly PlaybackSpeed[] = [1, 2, 4];

/** Everything the up-front simulation produces. */
export interface BattleRecord {
  readonly result: BattleResult;
  readonly summary: BattleSummary;
  readonly eventLog: readonly ArenaEvent[];
  readonly zone: NeutralZone;
  /** The two team states at tick 0 (side 0, side 1). */
  readonly initialTeams: readonly [TeamState, TeamState];
  /** Health of every building and Core at tick 0 (the maxima). */
  readonly initialHealth: readonly HealthSim[];
  readonly coreMax: readonly [number, number];
  /** Core health after `t` ticks, for `t` in `0 .. endTick`, per side. */
  readonly coreHp: readonly [Int32Array, Int32Array];
  /**
   * `tickStart[t]` is the index of the first event with `tick >= t`, for
   * `t` in `0 .. endTick + 1`, so events of ticks `a .. b - 1` are the slice
   * `tickStart[a] .. tickStart[b]`.
   */
  readonly tickStart: Int32Array;
  /** Milliseconds the up-front simulation took (measurement only). */
  readonly simMs: number;
}

export type RecordResult =
  | { readonly ok: true; readonly record: BattleRecord }
  | { readonly ok: false; readonly error: BattleError };

type Started =
  | { readonly ok: true; readonly battle: Battle }
  | { readonly ok: false; readonly error: BattleError };

/** Start a fresh instance of a described battle. */
export function startDescribed(
  desc: BattleDescription,
  content: WebContent,
  config: BattleConfig,
): Started {
  return desc.kind === 'versus'
    ? startBattle(desc.input, content, config)
    : startPveBattle(desc.input, content, config);
}

const now = (): number => performance.now();

/** Run a battle to its end and keep what the screen needs. */
export function simulateRecord(
  desc: BattleDescription,
  content: WebContent,
  config: BattleConfig,
): RecordResult {
  const t0 = now();
  const started = startDescribed(desc, content, config);
  if (!started.ok) return started;
  const { battle } = started;
  const sim = battle.sim;
  const initialTeams: readonly [TeamState, TeamState] = [
    sim.teams[0],
    sim.teams[1],
  ];
  const initialHealth = sim.health.map((h) => ({ ...h }));
  const coreAt: number[] = [-1, -1];
  sim.health.forEach((h, i) => {
    if (h.building === 0) coreAt[h.side === 0 ? 0 : 1] = i;
  });
  const hpOf = (side: 0 | 1): number => {
    const i = coreAt[side] ?? -1;
    return i < 0 ? 0 : Math.max(0, sim.health[i]?.hp ?? 0);
  };
  const hp0: number[] = [hpOf(0)];
  const hp1: number[] = [hpOf(1)];
  while (!battle.isOver()) {
    battle.step();
    hp0.push(hpOf(0));
    hp1.push(hpOf(1));
  }
  const result = battle.result();
  if (result === null) throw new Error('Battle ended without a result.');
  const eventLog = battle.eventLog;
  const end = result.endTick;
  const tickStart = new Int32Array(end + 2);
  let j = 0;
  for (let t = 0; t <= end; t++) {
    while (j < eventLog.length && (eventLog[j]?.tick ?? 0) < t) j++;
    tickStart[t] = j;
  }
  tickStart[end + 1] = eventLog.length;
  const summary = battle.summary();
  return {
    ok: true,
    record: {
      result,
      summary,
      eventLog,
      zone: battle.zone,
      initialTeams,
      initialHealth,
      coreMax: [summary.sides[0].coreMaxHealth, summary.sides[1].coreMaxHealth],
      coreHp: [Int32Array.from(hp0), Int32Array.from(hp1)],
      tickStart,
      simMs: now() - t0,
    },
  };
}

/** Most ticks one `advance` call may step (a long frame never freezes). */
const MAX_STEPS_PER_ADVANCE = 40;
/** The longest frame time that counts as real time, in milliseconds. */
const MAX_FRAME_MS = 100;
/** Longest a unit's step between two cells is smoothed over, in ticks. */
const MAX_SMOOTH_TICKS = 6;

export class Playback {
  readonly record: BattleRecord;
  speed: PlaybackSpeed = 1;
  paused = false;
  /** False until `start`: the neutral zone is hidden and nothing runs. */
  started = false;

  private battle: Battle;
  private acc = 0;
  private readonly tps: number;

  // Per unit ID (IDs only grow, so these are indexed directly).
  private seen = new Uint8Array(0);
  private cx = new Float32Array(0);
  private cy = new Float32Array(0);
  private px = new Float32Array(0);
  private py = new Float32Array(0);
  private moveTick = new Int32Array(0);
  private smooth = new Uint8Array(0);

  constructor(
    private readonly desc: BattleDescription,
    private readonly content: WebContent,
    private readonly config: BattleConfig,
    record: BattleRecord,
  ) {
    this.record = record;
    this.tps = config.sim.ticksPerSecond;
    this.battle = this.fresh();
    this.updateTracks();
  }

  private fresh(): Battle {
    const s = startDescribed(this.desc, this.content, this.config);
    if (!s.ok) throw new Error(s.error.message);
    return s.battle;
  }

  /** The simulation state of the visual instance (read only). */
  get sim(): ArenaSim {
    return this.battle.sim;
  }

  /** Ticks completed by the visual instance. */
  get tick(): number {
    return this.battle.sim.tick;
  }

  /** How far into the next tick the picture is, 0 .. 1. */
  get frac(): number {
    return this.acc;
  }

  get endTick(): number {
    return this.record.result.endTick;
  }

  get finished(): boolean {
    return this.battle.isOver();
  }

  /** True once the zone may be shown (playback has begun). */
  get revealed(): boolean {
    return this.started || this.tick > 0;
  }

  /** Begin playing: reveals the neutral zone. */
  start(): void {
    this.started = true;
  }

  setSpeed(speed: PlaybackSpeed): void {
    this.speed = speed;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  /** Step by real time; returns the number of ticks stepped. */
  advance(dtMs: number): number {
    if (!this.started || this.paused || this.finished) return 0;
    const dt = Math.min(Math.max(0, dtMs), MAX_FRAME_MS);
    this.acc += (dt * this.tps * this.speed) / 1000;
    let n = Math.floor(this.acc);
    this.acc -= n;
    if (n > MAX_STEPS_PER_ADVANCE) n = MAX_STEPS_PER_ADVANCE;
    if (n > 0) this.stepTicks(n);
    if (this.battle.isOver()) this.acc = 0;
    return n;
  }

  /** Run to the end. The result is the one of the up-front simulation. */
  skip(): void {
    this.started = true;
    this.stepTicks(Number.POSITIVE_INFINITY);
    this.acc = 0;
  }

  /** Go to `tick` (re-simulating from the start when going back). */
  seekTo(tick: number): void {
    const target = Math.max(0, Math.min(tick, this.endTick));
    if (target < this.tick) this.rewind();
    if (target > 0) this.started = true;
    this.stepTicks(target - this.tick);
    this.acc = 0;
  }

  /** Back to tick 0 with the zone hidden again (Watch again). */
  restart(): void {
    this.rewind();
    this.started = false;
    this.paused = false;
    this.acc = 0;
  }

  private rewind(): void {
    this.battle = this.fresh();
    this.seen = new Uint8Array(0);
    this.updateTracks();
    this.acc = 0;
  }

  private stepTicks(n: number): void {
    if (n <= 0) return;
    const b = this.battle;
    // Positions are tracked after every step during real-time playback and
    // only after the last one when jumping.
    const every = n <= MAX_STEPS_PER_ADVANCE;
    let left = n;
    while (left > 0 && !b.isOver()) {
      b.step();
      left -= 1;
      if (every) this.updateTracks();
    }
    if (!every) this.updateTracks();
  }

  private grow(size: number): void {
    const cap = Math.max(size, this.seen.length * 2, 64);
    const g = <T extends Float32Array | Int32Array | Uint8Array>(
      a: T,
      make: (n: number) => T,
    ): T => {
      const next = make(cap);
      next.set(a);
      return next;
    };
    this.seen = g(this.seen, (n) => new Uint8Array(n));
    this.cx = g(this.cx, (n) => new Float32Array(n));
    this.cy = g(this.cy, (n) => new Float32Array(n));
    this.px = g(this.px, (n) => new Float32Array(n));
    this.py = g(this.py, (n) => new Float32Array(n));
    this.moveTick = g(this.moveTick, (n) => new Int32Array(n));
    this.smooth = g(this.smooth, (n) => new Uint8Array(n));
  }

  private updateTracks(): void {
    const sim = this.battle.sim;
    if (sim.nextUnitId + 1 > this.seen.length) this.grow(sim.nextUnitId + 1);
    const tick = sim.tick;
    for (const u of sim.units) {
      const id = u.id;
      if (this.seen[id] === 0) {
        this.seen[id] = 1;
        this.cx[id] = this.px[id] = u.x;
        this.cy[id] = this.py[id] = u.y;
        this.moveTick[id] = tick;
        const def = this.content.units.get(u.def);
        this.smooth[id] = Math.max(
          1,
          Math.min(MAX_SMOOTH_TICKS, def?.moveCooldownTicks ?? 1),
        );
      } else if (this.cx[id] !== u.x || this.cy[id] !== u.y) {
        this.px[id] = this.cx[id] ?? u.x;
        this.py[id] = this.cy[id] ?? u.y;
        this.cx[id] = u.x;
        this.cy[id] = u.y;
        this.moveTick[id] = tick;
      }
    }
  }

  /**
   * The drawn arena position of a unit: its last step between cells, eased
   * over the ticks the move takes. Writes into `out` (no allocation).
   */
  displayPos(u: UnitSim, out: { x: number; y: number }): void {
    const id = u.id;
    if (this.seen[id] !== 1) {
      out.x = u.x;
      out.y = u.y;
      return;
    }
    const w = this.smooth[id] ?? 1;
    const a = Math.min(
      1,
      (this.battle.sim.tick - (this.moveTick[id] ?? 0) + this.acc) / w,
    );
    out.x =
      (this.px[id] ?? u.x) + ((this.cx[id] ?? u.x) - (this.px[id] ?? u.x)) * a;
    out.y =
      (this.py[id] ?? u.y) + ((this.cy[id] ?? u.y) - (this.py[id] ?? u.y)) * a;
  }

  /** Index range of the events of ticks `from .. to - 1` in the record. */
  eventRange(from: number, to: number): readonly [number, number] {
    const ts = this.record.tickStart;
    const last = ts.length - 1;
    const a = Math.max(0, Math.min(from, last));
    const b = Math.max(a, Math.min(to, last));
    return [ts[a] ?? 0, ts[b] ?? 0];
  }
}
