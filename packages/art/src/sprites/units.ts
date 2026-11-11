/**
 * Unit sprites. 16x16 frames, top-down, drawn facing north (up the screen).
 * Side B is the same drawing flipped to face south, so all shading puts the
 * light on the left and the shadow on the right (it survives the flip).
 *
 * Team colour goes on the BODY (tunic, cloak, hull and shield face) through
 * the tint keys X, x, Z; the neutral set leaves them grey. The side cue is a
 * shape on the head or hull, not just a hue: side A wears a gold plume (a
 * tall tuft), side B has bone horns (a wide spread), so the silhouettes differ
 * at 1x.
 */

import { loadUnitIds } from '../content.js';
import { TEAM_A, TEAM_B, TINT_NEUTRAL, colorsWithRamp } from '../palette.js';
import { Pix } from '../pix.js';
import { sprite, type SpriteDef } from '../model.js';

type Side = 'n' | 'a' | 'b';
type Anim = 'idle' | 'walk' | 'attack';

interface Ctx {
  side: Side;
  /** Walk phase: -1, 0, +1. */
  step: -1 | 0 | 1;
  /** Attack phase: 0 none, 1 wind-up, 2 strike. */
  atk: 0 | 1 | 2;
}

type Grid = readonly string[];

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
    for (const layer of [this.back, this.body, this.front]) {
      layer.outline('K');
      out.blit(layer, 0, 0);
    }
    return out;
  }
}

function mirror(g: Grid): string[] {
  return g.map((r) => r.split('').reverse().join(''));
}

// ---- Shared parts ------------------------------------------------------

/** Side A: a gold fan-plume standing in front of the head (5 wide, 4 tall). */
const PLUME: Grid = ['.yyy.', 'yOOOy', '.OOO.', '..o..'];
/**
 * Side B: bone horns, a horseshoe that rises from behind the head and
 * curves out and forward, 10 px wide. The head is drawn over its base.
 */
const HORNS: Grid = [
  '6........6',
  '56......65',
  '55......55',
  '.55....55.',
  '..555555..',
];

/**
 * The side cue for a head whose top-left is (hx, hy) and width hw, drawn
 * before the head so the head covers the roots. The plume stands in front
 * (north); the horns spread out from the sides, which widens the silhouette.
 */
function sideCue(p: Pix, side: Side, hx: number, hy: number, hw: number): void {
  if (side === 'a') {
    p.stamp(PLUME, hx + Math.floor((hw - 5) / 2), hy - 3);
  } else if (side === 'b') {
    p.stamp(HORNS, hx + Math.floor((hw - 10) / 2), hy - 3);
  }
}

// ---- Soldier -----------------------------------------------------------

const SOLDIER_TORSO: Grid = [
  '..xxxxxxxx..',
  '.xZZxxxxxxX.',
  'xZZxxxxxxxXX',
  'xZxxxxxxxxXX',
  'xxxxxxxxxxXX',
  'xxxxxxxxxXXX',
  '.xxxxxxxXXX.',
  '..XXXXXXXX..',
];
const SOLDIER_HELM: Grid = ['.5444.', '544443', '544433', '443332', '.3222.'];
/** Round shield: steel rim, team-coloured face, gold boss. */
const SOLDIER_SHIELD: Grid = ['.55.', '5ZxX', '5xyX', '5xXX', '3xXX', '.33.'];

function soldier(L: Layers, c: Ctx): void {
  const lunge = c.atk === 2 ? -1 : c.atk === 1 ? 1 : 0;
  const bob = c.step === -1 ? -1 : 0;
  const dy = lunge + bob;
  const s = c.step;
  // Boots, stepping.
  L.back.rect(5, 12 + s, 2, 2, '1');
  L.back.rect(9, 12 - s, 2, 2, '1');
  // Spear on the right: thrust on the strike, drawn back on the wind-up.
  const tip = c.atk === 2 ? 0 : c.atk === 1 ? 5 : 1;
  const tail = c.atk === 2 ? 11 : c.atk === 1 ? 15 : 13;
  for (let y = tip + 2; y <= tail; y++) L.back.set(14, y + bob, 'o');
  L.back.stamp(['.6.', '565', '.5.'], 13, tip + bob);
  // Body, then the shield held out on the left, then the helmet.
  L.body.stamp(SOLDIER_TORSO, 2, 5 + dy);
  L.front.stamp(SOLDIER_SHIELD, 0, 6 + dy + (c.atk === 2 ? -1 : 0));
  sideCue(L.front, c.side, 5, 3 + dy, 6);
  L.front.stamp(SOLDIER_HELM, 5, 3 + dy);
}

// ---- Raider ------------------------------------------------------------

const RAIDER_VEST: Grid = [
  '.xxxxxxxx.',
  'xZZxxxxxXX',
  'xZxxxxxxXX',
  'xxxxxxxxXX',
  'xxxxxxxxXX',
  '.xxxxxxXX.',
  '..XXXXXX..',
];
/** Team-coloured hood with a dark opening at the front. */
const RAIDER_HOOD: Grid = ['.xZZx.', 'xZxxxX', 'x1111X', 'xxxxXX', '.XXXX.'];

function dagger(p: Pix, x0: number, y0: number, x1: number, y1: number): void {
  // Hilt at (x0, y0), blade out to (x1, y1), two pixels wide.
  p.line(x0 + 1, y0, x1 + 1, y1, '4');
  p.line(x0, y0, x1, y1, '5');
  p.set(x1, y1, '6');
  p.set(x0, y0, 'y');
  p.set(x0 + 1, y0, 'o');
}

function raider(L: Layers, c: Ctx): void {
  const lunge = c.atk === 2 ? -2 : c.atk === 1 ? 1 : 0;
  const bob = c.step === -1 ? -1 : 0;
  const dy = lunge + bob;
  const s = c.step;
  // Scarf tails streaming behind in the team colour, swaying as it runs.
  for (let k = 0; k < 4; k++) {
    const sway = k > 1 ? s : 0;
    const key = k > 2 ? 'X' : 'x';
    const ly = Math.min(15, 12 + k + dy);
    L.back.set(6 + sway, ly, key);
    L.back.set(7 + sway, ly, key);
    L.back.set(9 - sway, ly, key);
    L.back.set(10 - sway, ly, key);
  }
  // Quick feet.
  L.back.rect(5, 12 + s, 2, 2, '1');
  L.back.rect(9, 12 - s, 2, 2, '1');
  // Twin daggers: forward at rest, spread on the wind-up, crossed on the strike.
  if (c.atk === 2) {
    dagger(L.front, 3, 10 + dy, 8, 1);
    dagger(L.front, 11, 10 + dy, 6, 1);
  } else if (c.atk === 1) {
    dagger(L.front, 2, 9 + dy, 0, 5);
    dagger(L.front, 12, 9 + dy, 14, 5);
  } else {
    dagger(L.front, 1, 10 + dy, 3, 5 + dy);
    dagger(L.front, 12, 10 + dy, 10, 5 + dy);
  }
  L.body.stamp(RAIDER_VEST, 3, 6 + dy);
  // Dark bandolier across the vest.
  for (let k = 0; k < 6; k++)
    L.body.set(4 + k, 9 + dy + Math.floor(k / 1.5), '1');
  sideCue(L.front, c.side, 5, 4 + dy, 6);
  L.front.stamp(RAIDER_HOOD, 5, 4 + dy);
}

// ---- Archer ------------------------------------------------------------

const ARCHER_CLOAK: Grid = [
  '..xxxxxxxx..',
  '.xZZxxxxxxX.',
  'xZxxxxxxxxXX',
  '.xxxxxxxxXX.',
  '..xxxxxxXX..',
  '...xxxxXX...',
  '....xxXX....',
  '.....XX.....',
];
/** Hood in the team colour with a leather band. */
const ARCHER_HOOD: Grid = ['.xZZx.', 'xZxxxX', 'xxxxXX', 'qqqqqq', '.XXXX.'];

function archer(L: Layers, c: Ctx): void {
  const lean = c.atk === 1 ? 1 : 0;
  const bob = c.step === -1 ? -1 : 0;
  const dy = lean + bob;
  const s = c.step;
  // Boots peeking out under the cloak tail.
  L.back.rect(4, 13 + s, 2, 2, '1');
  L.back.rect(10, 13 - s, 2, 2, '1');
  // Quiver on the back, feathers peeking out beside the shoulder.
  L.back.stamp(['6.5', 'ooo', 'oOo', 'ooo'], 13, 8 + bob);
  // Bow in front of the head, arcing across the line of fire; string, arrow.
  const pull = c.atk === 1 ? 3 : 0;
  for (let x = 3; x <= 12; x++) {
    const k0 = Math.round(((2 * x - 15) * (2 * x - 15)) / 40);
    // The limbs spring forward after the shot.
    const k = c.atk === 2 ? Math.max(0, k0 - 1) : k0;
    L.back.set(x, k, k <= 1 ? 'O' : 'o');
  }
  if (c.atk === 1) {
    // String drawn back to the cheek.
    L.back.line(3, 2, 7, 2 + pull, '4');
    L.back.line(12, 2, 8, 2 + pull, '4');
  } else {
    L.back.hline(4, c.atk === 2 ? 1 : 2, 8, c.atk === 2 ? 'y' : '4');
  }
  if (c.atk === 2) {
    // The shot has left: only the arrow's tail is still in sight.
    L.back.set(7, 0, '6');
  } else {
    L.back.vline(7, 1, 4 + pull + 2, '5');
    L.back.set(7, 1, '6');
  }
  L.body.stamp(ARCHER_CLOAK, 2, 7 + dy);
  sideCue(L.front, c.side, 5, 6 + dy, 6);
  L.front.stamp(ARCHER_HOOD, 5, 6 + dy);
}

// ---- Drone -------------------------------------------------------------

const DRONE_HULL: Grid = [
  '..xxxx..',
  '.xZZxxX.',
  'xZxxxxXX',
  'xxxxxxXX',
  'xxxxxxXX',
  'xxxxxXXX',
  '.XXXXXX.',
  '..3333..',
];

function drone(L: Layers, c: Ctx): void {
  // Bobs while moving, rocks back to charge and lurches forward on the shot.
  const dy = c.atk === 1 ? 1 : c.atk === 2 ? -1 : c.step === -1 ? -1 : 0;
  L.body.stamp(DRONE_HULL, 4, 4 + dy);
  // Lens at the front; it charges to gold and flares red on the shot.
  const lens = c.atk === 2 ? 'M' : c.atk === 1 ? 'y' : 'T';
  L.front.rect(7, 4 + dy, 2, 1, lens);
  if (c.atk === 2) {
    L.front.vline(6, 1 + dy, 3, 'y');
    L.front.vline(9, 1 + dy, 3, 'y');
  } else if (c.atk === 1) {
    L.front.rect(7, 5 + dy, 2, 1, 'O');
    L.front.set(6, 3 + dy, 'O');
    L.front.set(9, 3 + dy, 'O');
  }
  // Side cue. A: a gold prow in front. B: bone wedges jutting from the sides.
  if (c.side === 'a') L.front.stamp(['.yy.', 'yOOy'], 6, 2 + dy);
  else if (c.side === 'b') {
    L.front.stamp(['..5', '.56', '556', '.55'], 1, 6 + dy);
    L.front.stamp(mirror(['..5', '.56', '556', '.55']), 12, 6 + dy);
  }
}

/** Arms and small translucent rotor discs, drawn under and around the hull. */
function dronePost(p: Pix, c: Ctx): void {
  const dy = c.atk === 1 ? 1 : c.atk === 2 ? -1 : c.step === -1 ? -1 : 0;
  const phase = c.step === 0 ? 0 : c.step === 1 ? 1 : 2;
  const free = (x: number, y: number): boolean => !p.opaque(x, y);
  for (const [cx, cy] of [
    [2, 2],
    [13, 2],
    [2, 13],
    [13, 13],
  ] as const) {
    const ry = cy + dy;
    // Arm from the hull corner to the rotor mount.
    const hx = cx < 8 ? 5 : 10;
    const hy = (cy < 8 ? 5 : 10) + dy;
    const arm = new Pix(16, 16);
    arm.line(hx, hy, cx, ry, '2');
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++)
        if (arm.opaque(x, y) && free(x, y)) p.setRgba(x, y, arm.get(x, y));
    // Disc: 6x6, soft edge, one blade.
    for (let y = -2; y <= 2; y++)
      for (let x = -2; x <= 2; x++) {
        const d2 = x * x + y * y;
        if (d2 > 5) continue;
        if (free(cx + x, ry + y))
          p.setRgba(
            cx + x,
            ry + y,
            d2 > 3 ? [225, 238, 246, 105] : [205, 225, 240, 38],
          );
      }
    const blade: [number, number][] =
      phase === 1
        ? [
            [-2, 0],
            [-1, 0],
            [0, 0],
            [1, 0],
          ]
        : phase === 2
          ? [
              [0, -2],
              [0, -1],
              [0, 0],
              [0, 1],
            ]
          : [
              [-2, -2],
              [-1, -1],
              [0, 0],
              [1, 1],
            ];
    for (const [bx, by] of blade)
      if (free(cx + bx, ry + by))
        p.setRgba(cx + bx, ry + by, [244, 248, 250, 235]);
  }
}

const DRAWERS: Readonly<Record<string, (L: Layers, c: Ctx) => void>> = {
  unit_soldier: soldier,
  unit_raider: raider,
  unit_archer: archer,
  unit_drone: drone,
};

/** Art that exists ahead of its content: planned until content has the id. */
const ART_ONLY: readonly string[] = ['unit_archer', 'unit_drone'];
const NOTES: Readonly<Record<string, string>> = {
  unit_soldier: 'Melee ground unit.',
  unit_raider: 'Fast melee ground unit.',
  unit_archer: 'Ranged ground unit.',
  unit_drone: 'Flying unit; place fx_shadow under it.',
};

function ramp(side: Side): readonly [string, string, string] {
  return side === 'a' ? TEAM_A : side === 'b' ? TEAM_B : TINT_NEUTRAL;
}

function flipY(p: Pix): Pix {
  const out = new Pix(p.w, p.h, p.map);
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) out.setRgba(x, p.h - 1 - y, p.get(x, y));
  return out;
}

function frame(id: string, side: Side, anim: Anim, i: number): Pix {
  const map = colorsWithRamp(ramp(side));
  const L = new Layers(map);
  const draw = DRAWERS[id];
  if (!draw) throw new Error(`no drawing for ${id}`);
  const ctx: Ctx = {
    side,
    step: anim === 'walk' ? (i === 0 ? 1 : -1) : 0,
    atk: anim === 'attack' ? ((i + 1) as 1 | 2) : 0,
  };
  draw(L, ctx);
  const p = L.compose(map);
  if (id === 'unit_drone') dronePost(p, ctx);
  // Side A faces north as drawn; side B faces south.
  return side === 'b' ? flipY(p) : p;
}

/**
 * Unit sprites for the content units plus art-only units. An art-only unit
 * is flagged `planned` only while `contentIds` lacks it, so adding it to
 * content later neither duplicates the sprite nor leaves the flag behind.
 */
export function unitSprites(
  contentIds: readonly string[] = loadUnitIds(),
): SpriteDef[] {
  const out: SpriteDef[] = [];
  const ids = [...new Set([...contentIds, ...ART_ONLY])];
  const inContent = new Set(contentIds);
  for (const id of ids) {
    if (!DRAWERS[id]) continue;
    const planned = !inContent.has(id);
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
            ...(planned ? { planned: true } : {}),
            note: `${planned ? 'Planned: ' : ''}${NOTES[id] ?? ''} ${side === 'n' ? 'Neutral greys in the team parts (tint keys).' : side === 'a' ? 'Side A, faces north, gold plume.' : 'Side B, faces south, bone horns.'}`,
          }),
        );
      }
    }
  }
  return out;
}
