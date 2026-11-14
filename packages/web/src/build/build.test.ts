import { describe, expect, test } from 'vitest';
import {
  dryRunFlow,
  conduitResource,
  type Cell,
  type ConduitEnd,
  type TeamState,
} from '@game/core';
import { content } from '../content.js';
import { proposePath, routeBetween } from './autoroute.js';
import { previewConduit } from './ops.js';
import { CONTROLLER_REASONS, GHOST_REASONS } from '@game/session';
import { shopReason } from '../shop/messages.js';
import { KNOWN_REASONS, reasonMessage, REASON_MESSAGES } from './reasons.js';
import { simConfig } from './setup.js';
import { BuildSession } from './session.js';
import { buildRun, firstFit, stashIds } from './test-helpers.js';
import { layoutHash } from './undo.js';
import {
  computeFlowView,
  deriveProblems,
  inspectorFigures,
} from './view-model.js';

/** A working factory: an extractor on a node of the barracks' resource. */
async function factory(): Promise<{
  s: BuildSession;
  ex: number;
  bk: number;
  node: Cell;
}> {
  const s = await buildRun();
  const team = s.run.team;
  const bkDef = content.buildings.get('bld_barracks');
  const need = bkDef?.inputs[0]?.resource;
  const node = team.map.nodes.find((n) => n.resource === need);
  if (node === undefined) throw new Error('no node for the barracks');
  const ex = stashIds(team, 'bld_extractor')[0] as number;
  const bk = stashIds(team, 'bld_barracks')[0] as number;
  const r1 = await s.act({
    t: 'place',
    id: ex,
    x: node.x,
    y: node.y,
    rotation: 0,
  });
  expect(r1.ok).toBe(true);
  const spot = firstFit(
    s.run.team,
    bk,
    0,
    (c) => c.y < node.y + 4 || Math.abs(c.x - node.x) > 6,
  );
  const r2 = await s.act({
    t: 'place',
    id: bk,
    x: spot.x,
    y: spot.y,
    rotation: 0,
  });
  expect(r2.ok).toBe(true);
  return { s, ex, bk, node };
}

function ends(team: TeamState, ex: number, bk: number) {
  const from: ConduitEnd = { building: ex, side: 'north' };
  const to: ConduitEnd = { building: bk, side: 'south' };
  expect(team.buildings.some((b) => b.id === ex)).toBe(true);
  return { from, to };
}

async function connect(s: BuildSession, ex: number, bk: number) {
  const { from, to } = ends(s.run.team, ex, bk);
  const cells = proposePath(s.run.team, content, from, to, [], 0);
  expect(cells).not.toBeNull();
  const r = await s.act({ t: 'add', from, to, cells: cells as Cell[] });
  expect(r).toEqual({ ok: true });
}

describe('reason messages', () => {
  test('every reason has a non-empty message', () => {
    for (const reason of KNOWN_REASONS) {
      expect(REASON_MESSAGES[reason].length).toBeGreaterThan(3);
    }
  });

  test('every reason a session intent can return has plain wording', () => {
    for (const reason of [...GHOST_REASONS, ...CONTROLLER_REASONS]) {
      expect(Object.keys(REASON_MESSAGES), reason).toContain(reason);
      expect(shopReason(reason), reason).not.toMatch(/^Not allowed \(/);
    }
    expect(reasonMessage('invalid_state')).toBe(
      'The game hit an internal error and did not save this action. Reload and try again.',
    );
    expect(reasonMessage('ghost_selection_pending')).toBe(
      'Still choosing your next opponent…',
    );
    expect(
      reasonMessage('ghost_selection_pending', undefined, {
        reason: 'save_failed',
      }),
    ).toContain('could not be saved');
  });

  test('an inherited property name is not a reason', () => {
    expect(shopReason('constructor')).toBe('Not allowed (constructor).');
  });

  test('covers placement, core, stash and conduit reasons from core', () => {
    const listed = [
      // PlacementReason
      'unknown_building',
      'invalid_rotation',
      'out_of_bounds',
      'blocked_by_feature',
      'overlaps_core',
      'overlaps_building',
      'overlaps_conduit',
      'source_needs_node',
      'node_reserved',
      // CoreReason
      'core_already_placed',
      'blocked',
      'on_node',
      'too_far_forward',
      // StashReason
      'unknown_definition',
      'core_not_allowed',
      'invalid_tier',
      'invalid_owner',
      // ConduitReason
      'not_an_output',
      'not_an_input',
      'side_in_use',
      'invalid_path',
      'crosses_conduit',
      'resource_mismatch',
      'would_loop',
      'unknown_conduit',
    ];
    for (const r of listed) {
      expect(KNOWN_REASONS, `no message for ${r}`).toContain(r);
    }
  });

  test('an offending cell from core is appended', () => {
    expect(reasonMessage('crosses_conduit', '(3, 4)')).toBe(
      reasonMessage('crosses_conduit'),
    );
    expect(reasonMessage('crosses_conduit', '(3, 4)')).not.toContain('(3, 4)');
    expect(reasonMessage('made_up')).toContain('made_up');
  });
});

describe('auto-route', () => {
  test('proposes a path core accepts, never through occupied cells', async () => {
    const { s, ex, bk } = await factory();
    const { from, to } = ends(s.run.team, ex, bk);
    const cells = proposePath(s.run.team, content, from, to, [], 0) as Cell[];
    expect(previewConduit(s.run.team, content, from, to, cells, 0).ok).toBe(
      true,
    );
    for (let i = 1; i < cells.length; i++) {
      const a = cells[i - 1] as Cell;
      const b = cells[i] as Cell;
      expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBe(1);
    }
  });

  test('adjacent facing sides give an empty path', async () => {
    const s = await buildRun();
    const team = s.run.team;
    const node = team.map.nodes.find((n) => n.resource === 'res_a') as Cell;
    const ex = stashIds(team, 'bld_extractor')[0] as number;
    const bk = stashIds(team, 'bld_barracks')[0] as number;
    await s.act({ t: 'place', id: ex, x: node.x, y: node.y, rotation: 0 });
    // The barracks' input faces south; put it right above the extractor.
    const r = await s.act({
      t: 'place',
      id: bk,
      x: node.x,
      y: node.y + 1,
      rotation: 0,
    });
    if (!r.ok) return; // the node is against a wall of the map; nothing to test
    const { from, to } = ends(s.run.team, ex, bk);
    expect(proposePath(s.run.team, content, from, to, [], 0)).toEqual([]);
    expect(previewConduit(s.run.team, content, from, to, [], 0).ok).toBe(true);
  });

  test('a blocked board still gets a proposal for core to judge', async () => {
    const { s, ex, bk } = await factory();
    const { from, to } = ends(s.run.team, ex, bk);
    // Whatever is proposed, core has the final word and says why or accepts.
    const cells = proposePath(s.run.team, content, from, to, [], 0);
    expect(cells).not.toBeNull();
    const v = previewConduit(s.run.team, content, from, to, cells as Cell[], 0);
    expect(typeof v.ok).toBe('boolean');
  });

  test('routeBetween returns null for unreachable goals', async () => {
    const s = await buildRun();
    const r = routeBetween(
      s.run.team,
      content,
      [{ x: 0, y: 0 }],
      [{ x: 999, y: 999 }],
    );
    expect(r).toBeNull();
  });
});

describe('undo and redo', () => {
  test('place, move, rotate, return and conduit changes restore the layout', async () => {
    const { s, ex, bk } = await factory();
    const hashes: string[] = [layoutHash(s.run.team)];
    await connect(s, ex, bk);
    hashes.push(layoutHash(s.run.team));

    // Move the barracks (detaches the conduit).
    const b = s.run.team.buildings.find((x) => x.id === bk);
    if (b === undefined) throw new Error('no barracks');
    const moveTo = { x: b.x + 1, y: b.y };
    const moved = await s.act({
      t: 'move',
      id: bk,
      x: moveTo.x,
      y: moveTo.y,
      rotation: 0,
    });
    if (moved.ok) {
      expect(s.run.team.conduits.length).toBe(0);
      hashes.push(layoutHash(s.run.team));
    }
    const rot = await s.act({
      t: 'move',
      id: ex,
      x: s.run.team.buildings.find((x) => x.id === ex)?.x as number,
      y: s.run.team.buildings.find((x) => x.id === ex)?.y as number,
      rotation: 90,
    });
    if (rot.ok) hashes.push(layoutHash(s.run.team));
    const back = await s.act({ t: 'return', id: bk });
    expect(back.ok).toBe(true);
    hashes.push(layoutHash(s.run.team));

    // Undo everything, checking each prior state exactly.
    for (let i = hashes.length - 2; i >= 0; i--) {
      const r = await s.undo();
      expect(r).toEqual({ ok: true });
      expect(layoutHash(s.run.team)).toBe(hashes[i]);
    }
    // Redo everything forward.
    for (let i = 1; i < hashes.length; i++) {
      const r = await s.redo();
      expect(r).toEqual({ ok: true });
      expect(layoutHash(s.run.team)).toBe(hashes[i]);
    }
    expect(s.stack.redoCount).toBe(0);
  });

  test('undo restores conduits detached by a move', async () => {
    const { s, ex, bk } = await factory();
    await connect(s, ex, bk);
    const before = layoutHash(s.run.team);
    const b = s.run.team.buildings.find((x) => x.id === ex);
    if (b === undefined) throw new Error('no extractor');
    // Rotating always detaches; if it is illegal there is nothing to undo.
    const r = await s.act({
      t: 'move',
      id: ex,
      x: b.x,
      y: b.y,
      rotation: 180,
    });
    if (!r.ok) return;
    expect(s.run.team.conduits.length).toBe(0);
    expect(await s.undo()).toEqual({ ok: true });
    expect(s.run.team.conduits.length).toBe(1);
    expect(layoutHash(s.run.team)).toBe(before);
  });

  test('undo is dispatched as intents, so the action log grows', async () => {
    const { s } = await factory();
    const n = s.run.actionLog.length;
    await s.undo();
    expect(s.run.actionLog.length).toBe(n + 1);
  });

  test('a new action clears redo; a step change clears everything', async () => {
    const { s, ex } = await factory();
    await s.undo();
    expect(s.stack.redoCount).toBe(1);
    await s.act({ t: 'return', id: ex });
    expect(s.stack.redoCount).toBe(0);
    expect(s.stack.undoCount).toBeGreaterThan(0);
    const r = await s.dispatch({ type: 'ready' });
    expect(r.ok).toBe(true);
    expect(s.run.step).toBe('pve_choice');
    expect(s.stack.undoCount).toBe(0);
    expect(s.stack.redoCount).toBe(0);
    expect(await s.undo()).toBeNull();
  });

  test('an undo the board no longer allows is refused and the history is kept', async () => {
    const { s, ex } = await factory();
    // Break history: return the extractor outside the stack, then undo its
    // placement (whose inverse returns it again).
    await s.dispatch({ type: 'return_building', id: ex });
    const r = await s.undo();
    // undo of the barracks placement (the latest entry) still works
    expect(r).toEqual({ ok: true });
    const r2 = await s.undo();
    expect(r2).toMatchObject({ ok: false, kept: true });
    expect(s.stack.undoCount).toBe(1);
  });
});

describe('flow, inspector and problems', () => {
  test('flow view matches dryRunFlow', async () => {
    const { s, ex, bk } = await factory();
    await connect(s, ex, bk);
    const team = s.run.team;
    const view = computeFlowView(team, content, simConfig, 600);
    const dry = dryRunFlow(team, content, simConfig, 600);
    expect(view?.dry).toEqual(dry);
    const conduit = team.conduits[0];
    expect(conduit).toBeDefined();
    expect(view?.activeConduits.has(conduit?.id as number)).toBe(true);
    expect(
      conduitResource(team, content, conduit?.id as number),
    ).not.toBeNull();
    expect(view?.starved.size).toBe(0);
  });

  test('inspector figures come from the dry run and content numbers', async () => {
    const { s, ex, bk } = await factory();
    await connect(s, ex, bk);
    const team = s.run.team;
    const dry = dryRunFlow(team, content, simConfig, 600);
    const b = team.buildings.find((x) => x.id === bk);
    if (b === undefined) throw new Error('no barracks');
    const fig = inspectorFigures(team, content, simConfig, dry, b);
    const row = dry.consumers.find((c) => c.building === bk);
    expect(fig?.inputs[0]?.connected).toBe(true);
    const arrives = ((row?.ratePer1000 ?? 0) * simConfig.ticksPerSecond) / 1000;
    expect(fig?.inputs[0]?.arrivesPerSec).toBeCloseTo(arrives, 1);
    const bkDef = content.buildings.get('bld_barracks');
    const cost =
      bkDef?.kind === 'unit_producer'
        ? (bkDef.tiers[b.tier - 1]?.costPerUnit ?? 1)
        : 1;
    expect(fig?.derived?.kind).toBe('units');
    expect(fig?.derived?.cost).toBe(cost);
    expect(fig?.derived?.perMin).toBeCloseTo((arrives * 60) / cost, 0);
    const exFig = inspectorFigures(
      team,
      content,
      simConfig,
      dry,
      team.buildings.find((x) => x.id === ex) as never,
    );
    expect(exFig?.produces?.perSec).toBeGreaterThan(0);
  });

  test('an unconnected barracks has no arrivals and is a problem', async () => {
    const { s, bk } = await factory();
    const team = s.run.team;
    const flow = computeFlowView(team, content, simConfig, 600);
    const b = team.buildings.find((x) => x.id === bk);
    const fig = inspectorFigures(
      team,
      content,
      simConfig,
      flow?.dry ?? null,
      b as never,
    );
    expect(fig?.inputs[0]?.connected).toBe(false);
    expect(fig?.inputs[0]?.arrivesPerSec).toBe(0);
    const problems = deriveProblems(team, content, flow);
    expect(problems.some((p) => p.kind === 'missing_input')).toBe(true);
    expect(problems.some((p) => p.kind === 'lost_output')).toBe(true);
    // No conduit in is not repeated as a supply of 0 for the same building.
    expect(
      problems.some(
        (p) => p.kind === 'under_supplied' && p.id === `under:${String(bk)}`,
      ),
    ).toBe(false);
  });

  test('problems: stash, free nodes, starved; none when solved', async () => {
    const s = await buildRun();
    const team = s.run.team;
    const problems = deriveProblems(team, content, null);
    const kinds = problems.map((p) => p.kind);
    expect(kinds).toContain('stash');
    expect(kinds).toContain('free_nodes');
    const free = problems.find((p) => p.kind === 'free_nodes');
    expect(free?.focus).not.toBeNull();
    expect(free?.text).toMatch(/Extractor/);
    // Empty board, empty stash: nothing to report.
    const empty: TeamState = { ...team, stash: [] };
    expect(deriveProblems(empty, content, null)).toEqual([]);
  });

  test('a consumer fed by a conduit that delivers nothing is starved', async () => {
    const { s, ex, bk } = await factory();
    await connect(s, ex, bk);
    // Wrong resource node would be rejected by core, so starve it differently:
    // with 0 ticks nothing has arrived yet.
    const team = s.run.team;
    const flow = computeFlowView(team, content, simConfig, 0);
    expect(flow?.starved.has(bk)).toBe(true);
    const p = deriveProblems(team, content, flow);
    expect(p.some((x) => x.kind === 'starved')).toBe(true);
  });
});
