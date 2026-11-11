/** Interface textures, 9-slices and icons. */

import { loadEventTypes } from '../content.js';
import { Pix, bevelShape, rng, roundRect } from '../pix.js';
import { sprite, wset, type SpriteDef } from '../model.js';

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
  for (let i = 0; i < n; i++) {
    wset(
      p,
      Math.floor(r() * size),
      Math.floor(r() * size),
      i % 3 === 0 ? light : dark,
    );
  }
  return p;
}

function pageBackground(): Pix {
  const p = speckled(32, 'K', '0', 'a', 7, 40);
  // A faint 16 px lattice so the page does not feel empty.
  for (let i = 0; i < 32; i++) {
    if (i % 2 === 0) {
      p.set(i, 0, '0');
      p.set(0, i, '0');
      p.set(i, 16, '0');
      p.set(16, i, '0');
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
      const f = Math.pow(u * u + v * v - 1, 3) - u * u * v * v * v;
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

const EVENT_ICONS: Readonly<Record<string, () => Pix>> = {
  workshop,
  shrine,
  windfall,
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
    frames: speckled(16, '1', '0', '2', 21, 14),
    note: 'Tileable panel texture.',
  });
  add({
    name: 'ui_bg',
    sheet: 'ui',
    category: 'ui',
    frames: pageBackground(),
    note: 'Tileable page background, darker than the panel.',
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
