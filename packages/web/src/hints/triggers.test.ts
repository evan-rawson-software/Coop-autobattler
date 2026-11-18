import { describe, expect, test } from 'vitest';
import type { PlacedBuilding } from '@game/core';
import type { Json, RunState } from '@game/session';
import { gameConfigs } from '../build/setup.js';
import { content } from '../content.js';
import { newRun, playUntil, realDeps, reachStep } from '../run/test-run.js';
import { HINT_IDS, type HintId } from './hint-store.js';
import {
  candidateHints,
  dueHint,
  plotNearlyFull,
  plotRoom,
  type HintInput,
} from './triggers.js';

const input = (run: RunState): HintInput => ({
  run,
  acting: 0,
  content,
  deps: realDeps(),
  events: gameConfigs.events,
});

const open = { seen: [], tipsOff: false, tutorialActive: false } as const;

function inStep(step: 'build' | 'shop'): RunState {
  return playUntil(newRun(5), (s) => s.step === step);
}

function withBuildings(run: RunState, b: PlacedBuilding[]): RunState {
  return {
    ...run,
    team: { ...run.team, buildings: [...run.team.buildings, ...b] },
  };
}

function placed(def: string, id: number, x = 0, y = 0): PlacedBuilding {
  return { id, def, tier: 1, x, y, rotation: 0, owner: 0 };
}

/** Fill the plot with single-cell walls, leaving `spare` free cells. */
function fillPlot(run: RunState, spare: number): RunState {
  const { map } = run.team;
  let cur = run;
  let free = plotRoom(cur.team, content, 0).free;
  let id = 1000;
  for (let y = 0; y < map.height && free > spare; y++) {
    for (let x = 0; x < map.plotWidth && free > spare; x++) {
      const next = withBuildings(cur, [placed('bld_wall_block', id, x, y)]);
      const room = plotRoom(next.team, content, 0).free;
      if (room < free) {
        cur = next;
        free = room;
        id++;
      }
    }
  }
  return cur;
}

const pactOffer: Json = {
  id: 'evt_pact',
  event: 'evt_pact',
  type: 'pact',
  pact: 'mod_pact_fury',
};

describe('hint triggers', () => {
  test('a quiet build shop has no hint', () => {
    expect(candidateHints(input(inStep('build')))).toEqual([]);
  });

  test('pact: an event step offering a Pact', () => {
    const r = reachStep('event_choice');
    expect(candidateHints(input(r))).not.toContain('pact');
    const withPact = { ...r, pending: { options: [pactOffer] } };
    expect(candidateHints(input(withPact))).toEqual(['pact']);
  });

  test('caravan: the draft screen', () => {
    const base = newRun();
    const items: Json[] = [{ id: 'it0', kind: 'gold', gold: 6 }];
    const run = {
      ...base,
      step: 'event_resolve',
      pending: {
        offer: {
          id: 'evt_caravan',
          event: 'evt_caravan',
          type: 'caravan',
          items,
          order: [0],
        },
        followUp: {
          prompt: 'caravan',
          mode: 'draft',
          items,
          order: [0],
          taken: [null],
        },
      },
    } as RunState;
    expect(candidateHints(input(run))).toEqual(['caravan']);
  });

  test('vein: the cell picker of a Rich vein', () => {
    let r = playUntil(newRun(1), (x) => x.step === 'event_choice');
    r = {
      ...r,
      pending: {
        options: [
          {
            id: 'evt_rich_vein',
            event: 'evt_rich_vein',
            type: 'rich_vein',
            resource: 'res_c',
          },
        ],
      },
    };
    const voted = playUntil(r, (x) => x.step === 'event_resolve', 1);
    expect(candidateHints(input(voted))).toEqual(['vein']);
  });

  test('boss: the shop whose next rival is a boss', () => {
    const shop = playUntil(
      newRun(5),
      (s) => s.step === 'shop' && s.leg === 'pve',
    );
    const rival = (kind: 'boss' | 'ghost'): RunState =>
      ({
        ...shop,
        pvpOpponent: {
          round: shop.round,
          kind,
          label: kind === 'boss' ? 'boss' : 'Bundled',
          ...(kind === 'boss' ? { boss: 'arch_boss_brood' } : {}),
        },
      }) as RunState;
    expect(candidateHints(input(rival('boss')))).toContain('boss');
    expect(candidateHints(input(rival('ghost')))).not.toContain('boss');
    expect(candidateHints(input(shop))).not.toContain('boss');
  });

  test('refinery placed: only a refinery of the player counts', () => {
    const run = inStep('build');
    expect(candidateHints(input(run))).not.toContain('refineryPlaced');
    const mine = withBuildings(run, [placed('bld_refinery_ab', 900, 3, 3)]);
    expect(candidateHints(input(mine))).toContain('refineryPlaced');
    const transmuter = withBuildings(run, [
      placed('bld_transmuter', 901, 3, 3),
    ]);
    expect(candidateHints(input(transmuter))).not.toContain('refineryPlaced');
    const theirs = withBuildings(run, [
      { ...placed('bld_refinery_ab', 902, 3, 3), owner: 1 },
    ]);
    expect(candidateHints(input(theirs))).not.toContain('refineryPlaced');
  });

  test('bonuses: the first modifier taken, on a non-battle screen', () => {
    const run = inStep('build');
    const held = {
      ...run,
      team: {
        ...run.team,
        modifiers: [{ id: 'mod_stout_walls', effects: [] }],
      },
    } as RunState;
    expect(candidateHints(input(held))).toContain('bonuses');
    expect(candidateHints(input({ ...held, step: 'pve_battle' }))).toEqual([]);
  });

  test('plot nearly full: 15 percent or less of the free ground is left', () => {
    const run = inStep('build');
    const { free, total } = plotRoom(run.team, content, 0);
    expect(free).toBeGreaterThan(total / 2);
    expect(plotNearlyFull(run.team, content, 0)).toBe(false);
    const roomy = fillPlot(run, Math.floor(total * 0.3));
    expect(plotNearlyFull(roomy.team, content, 0)).toBe(false);
    const full = fillPlot(run, Math.floor(total * 0.1));
    expect(plotNearlyFull(full.team, content, 0)).toBe(true);
    expect(candidateHints(input(full))).toContain('plotFull');
  });
});

describe('which hint is due', () => {
  const run = (): RunState => ({
    ...reachStep('event_choice'),
    pending: { options: [pactOffer] },
  });

  test('shows the first hint not yet seen, then none', () => {
    expect(dueHint(input(run()), open)).toBe('pact');
    expect(dueHint(input(run()), { ...open, seen: ['pact'] })).toBeNull();
  });

  test('none while a tutorial runs, or when tips are off', () => {
    expect(dueHint(input(run()), { ...open, tutorialActive: true })).toBeNull();
    expect(dueHint(input(run()), { ...open, tipsOff: true })).toBeNull();
  });

  test('every hint has a text', async () => {
    const { screenTexts, screenText } = await import('../build/texts.js');
    const keys: Record<HintId, string> = {
      pact: 'hintPact',
      caravan: 'hintCaravan',
      vein: 'hintVein',
      boss: 'hintBoss',
      refineryPlaced: 'hintRefineryPlaced',
      bonuses: 'hintBonuses',
      plotFull: 'hintPlotFull',
    };
    for (const id of HINT_IDS) {
      expect(screenText(screenTexts, keys[id])).not.toBe('');
    }
  });
});
