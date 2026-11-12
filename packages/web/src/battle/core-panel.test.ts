import type { ComponentChildren, VNode } from 'preact';
import { describe, expect, test } from 'vitest';
import { content } from '../content.js';
import { sideStats } from './derive.js';
import { CoreBars } from './panels.js';
import { Playback, simulateRecord } from './playback.js';
import { buildSample } from './samples.js';
import { battleConfig } from './setup.js';

const fields = (node: ComponentChildren, out: string[] = []): string[] => {
  if (node === null || node === undefined || typeof node !== 'object') {
    return out;
  }
  if (Array.isArray(node)) {
    for (const n of node) fields(n as ComponentChildren, out);
    return out;
  }
  const v = node as VNode<Record<string, unknown>>;
  const f = v.props['data-field'];
  if (typeof f === 'string') out.push(f);
  if (typeof v.type === 'function') {
    return fields((v.type as (p: unknown) => ComponentChildren)(v.props), out);
  }
  fields(v.props['children'], out);
  return out;
};

describe('four Cores in a side panel', () => {
  const cores = [0, 1, 2, 3].map((player) => ({
    player,
    hp: player === 2 ? 0 : 400,
    max: 500,
  }));
  const tree = CoreBars({
    label: 'Core',
    cores,
    hp: 1200,
    max: 2000,
    side: 0,
  });

  test('has the total and one bar per player, fallen or not', () => {
    const f = fields(tree);
    for (const p of [0, 1, 2, 3]) {
      expect(f).toContain(`core-hp-0-${String(p)}`);
    }
    expect(f).toContain('core-hp-0');
  });
});

describe('sideStats per tick', () => {
  const sample = buildSample({
    player: 'rush',
    opponent: 'ghost:fortify',
    seed: 1,
    tick: 0,
  });
  const r = simulateRecord(sample.battle, content, battleConfig);
  if (!r.ok) throw new Error(r.error.message);
  const pb = new Playback(sample.battle, content, battleConfig, r.record);

  test('is computed once per tick and side, and follows the tick', () => {
    pb.seekTo(50);
    const a = sideStats(pb, content, 0, 10);
    expect(sideStats(pb, content, 0, 10)).toBe(a);
    expect(sideStats(pb, content, 1, 10)).not.toBe(a);
    pb.seekTo(60);
    const b = sideStats(pb, content, 0, 10);
    expect(b).not.toBe(a);
    pb.seekTo(50);
    expect(sideStats(pb, content, 0, 10)).toEqual(a);
  });
});
