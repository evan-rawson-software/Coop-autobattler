// Shop + Build smoke checks (issues W2-7 and #302: the shop is a part of the
// Build screen, opened from the top bar into the info rail). Called from smoke.mjs with the
// shared page and helpers. Plain Node ESM, not part of the bundle.
//
// The shop route sets up a sample run (fixed seed, every battle won) that
// is already in a shop step, and saves it in localStorage. `?next=pve` or
// `?next=pvp` picks which battle follows the shop.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { closeShop, frames, hookReady, openShop } from './smoke-timing.mjs';

export async function runShopSmoke({
  page,
  baseUrl,
  check,
  shot,
  shotDark,
  settle,
  webDir,
}) {
  const footprints = Object.fromEntries(
    JSON.parse(
      readFileSync(
        path.resolve(webDir, '../../content/buildings.json'),
        'utf8',
      ),
    ).buildings.map((b) => [b.id, b.footprint]),
  );
  const S = {
    state: async () => {
      await hookReady(page, 'shop');
      return await page.evaluate(() => window.__debug.shop.state());
    },
  };
  const B = {
    step: () => page.evaluate(() => window.__debug.build.step()),
    team: async () => {
      await hookReady(page, 'build');
      return await page.evaluate(() => window.__debug.build.team());
    },
    counts: () => page.evaluate(() => window.__debug.build.counts()),
  };
  const at = (x, y) =>
    page.evaluate(
      ([cx, cy]) => window.__debug.build.cellToScreen(cx, cy),
      [x, y],
    );
  // The shop starts closed; `goShop` leaves it closed, `openShop` opens it.
  const goShop = async (next) => {
    await page.goto(`${baseUrl}?next=${next}#shop`);
    await page.waitForSelector('#shop-toggle');
    await page.waitForFunction(() => window.__debug?.shop?.state);
    await settle();
  };
  const gold = async () =>
    (await page.evaluate(() => window.__debug.shop.state())).gold;
  const noScroll = (w, h) =>
    page.evaluate(
      ([iw, ih]) => ({
        ok:
          document.documentElement.scrollWidth <= iw &&
          document.documentElement.scrollHeight <= ih &&
          document.body.scrollWidth <= iw,
        sw: document.documentElement.scrollWidth,
        sh: document.documentElement.scrollHeight,
      }),
      [w, h],
    );

  // --- Shop before a PvE battle
  await page.setViewportSize({ width: 1920, height: 1080 });
  await goShop('pve');
  const sPve = await S.state();
  check(
    sPve.step === 'shop' && sPve.next === 'pve',
    'shop route: run is in a shop that leads into a PvE battle',
  );
  const pveText = await page.locator('#panel-next-fight').innerText();
  check(
    /Stronghold/.test(pveText) && /3/.test(pveText),
    `next fight (PvE) is in the info rail while the shop is closed ("${pveText.replace(/\s+/g, ' ').slice(0, 80)}")`,
  );
  check(
    (await page.locator('#panel-party').count()) === 0,
    'solo: no party panel is shown',
  );
  check(
    (await page.locator('.topbar-tabs button').count()) === 0 &&
      (await page.locator('#shop-toggle').getAttribute('aria-pressed')) ===
        'false' &&
      /^Shop\s*\d+ offers?$/.test(
        (await page.locator('#shop-toggle').innerText()).trim(),
      ),
    'no Shop/Build tabs: the top bar has a Shop button with an offer-count badge, not pressed',
  );
  check(
    (await page.locator('#shop-screen').count()) === 0,
    'the shop starts closed, the checklist and Next fight are in the rail',
  );
  await shot('shop-1-before-pve');

  // --- Shop before a PvP battle: the main flow
  await goShop('pvp');
  const s0 = await S.state();
  check(
    s0.step === 'shop' && s0.next === 'pvp',
    'shop route: run is in a shop that leads into a PvP battle',
  );
  const pvpText = await page.locator('#panel-next-fight').innerText();
  check(
    !/Opponent/i.test(pvpText) &&
      /Win .*gold/.test(pvpText) &&
      /Lose .*life/.test(pvpText),
    `next fight (PvP): no opponent line, and the stakes are stated ("${pvpText.replace(/\s+/g, ' ').slice(0, 120)}")`,
  );
  const boardBefore = await page.locator('.frame-board canvas').boundingBox();
  await page.click('#shop-toggle');
  await page.waitForSelector('#shop-screen');
  await settle();
  check(
    (await page.locator('#shop-toggle').getAttribute('aria-pressed')) ===
      'true' &&
      (await page.locator('.shop-badge').count()) === 0 &&
      (await page.locator('#panel-next-fight').count()) === 0 &&
      (await page.locator('#panel-problems').count()) === 0,
    'opening the shop: the button looks pressed and loses its badge, and the shop replaces the checklist and Next fight',
  );
  const boardOpen = await page.locator('.frame-board canvas').boundingBox();
  check(
    boardOpen.width === boardBefore.width &&
      boardOpen.height === boardBefore.height,
    'the board keeps its size while the shop is open',
  );
  check(
    /Bought buildings go into the tray below the board\. To sell one, select it and press Sell\./.test(
      await page.locator('#shop-screen').innerText(),
    ),
    'the shop ends with the footnote about the tray and selling',
  );
  check(
    (await page.$$eval('#offers .offer', (els) =>
      els.reduce((n, e) => n + Number(e.dataset.copies ?? 1), 0),
    )) === 5 &&
      (await page.locator('#offers .offer').count()) ===
        (await page.$$eval(
          '#offers .offer[data-state]',
          // A source's card has no effect line: its Collects line is its effect.
          (els) =>
            els.filter(
              (e) =>
                e.querySelector('[data-field="effect"]') ||
                e.querySelector('[data-field="rate"]'),
            ).length,
        )),
    'five offers (identical ones grouped into one card), each card with a generated effect or Collects line',
  );
  const cardText = await page.locator('#offers .offer').first().innerText();
  check(
    /· T\d/.test(cardText) &&
      !/Needs/.test(cardText) &&
      /Health \d+/.test(cardText) &&
      /\d+ g$/.test(cardText.trim()),
    `offer row shows kind, tier, health and price (no Needs line) ("${cardText.replace(/\s+/g, ' ').slice(0, 110)}")`,
  );
  const sc = await noScroll(1920, 1080);
  check(
    sc.ok,
    `shop fits 1920x1080 without page scroll (${JSON.stringify(sc)})`,
  );
  await shot('shop-2-before-pvp');

  // Disabled buttons always say why.
  const allDisabledExplained = async () =>
    page.evaluate(() =>
      [...document.querySelectorAll('#offers .offer[data-def]')].every((el) => {
        const btn = el.querySelector('button');
        const why = btn.title ?? '';
        // No "Need N more gold." text: a reason shows only for a lock.
        return btn.disabled ? !/more gold/.test(why) : why === '';
      }),
    );
  check(
    await allDisabledExplained(),
    'enabled Buy buttons show no reason, and no card says "Need N more gold"',
  );

  // --- Buy the cheapest affordable offer
  let g0 = await gold();
  let s0b = s0;
  const pickSlot = () => {
    let found = -1;
    s0b.offers.forEach((def, i) => {
      const price = s0b.offerPrices[i];
      // Prefer an offer that is not duplicated: a grouped card stays after a buy.
      if (
        def !== null &&
        s0b.offers.filter((d) => d === def).length === 1 &&
        price <= g0 &&
        (found < 0 || price < s0b.offerPrices[found])
      )
        found = i;
    });
    return found;
  };
  let slot = pickSlot();
  // Offers are often grouped copies or dear; re-roll for a single affordable one.
  for (let i = 0; i < 8 && slot < 0 && g0 > 1; i++) {
    const before = g0;
    await page.click('#reroll');
    await page.waitForFunction(
      (g) => window.__debug.shop.state().gold < g,
      before,
    );
    s0b = await S.state();
    g0 = await gold();
    slot = pickSlot();
  }
  check(slot >= 0, `an affordable offer exists (gold ${g0})`);
  const price = s0b.offerPrices[slot];
  const boughtDef = s0b.offers[slot];
  await page
    .locator(`#offers .offer[data-slot="${slot}"] [data-action="buy"]`)
    .click();
  await page.waitForFunction(
    (n) => window.__debug.shop.state().stash.length === n,
    s0.stash.length + 1,
  );
  const s1 = await S.state();
  check(
    (await gold()) === g0 - price && s1.gold === g0 - price,
    `buy: gold ${g0} -> ${g0 - price} immediately`,
  );
  check(
    s1.stash.length === s0.stash.length + 1 &&
      s1.stash.some(
        (x) => x.def === boughtDef && !s0.stash.some((o) => o.id === x.id),
      ),
    `buy: ${boughtDef} is in the stash`,
  );
  check(
    (await page
      .locator(`#offers .offer[data-slot="${slot}"]`)
      .getAttribute('data-state')) === 'sold',
    'buy: the slot shows as sold out until the next re-roll',
  );
  check(
    await allDisabledExplained(),
    'after buying, no Buy button shows a gold-shortage reason',
  );
  check(
    (await page
      .locator(`.stash-item.flash[data-stash-def="${boughtDef}"]`)
      .count()) === 1 &&
      /JUST BOUGHT/.test(
        await page
          .locator(`.stash-item[data-stash-def="${boughtDef}"] .slot-new`)
          .first()
          .innerText(),
      ),
    'buy: the inventory slot that received the building is highlighted and says JUST BOUGHT',
  );
  await shot('shop-2b-after-buy');
  check(
    /Bought/.test(await page.locator('#status-line').innerText()),
    'a status line confirms the purchase',
  );

  // --- Re-roll
  const g1 = await gold();
  const rerollCost = Number(
    (await page.locator('#reroll').innerText()).match(/(\d+)\s*$/)[1],
  );
  check(
    rerollCost >= 1 && !(await page.locator('#reroll').isDisabled()),
    `re-roll button shows its cost (${rerollCost}) and is enabled`,
  );
  await page.click('#reroll');
  await page.waitForFunction(
    (g) => window.__debug.shop.state().gold === g,
    g1 - rerollCost,
  );
  const s2 = await S.state();
  check(
    s2.offers.every((d) => d !== null) && s2.gold === g1 - rerollCost,
    're-roll: gold paid and every slot, including the sold one, has a new offer',
  );

  // --- Sell: select the slot, press Sell, cancel first, then confirm
  const wallRow = page
    .locator('.stash-item[data-stash-def^="bld_wall_"]')
    .first();
  const wallCount = Number(await wallRow.getAttribute('data-count'));
  const wallDef = await wallRow.getAttribute('data-stash-def');
  await wallRow.click();
  await page.waitForSelector('#sell-strip [data-action="sell"]');
  const wallRefund = Number(
    (await page.locator('#sell-strip [data-action="sell"]').innerText()).match(
      /Sell · (\d+)/,
    )[1],
  );
  await page.click('#sell-strip [data-action="sell"]');
  const quote = await page.locator('#sell-quote').innerText();
  check(
    quote.includes(String(wallRefund)) && /^Sell /.test(quote),
    `sell: the amount returned (${wallRefund} gold) is shown before confirming`,
  );
  await shot('shop-3-sell-confirm');
  await page.click('#sell-cancel');
  check(
    (await gold()) === s2.gold &&
      (await S.state()).stash.length === s2.stash.length,
    'sell: cancelling changes nothing',
  );
  // Escape cancels the sale too, and leaves the shop open.
  await page.click('#sell-strip [data-action="sell"]');
  await page.waitForSelector('#sell-confirm');
  await page.keyboard.press('Escape');
  check(
    (await page.locator('#sell-confirm').count()) === 0 &&
      (await page.locator('#shop-screen').count()) === 1 &&
      (await gold()) === s2.gold,
    'sell: Escape cancels the sale, the shop stays open and nothing changes',
  );
  // There is no drop zone to drag onto; the Sell button opens the quote again.
  check(
    (await page.locator('#sell-target').count()) === 0 &&
      (await wallRow.getAttribute('draggable')) === null,
    'sell: no drag-to-sell drop zone, and inventory slots are not draggable',
  );
  await page.click('#sell-strip [data-action="sell"]');
  await page.waitForSelector('#sell-confirm');
  await page.click('#sell-confirm');
  await page.waitForFunction(
    (n) => window.__debug.shop.state().stash.length === n,
    s2.stash.length - 1,
  );
  const s3 = await S.state();
  check(
    s3.gold === s2.gold + wallRefund,
    `sell: gold ${s2.gold} -> ${s3.gold} (+${wallRefund})`,
  );
  const wallRowAfter = page.locator(`.stash-item[data-stash-def="${wallDef}"]`);
  check(
    wallCount === 1
      ? (await wallRowAfter.count()) === 0
      : Number(await wallRowAfter.first().getAttribute('data-count')) ===
          wallCount - 1,
    'sell: the inventory lost one wall',
  );

  // --- The board works while the shop is open: place the purchase
  check(
    (await B.step()) === 'shop' &&
      (await page.locator('#shop-screen').count()) === 1,
    'the shop is still open on the Build screen of the same step',
  );
  const t0 = await B.team();
  check(
    t0.stash.length === s3.stash.length &&
      t0.stash.some((x) => x.def === boughtDef),
    'the board sees the same stash, including the purchase',
  );
  check(
    await page.locator('[data-action="undo"]').isDisabled(),
    'undo is empty after buying, selling and re-rolling',
  );
  const bought = t0.stash.find((x) => x.def === boughtDef);

  // Find cells where the purchase fits, then drag it there.
  const fp = footprints[boughtDef];
  const blocked = new Set();
  const mark = (x, y, w, h) => {
    for (let dx = 0; dx < w; dx++)
      for (let dy = 0; dy < h; dy++) blocked.add(`${x + dx},${y + dy}`);
  };
  mark(t0.cores[0].x, t0.cores[0].y, 2, 2);
  for (const b of t0.buildings)
    mark(b.x, b.y, footprints[b.def].width, footprints[b.def].height);
  for (const f of t0.features) mark(f.x, f.y, 1, 1);
  for (const n of t0.nodes) mark(n.x, n.y, 1, 1);
  const candidates = [];
  if (boughtDef === 'bld_extractor') {
    for (const n of t0.nodes) candidates.push({ x: n.x, y: n.y });
  } else {
    for (let y = 6; y < t0.height - fp.height; y++) {
      for (let x = 1; x < t0.width - fp.width - 1; x++) {
        let free = true;
        for (let dx = 0; dx < fp.width && free; dx++)
          for (let dy = 0; dy < fp.height && free; dy++)
            if (blocked.has(`${x + dx},${y + dy}`)) free = false;
        if (free) candidates.push({ x, y });
      }
    }
  }
  const dragPurchase = async () => {
    for (const c of candidates.slice(0, 12)) {
      const before = (await B.team()).buildings.length;
      const b = await page
        .locator(`[data-stash-def="${boughtDef}"]`)
        .first()
        .boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      const p = await at(c.x, c.y);
      await page.mouse.move(p.x, p.y, { steps: 8 });
      await settle();
      await page.mouse.up();
      await frames(page, 6);
      if ((await B.team()).buildings.length > before) return c;
      await page.keyboard.press('Escape');
    }
    return null;
  };
  const spot = await dragPurchase();
  check(
    spot !== null,
    `purchase (${boughtDef}) placed on the board at ${JSON.stringify(spot)}`,
  );
  const afterPlace = await B.team();
  check(
    afterPlace.buildings.some((b) => b.id === bought.id) &&
      !afterPlace.stash.some((x) => x.id === bought.id),
    'the placed building left the stash',
  );

  // Undo only reverses the placement, never the purchase.
  await page.click('[data-action="undo"]');
  await frames(page, 6);
  const undone = await B.team();
  check(
    undone.stash.some((x) => x.id === bought.id) &&
      undone.buildings.every((b) => b.id !== bought.id),
    'undo on Build returns the building to the stash and nothing else',
  );
  check(
    await page.locator('[data-action="undo"]').isDisabled(),
    'undo has nothing further to reverse: the purchase is not on its stack',
  );
  await dragPurchase();
  const placed = await B.team();
  check(
    placed.buildings.some((b) => b.id === bought.id),
    'purchase placed again',
  );
  await shot('shop-4-build-after-placing');

  // --- Close and open the shop repeatedly: nothing is lost
  const snapshot = async () => {
    const s = await S.state();
    const t = await B.team();
    return JSON.stringify({
      gold: s.gold,
      offers: s.offers,
      stash: t.stash,
      buildings: t.buildings,
      conduits: t.conduits,
    });
  };
  const snap0 = await snapshot();
  const roundTrips = [];
  await page.click('#shop-close');
  await page.waitForSelector('#shop-screen', { state: 'detached' });
  check(
    (await page.locator('#panel-next-fight').count()) === 1 &&
      (await page.locator('#shop-toggle').getAttribute('aria-pressed')) ===
        'false' &&
      (await page.locator('.shop-badge').count()) === 0,
    'closing the shop (x): the rail shows the checklist and Next fight again, the button is not pressed',
  );
  await shot('shop-3b-closed');
  for (let i = 0; i < 3; i++) {
    await openShop(page);
    await closeShop(page);
    roundTrips.push(await snapshot());
  }
  check(
    roundTrips.every((x) => x === snap0),
    'opening and closing the shop three times loses no gold, offers, stash or board state',
  );
  await openShop(page);
  await page.keyboard.press('Escape');
  await page.waitForSelector('#shop-screen', { state: 'detached' });
  check(true, 'Escape closes the shop');
  await openShop(page);

  // --- Reload: gold, offers, stash and board survive; the shop starts closed
  const before = await snapshot();
  await page.reload();
  await page.waitForSelector('#shop-toggle');
  await page.waitForFunction(() => window.__debug?.shop?.state);
  await settle();
  check(
    (await page.locator('#shop-screen').count()) === 0,
    'after a reload the shop is closed again',
  );
  const afterReload = await snapshot();
  check(
    before === afterReload,
    'after a page reload gold, offers, stash and the board are as they were',
  );
  check(
    (await B.team()).buildings.some((b) => b.id === bought.id),
    'reload restores the placed building',
  );
  await openShop(page);
  await shot('shop-5-after-reload');

  // --- 1366x768
  await page.setViewportSize({ width: 1366, height: 768 });
  await settle();
  await frames(page, 9);
  const sc2 = await noScroll(1366, 768);
  check(sc2.ok, `shop has no page scroll at 1366x768 (${JSON.stringify(sc2)})`);
  // The offers are in the info rail, which scrolls when they do not all fit:
  // none may be cut off at the side, and every Buy button can be reached.
  const clipped = await page.evaluate(() => {
    const box = document.querySelector('.frame-info').getBoundingClientRect();
    return [...document.querySelectorAll('#offers .offer')].filter((el) => {
      const r = el.getBoundingClientRect();
      return (
        r.right > box.right + 1 ||
        r.left < box.left - 1 ||
        el.scrollWidth > el.clientWidth + 1
      );
    }).length;
  });
  check(
    clipped === 0,
    `no offer card is clipped at 1366x768 (${clipped} clipped)`,
  );
  const buyVisible = await page.evaluate(() => {
    const rail = document.querySelector('.frame-info');
    const box = rail.getBoundingClientRect();
    const canScroll =
      getComputedStyle(rail).overflowY === 'auto' ||
      rail.scrollHeight <= rail.clientHeight;
    return (
      canScroll &&
      [...document.querySelectorAll('#offers [data-action="buy"]')].every(
        (b) => {
          const r = b.getBoundingClientRect();
          return r.right <= box.right + 1 && r.left >= box.left - 1;
        },
      )
    );
  });
  check(buyVisible, 'Buy buttons are inside the info rail at 1366x768');
  await shot('shop-6-1366x768');
  await shotDark('art2-shop-1366x768');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await settle();

  // --- Two tabs on one run: a stale tab cannot undo a re-roll
  const stateOf = (p) => p.evaluate(() => window.__debug.shop.state());
  const context = page.context();
  const tabB = await context.newPage();
  // Tab B never hears about storage changes, as if the event were missed, so
  // only the store's own check can stop its purchase.
  await tabB.addInitScript(() => {
    const add = window.addEventListener.bind(window);
    window.addEventListener = (type, ...rest) =>
      type === 'storage' ? undefined : add(type, ...rest);
  });
  await tabB.setViewportSize({ width: 1920, height: 1080 });
  await tabB.goto(`${baseUrl}?next=pvp#shop`);
  await openShop(tabB);
  await tabB.waitForFunction(() => window.__debug?.shop?.state);
  const a0 = await S.state();
  const b0 = await stateOf(tabB);
  check(
    JSON.stringify(a0.offers) === JSON.stringify(b0.offers) &&
      a0.gold === b0.gold,
    'two tabs: both open on the same saved run',
  );
  const rerollGold = Number(
    (await page.locator('#reroll').innerText()).match(/(\d+)\s*$/)[1],
  );
  await page.click('#reroll');
  await page.waitForFunction(
    (g) => window.__debug.shop.state().gold === g,
    a0.gold - rerollGold,
  );
  const aRolled = await S.state();
  let bSlot = -1;
  b0.offers.forEach((def, i) => {
    if (def !== null && b0.offerPrices[i] <= b0.gold && bSlot < 0) bSlot = i;
  });
  check(bSlot >= 0, 'two tabs: tab B still shows an affordable old offer');
  await tabB
    .locator(`#offers .offer[data-slot="${bSlot}"] [data-action="buy"]`)
    .click();
  await tabB.waitForSelector('#run-conflict');
  const conflictText = await tabB.locator('#run-conflict').innerText();
  check(
    /changed in another tab/i.test(conflictText) &&
      (await tabB.locator('#run-reload').count()) === 1,
    'two tabs: the refused purchase stops tab B and offers Reload',
  );
  await page.reload();
  await openShop(page);
  await page.waitForFunction(() => window.__debug?.shop?.state);
  const aAfter = await S.state();
  check(
    aAfter.gold === aRolled.gold &&
      JSON.stringify(aAfter.offers) === JSON.stringify(aRolled.offers) &&
      aAfter.stash.length === aRolled.stash.length &&
      aAfter.actions === aRolled.actions,
    `two tabs: after reload gold (${aAfter.gold}) and offers are tab A's re-roll and tab B's buy was refused`,
  );
  await tabB.click('#run-reload');
  await openShop(tabB);
  await tabB.waitForFunction(() => window.__debug?.shop?.state);
  const bReloaded = await stateOf(tabB);
  check(
    JSON.stringify(bReloaded.offers) === JSON.stringify(aRolled.offers) &&
      bReloaded.gold === aRolled.gold,
    'two tabs: Reload in tab B shows the saved run',
  );
  // Now a change in B reaches A through the storage event.
  await tabB.click('#reroll');
  await page.waitForSelector('#run-conflict');
  check(
    /changed in another tab/i.test(
      await page.locator('#run-conflict').innerText(),
    ),
    'two tabs: a save from another tab stops tab A with a Reload button',
  );
  await page.click('#run-reload');
  await openShop(page);
  await page.waitForFunction(() => window.__debug?.shop?.state);
  check(
    JSON.stringify((await S.state()).offers) ===
      JSON.stringify((await stateOf(tabB)).offers),
    'two tabs: Reload in tab A shows what tab B saved',
  );
  await tabB.close();
  await shot('shop-6b-two-tabs');

  // --- Ready, with the shop open
  const readyBefore = await page.locator('#ready-button').innerText();
  check(
    /^Ready\s+Space$/.test(readyBefore),
    `Ready is at the end of the tray with the shop open ("${readyBefore.replace(/\s+/g, ' ')}")`,
  );
  await page.click('#ready-button');
  await page.waitForSelector('#step-placeholder');
  const ph = await page.locator('#step-placeholder').innerText();
  check(
    /pvp_summary/.test(ph),
    `ready: the run advances and a placeholder names the step ("${ph.replace(/\s+/g, ' ').slice(0, 100)}")`,
  );
  await shot('shop-7-ready');
  check(
    !/ready/i.test(await page.locator('[data-field="run-info"]').innerText()),
    'after Ready the status bar shows no ready count',
  );
  await page.reload();
  await page.waitForSelector('#step-placeholder');
  check(true, 'the ready state survives a reload');

  // --- Starting over asks first
  const savedKey = 'coop:save:shop-sample-pvp';
  const saved = () => page.evaluate((k) => localStorage.getItem(k), savedKey);
  const savedBefore = await saved();
  await page.click('#dev-new-run');
  await page.waitForSelector('#restart-confirm');
  check(
    /cannot be undone/.test(
      await page.locator('#restart-confirm').innerText(),
    ) && (await saved()) === savedBefore,
    'start a new sample run: asks first and deletes nothing yet',
  );
  await page.click('#dev-new-run-cancel');
  check(
    (await page.locator('#dev-new-run').count()) === 1 &&
      (await saved()) === savedBefore,
    'start a new sample run: Keep it leaves the save alone',
  );
  await page.click('#dev-new-run');
  await page.click('#dev-new-run-confirm');
  await page.waitForSelector('#shop-toggle');
  await page.waitForFunction(() => window.__debug?.shop?.state);
  // The new run is written to storage as the screen mounts; wait for it.
  await page.waitForFunction(
    ([k, v]) => localStorage.getItem(k) !== v,
    [savedKey, savedBefore],
  );
  await page.waitForFunction(() => window.__debug.shop.state().ready === false);
  check(
    (await saved()) !== savedBefore &&
      (await S.state()).step === 'shop' &&
      (await S.state()).ready === false,
    'start a new sample run: confirming starts a fresh run in the shop',
  );

  // --- A save that cannot be opened is kept, and the player decides
  const reloadAndExpectBlocked = async () => {
    await page.reload();
    await page.waitForSelector('#run-unopenable');
  };
  const old = JSON.parse(await saved());
  old.state.formatVersion = 1;
  const oldText = JSON.stringify(old);
  await page.evaluate(
    ([k, v]) => localStorage.setItem(k, v),
    [savedKey, oldText],
  );
  await reloadAndExpectBlocked();
  check(
    /format this version of the game cannot read/i.test(
      await page.locator('#run-unopenable [data-field="reason"]').innerText(),
    ) && (await saved()) === oldText,
    'an old-format save: the reason is shown and the save is not deleted',
  );
  await shot('shop-8-unopenable');
  await page.evaluate((k) => localStorage.setItem(k, '{not json'), savedKey);
  await reloadAndExpectBlocked();
  check(
    /damaged/i.test(
      await page.locator('#run-unopenable [data-field="reason"]').innerText(),
    ) && (await saved()) === '{not json',
    'a damaged save: the reason is shown and the save is not deleted',
  );
  await page.click('#run-discard');
  await page.waitForSelector('#shop-toggle');
  await page.waitForFunction(() => window.__debug?.shop?.state);
  check(
    (await S.state()).step === 'shop' &&
      JSON.parse(await saved()).runId === 'shop-sample-pvp',
    'Discard and start a new sample run replaces the damaged save on request',
  );

  // --- localStorage that refuses writes: the run works but says it is unsaved
  const noStore = await context.newPage();
  await noStore.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error('QuotaExceededError');
    };
  });
  await noStore.setViewportSize({ width: 1920, height: 1080 });
  await noStore.goto(`${baseUrl}?next=pvp#shop`);
  await noStore.waitForSelector('#shop-toggle');
  const note = 'Not saved — progress is lost on reload';
  check(
    (await noStore.locator('#not-saved-note').innerText()) === note,
    'unsaved run: the Build screen shows "Not saved — progress is lost on reload"',
  );
  await noStore.close();
  check(
    (await page.locator('#not-saved-note').count()) === 0,
    'a saved run shows no unsaved note',
  );

  // --- Two players (?players=2): the Ready lock with the partner not ready
  await page.goto(`${baseUrl}?next=pvp&players=2#shop`);
  await page.waitForSelector('#shop-toggle');
  await page.waitForFunction(() => window.__debug?.shop?.state);
  await page.waitForFunction(() => window.__debug?.partner !== undefined);
  check(
    (await S.state()).runId === 'shop-sample-pvp-2p',
    'two players: the ?players=2 route starts its own sample run',
  );
  const undoBtn = page.locator('[data-action="undo"]');
  const redoBtn = page.locator('[data-action="redo"]');
  // Make a real edit first, so Undo is enabled and a lock has something to hold back.
  const twoTeam = await B.team();
  let twoPlaced = null;
  for (let y = 6; y < twoTeam.height - 2 && twoPlaced === null; y++) {
    for (let x = 1; x < twoTeam.width - 2 && twoPlaced === null; x++) {
      const before = (await B.team()).buildings.length;
      const b = await page
        .locator('[data-stash-def^="bld_wall_"]')
        .first()
        .boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      const p = await at(x, y);
      await page.mouse.move(p.x, p.y, { steps: 8 });
      await settle();
      await page.mouse.up();
      await frames(page, 6);
      if ((await B.team()).buildings.length > before) twoPlaced = { x, y };
      else await page.keyboard.press('Escape');
    }
  }
  check(twoPlaced !== null, 'two players: a wall was twoPlaced before Ready');
  const twoPlacedCount = (await B.team()).buildings.length;
  check(
    !(await undoBtn.isDisabled()),
    'two players: Undo is enabled after an edit (so the Ready check below can fail)',
  );
  await page.click('#ready-button');
  await page.waitForSelector('[data-field="ready-locked"]');
  check(
    /^Unready\s+Space$/.test(await page.locator('#ready-button').innerText()) &&
      (await B.step()) === 'shop',
    'two players: Ready locks this player and the run stays in the shop',
  );
  check(
    (await undoBtn.isDisabled()) && (await redoBtn.isDisabled()),
    'two players: Undo and Redo are disabled while Ready (with an edit on the stack)',
  );
  await page.keyboard.press('Control+z');
  await page.waitForFunction(
    (t) => window.__debug.build.status().text === t,
    'Ready. Unready to make changes.',
  );
  check(
    (await B.team()).buildings.length === twoPlacedCount &&
      (await B.counts()).undo === 1,
    'two players: Ctrl+Z while Ready changes nothing and keeps the history',
  );
  const hookTool = () => page.evaluate(() => window.__debug.build.ui().tool);
  await page.keyboard.press('c');
  await page.waitForFunction(
    (t) => window.__debug.build.status().text === t,
    'Ready. Unready to make changes.',
  );
  check(
    (await hookTool()) === 'select',
    'two players: the conduit hotkey does not switch to a disabled tool while Ready',
  );
  await shot('shop-9-two-player-ready');
  // Unready reopens the edit: Undo is enabled again and still undoes the wall.
  await page.click('#ready-button');
  await page.waitForFunction(
    () => document.querySelector('[data-field="ready-locked"]') === null,
  );
  check(
    !(await undoBtn.isDisabled()),
    'two players: after Unready, Undo is enabled again',
  );
  await undoBtn.click();
  await page.waitForFunction(
    (n) => window.__debug.build.team().buildings.length < n,
    twoPlacedCount,
  );
  check(
    (await B.team()).buildings.length === twoPlacedCount - 1,
    'two players: after Unready, Undo takes the wall back',
  );
  await page.click('#ready-button');
  await page.waitForSelector('[data-field="ready-locked"]');
  // The partner readies too: everyone is ready and the run moves on.
  await page.evaluate(() => window.__debug.partner.ready());
  await page.waitForFunction(() => window.__debug.build.step() !== 'shop');
  check(
    (await B.step()) !== 'shop',
    `two players: when the partner is Ready the run continues (now "${await B.step()}")`,
  );
}
