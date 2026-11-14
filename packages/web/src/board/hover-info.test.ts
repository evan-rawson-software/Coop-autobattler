import { describe, expect, test } from 'vitest';
import { defCells, type Cell, type TeamState } from '@game/core';
import { proposePath } from '../build/autoroute.js';
import { content } from '../content.js';
import { buildRun, firstFit, stashIds } from '../build/test-helpers.js';
import { describeHit, describeNeutral } from './hover-info.js';
import { buildScene, type Hit } from './scene.js';

const hit = (x: number, y: number, team: TeamState): Hit => {
  const scene = buildScene(team, null, 0, content, null);
  const b = scene.boards[0];
  return {
    board: 'own',
    x,
    y,
    building: b?.occ.buildingAt(x, y) as Hit['building'],
  };
};

async function board() {
  const s = await buildRun();
  const t0 = s.run.team;
  const need = content.buildings.get('bld_barracks')?.inputs[0]?.resource;
  const node = t0.map.nodes.find((n) => n.resource === need);
  if (node === undefined) throw new Error('no node');
  const ex = stashIds(t0, 'bld_extractor')[0] as number;
  const bk = stashIds(t0, 'bld_barracks')[0] as number;
  expect(
    (await s.act({ t: 'place', id: ex, x: node.x, y: node.y, rotation: 0 })).ok,
  ).toBe(true);
  const spot = firstFit(
    s.run.team,
    bk,
    0,
    (c) => c.y < node.y + 4 || Math.abs(c.x - node.x) > 6,
  );
  expect(
    (await s.act({ t: 'place', id: bk, x: spot.x, y: spot.y, rotation: 0 })).ok,
  ).toBe(true);
  return { s, node, ex, bk };
}

const info = (team: TeamState, x: number, y: number) =>
  describeHit(
    buildScene(team, null, 0, content, null),
    hit(x, y, team),
    content,
  );

describe('board hover info (issue #308)', () => {
  test('an unbuilt resource node names the resource and the building to use', async () => {
    const s = await buildRun();
    const team = s.run.team;
    const n = team.map.nodes[0];
    if (n === undefined) throw new Error('no node');
    const name = content.resources.get(n.resource)?.name as string;
    const r = info(team, n.x, n.y);
    expect(r?.title).toBe(`${name} node`);
    expect(r?.lines).toEqual([`Put an Extractor here to mine ${name}.`]);
    expect(r?.tone).toBe('resource');
    expect(r?.color).toBe(content.resources.get(n.resource)?.color);
  });

  test('a placed building shows name, tier and the Selected panel stats', async () => {
    const { s, node } = await board();
    const r = info(s.run.team, node.x, node.y);
    expect(r?.title).toBe('Extractor · Tier 1');
    expect(r?.lines.some((l) => l.startsWith('Collects '))).toBe(true);
    expect(r?.lines.some((l) => l.startsWith('Health '))).toBe(true);
    expect(r?.tone).toBe('building');
  });

  test('the Core says whose it is', async () => {
    const s = await buildRun();
    const team = s.run.team;
    const core = team.cores[0] as unknown as Cell;
    const r = info(team, core.x, core.y);
    expect(r?.title).toBe('Your Core');
    expect(r?.lines[0]).toContain('battle is lost');
  });

  test('terrain uses the presentation name and description', async () => {
    const s = await buildRun();
    const team = s.run.team;
    const f = team.map.features[0];
    if (f === undefined) throw new Error('no feature');
    const entry = content.presentation.get(f.feature);
    const r = info(team, f.x, f.y);
    expect(r?.title).toBe(entry?.name);
    expect(r?.lines[0]).toBe(entry?.description);
    expect(r?.tone).toBe('terrain');
  });

  test('plain ground is quiet; the front row says where enemies arrive', async () => {
    const s = await buildRun();
    const team = s.run.team;
    const taken = (x: number, y: number): boolean =>
      team.map.features.some((f) => f.x === x && f.y === y) ||
      team.map.nodes.some((n) => n.x === x && n.y === y);
    let plain: Cell | null = null;
    for (let y = 0; y < team.map.height - 1 && plain === null; y++) {
      for (let x = 0; x < team.map.width; x++) {
        const sc = buildScene(team, null, 0, content, null);
        if (!taken(x, y) && sc.boards[0]?.occ.buildingAt(x, y) === null) {
          plain = { x, y };
          break;
        }
      }
    }
    expect(plain).not.toBeNull();
    expect(info(team, (plain as Cell).x, (plain as Cell).y)).toBeNull();
    const top = team.map.height - 1;
    const x = [...Array(team.map.width).keys()].find(
      (cx) =>
        !taken(cx, top) &&
        buildScene(team, null, 0, content, null).boards[0]?.occ.buildingAt(
          cx,
          top,
        ) === null,
    ) as number;
    const r = info(team, x, top);
    expect(r?.title).toBe('Front edge');
    expect(r?.lines).toEqual(['Enemies arrive from here.']);
  });

  test('a conduit says what it carries, from and to', async () => {
    const { s, ex, bk } = await board();
    const team = s.run.team;
    const from = { building: ex, side: 'north' as const };
    const to = { building: bk, side: 'south' as const };
    const cells = proposePath(team, content, from, to, [], 0) as Cell[];
    const r = await s.act({ t: 'add', from, to, cells });
    if (!r.ok || cells.length === 0) return;
    const c = cells[0] as Cell;
    const res = info(s.run.team, c.x, c.y);
    expect(res?.title).toBe('Conduit');
    expect(res?.lines[0]).toMatch(/^Carries \w+ from Extractor to Barracks\.$/);
  });

  test('a wall is hit on its mask cells only, not the bounding box', async () => {
    const s = await buildRun();
    const t0 = s.run.team;
    const id = stashIds(t0, 'bld_wall_t')[0] ?? stashIds(t0, 'bld_wall_l')[0];
    if (id === undefined) return;
    const def = t0.stash.find((x) => x.id === id)?.def as string;
    const spot = firstFit(t0, id, 0);
    expect(
      (await s.act({ t: 'place', id, x: spot.x, y: spot.y, rotation: 0 })).ok,
    ).toBe(true);
    const team = s.run.team;
    const d = content.buildings.get(def);
    if (d === undefined) throw new Error('def');
    const mask = defCells(d, spot.x, spot.y, 0);
    const keys = new Set(mask.map((c) => `${String(c.x)},${String(c.y)}`));
    const xs = mask.map((c) => c.x);
    const ys = mask.map((c) => c.y);
    let empty = 0;
    for (let y = Math.min(...ys); y <= Math.max(...ys); y++) {
      for (let x = Math.min(...xs); x <= Math.max(...xs); x++) {
        const r = info(team, x, y);
        if (keys.has(`${String(x)},${String(y)}`)) {
          expect(r?.title).toBe(
            `${content.presentation.get(def)?.name ?? ''} · Tier 1`,
          );
        } else {
          empty++;
          expect(r?.title.endsWith('· Tier 1') ?? false).toBe(false);
        }
      }
    }
    // A T or L wall leaves cells of its box open.
    expect(empty).toBeGreaterThan(0);
  });

  test('terrain of the neutral strip is found by view cell', () => {
    const lake = content.terrain.list()[0];
    if (lake === undefined) throw new Error('no terrain');
    const r = describeNeutral(
      [{ x: 3, y: 5, style: 0, feature: lake.id }],
      3.4,
      5.9,
      content,
    );
    expect(r?.title).toBe(content.presentation.get(lake.id)?.name);
    expect(
      describeNeutral(
        [{ x: 3, y: 5, style: 0, feature: lake.id }],
        4.1,
        5.9,
        content,
      ),
    ).toBeNull();
  });
});
