// Shop + Build smoke checks (issue W2-7). Called from smoke.mjs with the
// shared page and helpers. Plain Node ESM, not part of the bundle.
//
// The shop route sets up a sample run (fixed seed, every battle won) that
// is already in a shop step, and saves it in localStorage. `?next=pve` or
// `?next=pvp` picks which battle follows the shop.

import { readFileSync } from 'node:fs';
import path from 'node:path';

export async function runShopSmoke({
  page,
  baseUrl,
  check,
  shot,
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
    state: () => page.evaluate(() => window.__debug.shop.state()),
  };
  const B = {
    step: () => page.evaluate(() => window.__debug.build.step()),
    team: () => page.evaluate(() => window.__debug.build.team()),
    counts: () => page.evaluate(() => window.__debug.build.counts()),
  };
  const at = (x, y) =>
    page.evaluate(
      ([cx, cy]) => window.__debug.build.cellToScreen(cx, cy),
      [x, y],
    );
  const goShop = async (next) => {
    await page.goto(`${baseUrl}?next=${next}#shop`);
    await page.waitForSelector('#shop-screen');
    await page.waitForFunction(() => window.__debug?.shop?.state);
    await settle();
  };
  const goBuildTab = async () => {
    await page.click('.topbar-tabs button:has-text("Build")');
    await page.waitForSelector('canvas');
    await page.waitForFunction(() => window.__debug?.build?.step() === 'shop');
    await settle();
  };
  // Each mount of the Shop tab has its own number, so waiting for a larger
  // one cannot be satisfied by data left over from the previous mount.
  const mounts = () =>
    page.evaluate(() => window.__debug?.shop?.mounts?.() ?? 0);
  const goShopTab = async () => {
    const m0 = await mounts();
    await page.click('.topbar-tabs button:has-text("Shop")');
    await page.waitForSelector('#shop-screen');
    await page.waitForFunction(
      (m) => (window.__debug?.shop?.mounts?.() ?? 0) > m,
      m0,
    );
    await settle();
  };
  const gold = async () =>
    Number(await page.locator('#gold').getAttribute('data-gold'));
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
  const pveText = await page.locator('#panel-next-battle').innerText();
  check(
    (await page.locator('#next-options .pve-option').count()) === 3 &&
      /easy/i.test(pveText) &&
      /medium/i.test(pveText) &&
      /hard/i.test(pveText) &&
      /Win: \d+ gold/.test(pveText),
    'next battle (PvE): three options with archetype, threat and gold reward',
  );
  check(
    (await page.locator('#panel-party-shop').count()) === 0,
    'solo: no party panel is shown',
  );
  await shot('shop-1-before-pve');

  // --- Shop before a PvP battle: the main flow
  await goShop('pvp');
  const s0 = await S.state();
  check(
    s0.step === 'shop' && s0.next === 'pvp',
    'shop route: run is in a shop that leads into a PvP battle',
  );
  const pvpText = await page.locator('#panel-next-battle').innerText();
  check(
    /unknown/i.test(pvpText) &&
      /Win:/.test(pvpText) &&
      /Lose:.*life/.test(pvpText),
    `next battle (PvP): opponent unknown and the stakes are stated ("${pvpText.replace(/\s+/g, ' ').slice(0, 120)}")`,
  );
  check(
    (await page.locator('#offers .offer').count()) === 5 &&
      (await page
        .locator('#offers .offer[data-state] [data-field="effect"]')
        .count()) === 5,
    'five offer cards, each with a generated effect line',
  );
  const cardText = await page.locator('#offers .offer').first().innerText();
  check(
    /tier \d/.test(cardText) &&
      /Needs:/.test(cardText) &&
      /Buy · \d+ gold/.test(cardText),
    `offer card shows kind, tier, needs and price ("${cardText.replace(/\s+/g, ' ').slice(0, 110)}")`,
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
        const why =
          el.querySelector('[data-field="reason"]')?.textContent ?? '';
        return btn.disabled ? why.length > 5 : why === '';
      }),
    );
  check(
    await allDisabledExplained(),
    'every disabled Buy button shows a reason; enabled ones show none',
  );

  // --- Buy the cheapest affordable offer
  const g0 = await gold();
  let slot = -1;
  s0.offers.forEach((def, i) => {
    const price = s0.offerPrices[i];
    if (
      def !== null &&
      price <= g0 &&
      (slot < 0 || price < s0.offerPrices[slot])
    )
      slot = i;
  });
  check(slot >= 0, `an affordable offer exists (gold ${g0})`);
  const price = s0.offerPrices[slot];
  const boughtDef = s0.offers[slot];
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
    'after buying, disabled Buy buttons still explain why',
  );
  check(
    /cannot be undone|Bought/.test(
      await page.locator('#shop-status').innerText(),
    ),
    'a status line confirms the purchase',
  );

  // --- Re-roll
  const g1 = await gold();
  const rerollCost = Number(
    (await page.locator('#reroll').innerText()).match(/(\d+) gold/)[1],
  );
  check(
    rerollCost >= 1 && !(await page.locator('#reroll').isDisabled()),
    `re-roll button shows its cost (${rerollCost} gold) and is enabled`,
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

  // --- Sell: cancel first, then confirm
  const wallRow = page.locator('.stash-row[data-stash-def="bld_wall"]').first();
  const wallRefund = Number(
    (await wallRow.locator('[data-action="sell"]').innerText()).match(
      /(\d+)/,
    )[1],
  );
  const wallCount = Number(await wallRow.getAttribute('data-count'));
  await wallRow.locator('[data-action="sell"]').click();
  const quote = await page.locator('#sell-quote').innerText();
  check(
    quote.includes(String(wallRefund)) && /cannot be undone/.test(quote),
    `sell: the amount returned (${wallRefund} gold) is shown before confirming`,
  );
  await shot('shop-3-sell-confirm');
  await page.click('#sell-cancel');
  check(
    (await gold()) === s2.gold &&
      (await S.state()).stash.length === s2.stash.length,
    'sell: cancelling changes nothing',
  );
  // Drag onto the sell target, then confirm.
  await wallRow.dragTo(page.locator('#sell-target'));
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
  const wallRowAfter = page.locator('.stash-row[data-stash-def="bld_wall"]');
  check(
    wallCount === 1
      ? (await wallRowAfter.count()) === 0
      : Number(await wallRowAfter.first().getAttribute('data-count')) ===
          wallCount - 1,
    'sell: the stash list lost one wall',
  );

  // --- Build tab: place the purchase
  await page.click('#go-build');
  await page.waitForFunction(() => window.__debug?.build?.step() === 'shop');
  await page.waitForSelector('canvas');
  await settle();
  check(
    (await B.step()) === 'shop',
    'Open Build shows the Build tab of the same step',
  );
  const tabs = await page.locator('.topbar-tabs button').allInnerTexts();
  check(
    tabs.join(',') === 'Shop,Build' &&
      !(await page.locator('.topbar-tabs button').first().isDisabled()),
    'both tabs are available in the top bar',
  );
  const t0 = await B.team();
  check(
    t0.stash.length === s3.stash.length &&
      t0.stash.some((x) => x.def === boughtDef),
    'Build tab sees the same stash, including the purchase',
  );
  check(
    await page.locator('[data-action="undo"]').isDisabled(),
    'Build tab: undo is empty after buying, selling and re-rolling',
  );
  const bought = t0.stash.find((x) => x.def === boughtDef);

  // Find cells where the purchase fits, then drag it there.
  const fp = footprints[boughtDef];
  const blocked = new Set();
  const mark = (x, y, w, h) => {
    for (let dx = 0; dx < w; dx++)
      for (let dy = 0; dy < h; dy++) blocked.add(`${x + dx},${y + dy}`);
  };
  mark(t0.core.x, t0.core.y, 2, 2);
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
      await page.waitForTimeout(80);
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
  await page.waitForTimeout(100);
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

  // --- Switch tabs repeatedly: nothing is lost
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
  await goShopTab();
  const snap0 = await snapshot();
  const roundTrips = [];
  await goBuildTab();
  check(
    await page.evaluate(() => window.__debug?.shop === undefined),
    'the Shop debug hook is unregistered when the tab is left',
  );
  await goShopTab();
  for (let i = 0; i < 3; i++) {
    await goBuildTab();
    await goShopTab();
    roundTrips.push(await snapshot());
  }
  check(
    roundTrips.every((x) => x === snap0),
    'switching Shop and Build three times loses no gold, offers, stash or board state',
  );
  check(
    /1 building placed/.test(
      await page.locator('[data-field="factory-counts"]').innerText(),
    ),
    'the mini factory view counts the placed building',
  );

  // --- Reload: gold, offers, stash and board survive
  const before = await snapshot();
  await page.reload();
  await page.waitForSelector('#shop-screen');
  await page.waitForFunction(() => window.__debug?.shop?.state);
  await settle();
  // The Build debug hook registers when the Build tab is first shown.
  await goBuildTab();
  await goShopTab();
  const afterReload = await snapshot();
  check(
    before === afterReload,
    'after a page reload gold, offers, stash and the board are as they were',
  );
  await shot('shop-5-after-reload');

  // Reload directly on the Build tab: the board is back.
  await goBuildTab();
  await page.reload();
  await page.waitForSelector('canvas');
  await page.waitForFunction(() => window.__debug?.build?.step() === 'shop');
  await settle();
  const buildReload = await B.team();
  check(
    buildReload.buildings.some((b) => b.id === bought.id),
    'reload on the Build tab restores the placed building',
  );
  await goShopTab();

  // --- 1366x768
  await page.setViewportSize({ width: 1366, height: 768 });
  await settle();
  await page.waitForTimeout(150);
  const sc2 = await noScroll(1366, 768);
  check(sc2.ok, `shop has no page scroll at 1366x768 (${JSON.stringify(sc2)})`);
  const clipped = await page.evaluate(() => {
    const box = document.querySelector('#offers').getBoundingClientRect();
    return [...document.querySelectorAll('#offers .offer')].filter((el) => {
      const r = el.getBoundingClientRect();
      return (
        r.bottom > box.bottom + 1 ||
        r.right > box.right + 1 ||
        el.scrollHeight > el.clientHeight + 1
      );
    }).length;
  });
  check(
    clipped === 0,
    `no offer card is clipped at 1366x768 (${clipped} clipped)`,
  );
  const buyVisible = await page.evaluate(() => {
    const box = document.querySelector('#offers').getBoundingClientRect();
    return [...document.querySelectorAll('#offers [data-action="buy"]')].every(
      (b) => {
        const r = b.getBoundingClientRect();
        return r.bottom <= box.bottom + 1;
      },
    );
  });
  check(buyVisible, 'Buy buttons are fully visible at 1366x768');
  await shot('shop-6-1366x768');
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
  await tabB.waitForSelector('#shop-screen');
  await tabB.waitForFunction(() => window.__debug?.shop?.state);
  const a0 = await S.state();
  const b0 = await stateOf(tabB);
  check(
    JSON.stringify(a0.offers) === JSON.stringify(b0.offers) &&
      a0.gold === b0.gold,
    'two tabs: both open on the same saved run',
  );
  const rerollGold = Number(
    (await page.locator('#reroll').innerText()).match(/(\d+) gold/)[1],
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
  await page.waitForSelector('#shop-screen');
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
  await tabB.waitForSelector('#shop-screen');
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
  await page.waitForSelector('#shop-screen');
  await page.waitForFunction(() => window.__debug?.shop?.state);
  check(
    JSON.stringify((await S.state()).offers) ===
      JSON.stringify((await stateOf(tabB)).offers),
    'two tabs: Reload in tab A shows what tab B saved',
  );
  await tabB.close();
  await shot('shop-6b-two-tabs');

  // --- Ready from the Shop tab
  const readyBefore = await page.locator('#shop-ready').innerText();
  check(readyBefore === 'Ready', 'Ready is available on the Shop tab');
  await page.click('#shop-ready');
  await page.waitForSelector('#step-placeholder');
  const ph = await page.locator('#step-placeholder').innerText();
  check(
    /Ready, waiting to continue/i.test(ph) && /pvp_summary/.test(ph),
    `ready from the Shop tab: the run advances and a placeholder names the step ("${ph.replace(/\s+/g, ' ').slice(0, 100)}")`,
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
  await page.waitForSelector('#shop-screen');
  await page.waitForFunction(() => window.__debug?.shop?.state);
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
  await page.waitForSelector('#shop-screen');
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
  await noStore.waitForSelector('#shop-screen');
  const note = 'Not saved — progress is lost on reload';
  check(
    (await noStore.locator('#not-saved-note').innerText()) === note,
    'unsaved run: the Shop tab shows "Not saved — progress is lost on reload"',
  );
  await noStore.click('.topbar-tabs button:has-text("Build")');
  await noStore.waitForSelector('canvas');
  check(
    (await noStore.locator('#not-saved-note').innerText()) === note,
    'unsaved run: the Build tab shows the same note',
  );
  await noStore.close();
  check(
    (await page.locator('#not-saved-note').count()) === 0,
    'a saved run shows no unsaved note',
  );
}
