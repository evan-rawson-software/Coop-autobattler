import {
  listLegalCorePositions,
  addConduit,
  addToStash,
  createTeamState,
  placeCore,
  placeFromStash,
  type GameMap,
  type TeamState,
} from '@game/core';
import type { RunState } from '@game/session';
import type { VNode } from 'preact';
import { describe, expect, test, vi } from 'vitest';
import { content } from '../content.js';
import { BuildController } from './build-controller.js';
import { BuildSession } from './session.js';
import { BorderLinksPanel } from './panels.js';
import { NEIGHBOUR_ALPHA, halfAlpha, halfCell } from './border-links.js';

// The Border links list (issue #142): own halves only, solo hidden, Remove
// locked while Ready.

const map: GameMap = {
  width: 24,
  height: 16,
  partySize: 2,
  plotWidth: 12,
  features: [],
  nodes: [{ x: 2, y: 2, resource: 'res_a' }],
};

function team(): { team: TeamState; conduit: number } {
  let t = createTeamState(map);
  for (const [p, x] of [
    [0, 5],
    [1, 17],
  ] as const) {
    const r = placeCore(t, content, content.mapgen, p, { x, y: 0 });
    if (!r.ok) throw new Error(r.reason);
    t = r.state;
  }
  const a = addToStash(t, content, {
    def: 'bld_extractor',
    tier: 1,
    owner: 0,
  });
  if (!a.ok) throw new Error(a.reason);
  const p = placeFromStash(a.state, content, {
    actor: 0,
    id: a.id,
    x: 2,
    y: 2,
    rotation: 0,
  });
  if (!p.ok) throw new Error(p.reason);
  const cells = [];
  for (let x = 2; x <= 11; x++) cells.push({ x, y: 3 });
  const c = addConduit(p.state, content, {
    actor: 0,
    from: { building: a.id, side: 'north' },
    to: { border: 0, y: 3 },
    cells,
  });
  if (!c.ok) throw new Error(c.reason);
  return { team: c.state, conduit: c.state.conduits[0]?.id ?? -1 };
}

/** Every element of a vnode tree (function components are not run). */
function walk(n: unknown, out: VNode[] = []): VNode[] {
  if (Array.isArray(n)) n.forEach((x) => walk(x, out));
  else if (typeof n === 'object' && n !== null && 'props' in n) {
    out.push(n as VNode);
    walk((n as VNode<{ children?: unknown }>).props.children, out);
  }
  return out;
}

const run = (t: TeamState, players: number): RunState =>
  ({
    team: t,
    players: [{ name: 'Ann' }, { name: 'Bo' }].slice(0, players),
  }) as unknown as RunState;

const attr = (n: VNode, name: string): unknown =>
  (n.props as Record<string, unknown>)[name];

const field = (nodes: VNode[], name: string): VNode[] =>
  nodes.filter((n) => attr(n, 'data-field') === name);

describe('BorderLinksPanel', () => {
  const { team: t, conduit } = team();

  test('lists only the acting player halves and follows the acting player', () => {
    const erase = vi.fn();
    const ctl = { eraseConduit: erase } as unknown as BuildController;
    const mine = walk(
      BorderLinksPanel({ run: run(t, 2), ctl, acting: 0, locked: false }),
    );
    expect(field(mine, 'link-text')).toHaveLength(1);
    expect(field(mine, 'links-empty')).toHaveLength(0);
    const other = walk(
      BorderLinksPanel({ run: run(t, 2), ctl, acting: 1, locked: false }),
    );
    expect(field(other, 'link-text')).toHaveLength(0);
    expect(field(other, 'links-empty')).toHaveLength(1);
    // The live region stays mounted when the list is empty.
    expect(field(other, 'links')).toHaveLength(1);
    const btn = mine.find((n) => attr(n, 'data-action') === 'remove-link');
    (attr(btn as VNode, 'onClick') as () => void)();
    expect(erase).toHaveBeenCalledWith(conduit);
  });

  test('hidden for a solo run; Remove is disabled while Ready', () => {
    const ctl = {} as unknown as BuildController;
    expect(
      BorderLinksPanel({ run: run(t, 1), ctl, acting: 0, locked: false }),
    ).toBeNull();
    const locked = walk(
      BorderLinksPanel({ run: run(t, 2), ctl, acting: 0, locked: true }),
    );
    const btn = locked.find((n) => attr(n, 'data-action') === 'remove-link');
    expect(attr(btn as VNode, 'disabled')).toBe(true);
  });
});

describe('removing a half while Ready', () => {
  test('the controller refuses and the conduit stays', async () => {
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
    const ctl = new BuildController();
    ctl.attach(s);
    s.setActing(0);
    const ex = s.run.team.stash.find((b) => b.def === 'bld_extractor');
    const node = s.run.team.map.nodes.find(
      (n) => n.x < s.run.team.map.plotWidth,
    );
    if (ex === undefined || node === undefined) throw new Error('setup');
    const placed = await s.dispatch({
      type: 'place_building',
      id: ex.id,
      x: node.x,
      y: node.y,
      rotation: 0,
    });
    expect(placed.ok).toBe(true);
    const w = s.run.team.map.plotWidth;
    const cells = [];
    for (let x = node.x; x < w; x++) cells.push({ x, y: node.y + 1 });
    const added = await s.dispatch({
      type: 'add_conduit',
      from: { building: ex.id, side: 'north' },
      to: { border: 0, y: node.y + 1 },
      cells,
    });
    expect(added.ok).toBe(true);
    const id = s.run.team.conduits[0]?.id ?? -1;
    await s.dispatch({ type: 'ready' });
    expect(s.run.perPlayer[0]?.ready).toBe(true);
    const act = vi.spyOn(s, 'act');
    await ctl.eraseConduit(id);
    expect(act).not.toHaveBeenCalled();
    expect(s.run.team.conduits.some((c) => c.id === id)).toBe(true);
  });
});

describe('neighbour halves are dimmed', () => {
  test('alpha follows the acting player; the cell is on the owner side', () => {
    const { team: t } = team();
    expect(halfAlpha({ owner: 0 }, 0)).toBe(1);
    expect(halfAlpha({ owner: 0 }, 1)).toBe(NEIGHBOUR_ALPHA);
    expect(NEIGHBOUR_ALPHA).toBeLessThan(1);
    expect(halfCell(t, { owner: 0, spot: { border: 0, y: 3 } })).toEqual({
      x: 11,
      y: 3,
    });
    expect(halfCell(t, { owner: 1, spot: { border: 0, y: 3 } })).toEqual({
      x: 12,
      y: 3,
    });
  });
});
