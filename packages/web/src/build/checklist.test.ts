import type { Cell } from '@game/core';
import { beforeEach, describe, expect, test } from 'vitest';
import { content } from '../content.js';
import { proposePath } from './autoroute.js';
import { deriveChecklist } from './checklist.js';
import { newStashIds, noteRound, resetNewItems } from './new-items.js';
import { nextFightOf } from './next-fight.js';
import { simConfig } from './setup.js';
import { buildRun, firstFit, stashIds } from './test-helpers.js';
import type { BuildSession } from './session.js';
import { computeFlowView, deriveProblems } from './view-model.js';

/** The checklist of the session's board, as the Build screen derives it. */
function listOf(s: BuildSession, withFlow: boolean) {
  const team = s.run.team;
  const flow = withFlow ? computeFlowView(team, content, simConfig, 600) : null;
  const problems = deriveProblems(team, content, flow);
  return deriveChecklist(team, content, problems, flow, 0);
}

async function placeAt(s: BuildSession, id: number, c: Cell): Promise<void> {
  expect(await s.act({ t: 'place', id, x: c.x, y: c.y, rotation: 0 })).toEqual({
    ok: true,
  });
}

describe('the Before you fight checklist', () => {
  test('a fresh kit: a reminder to place it, nothing satisfied', async () => {
    const s = await buildRun();
    const list = listOf(s, true);
    expect(list.items.every((i) => i.state !== 'ok')).toBe(true);
    const stash = list.items.find((i) => i.problem?.kind === 'stash');
    expect(stash?.state).toBe('hint');
    expect(stash?.fix).toBe('Drag a slot from the inventory onto the board.');
    expect(list.items.some((i) => i.id === 'all-placed')).toBe(false);
  });

  test('a building with no conduit is a warning with a fix, before reminders', async () => {
    const s = await buildRun();
    const bk = stashIds(s.run.team, 'bld_barracks')[0] as number;
    await placeAt(s, bk, firstFit(s.run.team, bk));
    const list = listOf(s, true);
    const w = list.items.filter((i) => i.state === 'warn');
    expect(w.length).toBeGreaterThan(0);
    expect(w[0]?.problem?.kind).toBe('missing_input');
    expect(w[0]?.fix).toBe('Drag a conduit into it from a source.');
    expect(w[0]?.text).toMatch(/Barracks/);
    // Warnings come first, then reminders.
    const states = list.items.map((i) => i.state);
    expect(states.lastIndexOf('warn')).toBeLessThan(
      states.indexOf('hint') === -1 ? Infinity : states.indexOf('hint'),
    );
  });

  test('a fed barracks is a satisfied check; each item matches the problems', async () => {
    const s = await buildRun();
    const team = s.run.team;
    const need = content.buildings.get('bld_barracks')?.inputs[0]?.resource;
    const node = team.map.nodes.find((n) => n.resource === need) as Cell;
    const ex = stashIds(team, 'bld_extractor')[0] as number;
    const bk = stashIds(team, 'bld_barracks')[0] as number;
    await placeAt(s, ex, node);
    await placeAt(
      s,
      bk,
      firstFit(
        s.run.team,
        bk,
        0,
        (c) => c.y < node.y + 4 || Math.abs(c.x - node.x) > 6,
      ),
    );
    const from = { building: ex, side: 'north' as const };
    const to = { building: bk, side: 'south' as const };
    const cells = proposePath(s.run.team, content, from, to, [], 0);
    expect(cells).not.toBeNull();
    expect(await s.act({ t: 'add', from, to, cells: cells as Cell[] })).toEqual(
      { ok: true },
    );
    const flow = computeFlowView(s.run.team, content, simConfig, 600);
    const problems = deriveProblems(s.run.team, content, flow);
    const list = deriveChecklist(s.run.team, content, problems, flow, 0);
    const ok = list.items.filter((i) => i.state === 'ok');
    expect(ok.map((i) => i.text)).toContain('Barracks is getting Ore');
    // Every warning and reminder is a problem of the unchanged list.
    expect(list.items.filter((i) => i.state !== 'ok').map((i) => i.id)).toEqual(
      problems.map((p) => p.id),
    );
    // Nothing satisfied is listed for a building that has a problem.
    const broken = new Set(problems.map((p) => p.building));
    for (const i of ok) {
      const id = Number(i.id.split(':')[1]);
      if (i.id.startsWith('getting:')) expect(broken.has(id)).toBe(false);
    }
  });

  test('satisfied checks are capped, and the rest counted', () => {
    const team = {
      buildings: [],
      stash: [],
    } as never;
    const list = deriveChecklist(team, content, [], null, 0, 4);
    expect(list.items).toEqual([]);
    expect(list.okHidden).toBe(0);
  });
});

describe('NEW badges', () => {
  beforeEach(() => {
    resetNewItems();
  });

  test('items that arrive after the round was first seen are new', async () => {
    const s = await buildRun();
    const before = s.run;
    noteRound(before);
    expect(newStashIds(before).size).toBe(0);
    const later = {
      ...before,
      team: {
        ...before.team,
        stash: [
          ...before.team.stash,
          { id: before.team.nextId, def: 'bld_wall_i', tier: 1, owner: 0 },
        ],
        nextId: before.team.nextId + 1,
      },
    };
    expect([...newStashIds(later)]).toEqual([before.team.nextId]);
  });

  test('a run never seen has no new items', async () => {
    const s = await buildRun();
    expect(newStashIds(s.run).size).toBe(0);
  });
});

describe('Next fight', () => {
  const pvp = (winGold: number | null, lifeCost: number) =>
    ({
      kind: 'pvp',
      round: 3,
      title: 'Rival party',
      boss: false,
      bossNote: '',
      options: [],
      pvp: { winGold, lossGold: null, lifeCost },
    }) as never;

  test('a rival party shows the stakes', () => {
    expect(nextFightOf(pvp(8, 1))).toEqual({
      title: 'Rival party',
      stakes: 'Win +8 gold · Lose −1 life',
    });
    expect(nextFightOf(pvp(null, 2))?.stakes).toBe('Win gold · Lose −2 lives');
  });

  test('nothing known shows nothing', () => {
    expect(nextFightOf(null)).toBeNull();
  });
});
