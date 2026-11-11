/** Short effects: sparks, explosion, spawn puff, projectile, shadow. */

import { Pix, rng } from '../pix.js';
import { angleIndex, cos64, sin64 } from '../trig.js';
import { sprite, type SpriteDef } from '../model.js';

function hitSpark(frame: number): Pix {
  const p = new Pix(16, 16);
  if (frame === 0) {
    p.rect(7, 5, 2, 6, '6');
    p.rect(5, 7, 6, 2, '6');
    p.rect(7, 7, 2, 2, 'y');
  } else if (frame === 1) {
    p.line(8, 2, 8, 13, 'y');
    p.line(2, 8, 13, 8, 'y');
    p.line(3, 3, 12, 12, 'O');
    p.line(12, 3, 3, 12, 'O');
    p.rect(7, 7, 2, 2, '6');
  } else {
    for (const [x, y] of [
      [3, 3],
      [12, 3],
      [3, 12],
      [12, 12],
      [8, 1],
      [8, 14],
      [1, 8],
      [14, 8],
    ] as const)
      p.set(x, y, 'O');
    p.set(5, 5, 'y');
    p.set(10, 5, 'y');
    p.set(5, 10, 'y');
    p.set(10, 10, 'y');
  }
  return p;
}

/**
 * An irregular blob: the radius wobbles with the angle, so it reads as flame.
 * `phase` is a whole number of angle steps (64 per turn), no trig functions.
 */
function flame(
  p: Pix,
  cx: number,
  cy: number,
  rad: number,
  key: string,
  phase: number,
  wobble = 0.28,
): void {
  const ph = Math.round(phase * 10);
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const i = angleIndex(dx, dy);
      const wob = (sin64(i * 5 + ph) * sin64(i * 3 - ph)) / 1000000;
      const r = rad * (1 + wobble * wob);
      if (dx * dx + dy * dy <= r * r) p.set(x, y, key);
    }
}

function explosion(frame: number): Pix {
  const p = new Pix(32, 32);
  const r = rng(40 + frame);
  if (frame === 0) {
    flame(p, 16, 16, 7, 'O', 0.5, 0.2);
    flame(p, 16, 16, 5, 'y', 1, 0.2);
    flame(p, 16, 16, 2.6, '6', 2, 0.1);
  } else if (frame === 1) {
    flame(p, 16, 16, 12, 'm', 1.2);
    flame(p, 16, 16, 10.5, 'M', 2.2);
    flame(p, 16, 15.5, 8, 'O', 3.1);
    flame(p, 15.5, 15, 5, 'y', 4);
    flame(p, 15, 14.5, 2.6, '6', 5, 0.1);
  } else if (frame === 2) {
    flame(p, 16, 16, 14, 'm', 2.6, 0.3);
    flame(p, 16, 16, 12, 'M', 3.6, 0.3);
    flame(p, 16, 16, 8.5, 'O', 4.6, 0.3);
    flame(p, 16, 16, 4, 'y', 5.6, 0.2);
    // Dark gaps where the fire is tearing apart.
    for (let i = 0; i < 4; i++) {
      const a = Math.floor(r() * 64);
      const d = 6 + r() * 6;
      p.ellipse(
        16 + (cos64(a) * d) / 1000,
        16 + (sin64(a) * d) / 1000,
        1.6,
        1.6,
        '1',
      );
    }
  } else {
    // Embers and smoke, dithered away.
    for (let i = 0; i < 6; i++) {
      const a = Math.round((i * 64) / 6) + 4;
      flame(
        p,
        16 + (cos64(a) * 9) / 1000,
        16 + (sin64(a) * 9) / 1000,
        3.4,
        '2',
        i,
        0.3,
      );
    }
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) if ((x + y) % 2 === 0) p.set(x, y, '.');
    for (let i = 0; i < 10; i++) {
      const a = Math.floor(r() * 64);
      const d = 8 + r() * 7;
      p.set(
        Math.round(16 + (cos64(a) * d) / 1000),
        Math.round(16 + (sin64(a) * d) / 1000),
        i % 2 === 0 ? 'O' : 'y',
      );
    }
  }
  return p;
}

function spawnPuff(frame: number): Pix {
  const p = new Pix(16, 16);
  const puff = (cx: number, cy: number, rad: number): void => {
    p.ellipse(cx, cy, rad, rad, '5');
    p.ellipse(cx - 0.4, cy - 0.4, rad * 0.55, rad * 0.55, '6');
  };
  if (frame === 0) {
    puff(8, 8, 3);
  } else if (frame === 1) {
    for (const [dx, dy] of [
      [-4, 0],
      [4, 0],
      [0, -4],
      [0, 4],
      [-3, -3],
      [3, 3],
    ] as const)
      puff(8 + dx, 8 + dy, 2.2);
    puff(8, 8, 2.5);
  } else {
    for (const [dx, dy] of [
      [-6, 0],
      [6, 0],
      [0, -6],
      [0, 6],
      [-4, -4],
      [4, 4],
      [4, -4],
      [-4, 4],
    ] as const) {
      p.set(8 + dx, 8 + dy, '4');
      p.set(8 + dx + 1, 8 + dy, '5');
    }
  }
  return p;
}

function turretShot(frame: number): Pix {
  const p = new Pix(8, 8);
  // Points north; rotate to aim.
  p.rect(3, 1, 2, 6, frame === 0 ? 'y' : 'O');
  p.rect(3, 0, 2, 2, '6');
  p.set(3, 6, 'o');
  p.set(4, 7, 'o');
  p.outline('K');
  return p;
}

function shadow(): Pix {
  const p = new Pix(16, 16);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const dx = (x + 0.5 - 8) / 7.5;
      const dy = (y + 0.5 - 8) / 5;
      const d2 = dx * dx + dy * dy;
      if (d2 > 1) continue;
      const a = d2 < 0.25 ? 100 : d2 < 0.64 ? 70 : (x + y) % 2 === 0 ? 42 : 0;
      if (a > 0) p.setRgba(x, y, [0, 0, 0, a]);
    }
  return p;
}

export function effectSprites(): SpriteDef[] {
  const out: SpriteDef[] = [];
  const add = (d: Parameters<typeof sprite>[0]): void => {
    out.push(sprite(d));
  };
  add({
    name: 'fx_hit_spark',
    sheet: 'effects',
    category: 'effect',
    frames: [0, 1, 2].map(hitSpark),
    fps: 14,
    note: 'Play once, 3 frames.',
  });
  add({
    name: 'fx_explosion',
    sheet: 'effects',
    category: 'effect',
    frames: [0, 1, 2, 3].map(explosion),
    fps: 10,
    note: 'Destroyed unit or building, 4 frames, 32x32 (scale down for units).',
  });
  add({
    name: 'fx_spawn_puff',
    sheet: 'effects',
    category: 'effect',
    frames: [0, 1, 2].map(spawnPuff),
    fps: 9,
    note: 'Unit spawn, 3 frames.',
  });
  add({
    name: 'fx_turret_shot',
    sheet: 'effects',
    category: 'effect',
    frames: [0, 1].map(turretShot),
    fps: 12,
    note: 'Projectile pointing north; rotate to aim.',
  });
  add({
    name: 'fx_shadow',
    sheet: 'effects',
    category: 'effect',
    frames: shadow(),
    note: 'Soft ground shadow (semi-transparent black) for flyers; scale with the unit.',
  });
  return out;
}
