/**
 * Battle sounds from the arena event log (#450, docs/specs/08-audio.md,
 * AU-33 to AU-38). Playback hands this module the events of the ticks it
 * just passed; the `battleMap` of `content/audio.json` says which cue each
 * event plays. Nothing is added to the simulation and the module keeps no
 * log of its own. Later features add their rows to the map, not to this code.
 *
 * `BattleSounds.passed` never throws and never reads back: audio cannot
 * affect the battle.
 */
import type { AudioConfig, BattleRow } from '@game/audio';
import { getAudioEngine } from './index.js';

/** The part of an arena event the map reads (every `ArenaEvent` fits). */
export interface EventLike {
  readonly type: string;
  readonly tick: number;
}

type Fields = Readonly<Record<string, unknown>>;

function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

/** The side a row's `side` is compared with, or undefined (AU-41). */
function sideOf(e: EventLike): number | undefined {
  const f = e as unknown as Fields;
  if (e.type === 'unit_attacked') {
    const t = f['target'] as Fields | undefined;
    return t !== undefined && t['kind'] !== 'unit' ? num(t['side']) : undefined;
  }
  return num(f['side']);
}

function targetKindOf(e: EventLike): string | undefined {
  if (e.type !== 'unit_attacked') return undefined;
  const t = (e as unknown as Fields)['target'] as Fields | undefined;
  const k = t?.['kind'];
  return typeof k === 'string' ? k : undefined;
}

/** What the map needs from the battle beyond the event itself. */
export interface BattleSoundContext {
  /** Whether a side's Core health is at or below the low mark at `tick`. */
  coreLow(side: 0 | 1, tick: number): boolean;
}

/** The first row of the map that matches the event, if any. */
export function rowFor(
  rows: readonly BattleRow[],
  e: EventLike,
  ctx: BattleSoundContext,
): BattleRow | undefined {
  const side = sideOf(e);
  // Neutral guards (side 2) are not a side of the battle: no sound (AU-41).
  if (side === 2 || num((e as unknown as Fields)['side']) === 2)
    return undefined;
  const level = num((e as unknown as Fields)['level']);
  for (const r of rows) {
    if (r.event !== e.type) continue;
    const w = r.when;
    if (w.side !== undefined && w.side !== side) continue;
    if (w.target !== undefined && w.target !== targetKindOf(e)) continue;
    if (
      w.levelAtLeast !== undefined &&
      !(level !== undefined && level >= w.levelAtLeast)
    )
      continue;
    if (w.coreLow !== undefined) {
      if (side !== 0 && side !== 1) continue;
      if (ctx.coreLow(side, e.tick) !== w.coreLow) continue;
    }
    return r;
  }
  return undefined;
}

/** A cue to play for an event, with what picks the best of a thinned class. */
export interface BattleCue {
  readonly cue: string;
  readonly damage?: number;
  readonly unit?: number;
}

/** The result stinger of a `battle_ended` event (a music cue, #451). */
export function stingerFor(e: EventLike): string | undefined {
  if (e.type !== 'battle_ended') return undefined;
  const w = num((e as unknown as Fields)['winner']);
  return w === 0 ? 'music.win' : w === 1 ? 'music.loss' : undefined;
}

/** The cue of one event, or undefined (pure; the single mapping point). */
export function cueForEvent(
  rows: readonly BattleRow[],
  e: EventLike,
  ctx: BattleSoundContext,
): BattleCue | undefined {
  const row = rowFor(rows, e, ctx);
  if (row === undefined) return undefined;
  const f = e as unknown as Fields;
  const damage = num(f['damage']);
  const unit = num(f['unit']) ?? num(f['attacker']);
  return {
    cue: row.cue,
    ...(damage === undefined ? {} : { damage }),
    ...(unit === undefined ? {} : { unit }),
  };
}

/** Core health per side and tick, from the battle record. */
export interface CoreHealthLine {
  readonly coreMax: readonly [number, number];
  readonly coreHp: readonly [ArrayLike<number>, ArrayLike<number>];
}

/**
 * The low-Core test of AU-36 over the record's health line: a side's total
 * Core health (the shared pool when its Cores are linked) at or below the
 * mark. With several Cores it is the side's total, not the one hit.
 */
export function coreLowOf(
  line: CoreHealthLine,
  lowPercent: number,
): BattleSoundContext {
  return {
    coreLow(side, tick) {
      const max = line.coreMax[side];
      const hp = line.coreHp[side];
      if (max <= 0 || hp.length === 0) return false;
      const at = hp[Math.max(0, Math.min(tick, hp.length - 1))] ?? 0;
      return at * 100 <= max * lowPercent;
    },
  };
}

/** What the engine offers the battle (the `AudioEngine` methods). */
export interface BattlePlayer {
  playCue(id: string): boolean;
  playThinned(
    candidates: readonly BattleCue[],
    windowFactor?: number,
  ): string[];
}

/** The part of `Playback` this module reads. */
export interface PlaybackLike {
  readonly tick: number;
  readonly speed: number;
  readonly finished: boolean;
  readonly endTick: number;
  readonly record: { readonly eventLog: readonly EventLike[] } & CoreHealthLine;
  eventRange(from: number, to: number): readonly [number, number];
}

export class BattleSounds {
  private readonly ctx: BattleSoundContext;

  constructor(
    private readonly config: AudioConfig,
    line: CoreHealthLine,
    private readonly player: () => BattlePlayer | null = getAudioEngine,
  ) {
    this.ctx = coreLowOf(line, config.mix.lowCorePercent);
  }

  /** The speed factor of AU-37 (1 at 1x, 1.33 at 2x, 2 at 4x). */
  factor(speed: number): number {
    return this.config.mix.speedFactor[String(speed)] ?? 1;
  }

  /**
   * Playback moved from tick `from` to its current tick: play the events it
   * passed. A jump of more than `seekJumpTicks`, or `seek`, plays nothing
   * but the result stinger (AU-38).
   */
  passed(pb: PlaybackLike, from: number, seek = false): void {
    try {
      this.play(pb, from, seek);
    } catch {
      // Audio never affects the battle.
    }
  }

  private play(pb: PlaybackLike, from: number, seek: boolean): void {
    const player = this.player();
    if (player === null || pb.tick <= from) return;
    // A finished battle has also passed the events of its last tick.
    const to = pb.finished ? pb.endTick + 1 : pb.tick;
    const [a, b] = pb.eventRange(from, to);
    if (b <= a) return;
    const jump = seek || pb.tick - from > this.config.mix.seekJumpTicks;
    const log = pb.record.eventLog;
    const factor = this.factor(pb.speed);
    const batch: BattleCue[] = [];
    for (let i = a; i < b; i++) {
      const e = log[i];
      if (e === undefined) continue;
      const stinger = stingerFor(e);
      if (stinger !== undefined) {
        player.playCue(stinger);
        continue;
      }
      if (jump) continue;
      const c = cueForEvent(this.config.battleMap, e, this.ctx);
      if (c !== undefined) batch.push(c);
    }
    if (batch.length > 0) player.playThinned(batch, factor);
  }
}
