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
  private mover = new Uint8Array(0);
  /** 1: the mover ends at its tentative position; 0: at its previous one. */
  private accepted = new Uint8Array(0);
  /** 1 while a unit belongs to the group of equal priority being decided. */
  private inGroup = new Uint8Array(0);
  /** Per mover: squared distance from its tentative position to its target. */
  private prio = new Float64Array(0);
  private order = new Int32Array(0);
  private next = new Int32Array(0);
  private nextP = new Int32Array(0);
  /** Grid of tentative positions (all units) and of previous ones (movers). */
  private heads = new Int32Array(0);
  private headsP = new Int32Array(0);
  private gsize = 1;
  private gw = 1;
  private gh = 1;
  readonly tmp = new Int32Array(2);

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
    this.mover = u8(this.mover);
    this.accepted = u8(this.accepted);
    this.inGroup = u8(this.inGroup);
    this.prio = f64;
    this.order = i32(this.order);
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
    const { ox, oy, cx, cy, ax, ay, mover, accepted, rad, tmp, prio } = this;

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
    }

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

    // 2. Relaxation.
    for (let pass = 0; pass < passes; pass++) {
      this.buildGrid(n);
      ax.fill(0, 0, n);
      ay.fill(0, 0, n);
      let any = false;
      for (let i = 0; i < n; i++) {
        if (mover[i] !== 1) continue;
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
            let j = this.heads[y * gw + x] ?? -1;
            while (j !== -1) {
              const mj = mover[j] === 1;
              const uj = units[j];
              // A pair of movers is handled once, from its lower index.
              if (uj !== undefined && j !== i && (!mj || j > i)) {
                const dx = (cx[j] ?? 0) - xi;
                const dy = (cy[j] ?? 0) - yi;
                const d2 = dx * dx + dy * dy;
                const r = (rad[i] ?? 0) + (rad[j] ?? 0);
                if (d2 < r * r) {
                  any = true;
                  const parity = (ui.id + uj.id) % 2 === 0;
                  if (mj && (prio[i] ?? 0) === (prio[j] ?? 0)) {
                    // Two movers equally far from their targets share the
                    // push (their sides do not decide, which keeps a
                    // mirrored battle symmetric).
                    if (d2 > 0) {
                      const d = isqrtFloorSmall(d2);
                      const o = r - d;
                      const hx = awayDivSmall(dx * o, 2 * d);
                      const hy = awayDivSmall(dy * o, 2 * d);
                      ax[j] = (ax[j] ?? 0) + hx;
                      ay[j] = (ay[j] ?? 0) + hy;
                      ax[i] = (ax[i] ?? 0) - hx;
                      ay[i] = (ay[i] ?? 0) - hy;
                    } else {
                      // Coinciding centres: each is pushed half the sum
                      // along the axis, in its own frame (`coincidentSign`).
                      const half = Math.ceil(r / 2);
                      const si = coincidentSign(ui, uj) * half;
                      const sj = coincidentSign(uj, ui) * half;
                      if (parity) {
                        ax[i] = (ax[i] ?? 0) + si;
                        ax[j] = (ax[j] ?? 0) + sj;
                      } else {
                        ay[i] = (ay[i] ?? 0) + si;
                        ay[j] = (ay[j] ?? 0) + sj;
                      }
                    }
                  } else {
                    // The loser takes the whole push: the only mover, or of
                    // two movers the one farther from its target.
                    const iLoses = !mj || (prio[i] ?? 0) > (prio[j] ?? 0);
                    let px: number;
                    let py: number;
                    const loser = iLoses ? i : j;
                    if (d2 > 0) {
                      const d = isqrtFloorSmall(d2);
                      const o = r - d;
                      // Away from the other unit.
                      const sx = iLoses ? -dx : dx;
                      const sy = iLoses ? -dy : dy;
                      px = awayDivSmall(sx * o, d);
                      py = awayDivSmall(sy * o, d);
                    } else {
                      // Coinciding centres: see `coincidentSign`.
                      const sign = iLoses
                        ? coincidentSign(ui, uj)
                        : coincidentSign(uj, ui);
                      px = parity ? sign * r : 0;
                      py = parity ? 0 : sign * r;
                    }
                    ax[loser] = (ax[loser] ?? 0) + px;
                    ay[loser] = (ay[loser] ?? 0) + py;
                  }
                }
              }
              j = this.next[j] ?? -1;
            }
          }
        }
      }
      this.clearGrid(n);
      if (!any) break;
      for (let i = 0; i < n; i++) {
        if (mover[i] !== 1) continue;
        const px = ax[i] ?? 0;
        const py = ay[i] ?? 0;
        if (px === 0 && py === 0) continue;
        const u = units[i];
        if (u === undefined) continue;
        pushOutSolid(
          world,
          u.side,
          rad[i] ?? 0,
          (cx[i] ?? 0) + px,
          (cy[i] ?? 0) + py,
          tmp,
        );
        cx[i] = tmp[0] ?? 0;
        cy[i] = tmp[1] ?? 0;
      }
    }

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
    if (dirty > 1) {
      order.subarray(0, dirty).sort((a, b) => {
        const d = (prio[a] ?? 0) - (prio[b] ?? 0);
        return d !== 0 ? d : a - b;
      });
    }
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
        const clash: number[] = [];
        for (let q = q0; q < q1; q++) {
          const i = order[q] ?? 0;
          if (accepted[i] === 1 && this.overlapsGroup(i)) clash.push(i);
        }
        for (const i of clash) accepted[i] = 0;
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
