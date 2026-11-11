import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  SIDE_E,
  SIDE_N,
  SIDE_S,
  SIDE_W,
  conduitPiece,
} from '../sprites/conduit-piece.js';
import { rotateSide, type Rotation, type Side } from '@game/core';
import atlasJson from '../../../../assets/sprites/atlas.json';
import { loadWebContent } from '../content.js';
import {
  buildingSpriteRot,
  conduitCells,
  drawBoardLayer,
} from './sprite-board.js';
import type { BoardScene } from './scene.js';
import type { Theme } from './render.js';

// Record what the board layer asks the atlas to draw, instead of drawing.
const drawn = vi.hoisted(
  () => [] as { name: string; opts: { rot?: number } | undefined }[],
);
vi.mock('../sprites/atlas.js', () => ({
  drawSprite: (
    _ctx: unknown,
    name: string,
    _x: number,
    _y: number,
    _scale: number,
    opts?: { rot?: number },
  ) => {
    drawn.push({ name, opts });
    return true;
  },
  findSprite: () => ({ w: 16, h: 16, frames: 1, anchor: [8, 8] }),
  frameCanvas: () => null,
  spriteSet: () => ({
    sheets: { images: { tiles: {}, buildings: {} } },
    atlas: { sprites: { bld_turret_head: { anchor: [8, 8] } } },
  }),
}));

const pt = (x: number, y: number) => ({ x: x + 0.5, y: y + 0.5 });

function boardWith(
  points: { x: number; y: number }[],
  cells: { x: number; y: number }[],
): BoardScene {
  return {
    frame: { ox: 0, oy: 0 },
    conduits: [
      { id: 1, points, cells, color: '#fff', pattern: 0, resource: 'res_a' },
    ],
  } as unknown as BoardScene;
}

describe('conduit cells of a scene', () => {
  test('an L-shaped run between two buildings', () => {
    // Building cell (0,2), conduit (1,2) (2,2) (2,1), building cell (2,0).
    const pts = [pt(0, 2), pt(1, 2), pt(2, 2), pt(2, 1), pt(2, 0)];
    const out = conduitCells(boardWith(pts, [pt(1, 2), pt(2, 2), pt(2, 1)]));
    expect(out.map((c) => [c.x, c.y, c.sides])).toEqual([
      [1, 2, SIDE_W | SIDE_E],
      [2, 2, SIDE_W | SIDE_N],
      [2, 1, SIDE_S | SIDE_N],
    ]);
    expect(conduitPiece(out[1]?.sides ?? 0)).toEqual({
      kind: 'corner',
      rot: 3,
    });
    expect(conduitPiece(out[0]?.sides ?? 0)).toEqual({
      kind: 'straight',
      rot: 1,
    });
  });

  test('a run whose start building is missing begins with an end piece', () => {
    const pts = [pt(1, 2), pt(2, 2), pt(2, 1)];
    const out = conduitCells(boardWith(pts, [pt(1, 2), pt(2, 2)]));
    expect(out[0]?.sides).toBe(SIDE_E);
    expect(out[1]?.sides).toBe(SIDE_W | SIDE_N);
  });

  test('a direct connection has no conduit cells', () => {
    expect(conduitCells(boardWith([pt(0, 0), pt(1, 0)], []))).toEqual([]);
  });
});

describe('building sprite rotation follows the ports', () => {
  const content = loadWebContent();
  const sides: Side[] = ['north', 'east', 'south', 'west'];
  const rotations: Rotation[] = [0, 90, 180, 270];

  for (const def of content.buildings.list()) {
    // The art draws the ports where the def has them at rotation 0; walls,
    // gates and the Core have none. A turret's base sprite carries its port.
    const ports = [...def.inputs.map((i) => i.side), ...def.outputs];
    if (ports.length === 0) continue;
    const hasArt =
      def.id in atlasJson.sprites ||
      (def.kind === 'defense' && 'bld_turret_base' in atlasJson.sprites);
    if (!hasArt) continue;
    test(`${def.id}: drawn rotation puts ports where the def does`, () => {
      for (const rotation of rotations)
        for (const turned of [false, true]) {
          const rot = buildingSpriteRot(
            { def, instance: { rotation } as never },
            turned,
          );
          const want = (turned ? 2 : 0) + rotation / 90;
          for (const side of ports) {
            const drawn = sides[(sides.indexOf(side) + rot) % 4];
            const expected = sides[(sides.indexOf(side) + want) % 4];
            expect(drawn).toBe(expected);
            if (!turned) expect(drawn).toBe(rotateSide(side, rotation));
          }
        }
    });
  }
});

describe('conduit cells are board-local', () => {
  test('the frame origin is subtracted before flooring', () => {
    const board = {
      frame: { ox: 10, oy: 4 },
      conduits: [
        {
          id: 1,
          points: [pt(10, 5), pt(11, 5), pt(12, 5)],
          cells: [pt(11, 5)],
          color: '#fff',
          pattern: 0,
          resource: null,
        },
      ],
    } as unknown as BoardScene;
    expect(conduitCells(board).map((c) => [c.x, c.y])).toEqual([[1, 1]]);
  });
});

describe('building draw calls carry the rotation', () => {
  const content = loadWebContent();
  const theme = { owners: ['#f00'], kinds: {} } as unknown as Theme;
  const ctx = { imageSmoothingEnabled: true, drawImage: () => undefined };
  const fakeLayerCtx = new Proxy(
    {},
    { get: () => () => undefined, set: () => true },
  );

  beforeEach(() => {
    vi.stubGlobal('document', {
      createElement: () => ({ getContext: () => fakeLayerCtx }),
    });
    drawn.length = 0;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The sprite name and rotation each building type is drawn with, per
  // rotation, on the own board and on the turned enemy board.
  const turret = content.buildings
    .list()
    .find((d) => d.kind === 'defense' && d.defenseType === 'turret');
  const wall = content.buildings
    .list()
    .find((d) => d.kind === 'defense' && d.defenseType === 'wall');

  for (const turned of [false, true])
    for (const rotation of [0, 90, 180, 270] as Rotation[]) {
      test(`turret base ${turned ? 'turned' : 'own'} board at ${String(rotation)}`, () => {
        expect(turret).toBeDefined();
        expect(wall).toBeDefined();
        const at = (def: typeof turret, x: number) => ({
          def,
          instance: { rotation, tier: 1, owner: 0 },
          rect: { x, y: 0, w: 1, h: 1 },
          label: '',
          solid: false,
          notches: [],
        });
        const board = {
          frame: { ox: 0, oy: 0, w: 2, h: 1, turned },
          features: [],
          nodes: [],
          conduits: [],
          core: null,
          salt: 0,
          buildings: [at(turret, 0), at(wall, 1)],
        } as unknown as BoardScene;
        drawBoardLayer(ctx as never, board, theme, 0, 0, 16, 32, 16);
        const want = ((rotation / 90 + (turned ? 2 : 0)) % 4) as number;
        const base = drawn.find((d) => d.name === 'bld_turret_base');
        expect(base?.opts?.rot ?? 0).toBe(want);
        // Walls keep their light direction.
        const w = drawn.find((d) => d.name === wall?.id);
        expect(w?.opts?.rot ?? 0).toBe(0);
      });
    }
});
