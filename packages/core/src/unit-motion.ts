/**
 * Unit movement and separation (issue #59, step 5 of the battle tick): the
 * desired steps of the units that chose to move, a bounded relaxation of
 * pairwise overlaps, and a validation fixpoint that keeps the invariant "no
 * two collision circles overlap and no circle intersects solid ground" true
 * at the end of every tick. See docs/rules-reference.md, "Unit geometry" and
 * "One battle tick", step 5.
 *
 * Nothing here is state: the scratch arrays are rebuilt every tick from the
 * unit positions and the decisions, so a restored battle behaves the same.
 * The uniform grid used to find neighbours is an implementation detail: any
 * exact neighbour search gives the same result.
 */

import { fits, pushOutSolid, type World } from './geometry.js';
import { divCeil, isqrtCeil } from './int.js';
import { awayDivSmall, isqrtFloorSmall, truncDivSmall } from './geometry.js';

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
  private ox = new Int32Array(0);
  private oy = new Int32Array(0);
  private cx = new Int32Array(0);
  private cy = new Int32Array(0);
  private ax = new Int32Array(0);
  private ay = new Int32Array(0);
  private mover = new Uint8Array(0);
  private reverted = new Uint8Array(0);
  private stack = new Int32Array(0);
  private next = new Int32Array(0);
  private heads = new Int32Array(0);
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
    this.reverted = u8(this.reverted);
    this.stack = i32(this.stack);
    this.next = i32(this.next);
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
    const { ox, oy, cx, cy, ax, ay, mover, reverted, rad, tmp } = this;

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
    }

    // 1. Desire: tentative positions.
    let anyMover = false;
    for (let i = 0; i < n; i++) {
      const u = units[i];
      if (u === undefined) continue;
      ox[i] = cx[i] = u.px;
      oy[i] = cy[i] = u.py;
      mover[i] = 0;
      reverted[i] = 0;
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
              // A pair of movers is handled once, from its lower index.
              if (j !== i && (!mj || j > i)) {
                const dx = (cx[j] ?? 0) - xi;
                const dy = (cy[j] ?? 0) - yi;
                const d2 = dx * dx + dy * dy;
                const r = (rad[i] ?? 0) + (rad[j] ?? 0);
                if (d2 < r * r) {
                  any = true;
                  let pjx: number;
                  let pjy: number;
                  if (d2 > 0) {
                    const d = isqrtFloorSmall(d2);
                    const o = r - d;
                    const w = mj ? 2 * d : d;
                    pjx = awayDivSmall(dx * o, w);
                    pjy = awayDivSmall(dy * o, w);
                  } else {
                    const uj = units[j];
                    const half = mj ? divCeil(r, 2) : r;
                    const parity =
                      uj !== undefined && (ui.id + uj.id) % 2 === 0;
                    pjx = parity ? half : 0;
                    pjy = parity ? 0 : half;
                  }
                  // (pjx, pjy) is the push on `j` as the second of the pair
                  // (towards +x/+y from `i`). When `j` has the lower list
                  // position (only possible for an anchored `j`), the roles
                  // swap so that the lower position is always pushed
                  // towards negative.
                  if (j > i) {
                    if (mj) {
                      ax[j] = (ax[j] ?? 0) + pjx;
                      ay[j] = (ay[j] ?? 0) + pjy;
                    }
                    ax[i] = (ax[i] ?? 0) - pjx;
                    ay[i] = (ay[i] ?? 0) - pjy;
                  } else {
                    // `j < i`, `j` anchored: `j` is the lower of the pair,
                    // `i` the second. For distinct centres the push on `i`
                    // is the negative of the push computed for `j`.
                    if (d2 > 0) {
                      ax[i] = (ax[i] ?? 0) - pjx;
                      ay[i] = (ay[i] ?? 0) - pjy;
                    } else {
                      ax[i] = (ax[i] ?? 0) + pjx;
                      ay[i] = (ay[i] ?? 0) + pjy;
                    }
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

    // 3. Validation: the least fixed point of "reverted" units.
    this.buildGrid(n);
    let sp = 0;
    const stack = this.stack;
    const mark = (i: number): void => {
      if (reverted[i] === 1) return;
      reverted[i] = 1;
      stack[sp++] = i;
    };
    for (let i = 0; i < n; i++) {
      if (mover[i] !== 1) continue;
      const u = units[i];
      if (u === undefined) continue;
      const xi = cx[i] ?? 0;
      const yi = cy[i] ?? 0;
      let bad = !fits(world, u.side, rad[i] ?? 0, xi, yi);
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
              if (dx * dx + dy * dy < r * r) {
                bad = true;
                if (mover[j] === 1) mark(j);
              }
            }
            j = this.next[j] ?? -1;
          }
        }
      }
      if (bad) mark(i);
    }
    while (sp > 0) {
      const u = stack[--sp] ?? 0;
      const qx = ox[u] ?? 0;
      const qy = oy[u] ?? 0;
      const gx = Math.floor(qx / gsize);
      const gy = Math.floor(qy / gsize);
      const x0 = gx > 0 ? gx - 1 : 0;
      const x1 = gx + 1 < gw ? gx + 1 : gw - 1;
      const y0 = gy > 0 ? gy - 1 : 0;
      const y1 = gy + 1 < gh ? gy + 1 : gh - 1;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          let w = this.heads[y * gw + x] ?? -1;
          while (w !== -1) {
            if (w !== u && reverted[w] !== 1 && mover[w] === 1) {
              const dx = (cx[w] ?? 0) - qx;
              const dy = (cy[w] ?? 0) - qy;
              const r = (rad[u] ?? 0) + (rad[w] ?? 0);
              if (dx * dx + dy * dy < r * r) mark(w);
            }
            w = this.next[w] ?? -1;
          }
        }
      }
    }
    this.clearGrid(n);
    for (let i = 0; i < n; i++) {
      if (mover[i] !== 1 || reverted[i] === 1) continue;
      const u = units[i];
      if (u === undefined) continue;
      u.px = cx[i] ?? u.px;
      u.py = cy[i] ?? u.py;
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
