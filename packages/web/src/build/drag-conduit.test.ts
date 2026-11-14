import { occupancy, type Cell, type TeamState } from '@game/core';
import { describe, expect, test } from 'vitest';
import { content } from '../content.js';
import { BuildController } from './build-controller.js';
import { dragStep } from './drag-path.js';
import { outsideCells } from './geometry.js';
import { facesBoardEdge, outputFacesEdge } from './sides.js';
import { noRouteMessage, placedMessage, whyNoRoute } from './route-reasons.js';
import { BuildSession } from './session.js';
import { buildRun, stashIds } from './test-helpers.js';
import { deriveProblems } from './view-model.js';

// Conduit placement by dragging, and the reasons a route is not possible
// (issue #275).

/** An Extractor on a node of Barracks' resource and a Barracks above it. */
async function factory(): Promise<{
  s: BuildSession;
  ctl: BuildController;
  ex: number;
  bk: number;
}> {
  const s = await buildRun();
  const team = s.run.team;
  const need = content.buildings.get('bld_barracks')?.inputs[0]?.resource;
  const node = team.map.nodes.find(
    (n) => n.resource === need && n.x === 12 && n.y === 9,
  );
  if (node === undefined) throw new Error('no node');
  const ex = stashIds(team, 'bld_extractor')[0] as number;
  const bk = stashIds(team, 'bld_barracks')[0] as number;
  await s.act({ t: 'place', id: ex, x: node.x, y: node.y, rotation: 0 });
  // Up and to the left: a path with a corner, clear of the cliffs.
  const placed = await s.act({
    t: 'place',
    id: bk,
    x: node.x - 4,
    y: node.y + 3,
    rotation: 0,
  });
  expect(placed.ok).toBe(true);
  const ctl = new BuildController();
  ctl.attach(s);
  return { s, ctl, ex, bk };
}

const settle = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

function pointer(
  ctl: BuildController,
  type: 'down' | 'move' | 'up',
  c: Cell,
): void {
  const team = ctl.team() as TeamState;
  const hit = occupancy(team, content).buildingAt(c.x, c.y);
  ctl.onBoardPointer({
    type,
    hit: {
      board: 'own',
      x: c.x,
      y: c.y,
      building: hit === null ? null : 'core' in hit ? 'core' : hit,
    },
    shiftKey: false,
    external: false,
  });
}

/** The straight-then-sideways path from the Extractor's output cell to the
 * cell outside the Barracks' south (input) side. */
function planPath(team: TeamState, ex: number, bk: number): Cell[] {
  const occ = occupancy(team, content);
  const a = team.buildings.find((b) => b.id === ex);
  const b = team.buildings.find((x) => x.id === bk);
  if (a === undefined || b === undefined) throw new Error('missing');
  const start = outsideCells(occ.cellsOf(a), 'north')[0] as Cell;
  const goal = outsideCells(occ.cellsOf(b), 'south')[0] as Cell;
  const path = [start];
  let cur = start;
  while (cur.y !== goal.y) {
    cur = { x: cur.x, y: cur.y + 1 };
    path.push(cur);
  }
  while (cur.x !== goal.x) {
    cur = { x: cur.x + Math.sign(goal.x - cur.x), y: cur.y };
    path.push(cur);
  }
  return path;
}

describe('dragStep', () => {
  test('grows one cell at a time, backs up over earlier cells', async () => {
    const { s, ex, bk } = await factory();
    const team = s.run.team;
    const path = planPath(team, ex, bk);
    const starts = [path[0] as Cell];
    // Not a start cell: nothing happens.
    expect(dragStep(team, content, 0, [], path[1] as Cell, starts)).toEqual({
      cells: [],
      blocked: null,
    });
    let cells: readonly Cell[] = dragStep(
      team,
      content,
      0,
      [],
      path[0] as Cell,
      starts,
    ).cells;
    expect(cells).toEqual([path[0]]);
    for (const c of path.slice(1, 4)) {
      cells = dragStep(team, content, 0, cells, c, starts).cells;
    }
    expect(cells).toEqual(path.slice(0, 4));
    // Moving back over the previous cell takes the last one off again.
    cells = dragStep(team, content, 0, cells, path[2] as Cell, starts).cells;
    expect(cells).toEqual(path.slice(0, 3));
    // Over an earlier cell: back to there.
    cells = dragStep(team, content, 0, cells, path[0] as Cell, starts).cells;
    expect(cells).toEqual([path[0]]);
  });

  test('a jump is walked cell by cell', async () => {
    const { s, ex, bk } = await factory();
    const team = s.run.team;
    const path = planPath(team, ex, bk);
    const r = dragStep(team, content, 0, [path[0] as Cell], path[1] as Cell);
    expect(r.cells).toEqual(path.slice(0, 2));
    expect(r.blocked).toBeNull();
  });

  test('a building in the way stops the path and names it', async () => {
    const { s, ex, bk } = await factory();
    const team = s.run.team;
    const path = planPath(team, ex, bk);
    const b = team.buildings.find((x) => x.id === bk);
    if (b === undefined) throw new Error('missing');
    const r = dragStep(team, content, 0, path.slice(0, 2), {
      x: b.x,
      y: b.y,
    });
    // Walks toward the Barracks and stops at its first cell.
    expect(r.blocked?.reason).toBe('overlaps_building');
    expect(r.blocked?.building?.id).toBe(bk);
    expect(r.cells.length).toBeLessThan(path.length + 1);
    expect(r.cells.slice(0, 2)).toEqual(path.slice(0, 2));
  });

  test('cells off the board or in another plot stop the path', async () => {
    const { s } = await factory();
    const team = s.run.team;
    const edge: Cell = { x: 0, y: 0 };
    const off = dragStep(team, content, 0, [edge], { x: -1, y: 0 });
    expect(off.cells).toEqual([edge]);
    expect(off.blocked?.reason).toBe('out_of_bounds');
  });

  test('a drawn path is accepted by core as is', async () => {
    const { s, ctl, ex, bk } = await factory();
    const path = planPath(s.run.team, ex, bk);
    ctl.setTool('conduit');
    pointer(ctl, 'down', path[0] as Cell);
    for (const c of path.slice(1)) pointer(ctl, 'move', c);
    const mid = ctl.model.get().ui.draftView;
    expect(mid?.cells).toEqual(path);
    expect(mid?.ok).toBe(true);
    pointer(ctl, 'up', path[path.length - 1] as Cell);
    await settle();
    const conduits = s.run.team.conduits;
    expect(conduits).toHaveLength(1);
    // Exactly the dragged cells, in order.
    expect(conduits[0]?.cells).toEqual(path);
    expect(ctl.model.get().ui.status.text).toContain('Conduit added');
  });
});

describe('dragging a conduit with the controller', () => {
  test('moving back undoes a cell; a blocked cell says why', async () => {
    const { s, ctl, ex, bk } = await factory();
    const path = planPath(s.run.team, ex, bk);
    ctl.setTool('conduit');
    pointer(ctl, 'down', path[0] as Cell);
    pointer(ctl, 'move', path[1] as Cell);
    pointer(ctl, 'move', path[2] as Cell);
    expect(ctl.model.get().ui.draft?.cells).toEqual(path.slice(0, 3));
    pointer(ctl, 'move', path[1] as Cell);
    expect(ctl.model.get().ui.draft?.cells).toEqual(path.slice(0, 2));
    // Onto the Extractor: nothing is added, the status explains.
    const exB = s.run.team.buildings.find((b) => b.id === ex);
    pointer(ctl, 'move', {
      x: (exB as { x: number }).x,
      y: (exB as { y: number }).y,
    });
    // (Walking down the column first backs up over the drawn cells.)
    expect(ctl.model.get().ui.draft?.cells).toEqual(path.slice(0, 1));
    expect(ctl.model.get().ui.status.text).toBe('Extractor is in the way.');
    expect(ctl.model.get().ui.status.kind).toBe('error');
    // Released away from an input side: the draft stays, nothing is built.
    pointer(ctl, 'up', path[0] as Cell);
    await settle();
    expect(s.run.team.conduits).toHaveLength(0);
    expect(ctl.model.get().ui.draft?.cells).toEqual(path.slice(0, 1));
  });
});

describe('why there is no route', () => {
  /** The team with building `id` moved to (x, y); no validation is run. */
  const moved = (
    team: TeamState,
    id: number,
    x: number,
    y: number,
  ): TeamState => ({
    ...team,
    buildings: team.buildings.map((b) => (b.id === id ? { ...b, x, y } : b)),
  });

  test('an output facing the board edge', async () => {
    const { s, ex } = await factory();
    const top = moved(s.run.team, ex, 3, s.run.team.map.height - 1);
    const b = top.buildings.find((x) => x.id === ex);
    if (b === undefined) throw new Error('missing');
    expect(facesBoardEdge(top, content, b, 'north')).toBe(true);
    expect(outputFacesEdge(top, content, b)).toBe(true);
    const from = { building: ex, side: 'north' as const };
    expect(whyNoRoute(top, content, from, null)).toBe(
      "Extractor's output faces the board edge — rotate it (R).",
    );
    expect(noRouteMessage('statusNoRouteCell', top, content, from, null)).toBe(
      "No route to that cell. Extractor's output faces the board edge — rotate it (R).",
    );
    expect(placedMessage(top, content, b)).toEqual({
      text: "Placed Extractor. Extractor's output faces the board edge — rotate it (R).",
      warn: true,
    });
    // A building that is not at the edge raises nothing.
    const mid = s.run.team.buildings.find((x) => x.id === ex);
    if (mid === undefined) throw new Error('missing');
    expect(outputFacesEdge(s.run.team, content, mid)).toBe(false);
    expect(placedMessage(s.run.team, content, mid).warn).toBe(false);
  });

  test('the Problems list flags it', async () => {
    const { s, ex } = await factory();
    const top = moved(s.run.team, ex, 3, s.run.team.map.height - 1);
    const found = deriveProblems(top, content, null).find(
      (p) => p.kind === 'output_faces_edge',
    );
    expect(found?.text).toBe(
      "Extractor's output faces the board edge — rotate it (R).",
    );
    expect(found?.building).toBe(ex);
    expect(
      deriveProblems(s.run.team, content, null).some(
        (p) => p.kind === 'output_faces_edge',
      ),
    ).toBe(false);
  });

  test('a side blocked by a building, and the generic case', async () => {
    const { s, ex, bk } = await factory();
    const team = s.run.team;
    const e = team.buildings.find((x) => x.id === ex);
    if (e === undefined) throw new Error('missing');
    // The Barracks right above the Extractor blocks its output side.
    const stacked = moved(team, bk, e.x, e.y + 1);
    // A second Extractor beside the first fills the whole south side.
    const full: TeamState = {
      ...stacked,
      buildings: [...stacked.buildings, { ...e, id: 999, x: e.x + 1 }],
    };
    expect(
      whyNoRoute(stacked, content, { building: ex, side: 'north' }, null),
    ).toBe("Extractor's output side is blocked by Barracks.");
    // The Extractor right below the Barracks' south input blocks that side.
    expect(
      whyNoRoute(full, content, null, { building: bk, side: 'south' }),
    ).toBe('That side is blocked by Extractor.');
    // Otherwise there is no particular reason to name.
    expect(
      whyNoRoute(
        team,
        content,
        { building: ex, side: 'north' },
        { building: bk, side: 'south' },
      ),
    ).toBe(
      'No free path between them — move a building or draw the path by dragging.',
    );
  });
});
