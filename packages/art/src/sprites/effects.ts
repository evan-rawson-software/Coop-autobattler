/** Short effects: sparks, explosion, spawn puff, projectile, shadow. */

import { Pix, rng } from '../pix.js';
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

function explosion(frame: number): Pix {
  const p = new Pix(32, 32);
  const r = rng(40 + frame);
  const blob = (cx: number, cy: number, rad: number, key: string): void =>
    p.ellipse(cx, cy, rad, rad, key);
  if (frame === 0) {
    blob(16, 16, 6, 'O');
    blob(16, 16, 4.5, 'y');
    blob(16, 16, 2.5, '6');
  } else if (frame === 1) {
    blob(16, 16, 11, 'M');
    blob(16, 16, 9, 'O');
    blob(16, 15, 6, 'y');
    blob(15, 14, 3, '6');
    for (let i = 0; i < 6; i++) blob(16 + (r() - 0.5) * 22, 16 + (r() - 0.5) * 22, 2, 'O');
  } else if (frame === 2) {
    blob(16, 16, 13, 'm');
    blob(16, 16, 11, 'M');
    blob(15, 16, 7, 'O');
    blob(15, 15, 3.5, 'y');
    for (let i = 0; i < 5; i++) blob(16 + (r() - 0.5) * 26, 16 + (r() - 0.5) * 26, 2.5, '1');
  } else {
    // Smoke, dithered away.
    for (let i = 0; i < 7; i++) blob(16 + (r() - 0.5) * 20, 14 + (r() - 0.5) * 18, 4, '2');
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) if ((x + y) % 2 === 0) p.set(x, y, '.');
    for (let i = 0; i < 8; i++) {
      const a = r() * Math.PI * 2;
      p.set(Math.round(16 + Math.cos(a) * 12), Math.round(16 + Math.sin(a) * 12), 'O');
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
      const d = Math.hypot(dx, dy);
      if (d > 1) continue;
      const a = d < 0.5 ? 100 : d < 0.8 ? 70 : (x + y) % 2 === 0 ? 42 : 0;
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
