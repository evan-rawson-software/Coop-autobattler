import { describe, expect, test } from 'vitest';
import { type EnemyPath } from '@game/core';
import { economy, simConfig } from '../build/setup.js';
import { content } from '../content.js';
import { legalCore, newRun, send } from '../run/test-run.js';
import {
  clipPaths,
  coreCells,
  hintText,
  kitRows,
  legalSet,
  problemText,
  routesFor,
  verdictAt,
} from './view-model.js';

const run = newRun(5);
const team = run.team;
const { width, height } = team.map;

describe('legal and illegal Core positions', () => {
  const legal = legalCore(run);

  test('the legal set is the one core lists', () => {
    expect(legal.length).toBeGreaterThan(10);
    expect(legalSet(team, content, 0).size).toBe(legal.length);
    for (const c of legal) {
      expect(verdictAt(team, content, c, 0)).toMatchObject({
        ok: true,
        problem: null,
        text: null,
      });
    }
  });

  test('every illegal cell has a reason in plain words', () => {
    const seen = new Set<string>();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = verdictAt(team, content, { x, y }, 0);
        if (v.ok) continue;
        expect(v.problem).not.toBeNull();
        expect(v.text?.length).toBeGreaterThan(20);
        seen.add(v.problem as string);
      }
    }
    // This map has the front band, edges, terrain and nodes in the way.
    expect(seen.has('too_far_forward')).toBe(true);
    expect(seen.has('out_of_bounds')).toBe(true);
    expect(seen.has('blocked')).toBe(true);
  });

  test('the Core cannot be sent to an illegal cell', () => {
    const bad = { x: width - 1, y: height - 1 };
    const v = verdictAt(team, content, bad, 0);
    expect(v.ok).toBe(false);
    const r = (() => {
      try {
        return send(run, { type: 'place_core', x: bad.x, y: bad.y });
      } catch (e) {
        return e instanceof Error ? e.message : '';
      }
    })();
    expect(typeof r).toBe('string');
    expect(r).toMatch(/refused/);
  });

  test('the footprint covers the cells of the position', () => {
    const cells = coreCells(content, { x: 3, y: 4 });
    expect(cells).toHaveLength(4);
    expect(cells[0]).toEqual({ x: 3, y: 4 });
  });

  test('problem texts name the size of the Core', () => {
    expect(problemText('out_of_bounds', { width: 2, height: 2 })).toMatch(
      /2 × 2/,
    );
  });
});

describe('routes to a position', () => {
  const at = legalCore(run)[0] as { x: number; y: number };

  test('a legal position has routes, all inside the board', () => {
    const paths = routesFor(team, content, simConfig, at, 0);
    expect(paths).not.toBeNull();
    expect(paths?.length).toBeGreaterThan(0);
    for (const p of paths ?? []) {
      for (const c of [p.entry, ...p.cells]) {
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.y).toBeGreaterThanOrEqual(0);
        expect(c.x).toBeLessThan(width);
        expect(c.y).toBeLessThan(height);
      }
    }
  });

  test('an illegal position has none, and the run is not touched', () => {
    expect(
      routesFor(team, content, simConfig, { x: width - 1, y: height - 1 }, 0),
    ).toBeNull();
    expect(team.cores.every((c) => c === null)).toBe(true);
  });

  test('cells beyond the front row are clipped away (core issue 32)', () => {
    const paths: EnemyPath[] = [
      {
        entry: { x: 1, y: height - 1 },
        core: 0,
        cells: [
          { x: 1, y: height - 1 },
          { x: 1, y: height },
          { x: 2, y: height + 3 },
          { x: 2, y: height - 2 },
        ],
        approach: [],
        breach: { building: 4, cell: { x: 2, y: height + 1 } },
      },
      {
        entry: { x: 0, y: height },
        core: 0,
        cells: [{ x: 0, y: height }],
        approach: [],
        breach: null,
      },
    ];
    const clipped = clipPaths(paths, width, height);
    expect(clipped).toHaveLength(1);
    expect(clipped[0]?.cells).toEqual([
      { x: 1, y: height - 1 },
      { x: 2, y: height - 2 },
    ]);
    expect(clipped[0]?.breach).toBeNull();
  });
});

describe('starting kit', () => {
  test('lists each kit entry by its display name, then the gold', () => {
    const rows = kitRows(economy, content);
    expect(rows.at(-1)?.text).toBe(`${String(economy.startingGold)} gold`);
    expect(rows.length).toBe(economy.startingKit.length + 1);
    for (const r of rows.slice(0, -1)) expect(r.text).toMatch(/ × \d+$/);
    expect(rows.map((r) => r.text).join(' ')).not.toMatch(/bld_/);
  });
});

describe('hint line', () => {
  const legalCell = legalCore(run)[0] ?? { x: 0, y: 0 };
  const good = verdictAt(team, content, legalCell, 0);
  const bad = verdictAt(team, content, { x: width - 1, y: 0 }, 0);
  const stale = 'The Core is 2 × 2 and would hang over the edge of the board.';

  test('hovering a legal cell after an illegal click shows the legal text', () => {
    expect(bad.ok).toBe(false);
    expect(hintText({ hover: good, selected: null, message: stale })).toMatch(
      /fits here/,
    );
  });
  test('hovering an illegal cell shows its own reason', () => {
    expect(hintText({ hover: bad, selected: null, message: null })).toBe(
      bad.text,
    );
  });
  test('nothing hovered: the selection, or a stored message', () => {
    expect(
      hintText({ hover: null, selected: { x: 3, y: 4 }, message: null }),
    ).toBe('Chosen: column 3, row 4.');
    expect(hintText({ hover: null, selected: null, message: 'No.' })).toBe(
      'No.',
    );
    expect(hintText({ hover: null, selected: null, message: null })).toMatch(
      /Point at the map/,
    );
  });
});
