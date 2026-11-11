/**
 * Unit movement and separation (issue #59, step 5 of the battle tick): the
 * desired steps of the units that chose to move, a bounded relaxation of
 * pairwise overlaps, and an acceptance step that keeps the invariant "no two
 * collision circles overlap and no circle intersects solid ground" true at the
 * end of every tick. See docs/rules-reference.md, "Unit geometry" and "One
 * battle tick", step 5.
 *
 * Nothing here is state: the scratch arrays are rebuilt every tick from the
 * unit positions and the decisions, so a restored battle behaves the same.
 * The uniform grids used to find neighbours are an implementation detail: any
 * exact neighbour search gives the same result.
 */

import {
  awayDivSmall,
  fits,
  isqrtFloorSmall,
  pushOutSolid,
  truncDivSmall,
  type World,
} from './geometry.js';
import { isqrtCeil } from './int.js';

/**
 * The direction (+1 or -1, in arena coordinates) in which unit `u` is pushed
 * along the separation axis when its centre coincides with that of `other`:
 * towards positive in the frame of `u`'s own side if `u` has the higher id,
 * negative if the lower, and the frame of side 1 is the arena rotated by half
 * a turn (both axes negated). The separation axis itself (x when the sum of
 * the two ids is even, y when odd) is the same in both frames. Decided by the
 * ids and the pushed unit's own frame only, so a mirrored battle stays
 * symmetric.
 */
function coincidentSign(u: MotionUnit, other: MotionUnit): number {
  const frame = u.side === 0 ? 1 : -1;
  return u.id > other.id ? frame : -frame;
}

/** The positions of the units of a battle, as the motion step sees them. */
export interface MotionUnit {
  readonly id: number;
  readonly side: number;
  px: number;
  py: number;
}

/** Reusable arrays (grown on demand, never part of a result). */
export class MotionScratch {
  private cap = 0;
  private gridCap = 0;
  /** Per unit: 1 if the unit chose to move this tick. */
  want = new Uint8Array(0);
  /** Per unit: the target point of the move. */
  tx = new Int32Array(0);
  ty = new Int32Array(0);
  /** Per unit: the speed, sub-cell units per tick. */
  speed = new Int32Array(0);
  /** Per unit: the collision radius. */
  rad = new Int32Array(0);
  /** Previous positions (start of the tick) and tentative positions. */
  private ox = new Int32Array(0);
  private oy = new Int32Array(0);
  private cx = new Int32Array(0);
  private cy = new Int32Array(0);
  private ax = new Int32Array(0);
  private ay = new Int32Array(0);
  /** 1 while a mover is looked at in the current relaxation pass. */
  private active = new Uint8Array(0);
  private mover = new Uint8Array(0);
  /** 1: the mover ends at its tentative position; 0: at its previous one. */
  private accepted = new Uint8Array(0);
  /** 1 while a unit belongs to the group of equal priority being decided. */
  private inGroup = new Uint8Array(0);
  /** Scratch: members of a run whose acceptance is revoked. */
  private clashList = new Int32Array(0);
  /** Order of the dirty movers: smaller `prio` first, then lower index. */
  private readonly byPriority = (a: number, b: number): number => {
    const d = (this.prio[a] ?? 0) - (this.prio[b] ?? 0);
    return d !== 0 ? d : a - b;
  };
  /** Per mover: squared distance from its tentative position to its target. */
  private prio = new Float64Array(0);
  private order = new Int32Array(0);
  private next = new Int32Array(0);
  private nextP = new Int32Array(0);
  /** Grid of tentative positions (all units) and of previous ones (movers). */
  private heads = new Int32Array(0);
  private headsP = new Int32Array(0);
  /** Grid cells that saw a unit arrive or leave in the last relaxation pass. */
  private dirtyCell = new Uint8Array(0);
  private dirtyList = new Int32Array(0);
  private dirtyCount = 0;
  private gsize = 1;
  private gw = 1;
  private gh = 1;
  readonly tmp = new Int32Array(2);
  /**
   * Test hook: look at every mover in every relaxation pass (the plain
   * algorithm). The result must be the same either way.
   */
  everyMover = false;

  /** Make room for `n` units (contents of the input arrays are kept). */
  ensure(n: number): void {
    if (n <= this.cap) return;
    const cap = Math.max(n, 2 * this.cap, 64);
    const u8 = (a: Uint8Array): Uint8Array<ArrayBuffer> => {
      const b = new Uint8Array(cap);
      b.set(a);
      return b;
    };
    const i32 = (a: Int32Array): Int32Array<ArrayBuffer> => {
      const b = new Int32Array(cap);
      b.set(a);
      return b;
    };
    const f64 = new Float64Array(cap);
    f64.set(this.prio);
    this.cap = cap;
    this.want = u8(this.want);
    this.tx = i32(this.tx);
    this.ty = i32(this.ty);
    this.speed = i32(this.speed);
    this.rad = i32(this.rad);
    this.ox = i32(this.ox);
    this.oy = i32(this.oy);
    this.cx = i32(this.cx);
    this.cy = i32(this.cy);
    this.ax = i32(this.ax);
    this.ay = i32(this.ay);
    this.active = u8(this.active);
    this.mover = u8(this.mover);
    this.accepted = u8(this.accepted);
    this.inGroup = u8(this.inGroup);
    this.prio = f64;
    this.order = i32(this.order);
    this.clashList = i32(this.clashList);
    this.next = i32(this.next);
    this.nextP = i32(this.nextP);
  }

  /**
   * Resolve the moves of `units` (ascending id): `want`, `tx`, `ty`, `speed`
   * and `rad` must be filled for indices `0 .. n - 1`. Writes the new `px,
   * py` of the units.
   */
  resolve(
    units: readonly MotionUnit[],
    world: World,
    passes: number,
    maxRadius: number,
  ): void {
    const n = units.length;
    this.ensure(n);
    const { ox, oy, cx, cy, ax, ay, mover, accepted, rad, tmp, prio, active } =
      this;

    // The grid: cells of side 2 * maxRadius (at least), so a pair that
    // overlaps is in adjacent cells.
    const gsize = Math.max(1, 2 * maxRadius);
    const gw = Math.floor((world.width * 240) / gsize) + 1;
    const gh = Math.floor((world.height * 240) / gsize) + 1;
    this.gsize = gsize;
    this.gw = gw;
    this.gh = gh;
    if (gw * gh > this.gridCap) {
      this.gridCap = gw * gh;
      this.heads = new Int32Array(this.gridCap).fill(-1);
      this.headsP = new Int32Array(this.gridCap).fill(-1);
      this.dirtyCell = new Uint8Array(this.gridCap);
    }
    if (this.dirtyList.length < 2 * n) {
      this.dirtyList = new Int32Array(
        Math.max(2 * n, 2 * this.dirtyList.length),
      );
    }
    this.dirtyCount = 0;

    // 1. Desire: tentative positions.
    let anyMover = false;
    for (let i = 0; i < n; i++) {
      const u = units[i];
      if (u === undefined) continue;
      ox[i] = cx[i] = u.px;
      oy[i] = cy[i] = u.py;
      mover[i] = 0;
      accepted[i] = 0;
      if (this.want[i] !== 1) continue;
      const dx = (this.tx[i] ?? 0) - u.px;
      const dy = (this.ty[i] ?? 0) - u.py;
      const s = this.speed[i] ?? 0;
      let vx = dx;
      let vy = dy;
      if (dx * dx + dy * dy > s * s) {
        const len = isqrtCeil(dx * dx + dy * dy);
        vx = truncDivSmall(dx * s, len);
        vy = truncDivSmall(dy * s, len);
      }
      if (vx === 0 && vy === 0) continue;
      mover[i] = 1;
      anyMover = true;
      pushOutSolid(world, u.side, rad[i] ?? 0, u.px + vx, u.py + vy, tmp);
      cx[i] = tmp[0] ?? 0;
      cy[i] = tmp[1] ?? 0;
      const rx = (this.tx[i] ?? 0) - (cx[i] ?? 0);
      const ry = (this.ty[i] ?? 0) - (cy[i] ?? 0);
      prio[i] = rx * rx + ry * ry;
    }
    if (!anyMover) return;

    // 2. Relaxation. Pass 1 looks at every mover. A later pass only needs the
    // movers that can see something new: one whose own cell neighbourhood
    // (3 x 3 grid cells, wide enough to hold every circle that can overlap
    // it) contains the old or the new position of a unit that moved in the
    // previous pass. Any other mover has exactly the inputs it had before, so
    // it gets exactly the push it got then, which did not move it (it did not
    // move, or its push was zero or blocked by solid ground): leaving it out
    // changes nothing. The pairs of an active mover are all looked at, a pair
    // of two active movers once (from the lower index); an inactive mover only
    // takes part through the active ones and is never moved.
    for (let pass = 0; pass < passes; pass++) {
      this.buildGrid(n);
      ax.fill(0, 0, n);
      ay.fill(0, 0, n);
      let any = false;
      let nActive = 0;
      for (let i = 0; i < n; i++) {
        if (mover[i] !== 1) {
          active[i] = 0;
          continue;
        }
        const on =
          pass === 0 ||
          this.everyMover ||
          this.sawChange(cx[i] ?? 0, cy[i] ?? 0);
        active[i] = on ? 1 : 0;
        if (on) nActive += 1;
      }
      if (pass > 0) this.clearDirty();
      if (nActive === 0) {
        this.clearGrid(n);
        break;
      }
      for (let i = 0; i < n; i++) {
        if (active[i] !== 1) continue;
        const ui = units[i];
        if (ui === undefined) continue;
        const xi = cx[i] ?? 0;
        const yi = cy[i] ?? 0;
        const gx = Math.floor(xi / gsize);
        const gy = Math.floor(yi / gsize);
        const x0 = gx > 0 ? gx - 1 : 0;
        const x1 = gx + 1 < gw ? gx + 1 : gw - 1;
        const y0 = gy > 0 ? gy - 1 : 0;
        const y1 = gy + 1 < gh ? gy + 1 : gh - 1;
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            let k = this.heads[y * gw + x] ?? -1;
            while (k !== -1) {
              const mk = mover[k] === 1;
              const uk = units[k];
              // A pair of active movers is handled once, from its lower index.
              if (
                uk !== undefined &&
                k !== i &&
                !(mk && active[k] === 1 && k < i)
              ) {
                // `a` first, `b` second: for two movers the lower index is `a`.
                const swap = mk && k < i;
                const a = swap ? k : i;
                const b = swap ? i : k;
                const ua = swap ? uk : ui;
                const ub = swap ? ui : uk;
                const mb = swap || mk;
                const dx = (cx[b] ?? 0) - (cx[a] ?? 0);
                const dy = (cy[b] ?? 0) - (cy[a] ?? 0);
                const d2 = dx * dx + dy * dy;
                const r = (rad[a] ?? 0) + (rad[b] ?? 0);
                if (d2 < r * r) {
                  any = true;
                  const parity = (ua.id + ub.id) % 2 === 0;
                  if (mb && (prio[a] ?? 0) === (prio[b] ?? 0)) {
                    // Two movers equally far from their targets share the
                    // push (their sides do not decide, which keeps a
                    // mirrored battle symmetric).
                    if (d2 > 0) {
                      const d = isqrtFloorSmall(d2);
                      const o = r - d;
                      const hx = awayDivSmall(dx * o, 2 * d);
                      const hy = awayDivSmall(dy * o, 2 * d);
                      ax[b] = (ax[b] ?? 0) + hx;
                      ay[b] = (ay[b] ?? 0) + hy;
                      ax[a] = (ax[a] ?? 0) - hx;
                      ay[a] = (ay[a] ?? 0) - hy;
                    } else {
                      // Coinciding centres: each is pushed half the sum
                      // along the axis, in its own frame (`coincidentSign`).
                      const half = Math.ceil(r / 2);
                      const sa = coincidentSign(ua, ub) * half;
                      const sb = coincidentSign(ub, ua) * half;
                      if (parity) {
                        ax[a] = (ax[a] ?? 0) + sa;
                        ax[b] = (ax[b] ?? 0) + sb;
                      } else {
                        ay[a] = (ay[a] ?? 0) + sa;
                        ay[b] = (ay[b] ?? 0) + sb;
                      }
                    }
                  } else {
                    // The loser takes the whole push: the only mover, or of
                    // two movers the one farther from its target.
                    const aLoses = !mb || (prio[a] ?? 0) > (prio[b] ?? 0);
                    let px: number;
                    let py: number;
                    if (d2 > 0) {
                      const d = isqrtFloorSmall(d2);
                      const o = r - d;
                      // Away from the other unit.
                      const sx = aLoses ? -dx : dx;
                      const sy = aLoses ? -dy : dy;
                      px = awayDivSmall(sx * o, d);
                      py = awayDivSmall(sy * o, d);
                    } else {
                      // Coinciding centres: see `coincidentSign`.
                      const sign = aLoses
                        ? coincidentSign(ua, ub)
                        : coincidentSign(ub, ua);
                      px = parity ? sign * r : 0;
                      py = parity ? 0 : sign * r;
                    }
                    const loser = aLoses ? a : b;
                    ax[loser] = (ax[loser] ?? 0) + px;
                    ay[loser] = (ay[loser] ?? 0) + py;
                  }
                }
              }
              k = this.next[k] ?? -1;
            }
          }
        }
      }
      this.clearGrid(n);
      if (!any) break;
      for (let i = 0; i < n; i++) {
        if (active[i] !== 1) continue;
        const px = ax[i] ?? 0;
        const py = ay[i] ?? 0;
        if (px === 0 && py === 0) continue;
        const u = units[i];
        if (u === undefined) continue;
        const x0 = cx[i] ?? 0;
        const y0 = cy[i] ?? 0;
        pushOutSolid(world, u.side, rad[i] ?? 0, x0 + px, y0 + py, tmp);
        const x1 = tmp[0] ?? 0;
        const y1 = tmp[1] ?? 0;
        if (x1 === x0 && y1 === y0) continue;
        cx[i] = x1;
        cy[i] = y1;
        this.markDirty(x0, y0);
        this.markDirty(x1, y1);
      }
    }
    this.clearDirty();

    // 3. Acceptance: a mover ends at its relaxed position `F` or stays at its
    // previous position `p`; an anchored unit stays at `p` (= `F`). Movers
    // whose `F` overlaps nothing that could be there (any unit's `F`, any other
    // mover's `p`) are accepted at once ("clear"); the others ("dirty") are
    // decided nearest to the target first, a run of equal priority together.
    //
    // Why no two circles overlap and none touches blocked ground afterwards,
    // for every input and whatever the array order (given that every `p` fits
    // and no two `p`s overlap at the start of the tick):
    // 1. Ground: a unit at `p` fits; a mover is accepted at `F` only if `F`
    //    fits, which depends on nobody else.
    // 2. Pairs. Take two units a and b. If both end at `p`, they do not
    //    overlap (assumption). Otherwise at least one is a mover that ends at
    //    `F`, say a.
    //    - If a was accepted at once ("clear"): its `F` overlaps no other
    //      unit's `F` and no other mover's `p` (an anchored unit's `F` is its
    //      `p`), so b is fine wherever it ends.
    //    - If a is dirty and b is decided earlier (or is clear or anchored),
    //      a's check covered b's final place (`F_b` if accepted, else `p_b`).
    //      If b is decided in a later run, a was checked against `p_b` (b
    //      was still a mover at `p`), and b, if it ends at `F_b`, is checked
    //      against a's final `F_a`: the pair is covered either way.
    //    - If a and b are in the same run, each was checked against the
    //      other's `p` (never against a tentative `F`, which the clash pass
    //      may still revoke), so (F_a, p_b), (p_a, F_b) and (p_a, p_b) are
    //      fine; the clash pass sends both back to `p` whenever the two `F`s
    //      (accepted or not) overlap, so (F_a, F_b) cannot remain.
    // 3. A revoked acceptance puts the mover at `p`, and everyone who could
    //    meet it there (a later run, its own run) checked against that `p`.
    this.buildGrid(n);
    this.buildPrevGrid(n);
    const order = this.order;
    let dirty = 0;
    for (let i = 0; i < n; i++) {
      if (mover[i] !== 1) continue;
      if (this.clear(i, units, world)) accepted[i] = 1;
      else order[dirty++] = i;
    }
    if (dirty > 1) order.subarray(0, dirty).sort(this.byPriority);
    let q0 = 0;
    while (q0 < dirty) {
      let q1 = q0 + 1;
      const pr = prio[order[q0] ?? 0];
      while (q1 < dirty && prio[order[q1] ?? 0] === pr) q1++;
      for (let q = q0; q < q1; q++) this.inGroup[order[q] ?? 0] = 1;
      for (let q = q0; q < q1; q++) {
        const i = order[q] ?? 0;
        accepted[i] = this.fitsCommitted(i, units, world) ? 1 : 0;
      }
      if (q1 - q0 > 1) {
        // No unit of the run sees the F of another: if two overlap, both stay.
        let nClash = 0;
        for (let q = q0; q < q1; q++) {
          const i = order[q] ?? 0;
          if (accepted[i] === 1 && this.overlapsGroup(i)) {
            this.clashList[nClash++] = i;
          }
        }
        for (let q = 0; q < nClash; q++) accepted[this.clashList[q] ?? 0] = 0;
      }
      for (let q = q0; q < q1; q++) this.inGroup[order[q] ?? 0] = 0;
      q0 = q1;
    }
    this.clearGrid(n);
    this.clearPrevGrid(n);
    for (let i = 0; i < n; i++) {
      if (mover[i] !== 1 || accepted[i] !== 1) continue;
      const u = units[i];
      if (u === undefined) continue;
      u.px = cx[i] ?? u.px;
      u.py = cy[i] ?? u.py;
    }
  }

  /**
   * Whether the F of mover `i` fits and overlaps no other unit's F and no
   * other mover's previous position (so it is safe whatever the others do).
   */
  private clear(
    i: number,
    units: readonly MotionUnit[],
    world: World,
  ): boolean {
    const { cx, cy, ox, oy, rad } = this;
    const u = units[i];
    if (u === undefined) return false;
    const xi = cx[i] ?? 0;
    const yi = cy[i] ?? 0;
    if (!fits(world, u.side, rad[i] ?? 0, xi, yi)) return false;
    const { gsize, gw, gh } = this;
    const gx = Math.floor(xi / gsize);
    const gy = Math.floor(yi / gsize);
    const x0 = gx > 0 ? gx - 1 : 0;
    const x1 = gx + 1 < gw ? gx + 1 : gw - 1;
    const y0 = gy > 0 ? gy - 1 : 0;
    const y1 = gy + 1 < gh ? gy + 1 : gh - 1;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        let j = this.heads[y * gw + x] ?? -1;
        while (j !== -1) {
          if (j !== i) {
            const dx = (cx[j] ?? 0) - xi;
            const dy = (cy[j] ?? 0) - yi;
            const r = (rad[i] ?? 0) + (rad[j] ?? 0);
            if (dx * dx + dy * dy < r * r) return false;
          }
          j = this.next[j] ?? -1;
        }
        j = this.headsP[y * gw + x] ?? -1;
        while (j !== -1) {
          if (j !== i) {
            const dx = (ox[j] ?? 0) - xi;
            const dy = (oy[j] ?? 0) - yi;
            const r = (rad[i] ?? 0) + (rad[j] ?? 0);
            if (dx * dx + dy * dy < r * r) return false;
          }
          j = this.nextP[j] ?? -1;
        }
      }
    }
    return true;
  }

  /**
   * Whether mover `i` may end at its F given the committed positions: every
   * anchored unit and every mover accepted by an earlier run (or at once) at
   * its F, every other mover at its previous position. The members of the run
   * being decided count at their previous position whatever was tentatively
   * decided for them, because the clash pass can still send them back there.
   */
  private fitsCommitted(
    i: number,
    units: readonly MotionUnit[],
    world: World,
  ): boolean {
    const { cx, cy, ox, oy, rad, mover, accepted, inGroup } = this;
    const u = units[i];
    if (u === undefined) return false;
    const xi = cx[i] ?? 0;
    const yi = cy[i] ?? 0;
    if (!fits(world, u.side, rad[i] ?? 0, xi, yi)) return false;
    const { gsize, gw, gh } = this;
    const gx = Math.floor(xi / gsize);
    const gy = Math.floor(yi / gsize);
    const x0 = gx > 0 ? gx - 1 : 0;
    const x1 = gx + 1 < gw ? gx + 1 : gw - 1;
    const y0 = gy > 0 ? gy - 1 : 0;
    const y1 = gy + 1 < gh ? gy + 1 : gh - 1;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        // Units that are at their F: anchored ones and accepted movers.
        let j = this.heads[y * gw + x] ?? -1;
        while (j !== -1) {
          if (
            j !== i &&
            (mover[j] !== 1 || (accepted[j] === 1 && inGroup[j] !== 1))
          ) {
            const dx = (cx[j] ?? 0) - xi;
            const dy = (cy[j] ?? 0) - yi;
            const r = (rad[i] ?? 0) + (rad[j] ?? 0);
            if (dx * dx + dy * dy < r * r) return false;
          }
          j = this.next[j] ?? -1;
        }
        // Movers that are (still) at their previous position.
        j = this.headsP[y * gw + x] ?? -1;
        while (j !== -1) {
          if (j !== i && (accepted[j] !== 1 || inGroup[j] === 1)) {
            const dx = (ox[j] ?? 0) - xi;
            const dy = (oy[j] ?? 0) - yi;
            const r = (rad[i] ?? 0) + (rad[j] ?? 0);
            if (dx * dx + dy * dy < r * r) return false;
          }
          j = this.nextP[j] ?? -1;
        }
      }
    }
    return true;
  }

  /** Whether the F of `i` overlaps the F of another unit of the group being decided. */
  private overlapsGroup(i: number): boolean {
    const { cx, cy, rad, inGroup } = this;
    const xi = cx[i] ?? 0;
    const yi = cy[i] ?? 0;
    const { gsize, gw, gh } = this;
    const gx = Math.floor(xi / gsize);
    const gy = Math.floor(yi / gsize);
    const x0 = gx > 0 ? gx - 1 : 0;
    const x1 = gx + 1 < gw ? gx + 1 : gw - 1;
    const y0 = gy > 0 ? gy - 1 : 0;
    const y1 = gy + 1 < gh ? gy + 1 : gh - 1;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        let j = this.heads[y * gw + x] ?? -1;
        while (j !== -1) {
          if (j !== i && inGroup[j] === 1) {
            const dx = (cx[j] ?? 0) - xi;
            const dy = (cy[j] ?? 0) - yi;
            const r = (rad[i] ?? 0) + (rad[j] ?? 0);
            if (dx * dx + dy * dy < r * r) return true;
          }
          j = this.next[j] ?? -1;
        }
      }
    }
    return false;
  }

  /** Remember that a unit was at or went to the cell of `(x, y)`. */
  private markDirty(x: number, y: number): void {
    const { gsize, gw, gh } = this;
    const gx = Math.floor(x / gsize);
    const gy = Math.floor(y / gsize);
    const k = (gy < gh ? gy : gh - 1) * gw + (gx < gw ? gx : gw - 1);
    if (this.dirtyCell[k] === 1) return;
    this.dirtyCell[k] = 1;
    this.dirtyList[this.dirtyCount++] = k;
  }

  /** Whether the 3 x 3 cells around `(x, y)` saw a unit arrive or leave. */
  private sawChange(x: number, y: number): boolean {
    if (this.dirtyCount === 0) return false;
    const { gsize, gw, gh } = this;
    const gx = Math.floor(x / gsize);
    const gy = Math.floor(y / gsize);
    const x0 = gx > 0 ? gx - 1 : 0;
    const x1 = gx + 1 < gw ? gx + 1 : gw - 1;
    const y0 = gy > 0 ? gy - 1 : 0;
    const y1 = gy + 1 < gh ? gy + 1 : gh - 1;
    for (let y2 = y0; y2 <= y1; y2++) {
      for (let x2 = x0; x2 <= x1; x2++) {
        if (this.dirtyCell[y2 * gw + x2] === 1) return true;
      }
    }
    return false;
  }

  private clearDirty(): void {
    for (let q = 0; q < this.dirtyCount; q++) {
      this.dirtyCell[this.dirtyList[q] ?? 0] = 0;
    }
    this.dirtyCount = 0;
  }

  /** Bucket the previous positions of the movers by grid cell. */
  private buildPrevGrid(n: number): void {
    const { gsize, gw, gh } = this;
    for (let i = 0; i < n; i++) {
      if (this.mover[i] !== 1) continue;
      const gx = Math.floor((this.ox[i] ?? 0) / gsize);
      const gy = Math.floor((this.oy[i] ?? 0) / gsize);
      const k = (gy < gh ? gy : gh - 1) * gw + (gx < gw ? gx : gw - 1);
      this.nextP[i] = this.headsP[k] ?? -1;
      this.headsP[k] = i;
    }
  }

  private clearPrevGrid(n: number): void {
    const { gsize, gw, gh } = this;
    for (let i = 0; i < n; i++) {
      if (this.mover[i] !== 1) continue;
      const gx = Math.floor((this.ox[i] ?? 0) / gsize);
      const gy = Math.floor((this.oy[i] ?? 0) / gsize);
      this.headsP[(gy < gh ? gy : gh - 1) * gw + (gx < gw ? gx : gw - 1)] = -1;
    }
  }

  /** Empty the buckets that `buildGrid` filled (the grid rests all -1). */
  private clearGrid(n: number): void {
    const { gsize, gw, gh } = this;
    for (let i = 0; i < n; i++) {
      const gx = Math.floor((this.cx[i] ?? 0) / gsize);
      const gy = Math.floor((this.cy[i] ?? 0) / gsize);
      this.heads[(gy < gh ? gy : gh - 1) * gw + (gx < gw ? gx : gw - 1)] = -1;
    }
  }

  /** Bucket the tentative positions by grid cell. */
  private buildGrid(n: number): void {
    const { gsize, gw, gh } = this;
    for (let i = 0; i < n; i++) {
      const gx = Math.floor((this.cx[i] ?? 0) / gsize);
      const gy = Math.floor((this.cy[i] ?? 0) / gsize);
      const k = (gy < gh ? gy : gh - 1) * gw + (gx < gw ? gx : gw - 1);
      this.next[i] = this.heads[k] ?? -1;
      this.heads[k] = i;
    }
  }
}
