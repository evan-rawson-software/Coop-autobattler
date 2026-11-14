import type { Cell } from '@game/core';
import { openRun, startRun, type RunState } from '@game/session';
import { describe, expect, test } from 'vitest';
import { ME, BuildSession } from '../build/session.js';
import { economy, simConfig } from '../build/setup.js';
import { cardStats } from '../build/card-stats.js';
import { firstFit } from '../build/test-helpers.js';
import { layoutHash } from '../build/undo.js';
import { content } from '../content.js';
import { driveToShop } from '../run/drive.js';
import {
  createLocalStorageSaveStore,
  createMemoryStorage,
} from '../run/local-storage-store.js';
import { createShopDeps, loadShopRun, shopRunId } from '../run/shop-run.js';
import { performAction } from './actions.js';
import { effectText, needsText, templateKey } from './effect-text.js';
import {
  buildShopView,
  nextBattleView,
  readyLabel,
  saleQuote,
  type ShopContext,
} from './view-model.js';

const ctx: ShopContext = { content, economy, sim: simConfig };

describe('effect text', () => {
  test('every building and tier gets non-empty text with nothing unresolved', () => {
    for (const def of content.buildings.list()) {
      for (let tier = 1; tier <= def.tiers.length; tier++) {
        const text = effectText(content, simConfig, def, tier);
        // A source's card has no effect line: its Collects line says it all.
        if (def.kind !== 'source') {
          expect(text.trim(), `${def.id} tier ${String(tier)}`).not.toBe('');
        }
        expect(text).not.toMatch(/[{}]/);
        expect(text).not.toMatch(/\d+ health/);
        expect(
          cardStats(content, simConfig, def, tier).health,
          `${def.id} tier ${String(tier)}`,
        ).toMatch(/^Health \d+$/);
      }
    }
  });

  test('every shop offer has a name and effect text; Range and Hangar are offered', () => {
    const offered = economy.offerWeights.map((w) => w.def);
    expect(offered).toContain('bld_range');
    expect(offered).toContain('bld_hangar');
    for (const id of offered) {
      const def = content.buildings.get(id);
      if (def === undefined) throw new Error(id);
      expect(content.presentation.get(id)?.name, id).toBeTruthy();
      if (def.kind === 'source') continue;
      expect(effectText(content, simConfig, def, 1).trim(), id).not.toBe('');
    }
  });

  test('every building kind maps to an existing template', () => {
    for (const def of content.buildings.list()) {
      if (def.kind === 'source') continue;
      expect(
        content.presentation.templates.effects[templateKey(def)],
      ).toBeTypeOf('string');
    }
  });

  test('numbers come from rules data and change with the tier', () => {
    const wall = content.buildings.get('bld_wall_block');
    if (wall === undefined) throw new Error('no wall');
    const t1 = cardStats(content, simConfig, wall, 1).health;
    const t3 = cardStats(content, simConfig, wall, 3).health;
    expect(t1).toBe(`Health ${String(wall.tiers[0].health)}`);
    expect(t3).toBe(`Health ${String(wall.tiers[2]?.health)}`);
    expect(t1).not.toBe(t3);
  });

  test('resource names are the configured display names', () => {
    const barracks = content.buildings.get('bld_barracks');
    if (barracks === undefined) throw new Error('no barracks');
    const res = barracks.inputs[0]?.resource ?? '';
    const name = content.resources.get(res)?.name ?? '';
    expect(name).not.toBe('');
    expect(effectText(content, simConfig, barracks, 1)).toContain(name);
    expect(needsText(barracks, content)).toBe(name);
  });

  test('needs: nothing for walls, any resource for routes', () => {
    const wall = content.buildings.get('bld_wall_block');
    const splitter = content.buildings.get('bld_splitter');
    if (wall === undefined || splitter === undefined) throw new Error('def');
    expect(needsText(wall, content)).toBe('nothing');
    expect(needsText(splitter, content)).toBe('any resource');
  });

  test('each rate shows once, on one line, and health on its own line', () => {
    const stats = (id: string) => {
      const def = content.buildings.get(id);
      if (def === undefined) throw new Error(id);
      return cardStats(content, simConfig, def, 1);
    };
    const ore = content.resources.get('res_a')?.name ?? '';
    const barracks = stats('bld_barracks');
    expect(barracks.uses).toBe(`Uses ${ore} 0.50/s`);
    expect(barracks.collects).toBeNull();
    expect(barracks.effect).toBe(`Trains 1 Soldier per 5 ${ore}`);
    expect(barracks.health).toBe('Health 60');
    const extractor = stats('bld_extractor');
    expect(extractor.uses).toBeNull();
    expect(extractor.collects).toBe('Collects 0.50/s');
    expect(extractor.effect).toBe('');
    expect(stats('bld_wall_block').uses).toBeNull();
    expect(stats('bld_wall_block').collects).toBeNull();
    expect(stats('bld_splitter').uses).toBe('Uses: any resource');
    for (const def of content.buildings.list()) {
      const st = cardStats(content, simConfig, def, 1);
      expect(st.effect, def.id).not.toMatch(/ at top speed|\d+\.\d\d\/s/);
    }
  });

  test('unknown tier gives empty text', () => {
    const wall = content.buildings.get('bld_wall_block');
    if (wall === undefined) throw new Error('no wall');
    expect(effectText(content, simConfig, wall, 9)).toBe('');
  });
});

async function shopSession(): Promise<{
  s: BuildSession;
  store: ReturnType<typeof createLocalStorageSaveStore>;
  storage: ReturnType<typeof createMemoryStorage>;
  runId: string;
}> {
  const storage = createMemoryStorage();
  const store = createLocalStorageSaveStore(storage);
  const deps = createShopDeps();
  const runId = 'test-shop';
  const r = await startRun(
    { runId, runVersion: '1.0', seed: 11, players: ['You'], host: 0 },
    deps,
    store,
    1,
    '1.0.0',
  );
  if (!r.ok) throw new Error(r.reason);
  const s = BuildSession.fromController(r.controller);
  await driveToShop(
    () => s.run,
    (i) => s.dispatch(i),
    { next: 'pvp' },
  );
  return { s, store, storage, runId };
}

describe('the shop route setup', () => {
  test('both variants reach a shop and show the right next battle', async () => {
    for (const next of ['pvp', 'pve'] as const) {
      const run = await loadShopRun({ next, seed: 11 });
      expect(run.session.run.step).toBe('shop');
      expect(run.runId).toBe(shopRunId(next));
      const view = nextBattleView(run.session.run, run.deps);
      expect(view?.kind).toBe(next);
      if (next === 'pve') expect(view?.options).toHaveLength(3);
      else {
        expect(view?.pvp).not.toHaveProperty('opponent');
        expect(view?.pvp?.lifeCost).toBeGreaterThan(0);
      }
    }
  });

  test('the shop view lists only the viewer own offers', async () => {
    const { s } = await shopSession();
    const v = buildShopView(s.run, ME, ctx);
    expect(v.open).toBe(true);
    expect(v.offers).toHaveLength(economy.shopOfferCount);
    for (const card of v.offers) {
      // A source's card has no effect line: its Collects line says it all.
      if (card.offer?.kind !== 'source')
        expect(card.offer?.effect).toBeTruthy();
      expect(card.offer?.health).toBeTruthy();
    }
  });
});

describe('buying, selling, re-rolling', () => {
  test('buy puts the building in the stash and takes the price', async () => {
    const { s } = await shopSession();
    const before = buildShopView(s.run, ME, ctx);
    const card = before.offers.find((c) => c.canBuy);
    if (card?.offer == null) throw new Error('nothing affordable');
    const r = await s.dispatch({ type: 'buy', slot: card.slot });
    expect(r.ok).toBe(true);
    const after = buildShopView(s.run, ME, ctx);
    expect(after.gold).toBe(before.gold - card.offer.price);
    expect(after.stashCount).toBe(before.stashCount + 1);
    expect(after.offers[card.slot]?.offer).toBeNull();
  });

  test('an unaffordable offer is disabled with no gold-shortage text', async () => {
    const { s } = await shopSession();
    const poor: RunState = {
      ...s.run,
      perPlayer: s.run.perPlayer.map((p) => ({ ...p, gold: 0 })),
    };
    const v = buildShopView(poor, ME, ctx);
    for (const c of v.offers) {
      expect(c.canBuy).toBe(false);
      expect(c.reason).toBeNull();
    }
    expect(v.reroll.can).toBe(false);
    expect(v.reroll.reason).toBeNull();
  });

  test('the session refuses what the view disabled, and the view follows', async () => {
    const { s } = await shopSession();
    for (let guard = 0; guard < 20; guard++) {
      const v = buildShopView(s.run, ME, ctx);
      const slot = v.offers.findIndex((c) => c.canBuy);
      if (slot < 0) break;
      expect((await s.dispatch({ type: 'buy', slot })).ok).toBe(true);
    }
    const v = buildShopView(s.run, ME, ctx);
    const locked = v.offers.find((c) => c.offer !== null);
    if (locked === undefined) {
      // Every slot was bought; re-roll must then be the disabled one.
      expect(v.reroll.can).toBe(v.gold >= economy.rerollCost);
      return;
    }
    expect(locked.canBuy).toBe(false);
    const r = await s.dispatch({ type: 'buy', slot: locked.slot });
    expect(r).toMatchObject({ ok: false, reason: 'not_enough_gold' });
  });

  test('sell quote matches what the sale returns', async () => {
    const { s } = await shopSession();
    const v = buildShopView(s.run, ME, ctx);
    const row = v.stash[0];
    if (row === undefined) throw new Error('empty stash');
    const q = saleQuote(row);
    expect(q.text).toContain(String(q.refund));
    const r = await s.dispatch({ type: 'sell', id: q.id });
    expect(r.ok).toBe(true);
    expect(buildShopView(s.run, ME, ctx).gold).toBe(v.gold + q.refund);
  });

  test('re-roll costs gold and refills sold slots', async () => {
    const { s } = await shopSession();
    const first = buildShopView(s.run, ME, ctx);
    const slot = first.offers.findIndex((c) => c.canBuy);
    await s.dispatch({ type: 'buy', slot });
    const mid = buildShopView(s.run, ME, ctx);
    expect(mid.offers[slot]?.offer).toBeNull();
    const r = await s.dispatch({ type: 'reroll' });
    expect(r.ok).toBe(true);
    const after = buildShopView(s.run, ME, ctx);
    expect(after.gold).toBe(mid.gold - economy.rerollCost);
    expect(after.offers.every((c) => c.offer !== null)).toBe(true);
  });
});

describe('undo never reverses a purchase, sale or re-roll', () => {
  test('a buy clears the undo history of earlier board edits', async () => {
    const { s } = await shopSession();
    const id = s.run.team.stash[0]?.id as number;
    const at = firstFit(s.run.team, id);
    const placed = await s.act({
      t: 'place',
      id,
      x: at.x,
      y: at.y,
      rotation: 0,
    });
    expect(placed.ok).toBe(true);
    expect(s.stack.undoCount).toBe(1);
    const slot = buildShopView(s.run, ME, ctx).offers.findIndex(
      (c) => c.canBuy,
    );
    await s.dispatch({ type: 'buy', slot });
    expect(s.stack.undoCount).toBe(0);
    expect(await s.undo()).toBeNull();
  });

  test('sell and re-roll also clear it', async () => {
    const { s } = await shopSession();
    const id = s.run.team.stash[0]?.id as number;
    const at = firstFit(s.run.team, id);
    await s.act({ t: 'place', id, x: at.x, y: at.y, rotation: 0 });
    const sellId = s.run.team.stash[0]?.id as number;
    await s.dispatch({ type: 'sell', id: sellId });
    expect(s.stack.undoCount).toBe(0);
    await s.act({ t: 'return', id });
    expect(s.stack.undoCount).toBe(1);
    await s.dispatch({ type: 'reroll' });
    expect(s.stack.undoCount).toBe(0);
  });

  test('undoing a placement made after a buy keeps the purchase', async () => {
    const { s } = await shopSession();
    const slot = buildShopView(s.run, ME, ctx).offers.findIndex(
      (c) => c.canBuy,
    );
    await s.dispatch({ type: 'buy', slot });
    const gold = buildShopView(s.run, ME, ctx).gold;
    const bought = s.run.team.stash.at(-1);
    if (bought === undefined) throw new Error('no purchase');
    const stashBefore = s.run.team.stash.length;
    const hash = layoutHash(s.run.team);
    const at: Cell = firstFit(s.run.team, bought.id);
    await s.act({ t: 'place', id: bought.id, x: at.x, y: at.y, rotation: 0 });
    expect(s.run.team.stash.length).toBe(stashBefore - 1);
    await s.undo();
    expect(s.run.team.stash.length).toBe(stashBefore);
    expect(layoutHash(s.run.team)).toBe(hash);
    expect(buildShopView(s.run, ME, ctx).gold).toBe(gold);
    expect(s.run.team.stash.some((x) => x.id === bought.id)).toBe(true);
  });
});

describe('reload', () => {
  test('gold, offers, stash and board come back from the saved run', async () => {
    const { s, storage, runId } = await shopSession();
    const slot = buildShopView(s.run, ME, ctx).offers.findIndex(
      (c) => c.canBuy,
    );
    await s.dispatch({ type: 'buy', slot });
    await s.dispatch({ type: 'reroll' });
    const stashId = s.run.team.stash[0]?.id as number;
    const at = firstFit(s.run.team, stashId);
    await s.act({ t: 'place', id: stashId, x: at.x, y: at.y, rotation: 0 });
    const sellId = s.run.team.stash.at(-1)?.id as number;
    await s.dispatch({ type: 'sell', id: sellId });
    const saved = s.run;

    // A new store over the same storage, as after a page reload.
    const store2 = createLocalStorageSaveStore(storage);
    const opened = await openRun(runId, createShopDeps(), store2, '1.0.0');
    if (!opened.ok) throw new Error(opened.reason);
    const back = opened.controller.state;
    expect(back).toEqual(saved);
    expect(buildShopView(back, ME, ctx)).toEqual(buildShopView(saved, ME, ctx));
  });
});

describe('actions sent back to back', () => {
  test('two affordable buys both apply, in order', async () => {
    const { s } = await shopSession();
    const view = buildShopView(s.run, ME, ctx);
    const affordable = view.offers.filter((c) => c.canBuy && c.offer);
    const total = affordable
      .slice(0, 2)
      .reduce((n, c) => n + (c.offer?.price ?? 0), 0);
    const slots = affordable.slice(0, 2).map((c) => c.slot);
    if (slots.length < 2 || total > view.gold) return;
    const stash0 = s.run.team.stash.length;
    const [r1, r2] = await Promise.all(
      slots.map((slot) => performAction(s, { type: 'buy', slot }, 'ok')),
    );
    expect(r1?.ok).toBe(true);
    expect(r2?.ok).toBe(true);
    expect(s.run.team.stash).toHaveLength(stash0 + 2);
    expect(buildShopView(s.run, ME, ctx).gold).toBe(view.gold - total);
  });

  test('a queued action that no longer fits shows its own reason', async () => {
    const { s } = await shopSession();
    const slot = buildShopView(s.run, ME, ctx).offers.findIndex(
      (c) => c.canBuy,
    );
    const stash0 = s.run.team.stash.length;
    // The same slot twice: the second runs after the first and finds it sold.
    const [r1, r2] = await Promise.all([
      performAction(s, { type: 'buy', slot }, 'ok'),
      performAction(s, { type: 'buy', slot }, 'ok'),
    ]);
    expect(r1.ok).toBe(true);
    expect(r2).toMatchObject({ ok: false, kind: 'error' });
    expect(r2.text).toMatch(/gone|already/i);
    expect(s.run.team.stash).toHaveLength(stash0 + 1);
  });
});

describe('the ready count', () => {
  test('is hidden in a solo run, before and after Ready moves it on', async () => {
    const { s } = await shopSession();
    expect(readyLabel(s.run)).toBeNull();
    const r = await s.dispatch({ type: 'ready' });
    expect(r.ok).toBe(true);
    expect(s.run.step).not.toBe('shop');
    expect(readyLabel(s.run)).toBeNull();
  });
});
