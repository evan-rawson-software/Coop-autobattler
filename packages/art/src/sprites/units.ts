/**
 * Unit sprites. 16x16 frames, drawn as a round body so they can be scaled to
 * different circle sizes. Parts that take a team colour use the tint keys
 * X, x, Z; the neutral set leaves them grey. Side A faces north (up the
 * screen) and carries a single gold plume; side B faces south and carries two
 * bone prongs, so the sides differ by shape and not only by hue.
 */

import { loadUnitIds } from '../content.js';
import { TEAM_A, TEAM_B, TINT_NEUTRAL, colorsWithRamp } from '../palette.js';
import { Pix } from '../pix.js';
import { sprite, type SpriteDef } from '../model.js';

type Side = 'n' | 'a' | 'b';
type Anim = 'idle' | 'walk' | 'attack';

interface Ctx {
  /** -1 faces north, +1 faces south. */
  dir: -1 | 1;
  side: Side;
  /** Walk phase: -1, 0, +1. */
  step: number;
  /** Attack phase: 0 none, 1 wind-up, 2 strike. */
  atk: 0 | 1 | 2;
}

type Ramp = readonly [string, string, string];

/**
 * A flat-shaded disc: mid tone, a shadow crescent bottom-right and a small
 * highlight top-left. `ring` adds the 1-px dark rim (the body does; pieces
 * drawn on the front layer get theirs from the layer outline).
 */
function ball(
  p: Pix,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  ramp: Ramp,
  ring = true,
): void {
  const inside = (
    x: number,
    y: number,
    ox: number,
    oy: number,
    sx: number,
    sy: number,
  ): boolean => {
    const dx = (x + 0.5 - cx - ox) / sx;
    const dy = (y + 0.5 - cy - oy) / sy;
    return dx * dx + dy * dy <= 1;
  };
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      if (!inside(x, y, 0, 0, rx, ry)) continue;
      if (ring && !inside(x, y, 0, 0, rx - 1, ry - 1)) {
        p.set(x, y, 'K');
        continue;
      }
      let key = ramp[1];
      if (!inside(x, y, -1, -1, rx - 0.6, ry - 0.6)) key = ramp[0];
      else if (inside(x, y, -rx * 0.38, -ry * 0.38, rx * 0.34, ry * 0.34))
        key = ramp[2];
      p.set(x, y, key);
    }
}

/** Three layers: things behind the body, the body, things in front. */
class Layers {
  readonly back: Pix;
  readonly body: Pix;
  readonly front: Pix;
  constructor(map: Pix['map']) {
    this.back = new Pix(16, 16, map);
    this.body = new Pix(16, 16, map);
    this.front = new Pix(16, 16, map);
  }
  compose(map: Pix['map']): Pix {
    const out = new Pix(16, 16, map);
    this.back.outline('K');
    out.blit(this.back, 0, 0);
    out.blit(this.body, 0, 0);
    this.front.outline('K');
    out.blit(this.front, 0, 0);
    return out;
  }
}

/** The side-specific shape accent at the front of the head. */
function accent(p: Pix, c: Ctx, hx: number, hy: number, hr: number): void {
  if (c.side === 'a') {
    for (let k = hr; k <= hr + 2; k++)
      p.set(hx, hy + c.dir * k, k === hr + 2 ? 'O' : 'y');
  } else if (c.side === 'b') {
    for (const sx of [-2, 2]) {
      p.set(hx + sx, hy + c.dir * hr, '6');
      p.set(hx + sx, hy + c.dir * (hr + 1), '5');
    }
  }
}

function soldier(L: Layers, c: Ctx): void {
  const lunge = c.atk === 2 ? 1 : c.atk === 1 ? -1 : 0;
  const cx = 8;
  const cy = 8 + c.dir * lunge;
  const s = c.step;
  // Boots, stepping.
  L.back.rect(cx - 3, Math.round(cy + c.dir * (3 + s)), 2, 2, '1');
  L.back.rect(cx + 1, Math.round(cy + c.dir * (3 - s)), 2, 2, '1');
  // Spear on the right: long, so it sticks out of the round body.
  const reach = c.atk === 2 ? 11 : c.atk === 1 ? 6 : 9;
  const sx = 14;
  const y0 = Math.round(cy - c.dir * 3);
  for (let k = 0; k < reach; k++)
    L.back.set(sx, y0 + c.dir * k, k >= reach - 2 ? '6' : 'o');
  L.back.set(sx, y0 + c.dir * (reach - 3), '5');
  // Body: team tunic.
  ball(L.body, cx, cy, 5.6, 5.6, ['X', 'x', 'Z']);
  // Steel cap, then a round shield held out on the left.
  ball(L.body, cx + 0.5, cy + c.dir * 0.5, 2.5, 2.5, ['3', '4', '5'], false);
  ball(L.front, cx - 5.2, cy + c.dir * 0.5, 2, 3.2, ['2', '4', '5'], false);
  L.front.set(cx - 6, Math.round(cy + c.dir * 0.5), 'y');
  L.front.set(cx - 5, Math.round(cy + c.dir * 0.5), 'y');
  accent(L.front, c, cx, Math.round(cy), 3);
}

function raider(L: Layers, c: Ctx): void {
  const lunge = c.atk === 2 ? 2 : c.atk === 1 ? -1 : 0;
  const cx = 8;
  const cy = 8 + c.dir * lunge;
  const s = c.step;
  // Scarf tails streaming behind, in the team colour.
  const sway = c.step;
  for (let k = 3; k <= 6; k++) {
    L.back.set(
      cx - 1 + (k > 4 ? sway : 0),
      Math.round(cy - c.dir * k),
      k > 4 ? 'X' : 'x',
    );
    L.back.set(
      cx + 1 + (k > 4 ? -sway : 0),
      Math.round(cy - c.dir * k),
      k > 4 ? 'X' : 'x',
    );
  }
  // Quick feet.
  L.back.rect(cx - 3, Math.round(cy + c.dir * (2 + s)), 1, 2, '1');
  L.back.rect(cx + 2, Math.round(cy + c.dir * (2 - s)), 1, 2, '1');
  // Twin daggers, crossing on the strike.
  const spread = c.atk === 2 ? 2 : c.atk === 1 ? 5 : 5;
  const reach = c.atk === 2 ? 6 : 4;
  for (const side of [-1, 1]) {
    const dx = cx + side * spread;
    for (let k = 0; k < reach; k++)
      L.back.set(
        dx,
        Math.round(cy + c.dir * (k - 1)),
        k >= reach - 2 ? '6' : '5',
      );
    L.back.set(dx, Math.round(cy + c.dir * -2), 'y');
  }
  ball(L.body, cx, cy, 4.2, 4.8, ['0', '1', '2']);
  ball(L.body, cx, cy + c.dir * 0.7, 2.6, 2.6, ['X', 'x', 'Z'], false);
  L.body.set(cx - 1, Math.round(cy + c.dir * 1.5), 'K');
  L.body.set(cx + 1, Math.round(cy + c.dir * 1.5), 'K');
  accent(L.front, c, cx, Math.round(cy + c.dir * 0.7), 2);
}

function archer(L: Layers, c: Ctx): void {
  const cx = 9;
  const cy = 8;
  const s = c.step;
  L.back.rect(cx - 3, Math.round(cy + c.dir * (3 + s)), 2, 2, '1');
  L.back.rect(cx + 1, Math.round(cy + c.dir * (3 - s)), 2, 2, '1');
  // Bow held out front on the left; the string is pulled on the wind-up.
  const bx = cx - 6;
  for (let k = -4; k <= 4; k++) {
    const bend = Math.floor((k * k) / 6);
    L.back.set(
      bx - bend + 1,
      Math.round(cy + c.dir * (k + 1)),
      k === 0 ? 'O' : 'o',
    );
  }
  const pull = c.atk === 1 ? 3 : 0;
  L.back.set(bx + 2 + pull, Math.round(cy + c.dir), '5');
  for (let k = 0; k < 4; k++) {
    L.back.set(
      bx + 1 + (k === 0 ? 0 : 0),
      Math.round(cy + c.dir * (1 + k - 4 + (k > 2 ? 0 : 0))),
      '5',
    );
  }
  if (c.atk === 1) {
    for (let k = 0; k < 6; k++)
      L.back.set(bx + 2, Math.round(cy + c.dir * (k - 1)), k === 5 ? '6' : '4');
  }
  if (c.atk === 2) {
    for (let k = 0; k < 5; k++)
      L.back.set(bx + 2, Math.round(cy + c.dir * (5 + k)), k === 4 ? '6' : '4');
  }
  ball(L.body, cx, cy, 5, 5, ['r', 'q', 'p']);
  ball(L.body, cx, cy, 3, 3, ['X', 'x', 'Z'], false);
  accent(L.front, c, cx, cy, 3);
}

function drone(L: Layers, c: Ctx): void {
  const cx = 8;
  const cy = 8;
  for (const [dx, dy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    L.back.line(cx + dx * 2, cy + dy * 2, cx + dx * 4, cy + dy * 4, '2');
    L.back.set(cx + dx * 5, cy + dy * 5, '1');
  }
  ball(L.body, cx, cy, 4, 4, ['2', '3', '4']);
  ball(L.body, cx, cy, 2.3, 2.3, ['X', 'x', 'Z'], false);
  const lens = c.atk === 2 ? 'M' : c.atk === 1 ? 'y' : 'T';
  L.front.rect(cx - 1, cy - 1, 2, 2, lens);
  accent(L.front, c, cx, cy, 3);
}

/** Translucent spinning rotors, drawn last so they sit over everything. */
function rotors(p: Pix, c: Ctx): void {
  for (const [dx, dy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    const rx = 8 + dx * 5;
    const ry = 8 + dy * 5;
    for (let y = -3; y <= 3; y++)
      for (let x = -3; x <= 3; x++)
        if (x * x + y * y <= 9) {
          const o = p.get(rx + x, ry + y);
          if (o[3] === 0) p.setRgba(rx + x, ry + y, [205, 225, 240, 120]);
        }
    const horizontal = c.step >= 0;
    for (let k = -2; k <= 2; k++)
      p.setRgba(
        horizontal ? rx + k : rx,
        horizontal ? ry : ry + k,
        [240, 244, 246, 235],
      );
  }
}

const DRAWERS: Readonly<Record<string, (L: Layers, c: Ctx) => void>> = {
  unit_soldier: soldier,
  unit_raider: raider,
  unit_archer: archer,
  unit_drone: drone,
};

const PLANNED = new Set(['unit_archer', 'unit_drone']);
const NOTES: Readonly<Record<string, string>> = {
  unit_soldier: 'Melee ground unit.',
  unit_raider: 'Fast melee ground unit.',
  unit_archer: 'Planned: ranged ground unit.',
  unit_drone: 'Planned: flying unit; place fx_shadow under it.',
};

function ramp(side: Side): readonly [string, string, string] {
  return side === 'a' ? TEAM_A : side === 'b' ? TEAM_B : TINT_NEUTRAL;
}

function frame(id: string, side: Side, anim: Anim, i: number): Pix {
  const map = colorsWithRamp(ramp(side));
  const L = new Layers(map);
  const draw = DRAWERS[id];
  if (!draw) throw new Error(`no drawing for ${id}`);
  const ctx: Ctx = {
    dir: side === 'b' ? 1 : -1,
    side,
    step: anim === 'walk' ? (i === 0 ? 1 : -1) : 0,
    atk: anim === 'attack' ? ((i + 1) as 1 | 2) : 0,
  };
  draw(L, ctx);
  const p = L.compose(map);
  if (id === 'unit_drone') rotors(p, ctx);
  return p;
}

export function unitSprites(): SpriteDef[] {
  const out: SpriteDef[] = [];
  const ids = [...loadUnitIds(), 'unit_archer', 'unit_drone'];
  for (const id of ids) {
    if (!DRAWERS[id]) continue;
    for (const side of ['n', 'a', 'b'] as const) {
      const base = side === 'n' ? id : `${id}@${side}`;
      const anims: readonly [Anim, number, number, string][] = [
        ['idle', 1, 0, ''],
        ['walk', 2, 6, '.walk'],
        ['attack', 2, 8, '.attack'],
      ];
      for (const [anim, n, fps, suffix] of anims) {
        out.push(
          sprite({
            name: `${base}${suffix}`,
            id,
            sheet: 'units',
            category: 'unit',
            frames: Array.from({ length: n }, (_, i) =>
              frame(id, side, anim, i),
            ),
            fps,
            tintable: side === 'n',
            ...(PLANNED.has(id) ? { planned: true } : {}),
            note: `${NOTES[id] ?? ''} ${side === 'n' ? 'Neutral greys in the team parts (tint keys).' : side === 'a' ? 'Side A, faces north.' : 'Side B, faces south.'}`,
          }),
        );
      }
    }
  }
  return out;
}
