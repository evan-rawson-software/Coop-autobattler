import { describe, expect, test } from 'vitest';
import { content } from '../content.js';
import { effectText } from '../shop/effect-text.js';
import { buildingRate, formatHundredths, rateText, supplyOf } from './rates.js';
import { simConfig } from './setup.js';
import { reasonMessage } from './reasons.js';

const tps = simConfig.ticksPerSecond;

describe('Range and Hangar are presented like other unit producers', () => {
  for (const id of ['bld_range', 'bld_hangar']) {
    test(`${id}: name, effect, need per second`, () => {
      const def = content.buildings.get(id);
      if (def === undefined) throw new Error(id);
      expect(content.presentation.get(id)?.name).toBeTruthy();
      expect(effectText(content, simConfig, def, 1)).toMatch(/\d/);
      for (let tier = 1; tier <= def.tiers.length; tier++) {
        const r = buildingRate(def, tier, tps);
        expect(r.needs, `${id} tier ${String(tier)}`).toBeGreaterThan(0);
        expect(r.topSpeed).toBeGreaterThan(0);
        const text = rateText(def, tier, tps);
        expect(text).toContain(`Needs ${formatHundredths(r.needs ?? 0)} / s`);
        expect(text).toContain('units');
      }
    });
  }
});

describe('supplied against need', () => {
  test('a short dry-run length cannot make a starving building supplied', () => {
    const bk = { id: 5, def: 'bld_barracks', tier: 1, x: 1, y: 1, rotation: 0 };
    const team = { buildings: [bk] } as never;
    const state = (ticks: number, got: number) =>
      supplyOf(
        team,
        content,
        {
          ticks,
          needs: [{ building: bk.id, needPer1000: 75, productions: 0 }],
          consumers: [{ building: bk.id, side: 'south', ratePer1000: got }],
        } as never,
        tps,
      )[0]?.state;
    // 100 ticks used to allow 20 per 1000 of slack; now the slack is fixed.
    expect(state(100, 60)).toBe('under');
    expect(state(2, 0)).toBe('under');
    expect(state(600, 75)).toBe('full');
    expect(state(600, 200)).toBe('full');
  });
});

describe('refusals caused by a neighbour', () => {
  test('mismatch and loop messages mention the neighbour', () => {
    expect(reasonMessage('resource_mismatch')).toMatch(/neighbour/);
    expect(reasonMessage('would_loop')).toMatch(/neighbour/);
  });
});
