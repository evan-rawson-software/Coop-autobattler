import {
  addConduit,
  addItemToStash,
  createTeamState,
  placeFromStash,
  type GameMap,
  type TeamState,
} from '@game/core';
import { describe, expect, test } from 'vitest';
import { content } from '../content.js';
import { downstreamOf, upstreamSources } from './refining.js';
import { partnerHint, tunnelMarks } from './tunnel-marks.js';
import { deriveProblems } from './view-model.js';

const map: GameMap = {
  width: 24,
  height: 16,
  partySize: 1,
  plotWidth: 24,
  features: [],
  nodes: [],
};

const IN = 'bld_tunnel_in';
const OUT = 'bld_tunnel_out';

/** A state with the given Tunnel ends placed: [def, x, y, rotation]. */
function ends(...list: [string, number, number, number][]): TeamState {
  let s = createTeamState(map);
  const bought = addItemToStash(s, content, { def: IN, tier: 1, owner: 0 });
  if (!bought.ok) throw new Error(bought.reason);
  s = bought.state;
  const entranceId = bought.ids[0] as number;
  const exitId = bought.ids[1] as number;
  const wanted = new Map<string, number[]>([
    [IN, [entranceId]],
    [OUT, [exitId]],
  ]);
  for (const [def, x, y, rotation] of list) {
    let id = wanted.get(def)?.shift();
    if (id === undefined) {
      const more = addItemToStash(s, content, { def, tier: 1, owner: 0 });
      if (!more.ok) throw new Error(more.reason);
      s = more.state;
      id = more.id;
    }
    const r = placeFromStash(s, content, { actor: 0, id, x, y, rotation });
    if (!r.ok) throw new Error(r.reason);
    s = r.state;
  }
  return s;
}

describe('tunnel marks', () => {
  test('a pair is a line between its ends; an end alone is unpaired', () => {
    const paired = tunnelMarks(ends([IN, 3, 2, 0], [OUT, 3, 6, 0]), content);
    expect(paired.pairs).toEqual([
      { from: { x: 3, y: 2 }, to: { x: 3, y: 6 } },
    ]);
    expect(paired.unpaired).toEqual([]);
    const far = tunnelMarks(ends([IN, 3, 2, 0], [OUT, 3, 12, 0]), content);
    expect(far.pairs).toEqual([]);
    expect(far.unpaired).toEqual([
      { x: 3, y: 2 },
      { x: 3, y: 12 },
    ]);
  });

  test('the checklist names an unpaired end, and a pair is no problem', () => {
    const texts = (s: TeamState): string[] =>
      deriveProblems(s, content, null)
        .filter((p) => p.kind === 'unpaired_tunnel')
        .map((p) => p.text);
    expect(texts(ends([IN, 3, 2, 0], [OUT, 3, 6, 0]))).toEqual([]);
    expect(texts(ends([IN, 3, 2, 0], [OUT, 8, 6, 0]))).toEqual([
      'Tunnel entrance has no partner end in line within range, so it does nothing.',
      'Tunnel exit has no partner end in line within range, so it does nothing.',
    ]);
  });
});

describe('partner hint', () => {
  test('an entrance: the cells in line within range, and the exits among them', () => {
    const s = ends([OUT, 3, 6, 0]);
    const h = partnerHint(s, content, IN, { x: 3, y: 2 }, 0, 0);
    expect(h?.entrance).toBe(true);
    expect(h?.span).toBe(5);
    expect(h?.range.map((c) => c.y)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(h?.partners).toEqual([{ x: 3, y: 6 }]);
    // Facing east: the row, and none of it is an exit.
    const e = partnerHint(s, content, IN, { x: 3, y: 2 }, 90, 0);
    expect(e?.range.map((c) => c.x)).toEqual([4, 5, 6, 7, 8, 9]);
    expect(e?.partners).toEqual([]);
  });

  test('an exit: the entrances that face it from within range', () => {
    const s = ends([IN, 3, 2, 0], [IN, 8, 2, 0]);
    const h = partnerHint(s, content, OUT, { x: 3, y: 5 }, 0, 0);
    expect(h?.entrance).toBe(false);
    expect(h?.partners).toEqual([{ x: 3, y: 2 }]);
    expect(
      partnerHint(s, content, OUT, { x: 3, y: 9 }, 0, 0)?.partners,
    ).toEqual([]);
  });

  test('other buildings give no hint', () => {
    expect(
      partnerHint(
        createTeamState(map),
        content,
        'bld_splitter',
        { x: 1, y: 1 },
        0,
        0,
      ),
    ).toBeNull();
  });
});

describe('walking the conduits through a pair', () => {
  test('downstream and upstream continue from the entrance to the exit', () => {
    const m: GameMap = { ...map, nodes: [{ x: 3, y: 1, resource: 'res_a' }] };
    let s = createTeamState(m);
    const put = (def: string, x: number, y: number): number => {
      const a = addItemToStash(s, content, { def, tier: 1, owner: 0 });
      if (!a.ok) throw new Error(a.reason);
      const p = placeFromStash(a.state, content, {
        actor: 0,
        id: a.id,
        x,
        y,
        rotation: 0,
      });
      if (!p.ok) throw new Error(p.reason);
      s = p.state;
      return a.id;
    };
    const link = (a: number, b: number, cells: [number, number][]): void => {
      const r = addConduit(s, content, {
        actor: 0,
        from: { building: a, side: 'north' },
        to: { building: b, side: 'south' },
        cells: cells.map(([x, y]) => ({ x, y })),
      });
      if (!r.ok) throw new Error(r.reason);
      s = r.state;
    };
    const src = put('bld_extractor', 3, 1);
    const tin = put(IN, 3, 4);
    link(src, tin, [
      [3, 2],
      [3, 3],
    ]);
    const tout = put(OUT, 3, 8);
    const dst = put('bld_barracks', 3, 10);
    link(tout, dst, [[3, 9]]);
    expect(downstreamOf(s, content, src)).toEqual([dst]);
    expect(upstreamSources(s, content, dst, 'south')).toEqual([src]);
    expect(tout).toBeGreaterThan(tin);
  });
});
