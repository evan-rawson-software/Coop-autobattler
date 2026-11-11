/**
 * Unit movement and soft collision (issue #82, step 5 of the battle tick):
 * the desired steps of the units that chose to move, ONE push pass in which
 * every pair of overlapping collision circles is pushed apart, and a hard
 * push-out from solid ground. Units may overlap each other for a while; they
 * can never end a tick inside solid ground or outside the arena. See
 * docs/rules-reference.md, "Unit geometry" and "One battle tick", step 5.
 *
 * Nothing here is state: the scratch arrays are rebuilt every tick from the
 * unit positions and the decisions, so a restored battle behaves the same.
 * The uniform grid used to find neighbours is an implementation detail: any
 * exact neighbour search gives the same result, and the result does not depend
 * on the order of the unit array (pushes are integers summed per unit).
 */

import {
  awayDivSmall,
  isqrtFloorSmall,
  settleOutOfSolid,
  truncDivSmall,
  type World,
} from './geometry.js';
import { isqrtCeil } from './int.js';

/** The class of a unit in the push pass. */
const CLASS_IDLE = 0;
const CLASS_MOVER = 1;
const CLASS_FIGHTER = 2;

/**
 * Against an ALLY, the weight `ALLY_WEIGHT[own class][other class]` of a unit
 * in the split of the pair's push: a unit takes `w / (w + w_other)` of it.
 * An idle (waiting) ally gives way completely to a mover or a fighter and
 * shares equally with another idle one; a mover and a fighter split 2 : 1
 * (the fighter holds its place and takes the reduced share); two units of one
 * class share equally. Rows and columns: idle, mover, fighter.
 */
const ALLY_WEIGHT = [
  [1, 1, 1],
  [0, 1, 2],
  [0, 1, 1],
] as const;

/**
 * The direction (+1 or -1, in arena coordinates) in which unit `u` is pushed
 * along the separation axis when its centre coincides with that of `other`.
 * Two units of one side: towards positive in the frame of `u`'s own side if
 * `u` has the higher id, negative if the lower, and the frame of side 1 is the
 * arena rotated by half a turn (both axes negated). Two units of different
 * sides: towards positive in the frame of `u`'s own side, whatever the ids
 * (so side 0 goes up the axis, side 1 down it, and the two always separate).
 * The separation axis itself (x when the sum of the two ids is even, y when
 * odd) is the same for both. Decided by the ids and the sides only, so a
 * mirrored battle stays symmetric.
 */
function coincidentSign(u: MotionUnit, other: MotionUnit): number {
  const frame = u.side === 0 ? 1 : -1;
  if (u.side !== other.side) return frame;
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
  /** Per unit: 1 if the unit attacks this tick (it holds its place). */
  fight = new Uint8Array(0);
  /** Per unit: the target point of the move. */
  tx = new Int32Array(0);
  ty = new Int32Array(0);
  /** Per unit: the speed, sub-cell units per tick. */
  speed = new Int32Array(0);
  /** Per unit: the collision radius. */
  rad = new Int32Array(0);
  /** Per unit: the tentative position (start of the tick plus the step). */
  private cx = new Int32Array(0);
  private cy = new Int32Array(0);
  /** Per unit: the summed push. */
  private ax = new Int32Array(0);
  private ay = new Int32Array(0);
  /** Per unit: `CLASS_IDLE`, `CLASS_MOVER` or `CLASS_FIGHTER`. */
  private cls = new Uint8Array(0);
  private next = new Int32Array(0);
  private heads = new Int32Array(0);
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
    this.fight = u8(this.fight);
    this.tx = i32(this.tx);
    this.ty = i32(this.ty);
    this.speed = i32(this.speed);
    this.rad = i32(this.rad);
    this.cx = i32(this.cx);
    this.cy = i32(this.cy);
    this.ax = i32(this.ax);
    this.ay = i32(this.ay);
    this.cls = u8(this.cls);
    this.next = i32(this.next);
  }

  /**
   * Resolve the moves of `units` (ascending id): `want`, `fight`, `tx`, `ty`,
   * `speed` and `rad` must be filled for indices `0 .. n - 1`. Writes the new
   * `px, py` of the units. `percent` (0 to 100) is the share of an overlap a
   * pair resolves per tick and `pushCap` the most it moves a pair apart per
   * tick (`separationPercent`, `separationCap`).
   */
  resolve(
    units: readonly MotionUnit[],
    world: World,
    percent: number,
    pushCap: number,
    maxRadius: number,
  ): void {
    const n = units.length;
    this.ensure(n);
    const { cx, cy, ax, ay, cls, rad, tmp } = this;

    // 1. Desire: tentative positions.
    for (let i = 0; i < n; i++) {
      const u = units[i];
      if (u === undefined) continue;
      cx[i] = u.px;
      cy[i] = u.py;
      cls[i] = this.fight[i] === 1 ? CLASS_FIGHTER : CLASS_IDLE;
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
      cls[i] = CLASS_MOVER;
      settleOutOfSolid(
        world,
        u.side,
        rad[i] ?? 0,
        u.px + vx,
        u.py + vy,
        u.px,
        u.py,
        tmp,
      );
      cx[i] = tmp[0] ?? 0;
      cy[i] = tmp[1] ?? 0;
    }

    // 2. One push pass over the pairs of overlapping collision circles at the
    // tentative positions, each pair once.
    const gsize = Math.max(1, 2 * maxRadius);
    const gw = Math.floor((world.width * 240) / gsize) + 1;
    const gh = Math.floor((world.height * 240) / gsize) + 1;
    if (gw * gh > this.gridCap) {
      this.gridCap = gw * gh;
      this.heads = new Int32Array(this.gridCap).fill(-1);
    }
    const heads = this.heads;
    for (let i = 0; i < n; i++) {
      const gx = Math.min(Math.floor((cx[i] ?? 0) / gsize), gw - 1);
      const gy = Math.min(Math.floor((cy[i] ?? 0) / gsize), gh - 1);
      const k = gy * gw + gx;
      this.next[i] = heads[k] ?? -1;
      heads[k] = i;
      ax[i] = 0;
      ay[i] = 0;
    }
    let any = false;
    if (percent > 0) {
      for (let i = 0; i < n; i++) {
        const ui = units[i];
        if (ui === undefined) continue;
        const xi = cx[i] ?? 0;
        const yi = cy[i] ?? 0;
        const ri = rad[i] ?? 0;
        const gx = Math.min(Math.floor(xi / gsize), gw - 1);
        const gy = Math.min(Math.floor(yi / gsize), gh - 1);
        const x0 = gx > 0 ? gx - 1 : 0;
        const x1 = gx + 1 < gw ? gx + 1 : gw - 1;
        const y0 = gy > 0 ? gy - 1 : 0;
        const y1 = gy + 1 < gh ? gy + 1 : gh - 1;
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            let j = heads[y * gw + x] ?? -1;
            while (j !== -1) {
              if (j > i) {
                const dx = xi - (cx[j] ?? 0);
                const dy = yi - (cy[j] ?? 0);
                const r = ri + (rad[j] ?? 0);
                const d2 = dx * dx + dy * dy;
                if (d2 < r * r) {
                  const uj = units[j];
                  if (uj !== undefined) {
                    any =
                      this.push(
                        i,
                        j,
                        ui,
                        uj,
                        dx,
                        dy,
                        d2,
                        r,
                        percent,
                        pushCap,
                      ) || any;
                  }
                }
              }
              j = this.next[j] ?? -1;
            }
          }
        }
      }
    }
    // Empty the buckets (the grid rests all -1).
    for (let i = 0; i < n; i++) {
      const gx = Math.min(Math.floor((cx[i] ?? 0) / gsize), gw - 1);
      const gy = Math.min(Math.floor((cy[i] ?? 0) / gsize), gh - 1);
      heads[gy * gw + gx] = -1;
    }

    // 3. Apply the pushes, then hard push-out from solid ground.
    for (let i = 0; i < n; i++) {
      const u = units[i];
      if (u === undefined) continue;
      const x = cx[i] ?? 0;
      const y = cy[i] ?? 0;
      const px = any ? (ax[i] ?? 0) : 0;
      const py = any ? (ay[i] ?? 0) : 0;
      if (px === 0 && py === 0) {
        u.px = x;
        u.py = y;
        continue;
      }
      settleOutOfSolid(world, u.side, rad[i] ?? 0, x + px, y + py, x, y, tmp);
      u.px = tmp[0] ?? x;
      u.py = tmp[1] ?? y;
    }
  }

  /**
   * The push of one overlapping pair (`i < j`; `(dx, dy)` the vector from
   * `j` to `i`, `r` the sum of the collision radii, `d2` the squared
   * distance, less than `r * r`). Adds the integer push to both units and
   * returns whether any was added.
   */
  private push(
    i: number,
    j: number,
    ui: MotionUnit,
    uj: MotionUnit,
    dx: number,
    dy: number,
    d2: number,
    r: number,
    percent: number,
    pushCap: number,
  ): boolean {
    const ci = this.cls[i] ?? CLASS_IDLE;
    const cj = this.cls[j] ?? CLASS_IDLE;
    let wi: number;
    let wj: number;
    if (ui.side === uj.side) {
      wi = ALLY_WEIGHT[ci]?.[cj] ?? 1;
      wj = ALLY_WEIGHT[cj]?.[ci] ?? 1;
    } else {
      // Nobody pushes a fighter of the other side; the others share.
      wi = ci === CLASS_FIGHTER ? 0 : 1;
      wj = cj === CLASS_FIGHTER ? 0 : 1;
    }
    const w = wi + wj;
    if (w === 0) return false;
    // The pair's total push: `percent` of the overlap, rounded up, at most
    // `pushCap`.
    const d = d2 > 0 ? isqrtFloorSmall(d2) : 0;
    const o = r - d;
    const total = Math.min(pushCap, Math.floor((o * percent + 99) / 100));
    if (total <= 0) return false;
    if (d2 > 0) {
      // Each unit takes `w_self / w` of the total, away from the other.
      const qi = total * wi;
      const qj = total * wj;
      const den = d * w;
      this.ax[i] = (this.ax[i] ?? 0) + awayDivSmall(dx * qi, den);
      this.ay[i] = (this.ay[i] ?? 0) + awayDivSmall(dy * qi, den);
      this.ax[j] = (this.ax[j] ?? 0) + awayDivSmall(-dx * qj, den);
      this.ay[j] = (this.ay[j] ?? 0) + awayDivSmall(-dy * qj, den);
    } else {
      // Coinciding centres: along the separation axis, see `coincidentSign`.
      const si = coincidentSign(ui, uj) * awayDivSmall(total * wi, w);
      const sj = coincidentSign(uj, ui) * awayDivSmall(total * wj, w);
      if ((ui.id + uj.id) % 2 === 0) {
        this.ax[i] = (this.ax[i] ?? 0) + si;
        this.ax[j] = (this.ax[j] ?? 0) + sj;
      } else {
        this.ay[i] = (this.ay[i] ?? 0) + si;
        this.ay[j] = (this.ay[j] ?? 0) + sj;
      }
    }
    return true;
  }
}
