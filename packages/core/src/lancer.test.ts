/**
 * The Lancer hall and the Lancer (CB-9f, CB-16e; issue #439): a 1x3 unit
 * producer fed with Ore, and a melee unit whose long reach (300, against the
 * soldier's 60) lets it hit an enemy in contact with the ally in front of it.
 * Reach alone gives "attacks from the second rank": there is no targeting rule
 * for it (rule a tests only the distance, never what stands between).
 */
import { describe, expect, test } from 'vitest';
import {
  spawnUnitForTest,
  startArenaBattle,
  stepArena,
  type ArenaEvent,
} from './arena-sim.js';
import { dryRunFlow } from './flow-sim.js';
import { rotateBuilding } from './buildings.js';
import type { Rotation } from './buildings.js';
import { occupancy } from './team-state.js';
import { coreOnlyTeam, tinyMap } from './testing/ramp-scenarios.js';
import { content, got, Lab, simConfig } from './testing/support.js';

const GAP = 4;
const S = 240;
const lancer = () => got(content.units.get('unit_lancer'));
const hall = () => got(content.buildings.get('bld_lancer_hall'));

describe('the Lancer and the Lancer hall in content', () => {
  test('the Lancer has the numbers of the issue', () => {
    expect(lancer()).toMatchObject({
      health: 35,
      damage: 7,
      attackCooldownTicks: 12,
      moveCooldownTicks: 6,
      radius: 70,
      collisionRadius: 46,
      reach: 300,
      flying: false,
      attackType: 'melee',
      armor: 0,
    });
    expect(content.units.get('unit_soldier')?.reach).toBe(60);
  });

  test('aggro range exceeds the Lancer reach against every unit body', () => {
    const maxRadius = Math.max(...content.units.list().map((u) => u.radius));
    const reachCentres = lancer().reach + lancer().radius + maxRadius;
    expect(reachCentres).toBeLessThan(simConfig.aggroRangeCells * S);
  });

  test('the hall is 1x3, takes Ore on the south side, three Barracks-like tiers', () => {
    const h = hall();
    if (h.kind !== 'unit_producer') throw new Error('kind');
    expect(h.unit).toBe('unit_lancer');
    expect(h.footprint).toEqual({ width: 1, height: 3 });
    expect(h.inputs).toEqual([{ resource: 'res_a', side: 'south' }]);
    expect(h.outputs).toEqual([]);
    expect(h.tiers.map((t) => t.health)).toEqual([60, 90, 120]);
    expect(h.tiers.map((t) => t.price)).toEqual([25, 50, 90]);
    expect(h.tiers.map((t) => t.productionIntervalTicks)).toEqual([
      110, 77, 55,
    ]);
    expect(
      h.tiers.map((t) => ('costPerUnit' in t ? t.costPerUnit : undefined)),
    ).toEqual([6, 6, 6]);
  });
});

describe('the Lancer hall in each rotation', () => {
  // Placed at (4, 5): the box's lowest-left cell. Rotation turns the footprint
  // clockwise, so the box is 1 wide and 3 tall at 0 and 180 and 3 wide and 1
  // tall at 90 and 270, and the Ore input side turns with it.
  const cases: readonly [Rotation, [number, number][], string][] = [
    [
      0,
      [
        [4, 5],
        [4, 6],
        [4, 7],
      ],
      'south',
    ],
    [
      90,
      [
        [4, 5],
        [5, 5],
        [6, 5],
      ],
      'west',
    ],
    [
      180,
      [
        [4, 5],
        [4, 6],
        [4, 7],
      ],
      'north',
    ],
    [
      270,
      [
        [4, 5],
        [5, 5],
        [6, 5],
      ],
      'east',
    ],
  ];
  for (const [rotation, cells, side] of cases) {
    test(`rotation ${String(rotation)}: cells and the Ore input on the ${side} side`, () => {
      const lab = new Lab(tinyMap());
      lab.core(8, 0);
      const id = lab.put('bld_lancer_hall', 4, 5, rotation, 1);
      const occ = occupancy(lab.state, content);
      const b = got(lab.state.buildings.find((x) => x.id === id));
      expect(occ.cellsOf(b).map((c) => [c.x, c.y])).toEqual(cells);
      expect(occ.absoluteSides(b).inputs).toEqual([
        { resource: 'res_a', side },
      ]);
      expect(rotateBuilding(hall(), rotation).footprint).toEqual({
        width: rotation === 90 || rotation === 270 ? 3 : 1,
        height: rotation === 90 || rotation === 270 ? 1 : 3,
      });
    });
  }

  test('it does not fit where a 1x3 box would leave the plot, in any rotation', () => {
    const lab = new Lab(tinyMap());
    lab.core(8, 0);
    // The map is 12 x 16: 3 cells tall from y = 14 leaves the map, and 3
    // cells wide from x = 10 does.
    expect(() => lab.put('bld_lancer_hall', 4, 14, 0, 1)).toThrow();
    expect(() => lab.put('bld_lancer_hall', 10, 5, 90, 1)).toThrow();
    expect(() => lab.put('bld_lancer_hall', 4, 14, 180, 1)).toThrow();
    expect(() => lab.put('bld_lancer_hall', 10, 5, 270, 1)).toThrow();
    expect(() => lab.put('bld_lancer_hall', 4, 13, 0, 1)).not.toThrow();
  });
});

describe('a Lancer hall fed by an Ore collector', () => {
  /** A tier-t collector, a two-cell conduit and a tier-t hall in `rotation`. */
  function chain(tier: number, rotation: Rotation) {
    const lab = new Lab(tinyMap([[5, 2, 'res_a']]));
    lab.core(8, 0);
    const ore = lab.put('bld_extractor', 5, 2, 0, tier);
    // The collector emits north; the hall's input side turns with rotation.
    let id: number;
    if (rotation === 0) {
      id = lab.put('bld_lancer_hall', 5, 5, 0, tier);
      lab.link(ore, 'north', id, 'south', [
        [5, 3],
        [5, 4],
      ]);
    } else {
      // Rotated 180: the input is on the north side, so the conduit runs up
      // the west edge, over the top and down into it.
      id = lab.put('bld_lancer_hall', 5, 5, 180, tier);
      lab.link(ore, 'north', id, 'north', [
        [5, 3],
        [4, 3],
        [4, 4],
        [4, 5],
        [4, 6],
        [4, 7],
        [4, 8],
        [5, 8],
      ]);
    }
    return { lab, hall: id };
  }

  for (const rotation of [0, 180] as const) {
    test(`one tier t collector feeds exactly one hall of its tier (rotation ${String(rotation)})`, () => {
      for (const tier of [1, 2, 3]) {
        const { lab, hall: id } = chain(tier, rotation);
        const r = dryRunFlow(lab.state, content, simConfig, 2000, 'need');
        const need = got(r.needs?.find((n) => n.building === id));
        const src = got(r.sources[0]);
        const inp = got(r.consumers[0]);
        // Items per 1000 ticks: the collector (50, 71, 100) gives the hall
        // (top speed 54, 77, 109) all it can take: nothing stalls or is lost,
        // and every 6 items become a Lancer. A second hall would get nothing.
        expect(need.needPer1000).toBe([54, 77, 109][tier - 1] as number);
        expect(src.stalledTicks).toBe(0);
        expect(src.lost).toBe(0);
        expect(inp.delivered).toBeGreaterThanOrEqual(src.produced - 1);
        expect(inp.ratePer1000).toBeLessThanOrEqual(need.needPer1000);
        expect(need.productions).toBe(Math.floor(inp.delivered / 6));
      }
    });
  }

  test('a chain of a tier 1 collector makes Lancers', () => {
    const { lab, hall: id } = chain(1, 0);
    const { sim, ctx, events } = startArenaBattle(
      lab.state,
      coreOnlyTeam(8, 0),
      GAP,
      content,
      simConfig,
    );
    for (let t = 0; t < 900; t++) stepArena(sim, ctx);
    const spawned = events.filter((e) => e.type === 'unit_spawned');
    expect(spawned.length).toBeGreaterThanOrEqual(3);
    expect(spawned.every((e) => e.def === 'unit_lancer')).toBe(true);
    expect(spawned.every((e) => e.building === id)).toBe(true);
    // One Lancer per production (tier 1 interval 110), never faster.
    for (let i = 1; i < spawned.length; i++) {
      expect(
        got(spawned[i]).tick - got(spawned[i - 1]).tick,
      ).toBeGreaterThanOrEqual(110);
    }
  });
});

describe('a Lancer fights from the second rank', () => {
  function field() {
    return startArenaBattle(
      coreOnlyTeam(8, 0),
      coreOnlyTeam(8, 0),
      GAP,
      content,
      simConfig,
    );
  }
  const hits = (events: readonly ArenaEvent[], unit: number) =>
    events.flatMap((e) =>
      e.type === 'unit_attacked' && e.unit === unit ? [e] : [],
    );

  test('it hits an enemy that is in contact with the ally in front of it', () => {
    const { sim, ctx, events } = field();
    const x = 6 * S + S / 2;
    const y0 = 17 * S;
    // Side 0 walks towards larger y. Lancer, soldier, enemy soldier in a line.
    const back = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_lancer',
      px: x,
      py: y0,
    });
    const front = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      px: x,
      py: y0 + 140,
    });
    const foe = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      px: x,
      py: y0 + 140 + 200,
    });
    let attackedOver = -1;
    for (let t = 0; t < 120 && attackedOver < 0; t++) {
      stepArena(sim, ctx);
      const h = hits(events, back.id).find(
        (e) => e.target.kind === 'unit' && e.target.unit === foe.id,
      );
      if (h !== undefined) attackedOver = t;
    }
    expect(attackedOver).toBeGreaterThanOrEqual(0);
    // The ally in front is still alive and in front of the Lancer: the hit
    // went over it, with no targeting rule beyond distance.
    expect(front.hp).toBeGreaterThan(0);
    expect(front.py).toBeGreaterThan(back.py);
    // Contact test: the gap is at most the reach.
    const dx = foe.px - back.px;
    const dy = foe.py - back.py;
    const reachSq = (300 + 70 + 72) ** 2;
    expect(dx * dx + dy * dy).toBeLessThanOrEqual(reachSq);
    // The same distance is out of a soldier's reach.
    expect(dx * dx + dy * dy).toBeGreaterThan((60 + 72 + 72) ** 2);
  });

  test('pushing from the line in front does not carry it through the ally', () => {
    const { sim, ctx, events } = field();
    const x = 6 * S + S / 2;
    const y0 = 17 * S;
    const back = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_lancer',
      px: x,
      py: y0,
    });
    const front = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      px: x,
      py: y0 + 140,
    });
    // A second ally behind the Lancer pushes up against it.
    const behind = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      px: x,
      py: y0 - 140,
    });
    spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      px: x,
      py: y0 + 140 + 200,
    });
    for (let t = 0; t < 200; t++) {
      stepArena(sim, ctx);
      if (front.hp > 0) expect(back.py).toBeLessThan(front.py);
    }
    expect(hits(events, back.id).length).toBeGreaterThan(3);
    expect(behind.hp).toBeGreaterThan(0);
  });

  test('it holds its place while it has a target in reach', () => {
    const { sim, ctx } = field();
    const x = 6 * S + S / 2;
    const y0 = 17 * S;
    const back = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_lancer',
      px: x,
      py: y0,
    });
    spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_soldier',
      px: x,
      py: y0 + 140,
    });
    spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_soldier',
      px: x,
      py: y0 + 140 + 200,
    });
    stepArena(sim, ctx);
    const py = back.py;
    for (let t = 0; t < 30; t++) stepArena(sim, ctx);
    expect(back.py).toBe(py);
  });

  test('it cannot hit a flying unit, whatever its reach', () => {
    const { sim, ctx, events } = field();
    const x = 6 * S + S / 2;
    const y0 = 17 * S;
    const back = spawnUnitForTest(sim, ctx, {
      side: 0,
      def: 'unit_lancer',
      px: x,
      py: y0,
    });
    const drone = spawnUnitForTest(sim, ctx, {
      side: 1,
      def: 'unit_drone',
      px: x,
      py: y0 + 200,
    });
    for (let t = 0; t < 40; t++) stepArena(sim, ctx);
    expect(
      hits(events, back.id).filter(
        (e) => e.target.kind === 'unit' && e.target.unit === drone.id,
      ),
    ).toEqual([]);
  });
});
