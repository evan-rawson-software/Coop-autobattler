import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import type { Atlas } from './atlas.js';
import { outDir, buildAll } from './build.js';
import {
  loadBuildings,
  loadEventTypes,
  loadResources,
  loadTerrainIds,
  loadUnitIds,
} from './content.js';
import { decodePng } from './png.js';

const committed = JSON.parse(
  readFileSync(path.join(outDir, 'atlas.json'), 'utf8'),
) as Atlas;

describe('committed assets', () => {
  const fresh = buildAll();

  test('atlas.json matches a fresh build', () => {
    expect(readFileSync(path.join(outDir, 'atlas.json'), 'utf8')).toBe(
      fresh.atlasJson,
    );
  });

  test('sheet PNGs are byte-identical to a fresh build', () => {
    for (const [file, buf] of fresh.built.pngs) {
      expect(
        Buffer.compare(readFileSync(path.join(outDir, file)), buf),
        file,
      ).toBe(0);
    }
  });

  test('building twice gives identical bytes', () => {
    const again = buildAll();
    expect(again.atlasJson).toBe(fresh.atlasJson);
    for (const [file, buf] of fresh.built.pngs)
      expect(Buffer.compare(again.built.pngs.get(file) ?? Buffer.alloc(0), buf)).toBe(0);
  });
});

describe('atlas consistency', () => {
  test('every region lies inside its sheet and none overlap', () => {
    const sizes = new Map<string, { w: number; h: number }>();
    for (const [name, s] of Object.entries(committed.sheets)) {
      const png = decodePng(readFileSync(path.join(outDir, s.file)));
      expect({ w: png.w, h: png.h }, name).toEqual({ w: s.w, h: s.h });
      sizes.set(name, { w: s.w, h: s.h });
    }
    const bySheet = new Map<string, { name: string; x: number; y: number; w: number; h: number }[]>();
    for (const [name, sp] of Object.entries(committed.sprites)) {
      const sheet = sizes.get(sp.sheet);
      expect(sheet, `${name} sheet`).toBeDefined();
      const w = sp.w * sp.frames;
      expect(sp.x, name).toBeGreaterThanOrEqual(0);
      expect(sp.y, name).toBeGreaterThanOrEqual(0);
      expect(sp.x + w, name).toBeLessThanOrEqual(sheet?.w ?? 0);
      expect(sp.y + sp.h, name).toBeLessThanOrEqual(sheet?.h ?? 0);
      expect(sp.frames, name).toBeGreaterThanOrEqual(1);
      expect(sp.anchor[0], name).toBeGreaterThanOrEqual(0);
      expect(sp.anchor[0], name).toBeLessThanOrEqual(sp.w);
      expect(sp.anchor[1], name).toBeLessThanOrEqual(sp.h);
      const list = bySheet.get(sp.sheet) ?? [];
      list.push({ name, x: sp.x, y: sp.y, w, h: sp.h });
      bySheet.set(sp.sheet, list);
    }
    for (const list of bySheet.values())
      for (const [i, a] of list.entries())
        for (const b of list.slice(i + 1)) {
          const apart =
            a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
          expect(apart, `${a.name} overlaps ${b.name}`).toBe(true);
        }
  });

  test('every sprite has at least one opaque pixel in each frame', () => {
    const sheets = new Map<string, ReturnType<typeof decodePng>>();
    for (const [name, s] of Object.entries(committed.sheets))
      sheets.set(name, decodePng(readFileSync(path.join(outDir, s.file))));
    for (const [name, sp] of Object.entries(committed.sprites)) {
      const png = sheets.get(sp.sheet);
      for (let f = 0; f < sp.frames; f++) {
        let any = false;
        for (let y = 0; y < sp.h && !any; y++)
          for (let x = 0; x < sp.w && !any; x++) {
            const o = ((sp.y + y) * (png?.w ?? 0) + sp.x + f * sp.w + x) * 4 + 3;
            if ((png?.rgba[o] ?? 0) > 0) any = true;
          }
        expect(any, `${name} frame ${f} is empty`).toBe(true);
      }
    }
  });

  test('9-slice margins fit inside their sprite', () => {
    for (const [name, sp] of Object.entries(committed.sprites)) {
      if (!sp.nineSlice) continue;
      const [l, t, r, b] = sp.nineSlice;
      expect(l + r, name).toBeLessThan(sp.w);
      expect(t + b, name).toBeLessThan(sp.h);
    }
  });
});

describe('content coverage', () => {
  const has = (name: string): boolean => name in committed.sprites;

  test('every building has a sprite matching its footprint', () => {
    for (const b of loadBuildings()) {
      expect(has(b.id), `building ${b.id}`).toBe(true);
      const sp = committed.sprites[b.id];
      expect(sp?.w, b.id).toBe(b.width * committed.tile);
      expect(sp?.h, b.id).toBe(b.height * committed.tile);
    }
  });

  test('every unit has neutral and both team sprites with idle, walk and attack', () => {
    for (const id of loadUnitIds())
      for (const base of [id, `${id}@a`, `${id}@b`]) {
        expect(has(base), base).toBe(true);
        expect(committed.sprites[`${base}.walk`]?.frames, `${base}.walk`).toBe(2);
        expect(committed.sprites[`${base}.attack`]?.frames, `${base}.attack`).toBeGreaterThanOrEqual(2);
      }
  });

  test('every terrain feature has a sprite', () => {
    for (const id of loadTerrainIds()) expect(has(id), `terrain ${id}`).toBe(true);
  });

  test('every resource has a node sprite and a tint ramp', () => {
    for (const r of loadResources()) {
      expect(has(`node_${r.id}`), `node of ${r.id}`).toBe(true);
      expect(committed.tint.resources[r.id], `ramp of ${r.id}`).toHaveLength(3);
    }
  });

  test('every event type has an icon', () => {
    for (const t of loadEventTypes()) expect(has(`ui_event_${t}`), t).toBe(true);
  });

  test('conduit, effect and ui pieces are present', () => {
    for (const n of [
      'conduit_straight', 'conduit_corner', 'conduit_t', 'conduit_cross', 'conduit_end', 'conduit_item',
      'fx_hit_spark', 'fx_explosion', 'fx_spawn_puff', 'fx_turret_shot', 'fx_shadow',
      'ui_panel', 'ui_bg', 'ui_button_normal', 'ui_button_hover', 'ui_button_disabled', 'ui_card',
      'ui_icon_coin', 'ui_icon_heart', 'ui_icon_lock', 'ui_icon_ready', 'tier_pips',
      'ground_1', 'ground_2', 'ground_3', 'neutral_1', 'ter_lake_auto', 'ter_cliff_auto',
    ])
      expect(has(n), n).toBe(true);
    expect(committed.sprites['fx_hit_spark']?.frames).toBe(3);
    expect(committed.sprites['fx_explosion']?.frames).toBe(4);
    expect(committed.sprites['fx_spawn_puff']?.frames).toBe(3);
  });

  test('planned sprites exist and are listed as planned', () => {
    for (const n of ['unit_archer', 'unit_drone', 'bld_range', 'bld_hangar']) {
      expect(has(n), n).toBe(true);
      expect(committed.planned).toContain(n);
    }
  });
});
