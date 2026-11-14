import { occupancy, type Cell } from '@game/core';
import type { RunState } from '@game/session';
import { describe, expect, test } from 'vitest';
import { proposePath } from '../build/autoroute.js';
import { simConfig } from '../build/setup.js';
import { buildRun, firstFit, stashIds } from '../build/test-helpers.js';
import { computeFlowView } from '../build/view-model.js';
import { tutorialMarks } from '../build/tutorial-overlay.js';
import { content } from '../content.js';
import {
  allowedDefs,
  brokenStep,
  freeNodes,
  freePowerNodes,
  RING_COUNT,
  TURRET_NEAR_CORE,
  coreCellsOf,
  highlightDef,
  turretResource,
  oreResource,
  stepsDone,
  tutorialDefs,
  tutorialFacts,
  tutorialPosition,
  type TutorialFacts,
  type TutorialInput,
} from './steps.js';

const NO_FACTS: TutorialFacts = {
  extractor: false,
  powerExtractor: false,
  spareExtractor: false,
  barracksPlaced: false,
  barracksFed: false,
  turret: false,
  turretPowered: false,
};

function input(
  step: string,
  facts: Partial<TutorialFacts> = {},
  more: Partial<TutorialInput> = {},
  run: Partial<RunState> = {},
): TutorialInput {
  return {
    run: { round: 1, leg: 'pve', step, ...run } as unknown as RunState,
    facts: { ...NO_FACTS, ...facts },
    turretSkipped: false,
    battleDone: false,
    ...more,
  };
}

describe('tutorial position', () => {
  test('follows the run step and the first undone step of 2 to 4', () => {
    const at = (i: TutorialInput) => tutorialPosition(i);
    expect(at(input('core_placement'))).toEqual({ kind: 'step', n: 1 });
    expect(at(input('build'))).toEqual({ kind: 'step', n: 2 });
    expect(at(input('build', { extractor: true }))).toEqual({
      kind: 'step',
      n: 3,
    });
    expect(at(input('build', { extractor: true, barracksFed: true }))).toEqual({
      kind: 'step',
      n: 4,
    });
    expect(
      at(
        input('build', {
          extractor: true,
          barracksFed: true,
          turret: true,
          turretPowered: true,
        }),
      ),
    ).toEqual({ kind: 'step', n: 5 });
    expect(at(input('pve_choice'))).toEqual({ kind: 'step', n: 5 });
    expect(at(input('pve_summary'))).toEqual({ kind: 'step', n: 6 });
    expect(at(input('pve_summary', {}, { battleDone: true }))).toEqual({
      kind: 'closing',
    });
    expect(at(input('event_choice'))).toEqual({ kind: 'off' });
    expect(at(input('build', {}, {}, { round: 2 }))).toEqual({ kind: 'off' });
    expect(at(input('pvp_summary', {}, {}, { leg: 'pvp' }))).toEqual({
      kind: 'off',
    });
  });

  test('skipping the Turret step moves on to step 5', () => {
    const i = input(
      'build',
      { extractor: true, barracksFed: true },
      { turretSkipped: true },
    );
    expect(tutorialPosition(i)).toEqual({ kind: 'step', n: 5 });
  });

  test('done flags come from the facts and the step', () => {
    expect(stepsDone(input('core_placement'))).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(stepsDone(input('build', { extractor: true }))).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(stepsDone(input('pve_summary', {}, { battleDone: true }))).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  test('a loss points back at the first step that was not done', () => {
    expect(brokenStep(NO_FACTS, false)).toBe(2);
    expect(brokenStep({ ...NO_FACTS, extractor: true }, false)).toBe(3);
    expect(
      brokenStep({ ...NO_FACTS, extractor: true, barracksFed: true }, false),
    ).toBe(4);
    expect(
      brokenStep({ ...NO_FACTS, extractor: true, barracksFed: true }, true),
    ).toBeNull();
  });

  test('slots unlock step by step, and all at step 5', () => {
    const d = tutorialDefs(content);
    expect([...(allowedDefs(2, d) ?? [])]).toEqual([d.extractor]);
    expect(allowedDefs(3, d)?.has(d.barracks as string)).toBe(true);
    expect(allowedDefs(3, d)?.has(d.turret as string)).toBe(false);
    expect(allowedDefs(4, d)?.has(d.turret as string)).toBe(true);
    expect(allowedDefs(5, d)).toBeNull();
  });
});

describe('facts from a real board', () => {
  test('extractor on a node, barracks fed by a conduit, turret near the Core', async () => {
    const s = await buildRun();
    const defs = tutorialDefs(content);
    expect(defs.extractor).not.toBeNull();
    const team0 = s.run.team;
    expect(tutorialFacts(team0, content, 0, null)).toEqual({
      ...NO_FACTS,
      spareExtractor: true,
    });

    const ore = oreResource(content);
    const nodes = freeNodes(team0, content, 0);
    expect(nodes.length).toBeLessThanOrEqual(RING_COUNT);
    expect(nodes.length).toBeGreaterThan(0);
    for (const n of nodes) {
      expect(
        team0.map.nodes.find((k) => k.x === n.x && k.y === n.y)?.resource,
      ).toBe(ore);
    }
    const node = nodes[0] as Cell;
    const ex = stashIds(team0, defs.extractor as string)[0] as number;
    const bk = stashIds(team0, defs.barracks as string)[0] as number;
    // An extractor off a node is not step 2.
    expect(
      (await s.act({ t: 'place', id: ex, x: node.x, y: node.y, rotation: 0 }))
        .ok,
    ).toBe(true);
    expect(tutorialFacts(s.run.team, content, 0, null).extractor).toBe(true);
    // Step 2 no longer rings that node.
    expect(freeNodes(s.run.team, content, 0)).not.toContainEqual(node);

    const spot = firstFit(
      s.run.team,
      bk,
      0,
      (c) => c.y < node.y + 4 || Math.abs(c.x - node.x) > 6,
    );
    expect(
      (await s.act({ t: 'place', id: bk, x: spot.x, y: spot.y, rotation: 0 }))
        .ok,
    ).toBe(true);
    const placed = tutorialFacts(s.run.team, content, 0, null);
    expect(placed.barracksPlaced).toBe(true);
    expect(placed.barracksFed).toBe(false);

    // The suggested path for step 3 is a route the game accepts.
    const marks = tutorialMarks(s.run.team, content, 0, 3, placed);
    expect(marks?.path.length ?? 0).toBeGreaterThan(0);
    const from = { building: ex, side: 'north' as const };
    const to = { building: bk, side: 'south' as const };
    const cells = proposePath(s.run.team, content, from, to, [], 0) as Cell[];
    expect(await s.act({ t: 'add', from, to, cells })).toEqual({ ok: true });
    const flow = computeFlowView(s.run.team, content, simConfig, 600);
    expect(tutorialFacts(s.run.team, content, 0, flow).barracksFed).toBe(true);
  });

  test('the second Extractor on a Power node and a conduit power the Turret', async () => {
    const s = await buildRun();
    const defs = tutorialDefs(content);
    const [ex1, ex2] = stashIds(s.run.team, defs.extractor as string) as [
      number,
      number,
    ];
    const tu = stashIds(s.run.team, defs.turret as string)[0] as number;
    const ore = freeNodes(s.run.team, content, 0)[0] as Cell;
    expect(
      (await s.act({ t: 'place', id: ex1, x: ore.x, y: ore.y, rotation: 0 }))
        .ok,
    ).toBe(true);
    const core = coreCellsOf(s.run.team, content, 0);
    // Near the Core, with its input facing open ground.
    const spot = firstFit(
      s.run.team,
      tu,
      0,
      (c) =>
        c.y < 4 ||
        !core.some(
          (k) =>
            Math.max(Math.abs(c.x - k.x), Math.abs(c.y - k.y)) <=
            TURRET_NEAR_CORE - 2,
        ),
    );
    expect(
      (await s.act({ t: 'place', id: tu, x: spot.x, y: spot.y, rotation: 0 }))
        .ok,
    ).toBe(true);
    const placed = tutorialFacts(s.run.team, content, 0, null);
    expect(placed.turret).toBe(true);
    expect(placed.turretPowered).toBe(false);
    expect(placed.powerExtractor).toBe(false);
    // The Ore Extractor does not count as the Power one.
    expect(highlightDef(4, placed, defs)).toBe(defs.extractor);
    const rings = tutorialMarks(s.run.team, content, 0, 4, placed)?.rings ?? [];
    expect(rings.length).toBeGreaterThan(0);
    expect(rings.length).toBeLessThanOrEqual(RING_COUNT);
    expect(rings).toEqual(freePowerNodes(s.run.team, content, 0));
    const pw = rings[0] as Cell;
    expect(
      s.run.team.map.nodes.find((k) => k.x === pw.x && k.y === pw.y)?.resource,
    ).toBe(turretResource(content));
    expect(
      (await s.act({ t: 'place', id: ex2, x: pw.x, y: pw.y, rotation: 0 })).ok,
    ).toBe(true);
    const withPower = tutorialFacts(s.run.team, content, 0, null);
    expect(withPower.powerExtractor).toBe(true);
    expect(withPower.spareExtractor).toBe(false);
    expect(highlightDef(4, withPower, defs)).toBeNull();
    const marks = tutorialMarks(s.run.team, content, 0, 4, withPower);
    expect(marks?.rings).toEqual([]);
    expect(marks?.path.length ?? 0).toBeGreaterThan(0);
    // The conduit the game accepts: Power now reaches the Turret.
    const occ = occupancy(s.run.team, content);
    const find = (id: number) => s.run.team.buildings.find((b) => b.id === id);
    const out = occ.absoluteSides(find(ex2) as never).outputs[0];
    const inp = occ.absoluteSides(find(tu) as never).inputs[0]?.side;
    const from = { building: ex2, side: out as never };
    const to = { building: tu, side: inp as never };
    const cells = proposePath(s.run.team, content, from, to, [], 0) as Cell[];
    expect(await s.act({ t: 'add', from, to, cells })).toEqual({ ok: true });
    const done = tutorialFacts(s.run.team, content, 0, null);
    expect(done.turretPowered).toBe(true);
    const facts = { ...done, extractor: true, barracksFed: true };
    expect(stepsDone(input('build', facts))[3]).toBe(true);
  });

  test('a placed but unpowered Turret leaves step 4 open', () => {
    const placed = {
      ...NO_FACTS,
      extractor: true,
      barracksFed: true,
      turret: true,
    };
    expect(stepsDone(input('build', placed))[3]).toBe(false);
    expect(tutorialPosition(input('build', placed))).toEqual({
      kind: 'step',
      n: 4,
    });
    expect(brokenStep(placed, false)).toBe(4);
  });
});
