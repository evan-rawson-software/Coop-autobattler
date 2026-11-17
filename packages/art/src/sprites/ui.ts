/** Interface textures, 9-slices and icons. */

import { loadEventTypes } from '../content.js';
import { Pix, bevelShape, rng, roundRect } from '../pix.js';
import { sprite, wset, type SpriteDef } from '../model.js';

/**
 * A tileable texture: a flat base with a few single-pixel specks of the
 * neighbouring shades, no two close together (wrapping), so it shows no
 * pattern when tiled.
 */
function speckled(
  size: number,
  base: string,
  dark: string,
  light: string,
  seed: number,
  n: number,
): Pix {
  const p = new Pix(size, size);
  p.rect(0, 0, size, size, base);
  const r = rng(seed);
  const taken: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = Math.floor(r() * size);
      const y = Math.floor(r() * size);
      const near = taken.some(([tx, ty]) => {
        const dx = Math.min(Math.abs(tx - x), size - Math.abs(tx - x));
        const dy = Math.min(Math.abs(ty - y), size - Math.abs(ty - y));
        return Math.max(dx, dy) < 3;
      });
      if (near) continue;
      taken.push([x, y]);
      wset(p, x, y, i % 2 === 0 ? light : dark);
      break;
    }
  }
  return p;
}

function button(kind: 'normal' | 'hover' | 'disabled'): Pix {
  const p = new Pix(16, 16);
  const ramp =
    kind === 'normal'
      ? (['1', '2', '4'] as const)
      : kind === 'hover'
        ? (['2', '3', '5'] as const)
        : (['0', '1', '2'] as const);
  bevelShape(p, roundRect(0, 0, 16, 16, 2), ramp);
  if (kind === 'hover') {
    // Warm rim to make the hover obvious.
    for (let i = 2; i < 14; i++) {
      p.set(i, 1, 'y');
      p.set(i, 14, 'o');
    }
  }
  return p;
}

function card(): Pix {
  const p = new Pix(24, 24);
  bevelShape(p, roundRect(0, 0, 24, 24, 2), ['0', '2', '4']);
  p.rect(3, 3, 18, 18, 'K');
  p.rect(4, 4, 16, 16, '1');
  p.rect(4, 4, 16, 1, '0');
  p.rect(4, 4, 1, 16, '0');
  for (const [x, y] of [
    [1, 1],
    [21, 1],
    [1, 21],
    [21, 21],
  ] as const) {
    p.rect(x, y, 2, 2, 'y');
    p.set(x + 1, y + 1, 'o');
  }
  return p;
}

function coin(): Pix {
  const p = new Pix(16, 16);
  p.ellipse(8, 8, 5.6, 5.6, 'o');
  p.ellipse(8, 8, 4.7, 4.7, 'y');
  p.ellipse(8.4, 8.4, 3, 3, 'O');
  p.ellipse(8, 8, 2.4, 2.4, 'y');
  p.rect(7, 6, 2, 4, 'o');
  p.set(6, 5, '6');
  p.set(5, 6, '6');
  p.outline('K');
  return p;
}

function heart(): Pix {
  const p = new Pix(16, 16);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const u = (x + 0.5 - 8) / 5.6;
      const v = -(y + 0.5 - 8.6) / 5.2;
      const q = u * u + v * v - 1;
      const f = q * q * q - u * u * v * v * v;
      if (f > 0) continue;
      p.set(x, y, u + v * 0.3 > 0.25 ? 'm' : 'M');
    }
  p.set(4, 4, '6');
  p.set(5, 3, '6');
  p.set(4, 5, '5');
  p.outline('K');
  return p;
}

function lock(): Pix {
  const p = new Pix(16, 16);
  p.ellipse(8, 6.5, 3.7, 3.7, '5');
  p.ellipse(8, 6.8, 2, 2.2, '.');
  p.rect(4, 7, 8, 7, '4');
  p.rect(4, 7, 8, 1, '5');
  p.rect(11, 8, 1, 6, '3');
  p.rect(4, 13, 8, 1, '3');
  p.rect(7, 9, 2, 3, 'K');
  p.set(8, 11, '2');
  p.outline('K');
  return p;
}

function tick(): Pix {
  const p = new Pix(16, 16);
  p.ellipse(8, 8, 6.2, 6.2, 'K');
  p.ellipse(8, 8, 5.2, 5.2, 'd');
  p.line(4, 8, 7, 11, 'N');
  p.line(4, 9, 7, 12, 'N');
  p.line(7, 11, 12, 5, 'N');
  p.line(7, 12, 12, 6, 'N');
  p.set(5, 8, '6');
  return p;
}

function workshop(): Pix {
  const p = new Pix(16, 16);
  // Hammer on the diagonal, a gear tooth ring behind its head.
  p.line(5, 12, 11, 6, 'o');
  p.line(6, 12, 12, 6, 'O');
  p.rect(9, 2, 6, 4, '5');
  p.rect(9, 2, 6, 1, '6');
  p.rect(9, 5, 6, 1, '3');
  p.rect(14, 2, 1, 4, '3');
  p.set(2, 13, 'y');
  p.set(4, 14, 'y');
  p.set(2, 11, 'O');
  p.set(1, 9, 'y');
  p.outline('K');
  return p;
}

function shrine(): Pix {
  const p = new Pix(16, 16);
  p.rect(3, 12, 10, 2, '3');
  p.rect(3, 12, 10, 1, '4');
  p.rect(5, 10, 6, 2, '4');
  p.rect(6, 5, 4, 5, '4');
  p.rect(6, 5, 1, 5, '5');
  p.rect(9, 5, 1, 5, '3');
  // Violet flame.
  p.rect(7, 2, 2, 3, 'S');
  p.rect(6, 3, 4, 2, 'S');
  p.set(7, 1, 'S');
  p.rect(7, 3, 2, 2, 'T');
  p.set(8, 4, '6');
  p.set(5, 3, 's');
  p.set(10, 2, 's');
  p.outline('K');
  return p;
}

function windfall(): Pix {
  const p = new Pix(16, 16);
  const c = (cx: number, cy: number): void => {
    p.ellipse(cx, cy, 3.4, 2.4, 'o');
    p.ellipse(cx, cy - 0.5, 3, 2, 'y');
    p.set(Math.round(cx) - 1, Math.round(cy) - 1, '6');
  };
  c(5.5, 12.5);
  c(10.5, 12.5);
  c(8, 9.8);
  c(8, 4.5);
  // Sparkles.
  for (const [x, y] of [
    [2, 4],
    [13, 3],
    [13, 8],
  ] as const) {
    p.set(x, y, '6');
    p.set(x - 1, y, 'y');
    p.set(x + 1, y, 'y');
    p.set(x, y - 1, 'y');
    p.set(x, y + 1, 'y');
  }
  p.outline('K');
  return p;
}

function marketDay(): Pix {
  const p = new Pix(16, 16);
  // A stall: striped awning, two posts, a counter with a coin on it.
  for (let x = 2; x < 14; x += 2) {
    p.rect(x, 3, 2, 4, 'o');
    p.rect(x + 1, 3, 1, 4, '6');
  }
  p.rect(2, 7, 12, 1, '3');
  p.rect(3, 8, 1, 5, '3');
  p.rect(12, 8, 1, 5, '3');
  p.rect(2, 11, 12, 2, '4');
  p.rect(2, 11, 12, 1, '5');
  p.ellipse(8, 9.5, 1.6, 1.6, 'y');
  p.set(8, 9, '6');
  p.outline('K');
  return p;
}

function drill(): Pix {
  const p = new Pix(16, 16);
  // A drill bit pointing down: a shaft with two thread notches and a tip.
  p.rect(6, 2, 4, 3, '4');
  p.rect(6, 2, 1, 3, '5');
  p.rect(5, 5, 6, 2, '4');
  p.rect(5, 5, 6, 1, '5');
  p.rect(6, 7, 4, 2, '3');
  p.rect(7, 9, 2, 2, '3');
  p.line(6, 8, 9, 8, 'o');
  p.line(6, 6, 10, 6, '3');
  p.set(7, 11, '4');
  p.set(8, 12, 'o');
  p.set(4, 13, 'y');
  p.set(11, 13, 'y');
  p.set(8, 14, 'y');
  p.outline('K');
  return p;
}

function pact(): Pix {
  const p = new Pix(16, 16);
  // A scroll with a red wax seal: the contract.
  p.rect(3, 2, 10, 11, '6');
  p.rect(3, 2, 10, 1, '5');
  p.rect(2, 2, 1, 3, '4');
  p.rect(13, 11, 1, 3, '4');
  p.line(5, 5, 10, 5, '3');
  p.line(5, 7, 9, 7, '3');
  p.ellipse(9.5, 10.5, 2.2, 2.2, 'M');
  p.set(9, 10, 'm');
  p.outline('K');
  return p;
}

function richVein(): Pix {
  const p = new Pix(16, 16);
  // A rock face with a bright vein of ore running through it.
  p.rect(2, 4, 12, 9, '4');
  p.rect(2, 4, 12, 1, '5');
  p.rect(2, 12, 12, 1, '3');
  p.line(4, 11, 7, 8, 'y');
  p.line(7, 8, 9, 8, 'y');
  p.line(9, 8, 12, 5, 'y');
  p.set(5, 10, '6');
  p.set(10, 7, '6');
  p.set(7, 6, '3');
  p.set(11, 10, '3');
  p.outline('K');
  return p;
}

function blueprint(): Pix {
  const p = new Pix(16, 16);
  // A rolled plan: a sheet with a drawn square, a line and a dot.
  p.rect(3, 2, 10, 12, '6');
  p.rect(3, 2, 10, 1, '5');
  p.rect(5, 4, 4, 4, '3');
  p.rect(6, 5, 2, 2, '6');
  p.line(5, 10, 11, 10, '3');
  p.line(5, 12, 9, 12, '3');
  p.set(11, 5, 'y');
  p.outline('K');
  return p;
}

function caravan(): Pix {
  const p = new Pix(16, 16);
  // A covered wagon: a canvas hood on a cart body with two wheels.
  p.ellipse(8, 7, 5.5, 3.5, '6');
  p.rect(2, 8, 12, 4, '4');
  p.rect(2, 8, 12, 1, '5');
  p.rect(3, 6, 2, 1, '5');
  p.ellipse(5, 12.5, 2, 2, '3');
  p.set(5, 12, 'y');
  p.ellipse(11, 12.5, 2, 2, '3');
  p.set(11, 12, 'y');
  p.outline('K');
  return p;
}

/** The marker of a point of interest: a diamond that takes the holder's colour. */
function pointMarker(): Pix {
  const p = new Pix(16, 16);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const d = Math.abs(x + 0.5 - 8) + Math.abs(y + 0.5 - 8);
      if (d > 7) continue;
      if (d > 5.2) p.set(x, y, 'X');
      else if (x + y < 15 && d < 4) p.set(x, y, 'Z');
      else p.set(x, y, 'x');
    }
  p.outline('K');
  return p;
}

/** The icon of a point that makes new units stronger: a gold disc with an arrow up. */
function pointStrength(): Pix {
  const p = new Pix(16, 16);
  p.ellipse(8, 8, 6.2, 6.2, 'o');
  p.ellipse(8, 8, 5.2, 5.2, 'y');
  p.set(8, 4, 'K');
  p.rect(7, 5, 2, 1, 'K');
  p.rect(6, 6, 4, 1, 'K');
  p.rect(5, 7, 6, 1, 'K');
  p.rect(7, 8, 2, 4, 'K');
  p.outline('K');
  return p;
}

/** The icon of a healing point: a green disc with a white cross. */
function pointHeal(): Pix {
  const p = new Pix(16, 16);
  p.ellipse(8, 8, 6.2, 6.2, 't');
  p.ellipse(8, 8, 5.2, 5.2, 'N');
  p.rect(7, 4, 2, 8, '6');
  p.rect(4, 7, 8, 2, '6');
  p.outline('K');
  return p;
}

/** The icon of a neutral guard: a grey shield. */
function pointGuard(): Pix {
  const p = new Pix(16, 16);
  for (let y = 2; y < 14; y++) {
    const half = y < 9 ? 5 : 5 - (y - 8);
    if (half <= 0) continue;
    for (let x = 8 - half; x < 8 + half; x++) {
      p.set(x, y, x < 8 ? (y < 4 ? 'Z' : 'x') : 'X');
    }
  }
  p.rect(7, 4, 2, 7, 'K');
  p.outline('K');
  return p;
}

const EVENT_ICONS: Readonly<Record<string, () => Pix>> = {
  workshop,
  shrine,
  windfall,
  drill,
  market_day: marketDay,
  pact,
  rich_vein: richVein,
  blueprint,
  caravan,
};

export function uiSprites(): SpriteDef[] {
  const out: SpriteDef[] = [];
  const add = (d: Parameters<typeof sprite>[0]): void => {
    out.push(sprite(d));
  };
  add({
    name: 'ui_panel',
    sheet: 'ui',
    category: 'ui',
    frames: speckled(32, '1', '0', '2', 21, 26),
    note: 'Tileable panel texture, 32x32, low contrast.',
  });
  add({
    name: 'ui_bg',
    sheet: 'ui',
    category: 'ui',
    frames: speckled(64, 'K', '0', '0', 7, 40),
    note: 'Tileable page background, 64x64, darker than the panel.',
  });
  for (const k of ['normal', 'hover', 'disabled'] as const) {
    add({
      name: `ui_button_${k}`,
      sheet: 'ui',
      category: 'ui',
      frames: button(k),
      nineSlice: [5, 5, 5, 5],
      note: `Button 9-slice, ${k}.`,
    });
  }
  add({
    name: 'ui_card',
    sheet: 'ui',
    category: 'ui',
    frames: card(),
    nineSlice: [8, 8, 8, 8],
    note: 'Card frame 9-slice.',
  });
  add({
    name: 'ui_icon_coin',
    sheet: 'ui',
    category: 'ui',
    frames: coin(),
    note: 'Gold.',
  });
  add({
    name: 'ui_icon_heart',
    sheet: 'ui',
    category: 'ui',
    frames: heart(),
    note: 'Lives.',
  });
  add({
    name: 'ui_icon_lock',
    sheet: 'ui',
    category: 'ui',
    frames: lock(),
    note: 'Locked.',
  });
  add({
    name: 'ui_icon_ready',
    sheet: 'ui',
    category: 'ui',
    frames: tick(),
    note: 'Ready tick.',
  });
  add({
    name: 'ui_point_marker',
    sheet: 'ui',
    category: 'ui',
    frames: pointMarker(),
    tintable: true,
    note: 'Point of interest marker; the tint ramp is the holder colour.',
  });
  add({
    name: 'ui_point_strength',
    sheet: 'ui',
    category: 'ui',
    frames: pointStrength(),
    note: 'Point buff: stronger new units.',
  });
  add({
    name: 'ui_point_heal',
    sheet: 'ui',
    category: 'ui',
    frames: pointHeal(),
    note: 'Point buff: healing.',
  });
  add({
    name: 'ui_point_guard',
    sheet: 'ui',
    category: 'ui',
    frames: pointGuard(),
    note: 'Neutral guard of a point.',
  });
  for (const type of loadEventTypes()) {
    const make = EVENT_ICONS[type];
    if (!make) continue;
    add({
      name: `ui_event_${type}`,
      sheet: 'ui',
      category: 'ui',
      frames: make(),
      note: `Event type ${type}.`,
    });
  }
  return out;
}
