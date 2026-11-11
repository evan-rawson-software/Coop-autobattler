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

function disc(
  p: Pix,
  cx: number,
  cy: number,
  r: number,
  keys: readonly [string, string, string],
): void {
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy > r * r) continue;
      const lx = x + 0.5 - (cx - r * 0.35);
      const ly = y + 0.5 - (cy - r * 0.35);
      const l = Math.hypot(lx, ly) / r;
      p.set(x, y, l < 0.55 ? keys[2] : l < 1.05 ? keys[1] : keys[0]);
    }
}

/** The side-specific shape accent at the front of the head. */
function accent(p: Pix, c: Ctx, hx: number, hy: number, hr: number): void {
  if (c.side === 'a') {
    for (let k = hr; k <= hr + 2; k++) p.set(hx, hy + c.dir * k, k === hr + 2 ? 'O' : 'y');
  } else if (c.side === 'b') {
    for (const sx of [-2, 2]) {
      p.set(hx + sx, hy + c.dir * hr, '6');
      p.set(hx + sx, hy + c.dir * (hr + 1), '5');
    }
  }
}

function soldier(p: Pix, c: Ctx): void {
  const lunge = c.atk === 2 ? 2 : c.atk === 1 ? -1 : 0;
  const cx = 8;
  const cy = 8 + c.dir * lunge * 0.5;
  // Boots, stepping.
  const s = c.step;
  p.rect(cx - 4, Math.round(cy + c.dir * (3 + s)), 2, 2, '1');
  p.rect(cx + 2, Math.round(cy + c.dir * (3 - s)), 2, 2, '1');
  // Spear in the right hand.
  const reach = c.atk === 2 ? 8 : c.atk === 1 ? 4 : 6;
  const sx = cx + 5;
  const sy0 = Math.round(cy - c.dir * 2);
  for (let k = 0; k < reach; k++) p.set(sx, sy0 + c.dir * k, k === reach - 1 ? '6' : 'o');
  p.set(sx, sy0 + c.dir * (reach - 2), '5');
  // Body: team tunic with a steel cap.
  disc(p, cx, cy, 5.5, ['X', 'x', 'Z']);
  disc(p, cx, cy, 3.1, ['3', '4', '5']);
  p.set(cx - 1, Math.round(cy) - 1, '6');
  // Shield arm on the left.
  p.rect(cx - 7, Math.round(cy - 2), 2, 4, '2');
  p.set(cx - 7, Math.round(cy - 2), '4');
  accent(p, c, cx, Math.round(cy), 3);
}

function raider(p: Pix, c: Ctx): void {
  const lunge = c.atk === 2 ? 2 : c.atk === 1 ? -1 : 0;
  const cx = 8;
  const cy = 8 + c.dir * lunge * 0.5;
  const s = c.step;
  // Cloak streaming behind.
  const back = cy - c.dir * 3;
  p.ellipse(cx, back, 3.6, 2.6, 'X');
  p.ellipse(cx, back - c.dir * 0.4, 2.8, 1.8, 'x');
  // Quick feet.
  p.rect(cx - 3, Math.round(cy + c.dir * (2 + s)), 1, 2, '1');
  p.rect(cx + 2, Math.round(cy + c.dir * (2 - s)), 1, 2, '1');
  // Twin daggers, crossing on the strike.
  const spread = c.atk === 2 ? 1 : c.atk === 1 ? 4 : 3;
  const reach = c.atk === 2 ? 5 : 3;
  for (const side of [-1, 1]) {
    const dx = cx + side * (spread + 1);
    for (let k = 0; k < reach; k++) p.set(dx, Math.round(cy + c.dir * (1 + k)), k === reach - 1 ? '6' : '5');
    p.set(dx, Math.round(cy), 'y');
  }
  disc(p, cx, cy, 4.6, ['1', '2', '3']);
  // Hood lined with the team colour.
  disc(p, cx, cy + c.dir * 0.5, 2.6, ['X', 'x', 'Z']);
  accent(p, c, cx, Math.round(cy + c.dir * 0.5), 2);
}

function archer(p: Pix, c: Ctx): void {
  const cx = 8;
  const cy = 8;
  const s = c.step;
  p.rect(cx - 3, Math.round(cy + c.dir * (3 + s)), 2, 2, '1');
  p.rect(cx + 1, Math.round(cy + c.dir * (3 - s)), 2, 2, '1');
  // Bow held out front on the left; string pulled on the wind-up.
  const bx = cx - 5;
  for (let k = -3; k <= 3; k++) {
    const bend = Math.floor((k * k) / 5);
    p.set(bx - bend, cy + c.dir * (k + 2), 'o');
  }
  const pull = c.atk === 1 ? 2 : 0;
  p.set(bx + pull, cy + c.dir * 2, '5');
  p.set(bx + 1 - (c.atk === 1 ? 0 : 1), cy + c.dir * 5, '5');
  p.set(bx + 1 - (c.atk === 1 ? 0 : 1), cy + c.dir * -1, '5');
  if (c.atk === 1) {
    for (let k = 0; k < 5; k++) p.set(bx + 1, cy + c.dir * (2 + k - 1), '4');
  }
  if (c.atk === 2) {
    for (let k = 0; k < 4; k++) p.set(bx, cy + c.dir * (6 + k), k === 3 ? '6' : '4');
  }
  disc(p, cx, cy, 4.8, ['R', 'o', 'O']);
  // Hat in the team colour.
  disc(p, cx, cy, 3, ['X', 'x', 'Z']);
  p.set(cx, Math.round(cy) + c.dir * 2, 'K');
  accent(p, c, cx, cy, 3);
}

function drone(p: Pix, c: Ctx): void {
  const cx = 8;
  const cy = 8;
  // Arms and rotors on the diagonals.
  for (const [dx, dy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    p.line(cx + dx * 2, cy + dy * 2, cx + dx * 5, cy + dy * 5, '2');
    const rx = cx + dx * 5;
    const ry = cy + dy * 5;
    p.ellipse(rx + (dx < 0 ? 0 : 0), ry, 2.6, 2.6, '1');
    // Blades alternate between a plus and a cross so the rotor seems to spin.
    const spin = c.step >= 0;
    const blades: readonly (readonly [number, number])[] = spin
      ? [
          [-2, 0],
          [-1, 0],
          [0, 0],
          [1, 0],
          [0, -2],
          [0, -1],
          [0, 1],
        ]
      : [
          [-2, -2],
          [-1, -1],
          [0, 0],
          [1, 1],
          [-2, 2],
          [-1, 1],
          [1, -1],
        ];
    for (const [bx, by] of blades) p.set(rx + bx, ry + by, '4');
    p.set(rx, ry, '6');
  }
  disc(p, cx, cy, 3.6, ['2', '3', '4']);
  disc(p, cx, cy, 2.2, ['X', 'x', 'Z']);
  const lens = c.atk === 2 ? 'M' : c.atk === 1 ? 'y' : 'T';
  p.rect(cx - 1, cy - 1, 2, 2, lens);
  accent(p, c, cx, cy, 3);
}

const DRAWERS: Readonly<Record<string, (p: Pix, c: Ctx) => void>> = {
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
  const p = new Pix(16, 16, colorsWithRamp(ramp(side)));
  const draw = DRAWERS[id];
  if (!draw) throw new Error(`no drawing for ${id}`);
  const ctx: Ctx = {
    dir: side === 'b' ? 1 : -1,
    side,
    step: anim === 'walk' ? (i === 0 ? 1 : -1) : 0,
    atk: anim === 'attack' ? ((i + 1) as 1 | 2) : 0,
  };
  draw(p, ctx);
  p.outline('K');
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
            frames: Array.from({ length: n }, (_, i) => frame(id, side, anim, i)),
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
