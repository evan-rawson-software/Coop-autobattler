import { describe, expect, test } from 'vitest';
import atlasJson from '../../../../assets/sprites/atlas.json';
import {
  memo,
  tintKey,
  animFrame,
  frameOrigin,
  type AtlasSprite,
} from './atlas.js';
import {
  BLOB_MASKS,
  E,
  N,
  NE,
  S,
  SE,
  W,
  blobFrame,
  blobMask,
  normalizeMask,
} from './autotile.js';
import {
  SIDE_E,
  SIDE_N,
  SIDE_S,
  SIDE_W,
  conduitPiece,
  sideBit,
} from './conduit-piece.js';
import { cellHash, groundName, mapSalt, neutralName } from './variants.js';

const cells = (list: [number, number][]) => {
  const set = new Set(list.map(([x, y]) => `${String(x)},${String(y)}`));
  return (x: number, y: number) => set.has(`${String(x)},${String(y)}`);
};

describe('blob-47 autotile', () => {
  test('the 47 masks match the atlas', () => {
    expect(BLOB_MASKS).toEqual(atlasJson.autotile.blob47.masks);
    expect(BLOB_MASKS).toHaveLength(47);
  });

  test('corner bits count only with both sides', () => {
    expect(normalizeMask(NE)).toBe(0);
    expect(normalizeMask(N | NE)).toBe(N);
    expect(normalizeMask(N | E | NE)).toBe(N | E | NE);
    expect(normalizeMask(255)).toBe(255);
    expect(normalizeMask(255 & ~N)).toBe(E | S | W | SE | 32);
  });

  test('isolated, edge, corner and interior cells', () => {
    expect(blobFrame(0)).toBe(0);
    expect(blobFrame(255)).toBe(46);
    expect(blobFrame(N)).toBe(1);
    expect(blobFrame(N | E | S | W)).toBe(21);
    expect(blobFrame(N | E | S | W | NE | SE | 32 | 128)).toBe(46);
  });

  test('shapes from a board', () => {
    // A 2x2 block: every cell is a rounded corner.
    const block = cells([
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]);
    expect(blobFrame(blobMask(block, 0, 0))).toBe(10); // E+S+SE
    expect(blobFrame(blobMask(block, 1, 0))).toBe(blobFrame(S | W | 32));
    // A horizontal strip of three: the middle has W and E only.
    const strip = cells([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
    expect(blobFrame(blobMask(strip, 1, 0))).toBe(15); // E+W = 68
    expect(blobFrame(blobMask(strip, 0, 0))).toBe(blobFrame(E));
    // An L: the inside corner cell has N and E but no NE neighbour.
    const ell = cells([
      [0, 0],
      [0, 1],
      [1, 1],
    ]);
    expect(blobMask(ell, 0, 1)).toBe(N | E);
    expect(blobFrame(blobMask(ell, 0, 1))).toBe(BLOB_MASKS.indexOf(N | E));
    // A plus: the centre has all sides but no corners.
    const plus = cells([
      [1, 0],
      [0, 1],
      [1, 1],
      [2, 1],
      [1, 2],
    ]);
    expect(blobFrame(blobMask(plus, 1, 1))).toBe(21);
    // A lone diagonal neighbour is ignored: the cell is isolated.
    const diag = cells([[2, 0]]);
    expect(blobMask(diag, 1, 1)).toBe(NE);
    expect(blobFrame(blobMask(diag, 1, 1))).toBe(0);
  });
});

describe('conduit pieces', () => {
  test('unrotated pieces', () => {
    expect(conduitPiece(SIDE_N | SIDE_S)).toEqual({ kind: 'straight', rot: 0 });
    expect(conduitPiece(SIDE_N | SIDE_E)).toEqual({ kind: 'corner', rot: 0 });
    expect(conduitPiece(SIDE_E | SIDE_S | SIDE_W)).toEqual({
      kind: 't',
      rot: 0,
    });
    expect(conduitPiece(15)).toEqual({ kind: 'cross', rot: 0 });
    expect(conduitPiece(SIDE_S)).toEqual({ kind: 'end', rot: 0 });
  });

  test('quarter turns clockwise', () => {
    expect(conduitPiece(SIDE_E | SIDE_W)).toEqual({ kind: 'straight', rot: 1 });
    expect(conduitPiece(SIDE_E | SIDE_S)).toEqual({ kind: 'corner', rot: 1 });
    expect(conduitPiece(SIDE_S | SIDE_W)).toEqual({ kind: 'corner', rot: 2 });
    expect(conduitPiece(SIDE_W | SIDE_N)).toEqual({ kind: 'corner', rot: 3 });
    expect(conduitPiece(SIDE_N | SIDE_S | SIDE_W)).toEqual({
      kind: 't',
      rot: 1,
    });
    expect(conduitPiece(SIDE_N | SIDE_E | SIDE_W)).toEqual({
      kind: 't',
      rot: 2,
    });
    expect(conduitPiece(SIDE_N | SIDE_E | SIDE_S)).toEqual({
      kind: 't',
      rot: 3,
    });
    expect(conduitPiece(SIDE_W)).toEqual({ kind: 'end', rot: 1 });
    expect(conduitPiece(SIDE_N)).toEqual({ kind: 'end', rot: 2 });
    expect(conduitPiece(SIDE_E)).toEqual({ kind: 'end', rot: 3 });
  });

  test('every set of sides has exactly one piece', () => {
    for (let s = 1; s < 16; s++) {
      const p = conduitPiece(s);
      expect(['straight', 'corner', 't', 'cross', 'end']).toContain(p.kind);
    }
  });

  test('steps map to sides in view space (y down)', () => {
    expect(sideBit(0, -1)).toBe(SIDE_N);
    expect(sideBit(1, 0)).toBe(SIDE_E);
    expect(sideBit(0, 1)).toBe(SIDE_S);
    expect(sideBit(-1, 0)).toBe(SIDE_W);
    expect(sideBit(1, 1)).toBe(0);
    expect(sideBit(0, 2)).toBe(0);
  });
});

describe('deterministic ground variants', () => {
  const salt = mapSalt(24, 16, 1, 24);

  test('the same cell and salt always give the same sprite', () => {
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        expect(groundName(x, y, salt)).toBe(groundName(x, y, salt));
        expect(neutralName(x, y, salt)).toBe(neutralName(x, y, salt));
      }
    expect(cellHash(3, 4, 5)).toBe(cellHash(3, 4, 5));
  });

  test('names exist in the atlas', () => {
    for (let y = 0; y < 30; y++)
      for (let x = 0; x < 30; x++) {
        expect(atlasJson.sprites).toHaveProperty(groundName(x, y, salt));
        expect(atlasJson.sprites).toHaveProperty(neutralName(x, y, salt));
      }
  });

  test('rare variants are rare, common ones are common', () => {
    const count: Record<string, number> = {};
    const ncount: Record<string, number> = {};
    for (let y = 0; y < 60; y++)
      for (let x = 0; x < 60; x++) {
        const g = groundName(x, y, salt);
        const n = neutralName(x, y, salt);
        count[g] = (count[g] ?? 0) + 1;
        ncount[n] = (ncount[n] ?? 0) + 1;
      }
    const total = 3600;
    expect(count['ground_1'] ?? 0).toBeGreaterThan(total * 0.2);
    expect(count['ground_5'] ?? 0).toBeLessThan(total * 0.1);
    expect(count['ground_6'] ?? 0).toBeLessThan(total * 0.1);
    expect(count['ground_5'] ?? 0).toBeGreaterThan(0);
    expect(ncount['neutral_4'] ?? 0).toBeLessThan(total * 0.1);
    expect(ncount['neutral_1'] ?? 0).toBeGreaterThan(total * 0.2);
  });

  test('a different map salt gives a different pattern', () => {
    const other = mapSalt(30, 20, 2, 30);
    let diff = 0;
    for (let y = 0; y < 10; y++)
      for (let x = 0; x < 10; x++)
        if (groundName(x, y, salt) !== groundName(x, y, other)) diff++;
    expect(diff).toBeGreaterThan(20);
  });
});

describe('tint cache keys', () => {
  const ramp = ['#111111', '#222222', '#333333'];

  test('the key names sprite, frame and ramp', () => {
    expect(tintKey('conduit_t', 0, ramp)).toBe(
      tintKey('conduit_t', 0, [...ramp]),
    );
    expect(tintKey('conduit_t', 0, ramp)).not.toBe(
      tintKey('conduit_t', 1, ramp),
    );
    expect(tintKey('conduit_t', 0, ramp)).not.toBe(
      tintKey('conduit_end', 0, ramp),
    );
    expect(tintKey('conduit_t', 0, ramp)).not.toBe(
      tintKey('conduit_t', 0, ['#111111', '#222222', '#444444']),
    );
  });

  test('memo makes a value once per key', () => {
    const cache = new Map<string, { n: number }>();
    let made = 0;
    const make = () => ({ n: ++made });
    const a = memo(cache, 'k', make);
    const b = memo(cache, 'k', make);
    const c = memo(cache, 'other', make);
    expect(a).toBe(b);
    expect(c).not.toBe(a);
    expect(made).toBe(2);
  });
});

describe('frames', () => {
  const sp: AtlasSprite = {
    sheet: 'tiles',
    x: 16,
    y: 32,
    w: 16,
    h: 16,
    frames: 47,
    columns: 8,
    fps: 0,
    anchor: [8, 8],
    category: 'terrain',
  };
  test('frame origin follows columns', () => {
    expect(frameOrigin(sp, 0)).toEqual([16, 32]);
    expect(frameOrigin(sp, 9)).toEqual([32, 48]);
  });
  test('static sprites stay on frame 0; animated ones step', () => {
    expect(animFrame(sp, 5000)).toBe(0);
    const flat = { ...sp };
    delete flat.columns;
    const anim = { ...flat, frames: 2, fps: 2 };
    expect(animFrame(anim, 0)).toBe(0);
    expect(animFrame(anim, 500)).toBe(1);
    expect(animFrame(anim, 1000)).toBe(0);
  });
});
