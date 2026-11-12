/** Restore at a tick where cooldowns are running (PP-6, issue #150). */
import { describe, expect, test } from 'vitest';
import { createArenaContext, runArena, startArenaBattle } from './arena-sim.js';
import { hashJson } from './hash.js';
import { coreOnlyTeam, tinyMap } from './ramp-scenarios.js';
import { content, got, Lab, simConfig } from './test-support.js';

describe('restore mid-cooldown (PP-6)', () => {
  test('a state saved while a producer and an economy building are cooling down continues like the straight run', () => {
    const lab = new Lab(
      tinyMap([
        [2, 2, 'res_a'],
        [4, 2, 'res_a'],
        [10, 0, 'res_c'],
      ]),
    );
    lab.core(8, 0);
    const west = lab.put('bld_extractor', 2, 2, 0, 3);
    const east = lab.put('bld_extractor', 4, 2, 0, 3);
    const merger = lab.put('bld_merger', 3, 4);
    const bar = lab.put('bld_barracks', 3, 5);
    lab.link(west, 'north', merger, 'west', [
      [2, 3],
      [2, 4],
    ]);
    lab.link(east, 'north', merger, 'east', [
      [4, 3],
      [4, 4],
    ]);
    lab.link(merger, 'north', bar, 'south');
    const oc = lab.put('bld_extractor', 10, 0, 0, 3);
    const ov = lab.put('bld_overclocker', 10, 1, 0, 1);
    lab.link(oc, 'north', ov, 'south');
    const make = () =>
      startArenaBattle(coreOnlyTeam(), lab.state, 4, content, simConfig);
    const ref = make();
    runArena(ref.sim, ref.ctx, 600);
    // Restore points: the first ticks where both cooldowns are running.
    const scan = make();
    const points: number[] = [];
    for (let t = 1; t < 600 && points.length < 4; t++) {
      runArena(scan.sim, scan.ctx, 1);
      const p = got(scan.sim.producers.find((x) => x.building === bar));
      const r = got(scan.sim.ramps.find((x) => x.building === ov));
      if (p.cooldown > 0 && r.cooldown > 0 && t % 7 === 0) points.push(t);
    }
    expect(points.length).toBeGreaterThan(0);
    let cooling = 0;
    for (const at of points) {
      const a = make();
      runArena(a.sim, a.ctx, at);
      const prod = got(a.sim.producers.find((x) => x.building === bar));
      const ramp = got(a.sim.ramps.find((x) => x.building === ov));
      if (prod.cooldown > 0 && ramp.cooldown > 0) cooling += 1;
      // Save as JSON, rebuild the context from the state alone, continue.
      const copy = JSON.parse(JSON.stringify(a.sim)) as typeof a.sim;
      const ctx = createArenaContext(copy, content, simConfig);
      runArena(copy, ctx, 600 - at);
      expect(hashJson(copy)).toBe(hashJson(ref.sim));
    }
    // At least one restore point had both cooldowns running.
    expect(cooling).toBeGreaterThan(0);
  });
});
