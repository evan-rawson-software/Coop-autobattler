import {
  addConduit,
  addToStash,
  createTeamState,
  dryRunFlow,
  placeCore,
  placeFromStash,
  type DryRunResult,
  type GameMap,
  type TeamState,
} from '@game/core';
import { describe, expect, test } from 'vitest';
import { content } from '../content.js';
import type { VNode } from 'preact';
import type { RunState } from '@game/session';
import type { BuildController } from './build-controller.js';
import { halfStatuses } from './border-links.js';
import { BorderLinksPanel } from './panels.js';
import {
  backedUpSources,
  boardRateText,
  halfFlow,
  isBackedUp,
  MIN_RATE_FONT_PX,
  rateFontPx,
  rateLabelSpot,
  showRates,
  suppliedRateText,
  type RateLabelInput,
} from './overlay-marks.js';
import { simConfig } from './setup.js';
import {
  computeFlowView,
  deriveProblems,
  inspectorFigures,
} from './view-model.js';

// Link arrows, the rate text cut-off and the backed-up source problem
// (issue #142).

const map: GameMap = {
  width: 24,
  height: 16,
  partySize: 2,
  plotWidth: 12,
  features: [],
  nodes: [{ x: 2, y: 2, resource: 'res_a' }],
};

/** Player 0's extractor with a conduit to its right border: it can never deliver. */
function borderTeam(): { team: TeamState; source: number } {
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
  return { team: c.state, source: a.id };
}

describe('halfFlow', () => {
  const spot = { border: 1, y: 4 };
  const half = (owner: number, kind: 'send' | 'receive') => ({
    conduit: 7,
    owner,
    spot,
    kind,
  });

  test('both halves of a link point from the sending plot to the receiving plot', () => {
    // Border 1 lies between plot 1 (left) and plot 2 (right).
    expect(halfFlow(half(1, 'send'), null).direction).toBe('east');
    expect(halfFlow(half(2, 'receive'), null).direction).toBe('east');
    // Sending from the right plot into the left one flows west.
    expect(halfFlow(half(2, 'send'), null).direction).toBe('west');
    expect(halfFlow(half(1, 'receive'), null).direction).toBe('west');
  });

  test('active follows the conduit in the flow view and is idle without one', () => {
    expect(halfFlow(half(1, 'send'), new Set([7])).active).toBe(true);
    expect(halfFlow(half(1, 'send'), new Set([8])).active).toBe(false);
    expect(halfFlow(half(1, 'send'), null).active).toBe(false);
  });
});

describe('rate text zoom cut-off', () => {
  test('hidden when the text would be under 9 px, shown from 9 px', () => {
    expect(rateFontPx(29)).toBeLessThan(MIN_RATE_FONT_PX);
    expect(showRates(29)).toBe(false);
    expect(showRates(30)).toBe(true);
  });

  test('a collector shows its output and a consumer its need', () => {
    const tps = simConfig.ticksPerSecond;
    const ex = content.buildings.get('bld_extractor');
    const bk = content.buildings.get('bld_barracks');
    if (ex === undefined || bk === undefined) throw new Error('content');
    expect(boardRateText(ex, 1, tps)).toMatch(/^\d+\.\d\d\/s$/);
    expect(boardRateText(bk, 1, tps)).toMatch(/^\d+\.\d\d\/s$/);
  });
});

describe('backed-up sources', () => {
  test('flagged only when stalled for more than half of the run', () => {
    expect(isBackedUp(300, 600)).toBe(false);
    expect(isBackedUp(301, 600)).toBe(true);
    expect(isBackedUp(40, 600)).toBe(false);
    expect(isBackedUp(0, 0)).toBe(false);
  });

  test('backedUpSources gives the stalled share of the run', () => {
    const dry = {
      ticks: 200,
      sources: [
        { building: 1, resource: 'a', produced: 0, lost: 0, stalledTicks: 150 },
        { building: 2, resource: 'a', produced: 9, lost: 0, stalledTicks: 20 },
      ],
    } as unknown as DryRunResult;
    expect([...backedUpSources(dry)]).toEqual([[1, 75]]);
  });

  test('a connected source whose output goes nowhere is a problem with a line', () => {
    const { team, source } = borderTeam();
    const dry = dryRunFlow(team, content, simConfig, 600);
    expect(dry.sources[0]?.stalledTicks).toBeGreaterThan(300);
    const flow = computeFlowView(team, content, simConfig, 600);
    const problems = deriveProblems(team, content, flow);
    const p = problems.filter((x) => x.kind === 'stalled_output');
    expect(p).toHaveLength(1);
    expect(p[0]?.building).toBe(source);
    expect(p[0]?.text).toMatch(/connected but stalled for \d+% of the dry run/);
    // It is connected, so it is not the "no conduit" problem.
    expect(problems.some((x) => x.kind === 'lost_output')).toBe(false);
    const b = team.buildings.find((x) => x.id === source);
    if (b === undefined) throw new Error('no building');
    const figs = inspectorFigures(team, content, simConfig, dry, b);
    expect(figs?.produces?.stalledPercent).toBeGreaterThan(50);
  });

  test('a partner is not listed, and a short stall is not a problem', () => {
    const { team } = borderTeam();
    const flow = computeFlowView(team, content, simConfig, 600);
    const partner = deriveProblems(team, content, flow, {
      acting: 1,
      names: ['Ann', 'Bo'],
    });
    expect(partner.some((x) => x.kind === 'stalled_output')).toBe(false);
    if (flow === null) throw new Error('no flow');
    const brief = {
      ...flow,
      dry: {
        ...flow.dry,
        sources: flow.dry.sources.map((s) => ({ ...s, stalledTicks: 300 })),
      },
    };
    expect(
      deriveProblems(team, content, brief).some(
        (x) => x.kind === 'stalled_output',
      ),
    ).toBe(false);
  });
});

describe('Border links list mirrors active / idle', () => {
  const texts = (n: unknown, out: string[] = []): string[] => {
    if (Array.isArray(n)) n.forEach((x) => texts(x, out));
    else if (typeof n === 'string') out.push(n);
    else if (typeof n === 'object' && n !== null && 'props' in n) {
      texts((n as VNode<{ children?: unknown }>).props.children, out);
    }
    return out;
  };
  const run = (team: TeamState): RunState =>
    ({
      team,
      players: [{ name: 'Ann' }, { name: 'Bo' }],
    }) as unknown as RunState;
  const ctl = {} as unknown as BuildController;

  test('the word follows the flow view; without a flow view nothing is added', () => {
    const { team } = borderTeam();
    const flow = computeFlowView(team, content, simConfig, 600);
    const line = (f: typeof flow): string =>
      texts(
        BorderLinksPanel({
          run: run(team),
          ctl,
          acting: 0,
          locked: false,
          flow: f,
        }),
      ).join('');
    const h = halfStatuses(team)[0];
    if (h === undefined || flow === null) throw new Error('setup');
    expect(line(flow)).toContain('idle');
    const active = { ...flow, activeConduits: new Set([h.conduit]) };
    expect(line(active)).toContain('carrying');
    expect(line(active)).not.toContain('idle');
    expect(line(null)).not.toMatch(/idle|carrying/);
  });
});

/**
 * A joined border link at column 3 of border 0. The sender is an extractor on
 * a node in its own plot, the receiver a Barracks fed from the border.
 */
function joinedTeam(senderRight: boolean): TeamState {
  const m: GameMap = {
    ...map,
    nodes: [{ x: senderRight ? 21 : 2, y: 2, resource: 'res_a' }],
  };
  let t = createTeamState(m);
  for (const [p, x] of [
    [0, 5],
    [1, 17],
  ] as const) {
    const r = placeCore(t, content, content.mapgen, p, { x, y: 0 });
    if (!r.ok) throw new Error(r.reason);
    t = r.state;
  }
  const sender = senderRight ? 1 : 0;
  const place = (
    owner: number,
    def: string,
    x: number,
    y: number,
  ): { state: TeamState; id: number } => {
    const a = addToStash(t, content, { def, tier: 1, owner });
    if (!a.ok) throw new Error(a.reason);
    const p = placeFromStash(a.state, content, {
      actor: owner,
      id: a.id,
      x,
      y,
      rotation: 0,
    });
    if (!p.ok) throw new Error(p.reason);
    return { state: p.state, id: a.id };
  };
  const row = (from: number, to: number): { x: number; y: number }[] => {
    const out = [];
    const step = from <= to ? 1 : -1;
    for (let x = from; x !== to + step; x += step) out.push({ x, y: 3 });
    return out;
  };
  const ex = place(sender, 'bld_extractor', senderRight ? 21 : 2, 2);
  t = ex.state;
  const out = addConduit(t, content, {
    actor: sender,
    from: { building: ex.id, side: 'north' },
    to: { border: 0, y: 3 },
    cells: senderRight ? row(21, 12) : row(2, 11),
  });
  if (!out.ok) throw new Error(`${out.reason} ${out.detail ?? ''}`);
  t = out.state;
  const bx = senderRight ? 9 : 14;
  const bk = place(1 - sender, 'bld_barracks', bx, 6);
  t = bk.state;
  const inn = addConduit(t, content, {
    actor: 1 - sender,
    from: { border: 0, y: 3 },
    to: { building: bk.id, side: 'south' },
    cells: [
      ...(senderRight ? row(11, bx) : row(12, bx)),
      { x: bx, y: 4 },
      { x: bx, y: 5 },
    ],
  });
  if (!inn.ok) throw new Error(`${inn.reason} ${inn.detail ?? ''}`);
  return inn.state;
}

describe('a joined border link reads the same on both halves', () => {
  for (const senderRight of [false, true]) {
    const dir = senderRight ? 'west' : 'east';
    test(`sender on the ${senderRight ? 'right' : 'left'}: both halves point ${dir}`, () => {
      const team = joinedTeam(senderRight);
      const halves = halfStatuses(team);
      expect(halves).toHaveLength(2);
      expect(halves.every((h) => h.state === 'joined')).toBe(true);
      expect(halves.map((h) => h.kind).sort()).toEqual(['receive', 'send']);
      const flow = computeFlowView(team, content, simConfig, 600);
      if (flow === null) throw new Error('no flow');
      for (const h of halves) {
        expect(halfFlow(h, flow.activeConduits).direction).toBe(dir);
      }
    });
  }

  test('the neighbour half is carrying when the link carries, idle when it does not', () => {
    const team = joinedTeam(false);
    const flow = computeFlowView(team, content, simConfig, 600);
    if (flow === null) throw new Error('no flow');
    const halves = halfStatuses(team);
    const send = halves.find((h) => h.kind === 'send');
    const recv = halves.find((h) => h.kind === 'receive');
    if (send === undefined || recv === undefined) throw new Error('halves');
    expect(halfFlow(send, flow.activeConduits).active).toBe(true);
    expect(halfFlow(recv, flow.activeConduits).active).toBe(true);
    const idle = new Set<number>();
    expect(halfFlow(send, idle).active).toBe(false);
    expect(halfFlow(recv, idle).active).toBe(false);
  });
});

describe('rate label hide rules', () => {
  const base: RateLabelInput = {
    zoom: 40,
    sealed: false,
    mark: null,
    textWidth: 40,
    reserved: 0,
    boxWidth: 40,
  };
  const spot = (o: Partial<RateLabelInput>) => rateLabelSpot({ ...base, ...o });

  test('no mark: on the top row', () => {
    expect(spot({})).toBe('top');
  });
  test('hidden below the zoom cut-off, whatever the mark', () => {
    expect(spot({ zoom: 29 })).toBe('hidden');
    expect(spot({ zoom: 29, mark: 'low', reserved: 20 })).toBe('hidden');
  });
  test('hidden on a sealed building', () => {
    expect(spot({ sealed: true })).toBe('hidden');
  });
  test('LOW and starved: top when it fits beside the badge, else the bottom row', () => {
    for (const mark of ['low', 'starved'] as const) {
      expect(spot({ mark, reserved: 20, boxWidth: 60 })).toBe('top');
      expect(spot({ mark, reserved: 20, boxWidth: 60.5 })).toBe('top');
      expect(spot({ mark, reserved: 21, boxWidth: 60 })).toBe('bottom');
    }
  });
  test('the stalled marker hides the text when it does not fit', () => {
    expect(spot({ mark: 'stalled', reserved: 20, boxWidth: 60 })).toBe('top');
    expect(spot({ mark: 'stalled', reserved: 21, boxWidth: 60 })).toBe(
      'hidden',
    );
  });
});

describe('what an under-supplied consumer shows', () => {
  test('gets and need per second', () => {
    expect(suppliedRateText({ gets: 25, needs: 50 })).toBe('0.25/0.50/s');
    expect(suppliedRateText({ gets: 0, needs: 120 })).toBe('0.00/1.20/s');
  });
});

describe('a partner source is not reported as backed up', () => {
  test('the inspector is own-only, like the list and the marker', () => {
    const { team, source } = borderTeam();
    const dry = dryRunFlow(team, content, simConfig, 600);
    const b = team.buildings.find((x) => x.id === source);
    if (b === undefined) throw new Error('no building');
    const pct = (acting?: number): number | null | undefined =>
      inspectorFigures(team, content, simConfig, dry, b, acting)?.produces
        ?.stalledPercent;
    expect(pct(0)).toBeGreaterThan(50);
    expect(pct(1)).toBeNull();
  });
});

describe('problem texts agree with their count', () => {
  const stashOf = (t: TeamState, def: string, n: number): TeamState => {
    let out = t;
    for (let i = 0; i < n; i++) {
      const a = addToStash(out, content, { def, tier: 1, owner: 0 });
      if (!a.ok) throw new Error(a.reason);
      out = a.state;
    }
    return out;
  };
  const base = createTeamState({ ...map, nodes: [] });

  test('stash: nothing at 0, singular at 1, plural at 2', () => {
    const stash = (n: number): string[] =>
      deriveProblems(stashOf(base, 'bld_barracks', n), content, null)
        .filter((p) => p.kind === 'stash')
        .map((p) => p.text);
    expect(stash(0)).toEqual([]);
    expect(stash(1)[0]).toMatch(/^1 building in the stash/);
    expect(stash(2)[0]).toMatch(/^2 buildings in the stash/);
  });

  test('free nodes: nothing at 0, singular at 1, plural at 2', () => {
    const nodes = (n: number): string[] => {
      const t: TeamState = {
        ...stashOf(base, 'bld_extractor', 1),
        map: {
          ...base.map,
          nodes: Array.from({ length: n }, (_, i) => ({
            x: 2 + i,
            y: 2,
            resource: 'res_a',
          })),
        },
      };
      return deriveProblems(t, content, null)
        .filter((p) => p.kind === 'free_nodes')
        .map((p) => p.text);
    };
    expect(nodes(0)).toEqual([]);
    expect(nodes(1)[0]).toMatch(/: 1 free node \(/);
    expect(nodes(2)[0]).toMatch(/: 2 free nodes \(/);
  });
});
