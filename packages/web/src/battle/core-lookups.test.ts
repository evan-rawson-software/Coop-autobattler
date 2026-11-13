import { generateMap, listLegalCorePositions, placeCore } from '@game/core';
import { describe, expect, test } from 'vitest';
import type { OverlayContext } from '../board/BoardView.js';
import { buildScene } from '../board/scene.js';
import { content } from '../content.js';
import { buildSampleTeam } from '../sample-team.js';
import { geometryOf } from './derive.js';
import { drawBattleOverlay, makeDrawIndex } from './draw.js';
import { Playback, simulateRecord } from './playback.js';
import { battleConfig } from './setup.js';
import type { BattleDescription } from './types.js';

const cores = (seed: number, players: number) => {
  const map = generateMap(seed, players, content, content.mapgen);
  let state = buildSampleTeam(map, content, seed);
  for (let p = 0; p < players; p++) {
    if (state.cores[p] !== null) continue;
    const spots = listLegalCorePositions(map, content, content.mapgen, p);
    const placed = spots
      .map((pos) => placeCore(state, content, content.mapgen, p, pos))
      .find((r) => r.ok);
    if (!placed?.ok) throw new Error('no Core spot');
    state = placed.state;
  }
  return state;
};

type Call = { op: string; args: number[]; stroke: unknown };

/** A 2D context that records the path and rectangle calls. */
const recorder = () => {
  const calls: Call[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(
    {},
    {
      get: (_t, name: string) => {
        if (name in state) return state[name];
        return (...args: unknown[]) => {
          calls.push({
            op: name,
            args: args.filter((a): a is number => typeof a === 'number'),
            stroke: state['strokeStyle'],
          });
        };
      },
      set: (_t, name: string, value: unknown) => {
        state[name] = value;
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
};

describe('Core lookups when drawing a battle with several Cores', () => {
  // Frail Cores on both sides, so units reach and destroy Cores beyond the first.
  const d: BattleDescription = {
    kind: 'versus',
    input: {
      teamA: cores(3, 3),
      teamB: cores(4, 3),
      seed: 7,
      sideOptions: [{ coreHealths: [1, 1, 1] }, { coreHealths: [1, 1, 1] }],
    },
  };
  const r = simulateRecord(d, content, battleConfig);
  if (!r.ok) throw new Error(r.error.message);
  const rec = r.record;
  const pb = new Playback(d, content, battleConfig, rec);
  const scene = buildScene(
    rec.initialTeams[0],
    rec.initialTeams[1],
    rec.zone.depth,
    content,
  );
  const index = makeDrawIndex(scene, { own: 'a', enemy: 'b' });
  const z = 20;
  const o = {
    camera: { cx: 6, cy: 20, zoom: z },
    viewport: { w: 800, h: 800 },
    theme: {
      owners: ['#own', '#foe'],
      ink: '#ink',
      inkMuted: '#muted',
      outline: '#outline',
      hover: '#hover',
      boardBg: '#bg',
    },
    time: 0,
  } as unknown as OverlayContext;
  const ox = o.viewport.w / 2 - o.camera.cx * z;
  const oy = o.viewport.h / 2 - o.camera.cy * z;
  const draw = () => {
    const rc = recorder();
    drawBattleOverlay(rc.ctx, o, { pb, geo: geometryOf(rec), index, content });
    return rc.calls;
  };
  const rect = (side: 0 | 1, core: number) => {
    const rr = index.coreRects[side][core];
    if (rr === null || rr === undefined) throw new Error('no Core rectangle');
    return rr;
  };

  test('each Core has its own rectangle, on each side', () => {
    for (const side of [0, 1] as const) {
      const keys = index.coreRects[side].map((x) => JSON.stringify(x));
      expect(new Set(keys).size).toBe(3);
    }
  });

  test('health bars sit over the rectangle of their own Core', () => {
    pb.seekTo(0);
    const bars = draw().filter((c) => c.op === 'fillRect' && c.args[3] === 4);
    for (const side of [0, 1] as const) {
      for (const core of [0, 1, 2]) {
        const rr = rect(side, core);
        const x = ox + rr.x * z;
        const y = oy + rr.y * z - 6;
        const hit = bars.filter((c) => c.args[0] === x && c.args[1] === y);
        expect(hit.length, `${String(side)}:${String(core)}`).toBeGreaterThan(
          0,
        );
        expect(hit[0]?.args[2]).toBe(rr.w * z);
      }
    }
  });

  test('a fallen Core is crossed out on its own rectangle', () => {
    const falls = rec.eventLog.filter((e) => e.type === 'core_destroyed');
    const later = falls.filter((e) => e.core > 0);
    expect(later.map((e) => e.side).sort()).toEqual(
      expect.arrayContaining([0, 1]),
    );
    for (const f of later) {
      pb.seekTo(f.tick + 1);
      const rr = rect(f.side === 0 ? 0 : 1, f.core);
      const x = ox + rr.x * z;
      const y = oy + rr.y * z;
      const crossed = draw().some(
        (c) => c.op === 'moveTo' && c.args[0] === x && c.args[1] === y,
      );
      expect(crossed, `${String(f.side)}:${String(f.core)}`).toBe(true);
    }
  });

  test('an attack on a Core beyond the first aims at that Core', () => {
    const hits = rec.eventLog.filter(
      (e) => e.type === 'unit_attacked' && e.target.kind === 'core',
    );
    const seen = new Set<string>();
    for (const e of hits) {
      if (e.type !== 'unit_attacked' || e.target.kind !== 'core') continue;
      const { side, core } = e.target;
      if (core === 0) continue;
      pb.seekTo(e.tick + 1);
      const rr = rect(side === 0 ? 0 : 1, core);
      const cx = ox + (rr.x + rr.w / 2) * z;
      const cy = oy + (rr.y + rr.h / 2) * z;
      const aimed = draw().some(
        (c) =>
          c.op === 'lineTo' &&
          c.stroke === '#hover' &&
          c.args[0] === cx &&
          c.args[1] === cy,
      );
      expect(aimed, `${String(side)}:${String(core)}`).toBe(true);
      seen.add(`${String(side)}:${String(core)}`);
    }
    // Both sides are attacked on a Core other than the first.
    expect([...seen].some((k) => k.startsWith('0:'))).toBe(true);
    expect([...seen].some((k) => k.startsWith('1:'))).toBe(true);
  });
});
