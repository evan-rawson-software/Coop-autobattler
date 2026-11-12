import { addToStash, placeFromStash, type TeamState } from '@game/core';
import { sealedProducers, type RunState } from '@game/session';
import { describe, expect, test } from 'vitest';
import { economy, simConfig } from './setup.js';
import { content } from '../content.js';
import { realDeps, reachStep } from '../run/test-run.js';
import { buildShopView, type ShopContext } from '../shop/view-model.js';
import { READY_LOCK_TEXT, SEALED_HINT, gateFor, sealedInfo } from './lock.js';

const ctx: ShopContext = { content, economy, sim: simConfig };

function put(
  team: TeamState,
  def: string,
  x: number,
  y: number,
): { team: TeamState; id: number } {
  const a = addToStash(team, content, { def, tier: 1, owner: 0 });
  if (!a.ok) throw new Error(a.reason);
  const p = placeFromStash(a.state, content, {
    actor: 0,
    id: a.id,
    x,
    y,
    rotation: 0,
  });
  if (!p.ok)
    throw new Error(`${def} at ${String(x)},${String(y)}: ${p.reason}`);
  return { team: p.state, id: a.id };
}

/** A barracks in a board corner closed in by four walls (first corner that is free). */
function walledIn(run: RunState): { run: RunState; barracks: number } {
  const w = run.team.map.width;
  const clear: TeamState = {
    ...run.team,
    map: { ...run.team.map, features: [], nodes: [] },
  };
  const corners = [
    {
      bx: 0,
      sides: [
        [2, 0],
        [2, 1],
        [0, 2],
        [1, 2],
      ],
    },
    {
      bx: w - 2,
      sides: [
        [w - 3, 0],
        [w - 3, 1],
        [w - 2, 2],
        [w - 1, 2],
      ],
    },
  ] as const;
  for (const c of corners) {
    try {
      const b = put(clear, 'bld_barracks', c.bx, 0);
      let team = b.team;
      for (const [x, y] of c.sides) team = put(team, 'bld_wall', x, y).team;
      return { run: { ...run, team }, barracks: b.id };
    } catch {
      // This corner is taken (the Core); try the other one.
    }
  }
  throw new Error('no free corner');
}

describe('sealed producers', () => {
  const shop = reachStep('shop');

  test('the reason is set exactly when something is sealed', () => {
    const info = sealedInfo(shop, realDeps(), content);
    expect(info.ids).toEqual(sealedProducers(shop, realDeps()));
    expect(info.reason === null).toBe(info.ids.length === 0);
  });

  test('a walled-in barracks is named, with its place and the way out', () => {
    const { run, barracks } = walledIn(shop);
    const info = sealedInfo(run, realDeps(), content);
    expect(info.ids).toContain(barracks);
    expect(info.reason).toContain('Ready is blocked');
    expect(info.reason).toMatch(/Barracks \(column \d+, row 0\)/);
    expect(info.reason).toContain(SEALED_HINT);
  });

  test('Ready is blocked on the Shop view and the gate, and the session agrees', () => {
    const { run } = walledIn(shop);
    const gate = gateFor(run, 0, realDeps(), content);
    expect(gate.readyBlock).toBe(gate.sealed.reason);
    const v = buildShopView(run, 0, ctx, realDeps());
    expect(v.readyBlock).toBe(gate.sealed.reason);
  });
});

describe('the Ready lock', () => {
  const shop = reachStep('shop');
  const locked: RunState = {
    ...shop,
    perPlayer: shop.perPlayer.map((p) => ({ ...p, ready: true })),
  };

  test('a Ready player is offered only Unready, so buy, sell and re-roll are off', () => {
    const gate = gateFor(locked, 0, realDeps(), content);
    expect(gate.ready).toBe(true);
    expect(gate.allowed.has('unready')).toBe(true);
    for (const t of ['buy', 'sell', 'reroll', 'place_building']) {
      expect(gate.allowed.has(t)).toBe(false);
    }
    expect(gate.editBlock).toBe(READY_LOCK_TEXT);
    // Unready itself is never blocked.
    expect(gate.readyBlock).toBeNull();
  });

  test('the Shop view disables offers, re-roll and selling with the reason', () => {
    const v = buildShopView(locked, 0, ctx, realDeps());
    expect(v.offers.every((c) => !c.canBuy)).toBe(true);
    for (const c of v.offers) {
      if (c.offer !== null) expect(c.reason).toBe(READY_LOCK_TEXT);
    }
    expect(v.reroll.can).toBe(false);
    expect(v.reroll.reason).toBe(READY_LOCK_TEXT);
    expect(v.sellBlock).toBe(READY_LOCK_TEXT);
  });

  test('before Ready everything is open', () => {
    const v = buildShopView(shop, 0, ctx, realDeps());
    expect(v.sellBlock).toBeNull();
    expect(v.reroll.reason === null || /gold/.test(v.reroll.reason)).toBe(true);
  });
});
