import { listLegalCorePositions, type Cell } from '@game/core';
import { describe, expect, test } from 'vitest';
import { content } from '../content.js';
import {
  halfStatuses,
  type HalfStatus,
  linkText,
  ownSpotAt,
  ownSpots,
} from './border-links.js';
import { sideMarkers } from './sides.js';
import { BuildController, conduitAt } from './build-controller.js';
import { BuildSession } from './session.js';
import { simConfig } from './setup.js';
import {
  computeFlowView,
  deriveProblems,
  type FlowView,
  type ProblemScope,
} from './view-model.js';
import { buildingRate, formatHundredths, supplyOf } from './rates.js';
import { dryRunFlow } from '@game/core';

// Border links in the Build screen (issue #142 part 2, PP-4).

async function start(): Promise<{ s: BuildSession; ctl: BuildController }> {
  const s = await BuildSession.start(7, Date.now, ['Ann', 'Bo']);
  for (const p of [0, 1]) {
    s.setActing(p);
    const pos = listLegalCorePositions(
      s.run.team.map,
      content,
      content.mapgen,
      p,
    )[0];
    if (pos === undefined) throw new Error('no spot');
    await s.dispatch({ type: 'place_core', x: pos.x, y: pos.y });
    await s.dispatch({ type: 'ready' });
  }
  if (s.run.step !== 'build') throw new Error(`step ${s.run.step}`);
  const ctl = new BuildController();
  ctl.attach(s);
  return { s, ctl };
}

const click = (ctl: BuildController, c: Cell): void => {
  const team = ctl.team();
  if (team === null) throw new Error('no team');
  const b = team.buildings.find(
    (x) =>
      c.x >= x.x &&
      c.y >= x.y &&
      c.x < x.x + (x.def === 'bld_barracks' ? 2 : 1) &&
      c.y < x.y + (x.def === 'bld_barracks' ? 2 : 1),
  );
  ctl.onBoardPointer({
    type: 'down',
    hit: { board: 'own', x: c.x, y: c.y, building: b ?? null },
    shiftKey: false,
    external: false,
  });
  ctl.onBoardPointer({
    type: 'up',
    hit: { board: 'own', x: c.x, y: c.y, building: b ?? null },
    shiftKey: false,
    external: false,
  });
};

const settle = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

describe('border links in the Build screen', () => {
  test('spots exist only on the acting plot border and not in solo play', async () => {
    const { s } = await start();
    const t = s.run.team;
    const w = t.map.plotWidth;
    expect(ownSpots(t, 0).every((o) => o.cell.x === w - 1)).toBe(true);
    expect(ownSpots(t, 1).every((o) => o.cell.x === w)).toBe(true);
    expect(ownSpotAt(t, 0, { x: w, y: 3 })).toBeNull();
    const solo = await BuildSession.start(7);
    expect(ownSpots(solo.run.team, 0)).toEqual([]);
  });

  test('two players draw halves: open, then joined, then open again', async () => {
    const { s, ctl } = await start();
    const w = s.run.team.map.plotWidth;
    const ex0 = s.run.team.stash.find(
      (b) => b.owner === 0 && b.def === 'bld_extractor',
    );
    const ex1 = s.run.team.stash.find(
      (b) => b.owner === 1 && b.def === 'bld_barracks',
    );
    if (ex0 === undefined || ex1 === undefined) throw new Error('stash');

    // Player 0: extractor on a node beside the border, output into the border.
    s.setActing(0);
    const node = s.run.team.map.nodes.find((n) => n.x === w - 1 && n.y === 5);
    if (node === undefined) throw new Error('map changed: no node at border');
    const placed = await s.dispatch({
      type: 'place_building',
      id: ex0.id,
      x: node.x,
      y: node.y,
      rotation: 0,
    });
    expect(placed.ok).toBe(true);
    ctl.setTool('conduit');
    click(ctl, { x: w - 1, y: 6 }); // output marker starts the draft
    click(ctl, { x: w - 1, y: 6 }); // the border spot ends it
    await settle();
    let halves = halfStatuses(s.run.team);
    expect(halves).toHaveLength(1);
    expect(halves[0]).toMatchObject({ owner: 0, kind: 'send', state: 'open' });
    expect(linkText(halves[0] as HalfStatus, (p) => `P${String(p)}`)).toContain(
      'Not connected',
    );

    // Player 1: barracks near the border; receiving half from the spot.
    s.setActing(1);
    ctl.setTool('conduit');
    const placed1 = await s.dispatch({
      type: 'place_building',
      id: ex1.id,
      x: w + 2,
      y: 7,
      rotation: 0,
    });
    expect(placed1.ok).toBe(true);
    click(ctl, { x: w, y: 6 }); // the border spot starts a receiving draft
    click(ctl, { x: w + 2, y: 7 }); // a building ends it at an input side
    await settle();
    halves = halfStatuses(s.run.team);
    expect(halves.map((h) => [h.owner, h.kind, h.state])).toEqual([
      [0, 'send', 'joined'],
      [1, 'receive', 'joined'],
    ]);

    // A neighbour's half cannot be selected or erased by the other player.
    const other = s.run.team.conduits.find((c) => c.owner === 0);
    if (other === undefined) throw new Error('no half');
    expect(conduitAt(s.run.team, { x: w - 1, y: 6 }, 1)).toBeUndefined();
    ctl.setTool('erase');
    click(ctl, { x: w - 1, y: 6 });
    await settle();
    expect(s.run.team.conduits).toHaveLength(2);

    // Player 1 erases their own half: player 0's half is unconnected again.
    click(ctl, { x: w, y: 6 });
    await settle();
    halves = halfStatuses(s.run.team);
    expect(halves).toHaveLength(1);
    expect(halves[0]).toMatchObject({ owner: 0, state: 'open' });
  });

  test('two halves of the same kind show a warning state, not joined', async () => {
    const { s } = await start();
    const t = s.run.team;
    const mk = (id: number, owner: number, from: object, to: object) => ({
      id,
      owner,
      from,
      to,
      cells: [],
    });
    const fake = {
      ...t,
      conduits: [
        mk(90, 0, { building: 1, side: 'north' }, { border: 0, y: 4 }),
        mk(91, 1, { building: 2, side: 'north' }, { border: 0, y: 4 }),
      ],
    } as unknown as typeof t;
    const st = halfStatuses(fake);
    expect(st.map((h) => h.state)).toEqual(['same_kind', 'same_kind']);
    expect(linkText(st[0] as HalfStatus, (p) => `P${String(p)}`)).toContain(
      'Cannot join',
    );
  });
});

// Player `p` puts a stashed extractor on `node` and draws a sending half out
// of it to their border spot in row `y`, all through the controller.
async function drawSend(
  s: BuildSession,
  ctl: BuildController,
  p: 0 | 1,
  node: Cell,
  y: number,
): Promise<Cell> {
  s.setActing(p);
  const w = s.run.team.map.plotWidth;
  const ex = s.run.team.stash.find(
    (b) => b.owner === p && b.def === 'bld_extractor',
  );
  if (ex === undefined) throw new Error('no extractor');
  const placed = await s.dispatch({
    type: 'place_building',
    id: ex.id,
    x: node.x,
    y: node.y,
    rotation: 0,
  });
  if (!placed.ok) throw new Error(placed.reason);
  const start = sideMarkers(s.run.team, content, 'out', ex.id).flatMap(
    (m) => m.cells,
  )[0];
  if (start === undefined) throw new Error('no output marker');
  const spot = { x: p === 0 ? w - 1 : w, y };
  ctl.setTool('conduit');
  click(ctl, start); // the output marker starts the draft
  click(ctl, spot); // the border spot ends it
  await settle();
  return spot;
}

describe('refused border halves and acting switches', () => {
  test('a wrong border and a spot in use are refused and the draft stays usable', async () => {
    const { s, ctl } = await start();
    const w = s.run.team.map.plotWidth;
    const node = s.run.team.map.nodes.find((n) => n.x === w - 1 && n.y === 5);
    if (node === undefined) throw new Error('map changed: no node at border');
    const spot = await drawSend(s, ctl, 0, node, 6);
    expect(s.run.team.conduits).toHaveLength(1);

    // Spot in use: a receiving draft cannot start on the taken spot.
    click(ctl, spot);
    await settle();
    expect(s.run.team.conduits).toHaveLength(1);
    expect(ctl.model.get().ui.status.kind).toBe('error');

    // Wrong border: the neighbour's spot is not the acting player's.
    expect(ownSpotAt(s.run.team, 0, { x: w, y: 4 })).toBeNull();
    click(ctl, { x: w, y: 4 });
    await settle();
    expect(s.run.team.conduits).toHaveLength(1);
    expect(ctl.model.get().ui.draft).toBeNull();

    // The tool still works: erase the own half, then draw it again.
    ctl.setTool('erase');
    click(ctl, spot);
    await settle();
    expect(s.run.team.conduits).toHaveLength(0);
    ctl.setTool('conduit');
    click(ctl, spot);
    await settle();
    expect(ctl.model.get().ui.draft).not.toBeNull();
    expect(ctl.model.get().ui.status.kind).toBe('info');
  });

  test('undo and redo of a border half do not cross a switch of the acting player', async () => {
    const { s, ctl } = await start();
    const w = s.run.team.map.plotWidth;
    const node = s.run.team.map.nodes.find((n) => n.x === w - 1 && n.y === 5);
    if (node === undefined) throw new Error('map changed: no node at border');
    await drawSend(s, ctl, 0, node, 6);
    expect(s.store.get().undoCount).toBe(1);
    expect(await s.undo()).toEqual({ ok: true });
    expect(s.run.team.conduits).toHaveLength(0);
    expect(s.store.get().redoCount).toBe(1);

    // Switching clears both stacks: nothing to redo, and nothing for player 1.
    s.setActing(1);
    expect(s.store.get().redoCount).toBe(0);
    expect(await s.redo()).toBeNull();
    s.setActing(0);
    expect(await s.redo()).toBeNull();
    expect(s.run.team.conduits).toHaveLength(0);
  });

  test('halves of the same kind drawn through the controller are not joined', async () => {
    const { s, ctl } = await start();
    const t = s.run.team;
    const w = t.map.plotWidth;
    const n0 = t.map.nodes.find((n) => n.x === w - 1 && n.y === 5);
    const n1 = t.map.nodes.find((n) => n.x > w && n.x < 2 * w);
    if (n0 === undefined || n1 === undefined) {
      throw new Error('map changed: no node');
    }
    await drawSend(s, ctl, 0, n0, 6);
    await drawSend(s, ctl, 1, n1, 6);
    const halves = halfStatuses(s.run.team);
    expect(halves.map((h) => [h.owner, h.kind, h.state])).toEqual([
      [0, 'send', 'same_kind'],
      [1, 'send', 'same_kind'],
    ]);
  });
});

describe('rates', () => {
  test('numbers match the core helpers and are formatted for display', () => {
    const ex = content.buildings.get('bld_extractor');
    const bk = content.buildings.get('bld_barracks');
    if (ex === undefined || bk === undefined) throw new Error('content');
    const tps = simConfig.ticksPerSecond;
    // intervalTicks 20: 100 * tps / 20 hundredths per second.
    expect(buildingRate(ex, 1, tps).collects).toBe(
      Math.floor((100 * tps) / 20),
    );
    // 5 per 100 ticks.
    expect(buildingRate(bk, 1, tps).needs).toBe(Math.floor((500 * tps) / 100));
    expect(buildingRate(bk, 1, tps).needPer1000).toBe(50);
    expect(formatHundredths(125)).toBe('1.25');
    expect(formatHundredths(5)).toBe('0.05');
  });

  test('a consumer fed less than its need is under-supplied; fed enough it is not', async () => {
    const { s } = await start();
    const w = s.run.team.map.plotWidth;
    s.setActing(0);
    const ex = s.run.team.stash.filter(
      (b) => b.owner === 0 && b.def === 'bld_extractor',
    );
    const bk = s.run.team.stash.find(
      (b) => b.owner === 0 && b.def === 'bld_barracks',
    );
    const node = s.run.team.map.nodes.find(
      (n) => n.resource === 'res_a' && n.x < w,
    );
    if (ex[0] === undefined || bk === undefined || node === undefined) {
      throw new Error('setup');
    }
    // One extractor on an res_a node, a barracks fed straight from it.
    const place = (id: number, x: number, y: number) =>
      s.dispatch({ type: 'place_building', id, x, y, rotation: 0 });
    expect((await place(ex[0].id, node.x, node.y)).ok).toBe(true);
    expect((await place(bk.id, node.x, node.y + 2)).ok).toBe(true);
    const e = s.run.team.buildings.find((b) => b.id === ex[0]?.id);
    const b = s.run.team.buildings.find((x) => x.id === bk.id);
    if (e === undefined || b === undefined) throw new Error('not placed');
    const r = await s.dispatch({
      type: 'add_conduit',
      from: { building: e.id, side: 'north' },
      to: { building: b.id, side: 'south' },
      cells: [{ x: node.x, y: node.y + 1 }],
    });
    expect(r.ok).toBe(true);
    // A tier 1 barracks needs what one tier 1 extractor gives (one collector
    // feeds one producer of its tier, #145); a tier 2 barracks needs more.
    const team = {
      ...s.run.team,
      buildings: s.run.team.buildings.map((x) =>
        x.id === b.id ? { ...x, tier: 2 } : x,
      ),
    };
    const flow = computeFlowView(team, content, simConfig, 600);
    if (flow === null) throw new Error('no flow');
    const sup = flow.supply.find((x) => x.building === b.id);
    expect(sup).toBeDefined();
    const need = dryRunFlow(team, content, simConfig, 600, 'need');
    expect(supplyOf(team, content, need, simConfig.ticksPerSecond)).toEqual(
      flow.supply,
    );
    // The extractor makes 1 per 20 ticks (50 per 1000); the barracks needs 71.
    expect(sup?.state).toBe('under');
    expect(flow.underSupplied.has(b.id)).toBe(true);
    // The label does not depend on the dry-run length setting.
    for (const ticks of [0, 1, 100, 5000]) {
      const f = computeFlowView(team, content, simConfig, ticks);
      expect(f?.supply, `at ${String(ticks)} ticks`).toEqual(flow.supply);
    }
    expect(
      deriveProblems(team, content, flow).some(
        (p) => p.kind === 'under_supplied' && p.building === b.id,
      ),
    ).toBe(true);
  });
});

describe('supplied against need', () => {
  test('received at least the need: supplied; clearly less: under', async () => {
    const { s } = await start();
    s.setActing(0);
    const bk = s.run.team.stash.find(
      (b) => b.owner === 0 && b.def === 'bld_barracks',
    );
    const core = s.run.team.cores[0] ?? null;
    if (bk === undefined || core === null) throw new Error('setup');
    const placed = await s.dispatch({
      type: 'place_building',
      id: bk.id,
      x: core.x,
      y: core.y + 4,
      rotation: 0,
    });
    expect(placed.ok).toBe(true);
    const team = s.run.team;
    const run = (rate: number) =>
      supplyOf(
        team,
        content,
        {
          ticks: 600,
          needs: [{ building: bk.id, needPer1000: 75 }],
          consumers: [{ building: bk.id, side: 'south', ratePer1000: rate }],
        } as never,
        simConfig.ticksPerSecond,
      )[0]?.state;
    expect(run(80)).toBe('full');
    expect(run(75)).toBe('full');
    expect(run(50)).toBe('under');
    expect(run(0)).toBe('under');
  });
});

describe('a consumer whose need legitimately stopped', () => {
  test('an economy building that used all its steps is not under-supplied', async () => {
    const { s } = await start();
    const base = s.run.team;
    const oc = {
      id: 9001,
      def: 'bld_overclocker',
      tier: 1,
      x: 1,
      y: 1,
      rotation: 0,
      owner: 0,
    };
    const team = { ...base, buildings: [...base.buildings, oc] } as never;
    const max = (
      content.buildings.get('bld_overclocker')?.tiers[0] as
        { maxSteps?: number } | undefined
    )?.maxSteps;
    if (max === undefined) throw new Error('content');
    const run = (productions: number) =>
      supplyOf(
        team,
        content,
        {
          ticks: 600,
          needs: [{ building: 9001, needPer1000: 100, productions }],
          // The pacer stopped taking items at the limit: nothing arrives
          // in the second half of the run.
          consumers: [{ building: 9001, side: 'south', ratePer1000: 0 }],
        } as never,
        simConfig.ticksPerSecond,
      )[0]?.state;
    expect(run(max)).toBe('full');
    expect(run(max - 1)).toBe('under');
  });
});

describe('Backspace while drawing a border half', () => {
  test('on a receiving draft it cancels instead of leaving a stuck draft', async () => {
    const { s, ctl } = await start();
    const w = s.run.team.map.plotWidth;
    s.setActing(1);
    ctl.setTool('conduit');
    click(ctl, { x: w, y: 6 }); // the border spot starts a receiving draft
    expect(ctl.model.get().ui.draft?.building).toBe(-1);
    expect(ctl.model.get().ui.draft?.cells).toHaveLength(1);
    const key = {
      key: 'Backspace',
      ctrlKey: false,
      shiftKey: false,
      metaKey: false,
    };
    expect(ctl.key(key)).toBe(true);
    expect(ctl.model.get().ui.draft).toBeNull();
  });
});

describe('under-supplied problems in a party', () => {
  test('own buildings one by one, one summary line per partner, none in solo', async () => {
    const { s } = await start();
    const t = s.run.team;
    const mk = (id: number, owner: number, x: number) => ({
      id,
      def: 'bld_barracks',
      owner,
      x,
      y: 0,
      rotation: 0,
      tier: 1,
    });
    const team = {
      ...t,
      stash: [],
      buildings: [mk(1, 0, 0), mk(2, 1, 4), mk(3, 1, 8), mk(4, 1, 12)],
    } as unknown as typeof t;
    const flow = {
      dry: { consumers: [], sources: [] },
      starved: new Set<number>(),
      supply: [1, 2, 3, 4].map((building) => ({
        building,
        state: 'under',
        gets: 10,
        needs: 50,
      })),
    } as unknown as FlowView;
    const under = (scope?: ProblemScope) =>
      deriveProblems(team, content, flow, scope).filter(
        (p) => p.kind === 'under_supplied',
      );
    const scope = { acting: 0, names: ['Ann', 'Bo'] };
    const mine = under(scope);
    expect(mine.map((p) => p.building)).toEqual([1, null]);
    expect(mine[1]?.text).toBe('Bo has 3 under-supplied buildings.');
    // From the other seat the roles swap.
    const theirs = under({ acting: 1, names: scope.names });
    expect(theirs.map((p) => p.building)).toEqual([2, 3, 4, null]);
    expect(theirs[3]?.text).toBe('Ann has 1 under-supplied building.');
    // Solo (no scope): every building is the player's own.
    expect(under().map((p) => p.building)).toEqual([1, 2, 3, 4]);
  });
});
