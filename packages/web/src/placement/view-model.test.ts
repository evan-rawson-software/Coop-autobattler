import { describe, expect, test } from 'vitest';
import type { EnemyPath } from '@game/core';
import { economy, simConfig } from '../build/setup.js';
import { content } from '../content.js';
import { legalCore, newRun, send } from '../run/test-run.js';
import {
  clipPaths,
  coreCells,
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
    expect(legalSet(team, content).size).toBe(legal.length);
    for (const c of legal) {
      expect(verdictAt(team, content, c)).toMatchObject({
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
        const v = verdictAt(team, content, { x, y });
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
    const v = verdictAt(team, content, bad);
    expect(v.ok).toBe(false);
    const r = (() => {
      try {
        return send(run, { type: 'propose_core', x: bad.x, y: bad.y });
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
    const paths = routesFor(team, content, simConfig, at);
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
      routesFor(team, content, simConfig, { x: width - 1, y: height - 1 }),
    ).toBeNull();
    expect(team.core).toBeNull();
  });

  test('cells beyond the front row are clipped away (core issue 32)', () => {
    const paths: EnemyPath[] = [
      {
        entry: { x: 1, y: height - 1 },
        cells: [
          { x: 1, y: height - 1 },
          { x: 1, y: height },
          { x: 2, y: height + 3 },
          { x: 2, y: height - 2 },
        ],
        breach: { building: 4, cell: { x: 2, y: height + 1 } },
      },
      {
        entry: { x: 0, y: height },
        cells: [{ x: 0, y: height }],
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
