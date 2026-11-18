/**
 * The building resource setting through the intents (issue #473): placing with
 * a resource, `set_building_resource`, the step and Ready rules, replay, and
 * a ghost snapshot that holds a Mana Well.
 */
import { describe, expect, test, vi } from 'vitest';
import {
  addToStash,
  hashJson,
  loadEconomyOrThrow,
  validateTeamState,
  type TeamState,
} from '@game/core';
import economyJson from '../../../../content/economy.json';
import { fixedBattle } from './defaults.js';
import { createEconomyDeps, readShop } from './economy.js';
import { applyIntent, createRun, replayRun } from './machine.js';
import {
  content,
  mapgenConfig,
  ok,
  placeCoreAll,
  readyAll,
  runArgs,
} from '../testing/test-support.js';
import type { Intent, RunDeps, RunState } from './types.js';

vi.setConfig({ testTimeout: 120_000 });

const economy = loadEconomyOrThrow(economyJson, {
  buildings: content.buildings,
  specialists: content.specialists,
});

const deps: RunDeps = createEconomyDeps(content, mapgenConfig, economy, {
  battle: fixedBattle(true),
});

/** A solo run in the `build` step with a Mana Well in the stash. */
function withWell(): { state: RunState; well: number } {
  const r = createRun(runArgs(['Ann'], 5), deps);
  if (!r.ok) throw new Error(r.detail);
  const s = placeCoreAll(r.state, deps);
  expect(s.step).toBe('build');
  const added = addToStash(s.team, content, {
    def: 'bld_mana_well',
    tier: 1,
    owner: 0,
  });
  if (!added.ok) throw new Error(added.reason);
  return { state: { ...s, team: added.state }, well: added.id };
}

function send(state: RunState, intent: Intent) {
  return applyIntent(state, 0, intent, deps);
}

/** A cell of player 0's plot where a Well stands (no node, no feature). */
function openCell(team: TeamState): { x: number; y: number } {
  const nodes = new Set(
    team.map.nodes.map((n) => `${String(n.x)},${String(n.y)}`),
  );
  const bad = new Set(
    team.map.features.map((f) => `${String(f.x)},${String(f.y)}`),
  );
  for (const b of team.buildings) bad.add(`${String(b.x)},${String(b.y)}`);
  for (let y = 1; y < team.map.height - 2; y++) {
    for (let x = 0; x < team.map.plotWidth; x++) {
      const core = team.cores[0];
      if (core !== null && core !== undefined) {
        if (
          x >= core.x - 1 &&
          x <= core.x + 2 &&
          y >= core.y - 1 &&
          y <= core.y + 2
        )
          continue;
      }
      if (
        !nodes.has(`${String(x)},${String(y)}`) &&
        !bad.has(`${String(x)},${String(y)}`)
      )
        return { x, y };
    }
  }
  throw new Error('no open cell');
}

describe('placing with a resource', () => {
  test('the chosen resource is stored on the building', () => {
    const { state, well } = withWell();
    const at = openCell(state.team);
    const r = send(state, {
      type: 'place_building',
      id: well,
      ...at,
      rotation: 0,
      resource: 'res_c',
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.state.team.buildings.find((b) => b.id === well)?.resource).toBe(
      'res_c',
    );
  });

  test('without a resource it is the first base resource', () => {
    const { state, well } = withWell();
    const r = send(state, {
      type: 'place_building',
      id: well,
      ...openCell(state.team),
      rotation: 0,
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.state.team.buildings[0]?.resource).toBe('res_a');
  });

  test('a bad resource is refused with its reason, a non-string is an invalid intent', () => {
    const { state, well } = withWell();
    const base = { type: 'place_building', id: well, rotation: 0 } as const;
    const at = openCell(state.team);
    const bad = send(state, { ...base, ...at, resource: 'res_ab_refined' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe('invalid_resource');
    const odd = send(state, {
      ...base,
      ...at,
      resource: 4 as unknown as string,
    });
    expect(odd.ok).toBe(false);
    if (!odd.ok) expect(odd.reason).toBe('invalid_intent');
  });
});

describe('set_building_resource', () => {
  function placed(resource = 'res_a') {
    const { state, well } = withWell();
    const r = send(state, {
      type: 'place_building',
      id: well,
      ...openCell(state.team),
      rotation: 0,
      resource,
    });
    if (!r.ok) throw new Error(r.reason);
    return { state: r.state, well };
  }

  test('changes the setting and is logged', () => {
    const { state, well } = placed();
    const before = state.actionLog.length;
    const r = send(state, {
      type: 'set_building_resource',
      id: well,
      resource: 'res_b',
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.state.team.buildings.find((b) => b.id === well)?.resource).toBe(
      'res_b',
    );
    expect(r.state.actionLog.length).toBe(before + 1);
  });

  test('refusals: unknown building, not a base resource, no setting, a bad shape', () => {
    const { state, well } = placed();
    const reason = (i: Intent): string => {
      const r = send(state, i);
      return r.ok ? 'ok' : r.reason;
    };
    expect(
      reason({ type: 'set_building_resource', id: 999, resource: 'res_b' }),
    ).toBe('unknown_building');
    expect(
      reason({
        type: 'set_building_resource',
        id: well,
        resource: 'res_ab_refined',
      }),
    ).toBe('invalid_resource');
    expect(
      reason({ type: 'set_building_resource', id: well, resource: 7 as never }),
    ).toBe('invalid_intent');
    expect(
      reason({ type: 'set_building_resource', id: 1.5, resource: 'res_b' }),
    ).toBe('invalid_intent');
    // A building without the setting (the Core is not a building).
    const gate = addToStash(state.team, content, {
      def: 'bld_gate',
      tier: 1,
      owner: 0,
    });
    if (!gate.ok) throw new Error(gate.reason);
    const withGate = { ...state, team: gate.state };
    const put = applyIntent(
      withGate,
      0,
      {
        type: 'place_building',
        id: gate.id,
        ...openCell(withGate.team),
        rotation: 0,
      },
      deps,
    );
    if (!put.ok) throw new Error(put.reason);
    const r = applyIntent(
      put.state,
      0,
      { type: 'set_building_resource', id: gate.id, resource: 'res_b' },
      deps,
    );
    expect(r.ok ? 'ok' : r.reason).toBe('no_resource_setting');
  });

  test('a Ready player cannot change it; it is a board edit of build and shop only', () => {
    const { state, well } = placed();
    const ready = send(state, { type: 'ready' });
    if (!ready.ok) throw new Error(ready.reason);
    // A solo player's ready ends the step; use two players to hold the flag.
    expect(ready.state.step).not.toBe('build');
    const r = send(ready.state, {
      type: 'set_building_resource',
      id: well,
      resource: 'res_b',
    });
    expect(r.ok ? 'ok' : r.reason).toBe('wrong_step');
  });

  test('a Ready player of two is locked', () => {
    const made = createRun(runArgs(['Ann', 'Bo'], 5), deps);
    if (!made.ok) throw new Error(made.detail);
    let s = placeCoreAll(made.state, deps);
    const added = addToStash(s.team, content, {
      def: 'bld_mana_well',
      tier: 1,
      owner: 0,
    });
    if (!added.ok) throw new Error(added.reason);
    s = { ...s, team: added.state };
    const p = applyIntent(
      s,
      0,
      {
        type: 'place_building',
        id: added.id,
        ...openCell(s.team),
        rotation: 0,
      },
      deps,
    );
    if (!p.ok) throw new Error(p.reason);
    const rd = applyIntent(p.state, 0, { type: 'ready' }, deps);
    if (!rd.ok) throw new Error(rd.reason);
    const r = applyIntent(
      rd.state,
      0,
      { type: 'set_building_resource', id: added.id, resource: 'res_b' },
      deps,
    );
    expect(r.ok ? 'ok' : r.reason).toBe('locked_ready');
    // Another player's building is not theirs to set.
    const other = applyIntent(
      p.state,
      1,
      { type: 'set_building_resource', id: added.id, resource: 'res_b' },
      deps,
    );
    expect(other.ok ? 'ok' : other.reason).toBe('not_owner');
  });
});

describe('a record with a Mana Well', () => {
  test('a run that buys, places and changes a Well replays to the same state', () => {
    // A shop that offers the Flowmancer a Well in every slot from round 1, so
    // the Well comes through `buy` and the whole record is the action log.
    const eco = {
      ...economy,
      offerWeights: [
        ...economy.offerWeights.filter((w) => w.specialist === undefined),
        {
          def: 'bld_mana_well',
          weight: 5000,
          fromRound: 1,
          specialist: 'spec_flowmancer',
        },
      ],
    };
    const d = createEconomyDeps(content, mapgenConfig, eco, {
      battle: fixedBattle(true),
    });
    const args = runArgs(['Ann'], 9);
    const made = createRun(args, d);
    if (!made.ok) throw new Error(made.detail);
    let s = placeCoreAll(made.state, d);
    for (let i = 0; i < 20 && s.step !== 'shop'; i++) {
      if (s.step === 'pve_choice')
        s = ok(s, 0, { type: 'vote', choice: 'easy' }, d).state;
      else if (s.step === 'event_choice') {
        const p = s.pending as { options: { id: string }[] };
        s = ok(
          s,
          0,
          { type: 'vote', choice: p.options[0]?.id as string },
          d,
        ).state;
      } else s = readyAll(s, d);
    }
    expect(s.step).toBe('shop');
    const shop = readShop(s.perPlayer[0] as RunState['perPlayer'][number]);
    const slot =
      shop?.offers.findIndex((o) => o?.def === 'bld_mana_well') ?? -1;
    expect(slot).toBeGreaterThanOrEqual(0);
    s = ok(s, 0, { type: 'buy', slot }, d).state;
    const well = s.team.stash.find((b) => b.def === 'bld_mana_well');
    if (well === undefined) throw new Error('not bought');
    s = ok(
      s,
      0,
      {
        type: 'place_building',
        id: well.id,
        ...openCell(s.team),
        rotation: 0,
        resource: 'res_c',
      },
      d,
    ).state;
    s = ok(
      s,
      0,
      { type: 'set_building_resource', id: well.id, resource: 'res_b' },
      d,
    ).state;
    expect(s.team.buildings.find((b) => b.id === well.id)?.resource).toBe(
      'res_b',
    );
    const again = replayRun(args, s.actionLog, d);
    if (!again.ok) throw new Error(`${again.reason} at ${String(again.at)}`);
    expect(hashJson(again.state as never)).toBe(hashJson(s as never));
  });

  test('a snapshot of a Flowmancer with a placed Well: the real setting passes, a bad one does not', () => {
    const { state, well } = withWell();
    const r = send(state, {
      type: 'place_building',
      id: well,
      ...openCell(state.team),
      rotation: 0,
      resource: 'res_c',
    });
    if (!r.ok) throw new Error(r.reason);
    expect(r.state.team.specialists?.[0]).toBe('spec_flowmancer');
    const team = JSON.parse(JSON.stringify(r.state.team)) as {
      buildings: Record<string, unknown>[];
    };
    const check = (change: (b: Record<string, unknown>) => void): boolean => {
      const t = JSON.parse(JSON.stringify(team)) as typeof team;
      change(t.buildings[0] as Record<string, unknown>);
      return validateTeamState(t, content, mapgenConfig).ok;
    };
    expect(check(() => undefined)).toBe(true);
    expect(check((b) => delete b['resource'])).toBe(false);
    expect(check((b) => (b['resource'] = 'res_ab_refined'))).toBe(false);
    expect(check((b) => (b['resource'] = 3))).toBe(false);
    expect(check((b) => (b['resource'] = 'res_a'))).toBe(true);
  });
});
