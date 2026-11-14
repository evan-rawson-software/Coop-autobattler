import { describe, expect, test } from 'vitest';
import { listLegalCorePositions, type EnemyPath } from '@game/core';
import { BuildSession } from '../build/session.js';
import { pendingCoreSpots } from '../build/view-model.js';
import { economy, simConfig } from '../build/setup.js';
import { content } from '../content.js';
import { legalCore, newRun, send } from '../run/test-run.js';
import {
  clipPaths,
  coreCells,
  hintText,
  isRepeatClick,
  visibleProblem,
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

  test('a Ready player is offered no spots', () => {
    expect(legalSet(team, content, 0, true).size).toBe(0);
    expect(legalSet(team, content, 0, false).size).toBe(legal.length);
  });

  test('every illegal cell has a reason in plain words', () => {
    const seen = new Set<string>();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = verdictAt(team, content, { x, y }, 0);
        if (v.ok) continue;
        expect(v.problem).not.toBeNull();
        expect(v.text?.length).toBeGreaterThan(10);
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

  test('problem texts say what is wrong', () => {
    expect(problemText('out_of_bounds')).toBe('Off the board edge.');
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

describe('repeat click and refusal ownership', () => {
  test('a repeat click on the chosen spot sends nothing', () => {
    expect(isRepeatClick({ x: 3, y: 4 }, { x: 3, y: 4 })).toBe(true);
    expect(isRepeatClick({ x: 3, y: 4 }, { x: 3, y: 5 })).toBe(false);
    expect(isRepeatClick(null, { x: 3, y: 4 })).toBe(false);
  });
  test('a refusal is not shown after the acting player changes', () => {
    const stored = { acting: 0, text: 'No.' };
    expect(visibleProblem(stored, 0)).toBe('No.');
    expect(visibleProblem(stored, 1)).toBeNull();
    expect(visibleProblem(null, 0)).toBeNull();
  });
});

describe('hint line', () => {
  const legalCell = legalCore(run)[0] ?? { x: 0, y: 0 };
  const good = verdictAt(team, content, legalCell, 0);
  const bad = verdictAt(team, content, { x: width - 1, y: 0 }, 0);
  const stale = 'Off the board edge.';

  test('a stored refusal is not hidden by a hover left over after a tap', () => {
    expect(bad.ok).toBe(false);
    expect(hintText({ hover: good, selected: null, message: stale })).toBe(
      stale,
    );
    // The screen clears the message when the pointer moves to another cell.
    expect(hintText({ hover: good, selected: null, message: null })).toMatch(
      /Fits here/,
    );
  });
  test('hovering an illegal cell shows its own reason', () => {
    expect(hintText({ hover: bad, selected: null, message: null })).toBe(
      bad.text,
    );
  });
  test('nothing hovered: a stored message, or nothing', () => {
    expect(
      hintText({ hover: null, selected: { x: 3, y: 4 }, message: null }),
    ).toBe('');
    expect(hintText({ hover: null, selected: null, message: 'No.' })).toBe(
      'No.',
    );
    expect(hintText({ hover: null, selected: null, message: null })).toBe('');
  });
});

describe('choiceAnnouncement', () => {
  test('names the chosen spot and Ready', async () => {
    const { choiceAnnouncement } = await import('./view-model.js');
    expect(choiceAnnouncement(null, false)).toBe('');
    expect(choiceAnnouncement({ x: 3, y: 4 }, false)).toBe(
      'Core spot chosen: column 3, row 4.',
    );
    expect(choiceAnnouncement({ x: 3, y: 4 }, true)).toMatch(/You are Ready/);
  });
});

describe('the Core screen after a switch of the acting player', () => {
  test('a refusal and a chosen spot belong to one player', async () => {
    const s = await BuildSession.start(7, Date.now, ['Ann', 'Bo']);
    const pos = listLegalCorePositions(
      s.run.team.map,
      content,
      content.mapgen,
      0,
    )[0];
    if (pos === undefined) throw new Error('no spot');
    await s.dispatch({ type: 'place_core', x: pos.x, y: pos.y });
    const chosen = (p: number) =>
      pendingCoreSpots(s.run.pending).find((c) => c.player === p) ?? null;
    const stored = { acting: 0, text: 'Not there.' };
    expect(chosen(0)).toMatchObject(pos);
    expect(visibleProblem(stored, 0)).toBe('Not there.');
    s.setActing(1);
    expect(chosen(1)).toBeNull();
    expect(visibleProblem(stored, 1)).toBeNull();
    s.setActing(0);
    expect(chosen(0)).toMatchObject(pos);
  });
});
