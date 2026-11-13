import {
  addConduit,
  addToStash,
  createTeamState,
  placeCore,
  placeFromStash,
  type ConduitEndArg,
  type GameMap,
  type TeamState,
} from '@game/core';
import { describe, expect, test } from 'vitest';
import { content } from '../content.js';
import { halfStatuses, linkText } from './border-links.js';
import { deriveProblems } from './view-model.js';

// A broken link is shown as broken, to both of its players (issue #38).

const map: GameMap = {
  width: 24,
  height: 16,
  partySize: 2,
  plotWidth: 12,
  features: [],
  nodes: [
    { x: 2, y: 2, resource: 'res_a' },
    { x: 16, y: 2, resource: 'res_b' },
  ],
};

type Path = [number, number][];
const side = (building: number, s: string): ConduitEndArg => ({
  building,
  side: s,
});
const spot = (y: number): ConduitEndArg => ({ border: 0, y });

/** Row 3 is broken by a mismatch, row 12 by a loop, row 9 is joined. */
function board(): TeamState {
  let team = createTeamState(map);
  for (const [p, x] of [
    [0, 5],
    [1, 17],
  ] as const) {
    const r = placeCore(team, content, content.mapgen, p, { x, y: 0 });
    if (!r.ok) throw new Error(r.reason);
    team = r.state;
  }
  const put = (def: string, x: number, y: number): number => {
    const owner = Math.floor(x / 12);
    const s = addToStash(team, content, { def, tier: 1, owner });
    if (!s.ok) throw new Error(s.reason);
    const p = placeFromStash(s.state, content, {
      actor: owner,
      id: s.id,
      x,
      y,
      rotation: 0,
    });
    if (!p.ok) throw new Error(p.reason);
    team = p.state;
    return s.id;
  };
  const add = (
    actor: number,
    from: ConduitEndArg,
    to: ConduitEndArg,
    path: Path,
    restore = false,
  ): void => {
    const r = addConduit(team, content, {
      actor,
      from,
      to,
      cells: path.map(([x, y]) => ({ x, y })),
      restore,
    });
    if (!r.ok) throw new Error(`${r.reason} ${r.detail ?? ''}`);
    team = r.state;
  };
  const a = put('bld_extractor', 2, 2);
  const b = put('bld_extractor', 16, 2);
  const merger = put('bld_merger', 14, 6);
  const m = put('bld_merger', 9, 5);
  const s = put('bld_splitter', 14, 10);
  const sx: Path = [];
  for (let x = 2; x <= 11; x++) sx.push([x, 3]);
  add(0, side(a, 'north'), spot(3), sx);
  add(1, spot(3), side(merger, 'south'), [
    [12, 3],
    [13, 3],
    [14, 3],
    [14, 4],
    [14, 5],
  ]);
  // The cause of the mismatch: res_b into the same merger.
  add(
    1,
    side(b, 'north'),
    side(merger, 'east'),
    [
      [16, 3],
      [16, 4],
      [16, 5],
      [16, 6],
      [15, 6],
    ],
    true,
  );
  // M -> row 9 -> S -> row 12 -> M: the later link closes the loop.
  add(0, side(m, 'north'), spot(9), [
    [9, 6],
    [9, 7],
    [9, 8],
    [9, 9],
    [10, 9],
    [11, 9],
  ]);
  add(1, side(s, 'west'), spot(12), [
    [13, 10],
    [13, 11],
    [13, 12],
    [12, 12],
  ]);
  add(0, spot(12), side(m, 'west'), [
    [11, 12],
    [10, 12],
    [9, 12],
    [8, 12],
    ...[11, 10, 9, 8, 7, 6, 5].map((y): [number, number] => [8, y]),
  ]);
  add(
    1,
    spot(9),
    side(s, 'south'),
    [
      [12, 9],
      [13, 9],
      [14, 9],
    ],
    true,
  );
  return team;
}

describe('a broken link on the Build screen', () => {
  const team = board();
  const name = content.presentation.get('bld_merger')?.name ?? '';
  const mismatch = `Link broken: it would send a second resource into ${name}`;
  const loop = 'Link broken: it would form a loop';

  test('both halves of a broken link have the broken status and its reason', () => {
    const halves = halfStatuses(team, content);
    const at = (y: number) => halves.filter((h) => h.spot.y === y);
    expect(at(3).map((h) => [h.state, h.broken?.reason])).toEqual([
      ['broken', 'resource_mismatch'],
      ['broken', 'resource_mismatch'],
    ]);
    expect(at(12).map((h) => [h.state, h.broken?.reason])).toEqual([
      ['broken', 'would_loop'],
      ['broken', 'would_loop'],
    ]);
    expect(at(9).map((h) => h.state)).toEqual(['joined', 'joined']);
    const text = (y: number) =>
      at(y).map((h) => linkText(h, (p) => `P${String(p)}`));
    expect(text(12)).toEqual([loop, loop]);
    expect(text(3)).toEqual([mismatch, mismatch]);
  });

  test('the problems list has one entry per broken link, for both players', () => {
    for (const acting of [0, 1]) {
      const scope = { acting, names: ['Ann', 'Bo'] };
      const list = deriveProblems(team, content, null, scope).filter(
        (p) => p.kind === 'broken_link',
      );
      expect(list.map((p) => p.text)).toEqual([mismatch, loop]);
      // The camera goes to the acting player's own half of the spot.
      expect(list.map((p) => p.focus?.x)).toEqual(
        acting === 0 ? [11, 11] : [12, 12],
      );
    }
    expect(
      deriveProblems(team, content, null).filter(
        (p) => p.kind === 'broken_link',
      ),
    ).toHaveLength(2);
  });
});
