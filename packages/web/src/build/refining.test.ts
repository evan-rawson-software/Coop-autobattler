import {
  addConduit,
  addToStash,
  needPer1000By,
  placeCore,
  placeFromStash,
  createTeamState,
  type GameMap,
  type Side,
  type TeamState,
} from '@game/core';
import { describe, expect, test } from 'vitest';
import { content } from '../content.js';
import { cardStats } from './card-stats.js';
import { chainRows, downstreamOf, inputRates, outputRate } from './refining.js';
import { formatHundredths } from './rates.js';
import { reasonMessage } from './reasons.js';
import { simConfig } from './setup.js';
import { computeFlowView } from './view-model.js';
import { buildingRate } from './rates.js';
import { resourceName } from './view-model.js';

const tps = simConfig.ticksPerSecond;

function def(id: string) {
  const d = content.buildings.get(id);
  if (d === undefined) throw new Error(id);
  return d;
}

describe('per-resource need and output rates', () => {
  test('the Foundry and both refineries list each resource with its own need', () => {
    for (const id of ['bld_foundry', 'bld_refinery_ab', 'bld_refinery_bc']) {
      const d = def(id);
      for (let tier = 1; tier <= d.tiers.length; tier++) {
        const rates = inputRates(d, tier, tps);
        expect(rates).toHaveLength(2);
        const by = needPer1000By(d, tier);
        rates.forEach((r, i) => {
          expect(r.resource).toBe(by[i]?.resource);
          // The same need as core's per-1000-ticks figure, per second.
          expect(r.hundredths).toBeGreaterThan(0);
          expect(r.hundredths).toBeLessThanOrEqual(
            Math.ceil(((by[i]?.needPer1000 ?? 0) * tps) / 10) + 1,
          );
        });
      }
    }
  });

  test('card text names every resource with its rate, and a refinery its output', () => {
    for (const id of ['bld_foundry', 'bld_refinery_ab', 'bld_refinery_bc']) {
      const d = def(id);
      const stats = cardStats(content, simConfig, d, 1);
      for (const r of inputRates(d, 1, tps)) {
        expect(stats.uses).toContain(resourceName(content, r.resource));
        expect(stats.uses).toContain(`${formatHundredths(r.hundredths)}/s`);
      }
      expect(stats.io?.inputs).toHaveLength(2);
      expect(stats.io?.inputs.every((f) => f.color.startsWith('#'))).toBe(true);
    }
    const ab = def('bld_refinery_ab');
    const out = outputRate(ab, 1, tps);
    expect(out?.resource).toBe('res_ab_refined');
    const stats = cardStats(content, simConfig, ab, 1);
    expect(stats.makes).toBe(
      `Makes ${resourceName(content, 'res_ab_refined')} ${formatHundredths(out?.hundredths ?? 0)}/s`,
    );
    // A refinery says in one line that it makes less than it takes.
    expect(stats.notes).toHaveLength(1);
    expect(stats.notes[0]).toMatch(/at a loss/);
    expect(stats.notes[0]).toContain('6 items in, 2 out');
    expect(stats.io?.output?.resource).toBe('res_ab_refined');
  });

  test('a one-input building keeps its one-resource text', () => {
    const stats = cardStats(content, simConfig, def('bld_barracks'), 1);
    expect(stats.uses).toMatch(/^Uses \S+ \d/);
    expect(stats.makes).toBeNull();
    expect(stats.io).toBeNull();
    expect(stats.notes).toEqual([]);
  });

  test('the Foundry effect names both costs', () => {
    const stats = cardStats(content, simConfig, def('bld_foundry'), 1);
    expect(stats.effect).toContain(resourceName(content, 'res_a'));
    expect(stats.effect).toContain(resourceName(content, 'res_b'));
  });

  test('armor and area damage are explained from the unit data', () => {
    const golem = content.units.get('unit_golem');
    const caster = content.units.get('unit_caster');
    const forge = cardStats(content, simConfig, def('bld_golem_forge'), 1);
    expect(forge.notes.join(' ')).toContain(
      `every hit on a Golem does ${String(golem?.armor)} less damage`,
    );
    const spire = cardStats(content, simConfig, def('bld_spire'), 1);
    expect(spire.notes.join(' ')).toMatch(
      /each blast also hurts enemies next to the target/,
    );
    expect(spire.notes.join(' ')).toContain(
      `${String(caster?.splash?.percent)}%`,
    );
    // The Foundry's Heavy has neither.
    expect(cardStats(content, simConfig, def('bld_foundry'), 1).notes).toEqual(
      [],
    );
  });

  test('the top-speed figure of a refinery is in batches', () => {
    expect(
      buildingRate(def('bld_refinery_ab'), 1, tps).topSpeed,
    ).toBeGreaterThan(0);
  });
});

describe('a refused conduit says what the side wants', () => {
  test('the wanted resource is named from the detail', () => {
    const msg = reasonMessage(
      'resource_mismatch',
      'conduit 3 carries res_b into building 5, which takes res_a',
    );
    expect(msg).toContain(resourceName(content, 'res_a'));
    expect(msg).not.toContain(resourceName(content, 'res_b'));
  });
  test('without a detail the neighbour text stays', () => {
    expect(reasonMessage('resource_mismatch')).toMatch(/neighbour/);
    expect(
      reasonMessage(
        'resource_mismatch',
        'merger 4 is fed both res_a and res_b',
      ),
    ).toMatch(/neighbour/);
  });
});

// ---------------------------------------------------------------------------
// A real board: collectors into a refinery into a consumer of its compound.

const MAP: GameMap = {
  width: 12,
  height: 16,
  partySize: 1,
  plotWidth: 12,
  features: [],
  nodes: [],
};

class Lab {
  state: TeamState;
  constructor(nodes: [number, number, string][]) {
    this.state = createTeamState({
      ...MAP,
      nodes: nodes.map(([x, y, resource]) => ({ x, y, resource })),
    });
    const r = placeCore(this.state, content, content.mapgen, 0, { x: 8, y: 0 });
    if (!r.ok) throw new Error(r.reason);
    this.state = r.state;
  }
  put(defId: string, x: number, y: number, tier = 3): number {
    const s = addToStash(this.state, content, { def: defId, tier, owner: 0 });
    if (!s.ok) throw new Error(s.reason);
    const p = placeFromStash(s.state, content, {
      actor: 0,
      id: s.id,
      x,
      y,
      rotation: 0,
    });
    if (!p.ok) throw new Error(`${defId}: ${p.reason}`);
    this.state = p.state;
    return s.id;
  }
  link(
    from: number,
    fromSide: Side,
    to: number,
    toSide: Side,
    cells: [number, number][],
  ): void {
    const r = addConduit(this.state, content, {
      actor: 0,
      from: { building: from, side: fromSide },
      to: { building: to, side: toSide },
      cells: cells.map(([x, y]) => ({ x, y })),
    });
    if (!r.ok) throw new Error(`link: ${r.reason} ${r.detail ?? ''}`);
    this.state = r.state;
  }
}

/** Power (south) and Flux (west) into the Aether refinery, which feeds a Spire. */
function aetherChain(opts: { flux: boolean }) {
  const lab = new Lab([
    [5, 2, 'res_b'],
    [3, 2, 'res_c'],
  ]);
  const refinery = lab.put('bld_refinery_bc', 5, 5, 1);
  const power = lab.put('bld_extractor', 5, 2);
  lab.link(power, 'north', refinery, 'south', [
    [5, 3],
    [5, 4],
  ]);
  if (opts.flux) {
    const flux = lab.put('bld_extractor', 3, 2);
    lab.link(flux, 'north', refinery, 'west', [
      [3, 3],
      [3, 4],
      [3, 5],
      [4, 5],
    ]);
  }
  const spire = lab.put('bld_spire', 5, 10);
  lab.link(refinery, 'north', spire, 'south', [
    [5, 7],
    [5, 8],
    [5, 9],
  ]);
  return { lab, refinery, spire };
}

describe('the flow preview shows a refining chain', () => {
  test('a refinery fed on one input only: the missing one is short, the Spire is not fully fed', () => {
    const { lab, refinery, spire } = aetherChain({ flux: false });
    const flow = computeFlowView(lab.state, content, simConfig, 600);
    if (flow === null) throw new Error('no flow');
    const mine = flow.supply.find((s) => s.building === refinery);
    expect(mine?.inputs).toHaveLength(2);
    const short = mine?.inputs?.filter((i) => i.short).map((i) => i.resource);
    expect(short).toEqual(['res_c']);
    expect(mine?.output?.gets).toBe(0);
    const rows = chainRows(lab.state, content, flow.supply, flow.starved);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.feeds.map((f) => f.building)).toEqual([spire]);
    expect(rows[0]?.feeds[0]?.state).not.toBe('full');
  });

  test('a fully fed refinery reports its output and a fully fed Spire', () => {
    const { lab, refinery, spire } = aetherChain({ flux: true });
    const flow = computeFlowView(lab.state, content, simConfig, 600);
    if (flow === null) throw new Error('no flow');
    const mine = flow.supply.find((s) => s.building === refinery);
    expect(mine?.inputs?.some((i) => i.short)).toBe(false);
    expect(mine?.output?.resource).toBe('res_bc_refined');
    expect(mine?.output?.gets).toBeGreaterThan(0);
    expect(downstreamOf(lab.state, content, refinery)).toEqual([spire]);
    const row = chainRows(lab.state, content, flow.supply, flow.starved)[0];
    expect(row?.takes).toHaveLength(2);
    expect(row?.makes?.max).toBeGreaterThan(0);
  });

  test('with one Flux node shared with an Overclocker, the refinery shows Flux as its short input', () => {
    // One Flux collector feeds a splitter: one branch to the refinery, one to
    // an Overclocker. Neither gets its whole need; both are reported.
    const lab = new Lab([
      [5, 2, 'res_b'],
      [3, 2, 'res_c'],
    ]);
    const refinery = lab.put('bld_refinery_bc', 5, 6);
    const power = lab.put('bld_extractor', 5, 2, 1);
    lab.link(power, 'north', refinery, 'south', [
      [5, 3],
      [5, 4],
      [5, 5],
    ]);
    const flux = lab.put('bld_extractor', 3, 2, 1);
    const split = lab.put('bld_splitter', 3, 4, 1);
    lab.link(flux, 'north', split, 'south', [[3, 3]]);
    const clock = lab.put('bld_overclocker', 1, 6, 1);
    lab.link(split, 'west', clock, 'south', [
      [2, 4],
      [1, 4],
      [1, 5],
    ]);
    lab.link(split, 'east', refinery, 'west', [
      [4, 4],
      [4, 5],
      [4, 6],
    ]);
    const flow = computeFlowView(lab.state, content, simConfig, 600);
    if (flow === null) throw new Error('no flow');
    const gets = (id: number) => flow.supply.find((s) => s.building === id);
    // The Overclocker's row is there, and it never gets more than it needs.
    expect(gets(clock)?.gets).toBeLessThanOrEqual(gets(clock)?.needs ?? 0);
    // The refinery shares the one Flux node: Flux is its short input.
    expect(
      gets(refinery)?.inputs?.find((i) => i.resource === 'res_c')?.short,
    ).toBe(true);
    expect(flow.underSupplied.has(refinery)).toBe(true);
  });
});
