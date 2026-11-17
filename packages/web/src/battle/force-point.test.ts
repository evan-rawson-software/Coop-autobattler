import { generateNeutralZone, type NeutralZone } from '@game/core';
import { describe, expect, test } from 'vitest';
import { content } from '../content.js';
import { createMemoryStorage } from '../run/local-storage-store.js';
import {
  FORCE_POINT_KEY,
  readForcedPoint,
  withForcedPoint,
  writeForcedPoint,
} from './force-point.js';
import { buildSample } from './samples.js';
import { simulateRecord } from './playback.js';
import { battleConfig } from './setup.js';

const ctx = {
  terrain: content.terrain,
  points: content.points,
  plotWidth: content.mapgen.plotWidth,
};

/** A seed whose zone has no point in band 0. */
function seedWithoutPoint(): number {
  for (let s = 1; s < 200; s++) {
    const z = generateNeutralZone(s, 24, content, content.mapgen);
    if (z.pointsOfInterest.length === 0) return s;
  }
  throw new Error('no seed without a point');
}

describe('the forced point setting', () => {
  test('is off by default and stored like the forced opponent', () => {
    const s = createMemoryStorage();
    expect(readForcedPoint(s)).toBe('off');
    writeForcedPoint('heal', s);
    expect(s.getItem(FORCE_POINT_KEY)).toBe('heal');
    expect(readForcedPoint(s)).toBe('heal');
    writeForcedPoint('off', s);
    expect(s.length).toBe(0);
    s.setItem(FORCE_POINT_KEY, 'nonsense');
    expect(readForcedPoint(s)).toBe('off');
  });
});

describe('a point forced into a zone', () => {
  test('adds a valid point of the chosen buff to an empty band', () => {
    const zone = generateNeutralZone(
      seedWithoutPoint(),
      24,
      content,
      content.mapgen,
    );
    const out = withForcedPoint(zone, 'heal', 0, ctx);
    expect(out.pointsOfInterest).toHaveLength(1);
    const p = out.pointsOfInterest[0];
    expect(p?.band).toBe(0);
    expect(p?.id).toBe(0);
    expect(content.points.buff.get(p?.buff ?? '')?.kind).toBe('heal');
    // The rest of the zone is untouched.
    expect(out.features).toEqual(zone.features);
  });

  test('changes the buff of the point a band already has', () => {
    let zone: NeutralZone | undefined;
    for (let s = 1; s < 200 && zone === undefined; s++) {
      const z = generateNeutralZone(s, 24, content, content.mapgen);
      const p = z.pointsOfInterest[0];
      if (
        p !== undefined &&
        content.points.buff.get(p.buff)?.kind === 'unit_strength'
      )
        zone = z;
    }
    if (zone === undefined) throw new Error('no zone with a strength point');
    const out = withForcedPoint(zone, 'heal', 0, ctx);
    expect(out.pointsOfInterest).toHaveLength(1);
    expect(out.pointsOfInterest[0]?.x).toBe(zone.pointsOfInterest[0]?.x);
    expect(
      content.points.buff.get(out.pointsOfInterest[0]?.buff ?? '')?.kind,
    ).toBe('heal');
  });

  test('a sample battle with the option on has the point, one without it is as before', () => {
    const seed = seedWithoutPoint();
    const sel = {
      player: 'rush',
      opponent: 'ghost:fortify',
      seed,
      tick: 0,
    } as const;
    const plain = simulateRecord(
      buildSample(sel).battle,
      content,
      battleConfig,
    );
    const forced = simulateRecord(
      buildSample(sel, 'unit_strength').battle,
      content,
      battleConfig,
    );
    if (!plain.ok || !forced.ok) throw new Error('must simulate');
    expect(plain.record.zone.pointsOfInterest).toHaveLength(0);
    expect(forced.record.zone.pointsOfInterest).toHaveLength(1);
    expect(forced.record.summary.points).toHaveLength(1);
    // The default sample is the same description as before the option existed.
    expect(buildSample(sel).battle).toEqual(buildSample(sel, 'off').battle);
  });
});
