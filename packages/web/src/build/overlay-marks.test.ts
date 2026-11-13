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
  showRates,
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
