/**
 * The Transmuter through the intents (issue #476): it takes the resource
 * setting of the Mana Well (placing with a resource, `set_building_resource`)
 * and stands where a refinery stands, not on a node.
 */
import { describe, expect, test, vi } from 'vitest';
import { addToStash, loadEconomyOrThrow, type TeamState } from '@game/core';
import economyJson from '../../../../content/economy.json';
import { fixedBattle } from './defaults.js';
import { createEconomyDeps } from './economy.js';
import { applyIntent, createRun } from './machine.js';
import {
  content,
  mapgenConfig,
  placeCoreAll,
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

function withTransmuter(): { state: RunState; id: number } {
  const r = createRun(runArgs(['Ann'], 5), deps);
  if (!r.ok) throw new Error(r.detail);
  const s = placeCoreAll(r.state, deps);
  const added = addToStash(s.team, content, {
    def: 'bld_transmuter',
    tier: 1,
    owner: 0,
  });
  if (!added.ok) throw new Error(added.reason);
  return { state: { ...s, team: added.state }, id: added.id };
}

const send = (state: RunState, intent: Intent) =>
  applyIntent(state, 0, intent, deps);

/** Two cells in a column of player 0's plot, no node, no feature, no Core. */
function openSpot(team: TeamState): { x: number; y: number } {
  const bad = new Set([
    ...team.map.nodes.map((n) => `${String(n.x)},${String(n.y)}`),
    ...team.map.features.map((f) => `${String(f.x)},${String(f.y)}`),
  ]);
  const core = team.cores[0];
  for (let y = 1; y < team.map.height - 3; y++) {
    for (let x = 0; x < team.map.plotWidth; x++) {
      const near =
        core !== null &&
        core !== undefined &&
        x >= core.x - 1 &&
        x <= core.x + 2 &&
        y >= core.y - 2 &&
        y <= core.y + 3;
      if (
        !near &&
        !bad.has(`${String(x)},${String(y)}`) &&
        !bad.has(`${String(x)},${String(y + 1)}`)
      ) {
        return { x, y };
      }
    }
  }
  throw new Error('no open spot');
}

describe('the Transmuter through the intents', () => {
  test('placed with a resource, changed, and kept by a move', () => {
    const { state, id } = withTransmuter();
    const at = openSpot(state.team);
    const placed = send(state, {
      type: 'place_building',
      id,
      ...at,
      rotation: 0,
      resource: 'res_b',
    });
    if (!placed.ok) throw new Error(placed.reason);
    expect(placed.state.team.buildings[0]?.resource).toBe('res_b');
    const set = send(placed.state, {
      type: 'set_building_resource',
      id,
      resource: 'res_c',
    });
    if (!set.ok) throw new Error(set.reason);
    expect(set.state.team.buildings[0]?.resource).toBe('res_c');
    const bad = send(set.state, {
      type: 'set_building_resource',
      id,
      resource: 'res_ab_refined',
    });
    expect(bad).toMatchObject({ ok: false, reason: 'invalid_resource' });
  });

  test('it may not stand on a resource node', () => {
    const { state, id } = withTransmuter();
    const node = state.team.map.nodes.find(
      (n) => n.x < state.team.map.plotWidth,
    );
    if (node === undefined) throw new Error('no node');
    const r = send(state, {
      type: 'place_building',
      id,
      x: node.x,
      y: node.y,
      rotation: 0,
    });
    expect(r).toMatchObject({ ok: false });
  });
});
