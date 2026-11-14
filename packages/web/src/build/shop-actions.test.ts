import { readShop } from '@game/session';
import { describe, expect, test } from 'vitest';
import { loadShopRun } from '../run/shop-run.js';
import { BuildController } from './build-controller.js';
import { firstFit } from './test-helpers.js';
import { newStashIds } from './new-items.js';

/** The shop actions of the Build screen (issue #302), on the sample shop run. */
async function shopCtl() {
  const run = await loadShopRun({ storage: null });
  const ctl = new BuildController();
  ctl.attach(run.session, true);
  return { ctl, session: run.session };
}

describe('buying, re-rolling and selling in the Build screen', () => {
  test('a purchase lands in the inventory, is new, and costs its price', async () => {
    const { ctl, session } = await shopCtl();
    const me = session.run.perPlayer[0];
    if (me === undefined) throw new Error('no player');
    const shop = readShop(me);
    if (shop === null) throw new Error('no shop');
    const offer = shop.offers.findIndex(
      (o) => o !== null && o.price <= me.gold,
    );
    expect(offer).toBeGreaterThanOrEqual(0);
    const before = session.run.team.stash.length;
    const gold = session.run.perPlayer[0]?.gold ?? 0;
    expect(await ctl.buy(offer, 'Thing')).toBe(true);
    expect(session.run.team.stash).toHaveLength(before + 1);
    expect(session.run.perPlayer[0]?.gold).toBeLessThan(gold);
    expect(ctl.model.get().ui.status).toEqual(
      expect.objectContaining({ text: 'Bought Thing.', kind: 'ok' }),
    );
    const bought = session.run.team.stash[before];
    expect(newStashIds(session.run).has(bought?.id ?? -1)).toBe(true);
    // Buying is not on the undo stack.
    expect(session.stack.undoCount).toBe(0);
  });

  test('re-roll pays and a refused buy says why', async () => {
    const { ctl, session } = await shopCtl();
    const gold = session.run.perPlayer[0]?.gold ?? 0;
    expect(await ctl.reroll()).toBe(true);
    expect(session.run.perPlayer[0]?.gold).toBeLessThan(gold);
    expect(await ctl.buy(99, 'Nothing')).toBe(false);
    expect(ctl.model.get().ui.status.kind).toBe('error');
  });

  test('selling from the inventory returns the sale value', async () => {
    const { ctl, session } = await shopCtl();
    const item = session.run.team.stash[0];
    expect(item).toBeDefined();
    if (item === undefined) return;
    const gold = session.run.perPlayer[0]?.gold ?? 0;
    expect(await ctl.sell(item.id, 'Item', 3)).toBe(true);
    expect(session.run.team.stash.some((s) => s.id === item.id)).toBe(false);
    expect(session.run.perPlayer[0]?.gold).toBeGreaterThan(gold);
    expect(ctl.model.get().ui.status.text).toBe('Sold Item for 3 gold.');
  });

  test('selling a building on the board picks it up first', async () => {
    const { ctl, session } = await shopCtl();
    const wall = session.run.team.stash.find((s) =>
      s.def.startsWith('bld_wall'),
    );
    expect(wall).toBeDefined();
    if (wall === undefined) return;
    const at = firstFit(session.run.team, wall.id);
    const placed = await session.act({
      t: 'place',
      id: wall.id,
      x: at.x,
      y: at.y,
      rotation: 0,
    });
    expect(placed.ok).toBe(true);
    ctl.select({ kind: 'building', id: wall.id });
    const gold = session.run.perPlayer[0]?.gold ?? 0;
    expect(await ctl.sell(wall.id, 'Wall', 2)).toBe(true);
    expect(session.run.team.buildings.some((b) => b.id === wall.id)).toBe(
      false,
    );
    expect(session.run.team.stash.some((s) => s.id === wall.id)).toBe(false);
    expect(session.run.perPlayer[0]?.gold).toBeGreaterThan(gold);
    expect(ctl.model.get().ui.selection).toBeNull();
    // The sale clears the undo stack: the placement cannot be replayed.
    expect(session.stack.undoCount).toBe(0);
  });
});
