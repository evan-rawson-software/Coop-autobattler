import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import type { Atlas } from './atlas.js';
import { BLOB47, NE, N, E, S, W, blobFrame, canonical } from './autotile.js';
import { outDir, buildAll } from './build.js';
import {
  type BuildingInfo,
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

type Decoded = ReturnType<typeof decodePng>;

function readSheet(file: string): Decoded {
  return decodePng(readFileSync(path.join(outDir, file)));
}

/** Pixel `(x, y)` of one frame of a sprite, as `[r, g, b, a]`. */
function px(
  sheet: Decoded,
  sp: Atlas['sprites'][string],
  frame: number,
  x: number,
  y: number,
): number[] {
  const cols = sp.columns ?? sp.frames;
  const fx = sp.x + (frame % cols) * sp.w + x;
  const fy = sp.y + Math.floor(frame / cols) * sp.h + y;
  const o = (fy * sheet.w + fx) * 4;
  return [...sheet.rgba.subarray(o, o + 4)];
}

describe('committed assets', () => {
  const fresh = buildAll();

  // The PNG bytes depend on the zlib build inside Node, so the committed
  // files are compared by what they show: dimensions and decoded RGBA.
  test('atlas.json matches a fresh build', () => {
    const onDisk = JSON.parse(
      readFileSync(path.join(outDir, 'atlas.json'), 'utf8'),
    ) as unknown;
    expect(onDisk).toEqual(JSON.parse(fresh.atlasJson));
  });

  test('sheet pixels match a fresh build', () => {
    expect([...fresh.built.pngs.keys()].sort()).toEqual(
      Object.values(committed.sheets)
        .map((s) => s.file)
        .sort(),
    );
    for (const [file, buf] of fresh.built.pngs) {
      const want = decodePng(buf);
      const have = readSheet(file);
      expect({ w: have.w, h: have.h }, file).toEqual({
        w: want.w,
        h: want.h,
      });
      expect(Buffer.compare(have.rgba, want.rgba), `${file} pixels`).toBe(0);
    }
  });

  test('building twice gives identical pixels and atlas', () => {
    const again = buildAll();
    expect(again.atlasJson).toBe(fresh.atlasJson);
    for (const [file, buf] of fresh.built.pngs) {
      const a = decodePng(again.built.pngs.get(file) ?? new Uint8Array());
      expect(Buffer.compare(a.rgba, decodePng(buf).rgba), file).toBe(0);
    }
  });
});

describe('generation avoids engine-dependent maths', () => {
  test('no Math.sin, cos, tan, atan2, pow, hypot or exp in generator code', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const files = [
      ...readdirSync(dir)
        .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
        .map((f) => path.join(dir, f)),
      ...readdirSync(path.join(dir, 'sprites')).map((f) =>
        path.join(dir, 'sprites', f),
      ),
    ];
    const banned =
      /Math\.(sin|cos|tan|asin|acos|atan|atan2|pow|hypot|exp|log)\b/;
    for (const f of files)
      expect(banned.test(readFileSync(f, 'utf8')), path.basename(f)).toBe(
        false,
      );
  });
});

/** Region of a sprite: all frames, laid out `columns` per row. */
function region(sp: Atlas['sprites'][string]): { w: number; h: number } {
  const cols = sp.columns ?? sp.frames;
  return { w: sp.w * cols, h: sp.h * Math.ceil(sp.frames / cols) };
}

describe('atlas consistency', () => {
  test('every region lies inside its sheet and none overlap', () => {
    const sizes = new Map<string, { w: number; h: number }>();
    for (const [name, s] of Object.entries(committed.sheets)) {
      const png = readSheet(s.file);
      expect({ w: png.w, h: png.h }, name).toEqual({ w: s.w, h: s.h });
      sizes.set(name, { w: s.w, h: s.h });
    }
    const bySheet = new Map<
      string,
      { name: string; x: number; y: number; w: number; h: number }[]
    >();
    for (const [name, sp] of Object.entries(committed.sprites)) {
      const sheet = sizes.get(sp.sheet);
      expect(sheet, `${name} sheet`).toBeDefined();
      const r = region(sp);
      expect(sp.x, name).toBeGreaterThanOrEqual(0);
      expect(sp.y, name).toBeGreaterThanOrEqual(0);
      expect(sp.x + r.w, name).toBeLessThanOrEqual(sheet?.w ?? 0);
      expect(sp.y + r.h, name).toBeLessThanOrEqual(sheet?.h ?? 0);
      expect(sp.frames, name).toBeGreaterThanOrEqual(1);
      // Both anchor coordinates lie within the frame.
      expect(sp.anchor[0], `${name} anchor x`).toBeGreaterThanOrEqual(0);
      expect(sp.anchor[0], `${name} anchor x`).toBeLessThanOrEqual(sp.w);
      expect(sp.anchor[1], `${name} anchor y`).toBeGreaterThanOrEqual(0);
      expect(sp.anchor[1], `${name} anchor y`).toBeLessThanOrEqual(sp.h);
      const list = bySheet.get(sp.sheet) ?? [];
      list.push({ name, x: sp.x, y: sp.y, ...r });
      bySheet.set(sp.sheet, list);
    }
    for (const list of bySheet.values())
      for (const [i, a] of list.entries())
        for (const b of list.slice(i + 1)) {
          const apart =
            a.x + a.w <= b.x ||
            b.x + b.w <= a.x ||
            a.y + a.h <= b.y ||
            b.y + b.h <= a.y;
          expect(apart, `${a.name} overlaps ${b.name}`).toBe(true);
        }
  });

  test('every frame of every sprite has at least one opaque pixel', () => {
    const sheets = new Map<string, Decoded>();
    for (const [name, s] of Object.entries(committed.sheets))
      sheets.set(name, readSheet(s.file));
    for (const [name, sp] of Object.entries(committed.sprites)) {
      const png = sheets.get(sp.sheet) as Decoded;
      for (let f = 0; f < sp.frames; f++) {
        let any = false;
        for (let y = 0; y < sp.h && !any; y++)
          for (let x = 0; x < sp.w && !any; x++)
            if ((px(png, sp, f, x, y)[3] ?? 0) > 0) any = true;
        expect(any, `${name} frame ${String(f)} is empty`).toBe(true);
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

describe('tile sheet grid', () => {
  const sheet = committed.sheets['tiles'];

  test('the tiles sheet is a gutterless grid of whole cells', () => {
    expect(sheet?.grid).toBe(committed.tile);
    expect((sheet?.w ?? 1) % committed.tile).toBe(0);
    expect((sheet?.h ?? 1) % committed.tile).toBe(0);
    for (const [name, sp] of Object.entries(committed.sprites)) {
      if (sp.sheet !== 'tiles') continue;
      expect(sp.x % committed.tile, `${name} x`).toBe(0);
      expect(sp.y % committed.tile, `${name} y`).toBe(0);
      expect(sp.w % committed.tile, `${name} w`).toBe(0);
      expect(sp.h % committed.tile, `${name} h`).toBe(0);
    }
  });

  test('all terrain, node and conduit sprites are on it, and only they', () => {
    for (const [name, sp] of Object.entries(committed.sprites)) {
      const tiled = ['terrain', 'node', 'conduit'].includes(sp.category);
      expect(sp.sheet === 'tiles', name).toBe(tiled);
    }
  });

  test('free-form sheets keep their gutter between sprites', () => {
    expect(committed.gutter).toBeGreaterThanOrEqual(1);
    for (const [name, s] of Object.entries(committed.sheets))
      if (s.grid === undefined)
        expect(name === 'tiles', `${name} should be gridded`).toBe(false);
  });
});

describe('autotiles', () => {
  test('canonical masks: 47 distinct, corners only count with both sides', () => {
    expect(BLOB47).toHaveLength(47);
    expect(committed.autotile.blob47.masks).toEqual([...BLOB47]);
    expect(canonical(NE)).toBe(0);
    expect(canonical(N | NE)).toBe(N);
    expect(canonical(N | E | NE)).toBe(N | E | NE);
    expect(canonical(255)).toBe(255);
    expect(blobFrame(0)).toBe(0);
    expect(blobFrame(255)).toBe(46);
  });

  test('the lake and cliff sets have one distinct frame per canonical mask', () => {
    const sheet = readSheet('tiles.png');
    for (const name of ['ter_lake_auto', 'ter_cliff_auto']) {
      const sp = committed.sprites[name];
      expect(sp?.autotile, name).toBe('blob47');
      expect(sp?.frames, name).toBe(47);
      if (!sp) continue;
      const seen = new Set<string>();
      for (let f = 0; f < sp.frames; f++) {
        const pixels: number[] = [];
        for (let y = 0; y < sp.h; y++)
          for (let x = 0; x < sp.w; x++) pixels.push(...px(sheet, sp, f, x, y));
        seen.add(pixels.join(','));
      }
      expect(seen.size, `${name} frames are all different`).toBe(47);
    }
  });

  test('an isolated tile is outlined all round; a surrounded one is open', () => {
    const sheet = readSheet('tiles.png');
    const sp = committed.sprites['ter_cliff_auto'] as Atlas['sprites'][string];
    const lone = blobFrame(0);
    const full = blobFrame(255);
    for (const [x, y] of [
      [8, 0],
      [8, 15],
      [0, 8],
      [15, 8],
    ] as const)
      expect(
        px(sheet, sp, lone, x, y),
        `lone ${String(x)},${String(y)}`,
      ).toEqual([10, 13, 17, 255]);
    for (const [x, y] of [
      [0, 0],
      [15, 0],
      [0, 15],
      [15, 15],
      [8, 0],
    ] as const)
      expect(
        px(sheet, sp, full, x, y)[3],
        `full ${String(x)},${String(y)}`,
      ).toBe(255);
  });
});

describe('no tiling stripes', () => {
  type Sprite = Atlas['sprites'][string];
  const sheet = readSheet('tiles.png');
  const key = (sp: Sprite, f: number, x: number, y: number): string =>
    px(sheet, sp, f, x, y).join(',');
  const dominant = (sp: Sprite, f: number): string => {
    const counts = new Map<string, number>();
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++)
        counts.set(key(sp, f, x, y), (counts.get(key(sp, f, x, y)) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  };
  /** Indices of lines (rows or columns) that are one flat non-dominant colour. */
  const flatLines = (sp: Sprite, f: number, tiles: number): string[] => {
    const dom = dominant(sp, f);
    const n = 16 * tiles;
    const at = (x: number, y: number): string => key(sp, f, x % 16, y % 16);
    const bad: string[] = [];
    for (let i = 0; i < n; i++) {
      const col = new Set<string>();
      const row = new Set<string>();
      for (let j = 0; j < n; j++) {
        col.add(at(i, j));
        row.add(at(j, i));
      }
      const c = [...col];
      const r = [...row];
      if (c.length === 1 && c[0] !== dom) bad.push(`col ${String(i)}`);
      if (r.length === 1 && r[0] !== dom) bad.push(`row ${String(i)}`);
    }
    return bad;
  };

  test('tileable terrain has no flat stripe when tiled 4x4', () => {
    for (const [name, sp] of Object.entries(committed.sprites)) {
      if (!/^(ground_|neutral_|ter_water)/.test(name)) continue;
      for (let f = 0; f < sp.frames; f++)
        expect(flatLines(sp, f, 4), `${name} frame ${String(f)}`).toEqual([]);
    }
  });

  test('interior autotile frames have no flat stripe when tiled 4x4', () => {
    for (const name of ['ter_lake_auto', 'ter_cliff_auto']) {
      const sp = committed.sprites[name] as Sprite;
      expect(flatLines(sp, blobFrame(255), 4), name).toEqual([]);
    }
  });

  test('a joined edge is never a flat colour unlike the interior', () => {
    for (const name of ['ter_lake_auto', 'ter_cliff_auto']) {
      const sp = committed.sprites[name] as Sprite;
      BLOB47.forEach((mask, f) => {
        const dom = dominant(sp, f);
        const edges: [number, (i: number) => [number, number]][] = [
          [N, (i) => [i, 0]],
          [S, (i) => [i, 15]],
          [W, (i) => [0, i]],
          [E, (i) => [15, i]],
        ];
        for (const [bit, at] of edges) {
          if (!(mask & bit)) continue;
          const colours = new Set<string>();
          for (let i = 0; i < 16; i++) colours.add(key(sp, f, ...at(i)));
          const flat = colours.size === 1 ? [...colours][0] : dom;
          expect(flat, `${name} mask ${String(mask)} side ${String(bit)}`).toBe(
            dom,
          );
        }
      });
    }
  });
});

describe('look', () => {
  const luminance = (c: readonly number[]): number => {
    const f = (v: number): number => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return (
      0.2126 * f(c[0] ?? 0) + 0.7152 * f(c[1] ?? 0) + 0.0722 * f(c[2] ?? 0)
    );
  };
  const rgbOf = (key: string): number[] => {
    const e = committed.palette.find((p) => p.key === key);
    const n = parseInt((e?.hex ?? '#000000').slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };

  test('cliff top and south face stand out from the UI panel colour', () => {
    const panel = luminance(rgbOf('1')) + 0.05;
    const top = luminance(rgbOf('q')) + 0.05;
    const lip = luminance(rgbOf('p')) + 0.05;
    expect(top / panel).toBeGreaterThan(1.8);
    expect(lip / panel).toBeGreaterThan(2.6);
  });

  test('ground, neutral and panel textures only use neighbouring shades', () => {
    const allowed: Record<string, string[]> = {
      ground: ['b', 'c', 'd'],
      neutral: ['a', 'f', 'g'],
      ui_panel: ['0', '1', '2'],
      ui_bg: ['K', '0'],
    };
    for (const [name, sp] of Object.entries(committed.sprites)) {
      const group = Object.keys(allowed).find((g) => name.startsWith(g));
      if (!group) continue;
      const png = readSheet(`${sp.sheet}.png`);
      const ok = new Set((allowed[group] ?? []).map((k) => rgbOf(k).join(',')));
      for (let y = 0; y < sp.h; y++)
        for (let x = 0; x < sp.w; x++) {
          const c = px(png, sp, 0, x, y);
          expect(
            ok.has(c.slice(0, 3).join(',')),
            `${name} ${String(x)},${String(y)}`,
          ).toBe(true);
        }
    }
  });

  test('there are enough ground and neutral variants to vary at random', () => {
    const n = (p: string): number =>
      Object.keys(committed.sprites).filter((k) => k.startsWith(p)).length;
    expect(n('ground_')).toBeGreaterThanOrEqual(6);
    expect(n('neutral_')).toBeGreaterThanOrEqual(4);
    expect(committed.sprites['ui_panel']?.w).toBeGreaterThanOrEqual(32);
    expect(committed.sprites['ui_bg']?.w).toBeGreaterThanOrEqual(64);
  });

  test('tier 2 and tier 3 trims add pixels beyond the pips', () => {
    const png = readSheet('buildings.png');
    for (const [name, size] of [
      ['tier_trim_1x1', 16],
      ['tier_trim_2x2', 32],
    ] as const) {
      const sp = committed.sprites[name];
      expect(sp?.frames, name).toBe(2);
      expect(sp?.w, name).toBe(size);
      if (!sp) continue;
      const count = (f: number): number => {
        let n = 0;
        for (let y = 0; y < sp.h; y++)
          for (let x = 0; x < sp.w; x++)
            if ((px(png, sp, f, x, y)[3] ?? 0) > 0) n++;
        return n;
      };
      expect(count(0), `${name} tier 2`).toBeGreaterThanOrEqual(16);
      expect(count(1), `${name} tier 3`).toBeGreaterThan(count(0));
    }
  });
});

describe('units', () => {
  const sheet = readSheet('units.png');
  const unitIds = ['unit_soldier', 'unit_raider', 'unit_archer', 'unit_drone'];
  const frameOf = (name: string, f = 0): number[][] => {
    const sp = committed.sprites[name] as Atlas['sprites'][string];
    const out: number[][] = [];
    for (let y = 0; y < sp.h; y++)
      for (let x = 0; x < sp.w; x++) out.push(px(sheet, sp, f, x, y));
    return out;
  };
  const diff = (a: number[][], b: number[][]): number =>
    a.filter((c, i) => c.join(',') !== (b[i] ?? []).join(',')).length;
  const silhouette = (a: number[][]): boolean[] =>
    a.map((c) => (c[3] ?? 0) > 0);
  const rampRgb = (hexes: readonly string[]): string[] =>
    hexes.map((h) => {
      const n = parseInt(h.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255].join(',');
    });

  test('walk and attack frames differ visibly from idle and from each other', () => {
    for (const id of unitIds)
      for (const side of ['', '@a', '@b']) {
        const idle = frameOf(`${id}${side}`);
        const w0 = frameOf(`${id}${side}.walk`, 0);
        const w1 = frameOf(`${id}${side}.walk`, 1);
        const a0 = frameOf(`${id}${side}.attack`, 0);
        const a1 = frameOf(`${id}${side}.attack`, 1);
        const what = `${id}${side}`;
        expect(diff(w0, w1), `${what} walk frames`).toBeGreaterThanOrEqual(8);
        expect(diff(a0, a1), `${what} attack frames`).toBeGreaterThanOrEqual(
          12,
        );
        expect(
          diff(idle, a0),
          `${what} idle vs wind-up`,
        ).toBeGreaterThanOrEqual(8);
        expect(diff(idle, a1), `${what} idle vs strike`).toBeGreaterThanOrEqual(
          8,
        );
      }
  });

  test('team colour sits on the body, in the same places for neutral and teams', () => {
    const neutral = rampRgb(committed.tint.neutral);
    for (const id of unitIds)
      for (const [side, ramp] of [
        ['@a', rampRgb(committed.tint.teamA)],
        ['@b', rampRgb(committed.tint.teamB)],
      ] as const) {
        const n = frameOf(id);
        const t = frameOf(`${id}${side}`);
        const nTint = n.filter((c) => neutral.includes(c.join(','))).length;
        const tTint = t.filter((c) => ramp.includes(c.join(','))).length;
        expect(nTint, `${id} neutral tint pixels`).toBeGreaterThanOrEqual(40);
        expect(tTint, `${id}${side} team pixels`).toBeGreaterThanOrEqual(
          nTint * 0.5,
        );
        // Side B is drawn flipped; compare it flipped back.
        const comparable = side === '@b' ? flipRows(t, 16) : t;
        let agree = 0;
        let total = 0;
        n.forEach((c, i) => {
          const k = neutral.indexOf(c.join(','));
          if (k < 0) return;
          total++;
          if ((comparable[i] ?? []).join(',') === ramp[k]) agree++;
        });
        // Most neutral tint pixels become exactly the matching team colour;
        // the rest are covered by the side cue or the pose (flip rounding).
        expect(agree / total, `${id}${side} agreement`).toBeGreaterThan(0.6);
      }
  });

  test('side A and side B differ in silhouette, not only in colour', () => {
    for (const id of unitIds) {
      const a = silhouette(frameOf(`${id}@a`));
      const b = silhouette(flipRows(frameOf(`${id}@b`), 16));
      const differing = a.filter((v, i) => v !== b[i]).length;
      expect(differing, `${id} silhouette`).toBeGreaterThanOrEqual(10);
    }
  });
});

function flipRows(f: number[][], w: number): number[][] {
  const out: number[][] = [];
  const h = f.length / w;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) out.push(f[(h - 1 - y) * w + x] ?? []);
  return out;
}

describe('planned content', () => {
  const buildingInfo = (id: string): BuildingInfo => ({
    id,
    kind: 'unit_producer',
    width: 2,
    height: 2,
  });

  test('art without content is planned, with content it is not, and nothing breaks', () => {
    // The content now has these four; take them out to see the planned case.
    const planned = ['unit_archer', 'unit_drone', 'bld_range', 'bld_hangar'];
    const base = {
      units: loadUnitIds().filter((id) => !planned.includes(id)),
      buildings: loadBuildings().filter((b) => !planned.includes(b.id)),
    };
    const without = buildAll(base).built.atlas;
    expect(without.planned).toEqual(
      expect.arrayContaining([
        'unit_archer',
        'unit_drone',
        'bld_range',
        'bld_hangar',
      ]),
    );
    // Content now has every planned id: no duplicate error, no planned flag.
    const withAll = buildAll({
      units: [...base.units, 'unit_archer', 'unit_drone'],
      buildings: [
        ...base.buildings,
        buildingInfo('bld_range'),
        buildingInfo('bld_hangar'),
      ],
    }).built.atlas;
    expect(withAll.planned).toEqual([]);
    for (const n of [
      'unit_archer',
      'unit_archer@a.walk',
      'unit_drone@b.attack',
      'bld_range',
      'bld_hangar',
    ]) {
      expect(withAll.sprites[n], n).toBeDefined();
      expect(withAll.sprites[n]?.planned, n).toBeUndefined();
    }
    // Same sprites either way.
    expect(Object.keys(withAll.sprites).sort()).toEqual(
      Object.keys(without.sprites).sort(),
    );
    // One of them in content: only that one stops being planned.
    const some = buildAll({
      units: [...base.units, 'unit_archer'],
      buildings: base.buildings,
    }).built.atlas;
    expect(some.planned).toContain('unit_drone');
    expect(some.planned).not.toContain('unit_archer');
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
        expect(committed.sprites[`${base}.walk`]?.frames, `${base}.walk`).toBe(
          2,
        );
        expect(
          committed.sprites[`${base}.attack`]?.frames,
          `${base}.attack`,
        ).toBeGreaterThanOrEqual(2);
      }
  });

  test('every terrain feature has a sprite', () => {
    for (const id of loadTerrainIds())
      expect(has(id), `terrain ${id}`).toBe(true);
  });

  test('every resource has a node sprite and a tint ramp', () => {
    for (const r of loadResources()) {
      expect(has(`node_${r.id}`), `node of ${r.id}`).toBe(true);
      expect(committed.tint.resources[r.id], `ramp of ${r.id}`).toHaveLength(3);
    }
  });

  test('every event type has an icon', () => {
    for (const t of loadEventTypes())
      expect(has(`ui_event_${t}`), t).toBe(true);
  });

  test('conduit, effect and ui pieces are present', () => {
    for (const n of [
      'conduit_straight',
      'conduit_corner',
      'conduit_t',
      'conduit_cross',
      'conduit_end',
      'conduit_item',
      'fx_hit_spark',
      'fx_explosion',
      'fx_spawn_puff',
      'fx_turret_shot',
      'fx_shadow',
      'ui_panel',
      'ui_bg',
      'ui_button_normal',
      'ui_button_hover',
      'ui_button_disabled',
      'ui_card',
      'ui_icon_coin',
      'ui_icon_heart',
      'ui_icon_lock',
      'ui_icon_ready',
      'tier_pips',
      'tier_trim_1x1',
      'tier_trim_2x2',
      'ground_1',
      'ground_2',
      'ground_3',
      'neutral_1',
      'ter_lake_auto',
      'ter_cliff_auto',
    ])
      expect(has(n), n).toBe(true);
    expect(committed.sprites['fx_hit_spark']?.frames).toBe(3);
    expect(committed.sprites['fx_explosion']?.frames).toBe(4);
    expect(committed.sprites['fx_spawn_puff']?.frames).toBe(3);
  });

  test('the former planned art is in the content and no longer planned', () => {
    for (const n of ['unit_archer', 'unit_drone', 'bld_range', 'bld_hangar']) {
      expect(has(n), n).toBe(true);
    }
    expect(committed.planned).toEqual([]);
  });
});
