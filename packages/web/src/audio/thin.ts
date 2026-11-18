/**
 * Thinning (AU-34): streams of events such as attacks play at most one sound
 * per class per window of real time, the most important first. Pure.
 */
import type { ThinClass } from '@game/audio';

export interface ThinCandidate {
  readonly cue: string;
  readonly thin: ThinClass;
  readonly priority: number;
  /** Larger damage wins among equal priorities. */
  readonly damage?: number;
  /** The lowest unit ID wins a remaining tie. */
  readonly unit?: number;
}

/** Best first: priority, then damage, then the lowest unit ID. */
export function compareCandidates(a: ThinCandidate, b: ThinCandidate): number {
  return (
    b.priority - a.priority ||
    (b.damage ?? 0) - (a.damage ?? 0) ||
    (a.unit ?? 0) - (b.unit ?? 0)
  );
}

export class Thinner {
  private readonly last = new Map<ThinClass, number>();

  /** `windows` are milliseconds per class at speed 1. */
  constructor(private readonly windows: Record<ThinClass, number>) {}

  /**
   * The candidates to play now: for each class not inside its window, the
   * best one. `factor` scales the windows with the playback speed (AU-37).
   */
  pick(
    candidates: readonly ThinCandidate[],
    nowMs: number,
    factor = 1,
  ): ThinCandidate[] {
    const best = new Map<ThinClass, ThinCandidate>();
    for (const c of candidates) {
      const cur = best.get(c.thin);
      if (cur === undefined || compareCandidates(c, cur) < 0)
        best.set(c.thin, c);
    }
    const out: ThinCandidate[] = [];
    for (const [cls, c] of best) {
      const last = this.last.get(cls);
      if (last !== undefined && nowMs - last < this.windows[cls] * factor)
        continue;
      this.last.set(cls, nowMs);
      out.push(c);
    }
    return out;
  }

  reset(): void {
    this.last.clear();
  }
}
