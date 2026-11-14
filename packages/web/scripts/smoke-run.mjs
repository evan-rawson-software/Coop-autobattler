// Run flow smoke checks (issue W2-9). Called from smoke.mjs with the shared
// page and helpers. Plain Node ESM, not part of the bundle.
//
// Plays real runs from the main menu with fixed seeds: Core placement, the
// first build, PvE choice, battle (skipped), event with its follow-up, shop,
// PvP battle, a second round, the run-over screen (by defeat and by
// abandoning), reloads at each screen, and several saved runs at once.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { frames, hookReady, slow } from './smoke-timing.mjs';

const SEED = 7;

export async function runRunSmoke({
  page,
  baseUrl,
  check,
  shot,
  shotDark,
  settle,
  webDir,
  context,
  consoleErrors,
}) {
  const footprints = Object.fromEntries(
    JSON.parse(
      readFileSync(
        path.resolve(webDir, '../../content/buildings.json'),
        'utf8',
      ),
    ).buildings.map((b) => [b.id, b.footprint]),
  );
  const income = JSON.parse(
    readFileSync(path.resolve(webDir, '../../content/economy.json'), 'utf8'),
  ).baseIncomePerShop;
  const errorsAtStart = consoleErrors.length;

  const R = {
    state: async (p = page) => {
      await hookReady(p, 'run');
      return await p.evaluate(() => window.__debug.run.state());
    },
    screen: async (p = page) => {
      await hookReady(p, 'run');
      return await p.evaluate(() => window.__debug.run.screen());
    },
  };
  const B = {
    team: async () => {
      await hookReady(page, 'build');
      return await page.evaluate(() => window.__debug.build.team());
    },
  };
  const at = (x, y) =>
    page.evaluate(
      ([cx, cy]) => window.__debug.build.cellToScreen(cx, cy),
      [x, y],
    );
  const noHScroll = (w) =>
    page.evaluate(
      (iw) => ({
        ok:
          document.documentElement.scrollWidth <= iw &&
          document.body.scrollWidth <= iw,
        sw: document.documentElement.scrollWidth,
      }),
      w,
    );

  // The 1366x768 laptop check: no page scroll, the primary controls inside the
  // viewport and not covered, and the board drawn from the atlas at the zoom
  // the screen opens with. The viewport is restored afterwards.
  const checkAt1366 = async (label, selectors, shotName) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await settle();
    await frames(page, 15);
    const m = await page.evaluate((sels) => {
      const de = document.documentElement;
      const bar = document.querySelector('.topbar, header');
      const rects = sels.map((sel) => {
        const el = document.querySelector(sel);
        if (el === null) return { sel, missing: true };
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(
          Math.min(Math.max(r.x + r.width / 2, 0), innerWidth - 1),
          Math.min(Math.max(r.y + r.height / 2, 0), innerHeight - 1),
        );
        return {
          sel,
          rect: [r.x, r.y, r.right, r.bottom].map(Math.round),
          inView:
            r.width > 0 &&
            r.height > 0 &&
            r.x >= 0 &&
            r.y >= 0 &&
            r.right <= innerWidth &&
            r.bottom <= innerHeight,
          covered: hit === null || !(el === hit || el.contains(hit)),
        };
      });
      return {
        sw: de.scrollWidth,
        sh: de.scrollHeight,
        bodyH: document.body.scrollHeight,
        vw: innerWidth,
        vh: innerHeight,
        topbarH:
          bar === null ? null : Math.round(bar.getBoundingClientRect().height),
        rects,
      };
    }, selectors);
    console.log(`${label} 1366x768 top bar height: ${m.topbarH} px`);
    check(
      m.sw <= 1366 && m.sh <= 768 && m.bodyH <= 768,
      `${label}: no page scroll at 1366x768 (${JSON.stringify(m)})`,
    );
    check(
      m.rects.every((r) => !r.missing && r.inView && !r.covered),
      `${label}: controls are inside the viewport and not covered at 1366x768 (${JSON.stringify(m.rects)})`,
    );
    const cam = await page.evaluate(() => window.__debug.camera());
    const art = await page.evaluate(() => window.__debug.sprites?.() ?? null);
    console.log(`${label} 1366x768 board zoom: ${cam.zoom.toFixed(2)}`);
    check(
      art !== null &&
        art.state === 'ready' &&
        art.spriteFrames > 0 &&
        art.drawn > 0,
      `${label}: the board is drawn from the atlas at 1366x768 (${JSON.stringify(art)})`,
    );
    check(
      cam.zoom >= 12,
      `${label}: sprites are used at the opening zoom at 1366x768 (${cam.zoom.toFixed(1)} px a cell)`,
    );
    await shot(shotName);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await settle();
  };

  const mark2 = (set, b, fps) => {
    for (let dx = 0; dx < fps[b.def].width; dx++)
      for (let dy = 0; dy < fps[b.def].height; dy++)
        set.add(`${b.x + dx},${b.y + dy}`);
  };
  const goMenu = async (query = '') => {
    await page.goto(`${baseUrl}#/${query}`);
    // A hash-only change does not reload; make sure the menu has mounted.
    await page.waitForSelector('#main-menu');
    await page.waitForFunction(
      () => window.__debug?.menu?.storage() !== 'loading',
    );
    await settle();
  };
  const waitStep = (step, p = page) =>
    p.waitForFunction((s) => window.__debug?.run?.state().step === s, step);
  const reloadSame = async (what) => {
    const before = await R.state();
    const screen = await R.screen();
    await page.reload();
    await page.waitForFunction(() => window.__debug?.run?.state);
    await settle();
    const after = await R.state();
    check(
      before.hash === after.hash &&
        before.step === after.step &&
        (await R.screen()) === screen,
      `reload at ${what}: same screen ("${screen}") and same run state (${before.hash})`,
    );
  };

  // Place every stash item on a sensible cell of the Build screen.
  const placeKit = async () => {
    const skipped = new Set();
    for (let guard = 0; guard < 30; guard++) {
      const t = await B.team();
      const item = t.stash.find((s) => !skipped.has(s.id));
      if (item === undefined) break;
      const fp = footprints[item.def];
      const blocked = new Set();
      const mark = (x, y, w, h) => {
        for (let dx = 0; dx < w; dx++)
          for (let dy = 0; dy < h; dy++) blocked.add(`${x + dx},${y + dy}`);
      };
      mark(t.cores[0].x, t.cores[0].y, 2, 2);
      for (const b of t.buildings)
        mark(b.x, b.y, footprints[b.def].width, footprints[b.def].height);
      for (const f of t.features) mark(f.x, f.y, 1, 1);
      for (const n of t.nodes) mark(n.x, n.y, 1, 1);
      const candidates = [];
      if (item.def === 'bld_extractor') {
        for (const n of t.nodes) {
          if (!t.buildings.some((b) => b.x === n.x && b.y === n.y)) {
            candidates.push({ x: n.x, y: n.y });
          }
        }
      } else {
        // Defenses toward the front, everything else beside the Core.
        const front = item.def === 'bld_wall' || item.def === 'bld_turret';
        const rows = [];
        for (let y = 0; y < t.height - fp.height; y++) rows.push(y);
        if (!front) rows.reverse();
        for (const y of rows) {
          for (let x = 1; x < t.width - fp.width - 1; x++) {
            let free = true;
            for (let dx = 0; dx < fp.width && free; dx++)
              for (let dy = 0; dy < fp.height && free; dy++)
                if (blocked.has(`${x + dx},${y + dy}`)) free = false;
            if (free) candidates.push({ x, y });
          }
        }
      }
      let placed = false;
      for (const c of candidates.slice(0, 14)) {
        const before = (await B.team()).buildings.length;
        const box = await page
          .locator(`[data-stash-def="${item.def}"]`)
          .first()
          .boundingBox();
        if (box === null) break;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        const p = await at(c.x, c.y);
        await page.mouse.move(p.x, p.y, { steps: 6 });
        await page.mouse.up();
        await page
          .waitForFunction(
            (n) => window.__debug.build.team().buildings.length > n,
            before,
            { timeout: slow(400) },
          )
          .catch(() => undefined);
        if ((await B.team()).buildings.length > before) {
          placed = true;
          break;
        }
        await page.keyboard.press('Escape');
      }
      if (!placed) skipped.add(item.id);
    }
    return (await B.team()).stash.length;
  };

  // The Workshop follow-up: each option names a building, where it is, its
  // tiers and price, and is disabled with a reason when it cannot be paid.
  // Buy an upgrade when one is affordable (gold drops by the shown price, the
  // tier rises, the shop says so); otherwise skip.
  const runWorkshop = async (goldBefore) => {
    const opts = await page
      .locator('#event-resolve .event-card[data-option]')
      .evaluateAll((els) =>
        els.map((e) => ({
          id: e.dataset.option,
          affordable: e.dataset.affordable === 'true',
          text: e.innerText,
          disabled: e.disabled,
        })),
      );
    const parsed = opts.map((o) => ({
      ...o,
      price: Number(/(\d+) gold/.exec(o.text)?.[1]),
      from: Number(/Tier (\d) → (\d)/.exec(o.text)?.[1]),
      to: Number(/Tier (\d) → (\d)/.exec(o.text)?.[2]),
      name: o.text.split('\n')[0].trim(),
    }));
    check(
      parsed.length > 0 &&
        parsed.every(
          (o) =>
            o.to === o.from + 1 &&
            o.affordable === o.price <= goldBefore &&
            o.disabled === !o.affordable,
        ) &&
        parsed
          .filter((o) => !o.affordable)
          .every((o) => /Not enough gold/.test(o.text)),
      `Workshop: ${parsed.length} of your buildings listed with tiers and prices; unaffordable ones are disabled with the reason (gold ${goldBefore})`,
    );
    check(
      (await page.locator('#event-resolve [data-option="skip"]').count()) === 1,
      'Workshop: a Skip button is always there',
    );
    const pickOpt = parsed.find((o) => o.affordable);
    if (pickOpt !== undefined) {
      await page.click(
        `#event-resolve [data-action="choose-option"][data-option="${pickOpt.id}"]`,
      );
    } else {
      await page.click('#event-resolve [data-option="skip"]');
    }
    await waitStep('shop');
    await page.waitForSelector('#shop-screen');
    await settle();
    const goldAfter = Number(
      await page.locator('#gold').getAttribute('data-gold'),
    );
    const notice = await page.locator('#shop-notice').innerText();
    if (pickOpt !== undefined) {
      check(
        goldAfter === goldBefore - pickOpt.price + income &&
          new RegExp(
            `Upgraded .+ to tier ${pickOpt.to} \\(−${pickOpt.price} gold\\)`,
          ).test(notice),
        `Workshop: bought "${pickOpt.name}" tier ${pickOpt.from} -> ${pickOpt.to}: gold ${goldBefore} -> ${goldAfter} (price ${pickOpt.price} + ${income} income), shop says "${notice.replace(/\s+/g, ' ').trim()}"`,
      );
      await shot('run-8b-workshop-notice');
      await page.click('.topbar-tabs button:has-text("Build")');
      await page.waitForFunction(
        () => window.__debug?.build?.step() === 'shop',
      );
      await settle();
      const id = Number(pickOpt.id.slice(1));
      const t = await B.team();
      const b = [...t.buildings, ...t.stash].find((x) => x.id === id);
      check(
        b !== undefined && b.tier === pickOpt.to,
        `Workshop: building ${id} is now tier ${b?.tier} (was ${pickOpt.from})`,
      );
      await page.click('.topbar-tabs button:has-text("Shop")');
      await page.waitForSelector('#shop-screen');
    } else {
      check(
        goldAfter === goldBefore + income && /skipped/.test(notice),
        `Workshop: nothing affordable, skipped: gold ${goldBefore} -> ${goldAfter}, shop says "${notice.replace(/\s+/g, ' ').trim()}"`,
      );
    }
  };

  // Wall a Barracks in on the Build tab: Ready must be disabled on both tabs
  // with the reason, the building must carry the warning; then open a way out.
  const sealedScenario = async () => {
    const dragPlace = async (def, x, y) => {
      const before = (await B.team()).buildings.length;
      const box = await page
        .locator(`[data-stash-def="${def}"]`)
        .first()
        .boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      const p = await at(x, y);
      await page.mouse.move(p.x, p.y, { steps: 6 });
      await page.mouse.up();
      await page.waitForFunction(
        (n) => window.__debug.build.team().buildings.length > n,
        before,
        { timeout: slow(3000) },
      );
    };
    const toStash = async (b) => {
      const before = (await B.team()).stash.length;
      const p = await at(b.x, b.y);
      await page.mouse.click(p.x, p.y);
      await page.click('[data-action="to-stash"]');
      await page.waitForFunction(
        (n) => window.__debug.build.team().stash.length > n,
        before,
        { timeout: slow(3000) },
      );
    };
    const t = await B.team();
    const pieces = [
      t.buildings.find((b) => b.def === 'bld_barracks'),
      ...t.buildings.filter((b) => b.def === 'bld_wall').slice(0, 3),
      t.buildings.find((b) => b.def === 'bld_turret'),
    ];
    check(
      pieces.every((b) => b !== undefined) && pieces.length === 5,
      'sealed: the board has a Barracks, three walls and a turret to work with',
    );
    const pieceIds = new Set(pieces.map((b) => b.id));
    // Cells that stay blocked: terrain, the Core, other buildings.
    const blocked = new Set();
    const mark = (x, y, w, h) => {
      for (let dx = 0; dx < w; dx++)
        for (let dy = 0; dy < h; dy++) blocked.add(`${x + dx},${y + dy}`);
    };
    mark(t.cores[0].x, t.cores[0].y, 2, 2);
    for (const b of t.buildings)
      if (!pieceIds.has(b.id))
        mark(b.x, b.y, footprints[b.def].width, footprints[b.def].height);
    const terrain = new Set(t.features.map((f) => `${f.x},${f.y}`));
    const nodes = new Set(t.nodes.map((n) => `${n.x},${n.y}`));
    const fp = footprints.bld_barracks;
    // A spot near the top-right corner whose open neighbours fit the pieces.
    let plan = null;
    for (let by = 0; by < t.height - 2 && plan === null; by++) {
      for (let bx = t.width - fp.width; bx >= 0 && plan === null; bx--) {
        const cells = [];
        for (let dx = 0; dx < fp.width; dx++)
          for (let dy = 0; dy < fp.height; dy++) cells.push([bx + dx, by + dy]);
        if (
          cells.some(
            ([x, y]) =>
              x >= t.width ||
              y >= t.height - 1 ||
              blocked.has(`${x},${y}`) ||
              terrain.has(`${x},${y}`) ||
              nodes.has(`${x},${y}`),
          )
        )
          continue;
        const inside = new Set(cells.map(([x, y]) => `${x},${y}`));
        const ring = new Set();
        for (const [x, y] of cells)
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            const k = `${x + dx},${y + dy}`;
            const [nx, ny] = [x + dx, y + dy];
            if (
              inside.has(k) ||
              nx < 0 ||
              ny < 0 ||
              nx >= t.width ||
              ny >= t.height
            )
              continue;
            ring.add(k);
          }
        const open = [...ring].filter(
          (k) => !blocked.has(k) && !terrain.has(k),
        );
        if (open.length <= 4 && open.every((k) => !nodes.has(k))) {
          plan = { bx, by, open: open.map((k) => k.split(',').map(Number)) };
        }
      }
    }
    check(
      plan !== null,
      `sealed: a spot to wall in was found (${JSON.stringify(plan)})`,
    );
    for (const b of pieces) await toStash(b);
    await dragPlace('bld_barracks', plan.bx, plan.by);
    const barracksId = (await B.team()).buildings.find(
      (b) => b.def === 'bld_barracks',
    ).id;
    const fillers = ['bld_wall', 'bld_wall', 'bld_wall', 'bld_turret'];
    check(
      (await page.evaluate(() => window.__debug.build.sealed())).length === 0 &&
        !(await page.locator('#ready-button').isDisabled()),
      'sealed: before the walls are up Ready is enabled',
    );
    for (const [i, [x, y]] of plan.open.entries()) {
      await dragPlace(fillers[i], x, y);
    }
    await page.waitForFunction(() => window.__debug.build.sealed().length > 0);
    await settle();
    const sealedIds = await page.evaluate(() => window.__debug.build.sealed());
    const reason = await page
      .locator('[data-field="ready-blocked"]')
      .innerText();
    check(
      sealedIds.length === 1 &&
        sealedIds[0] === barracksId &&
        (await page.locator('#ready-button').isDisabled()) &&
        /Ready is blocked: Barracks \(column \d+, row \d+\) is walled in\. Open a path/.test(
          reason,
        ) &&
        (await page.locator('#sealed-warning').count()) === 1,
      `sealed: Ready is disabled on the Build tab with the reason ("${reason}"), and the warning line is shown`,
    );
    // The inspector explains it for the selected building.
    const bp = await at(plan.bx, plan.by);
    await page.mouse.click(bp.x, bp.y);
    await page.waitForSelector('[data-field="sealed"]');
    check(
      /Walled in\. Open a path or add a gate\./.test(
        await page.locator('[data-field="sealed"]').innerText(),
      ),
      'sealed: the inspector explains the sealed Barracks',
    );
    await shot('run-8c-sealed-build');
    // The same on the Shop tab.
    await page.click('.topbar-tabs button:has-text("Shop")');
    await page.waitForSelector('#shop-screen');
    await settle();
    const shopReason = await page
      .locator('[data-field="ready-state"]')
      .innerText();
    check(
      (await page.locator('#shop-ready').isDisabled()) &&
        /Ready is blocked: Barracks/.test(shopReason),
      `sealed: Ready is disabled on the Shop tab too ("${shopReason}")`,
    );
    await shot('run-8d-sealed-shop');
    // Open a way out: the turret goes to the stash and back on the front row.
    await page.click('.topbar-tabs button:has-text("Build")');
    await page.waitForFunction(() => window.__debug?.build?.step() === 'shop');
    await settle();
    const tt = await B.team();
    const turret = tt.buildings.find((b) => b.def === 'bld_turret');
    await toStash(turret);
    await page.waitForFunction(
      () => window.__debug.build.sealed().length === 0,
    );
    await settle();
    check(
      !(await page.locator('#ready-button').isDisabled()) &&
        (await page.locator('#sealed-warning').count()) === 0,
      'sealed: with a way out Ready is enabled again and the warning is gone',
    );
    const occupied = new Set(blocked);
    for (const b of (await B.team()).buildings) mark2(occupied, b, footprints);
    let safe = null;
    for (let x = 1; x < t.width - 1 && safe === null; x++) {
      const k = `${x},${t.height - 1}`;
      if (!occupied.has(k) && !terrain.has(k) && !nodes.has(k)) safe = x;
    }
    await dragPlace('bld_turret', safe, t.height - 1);
    check(
      (await page.evaluate(() => window.__debug.build.sealed())).length === 0 &&
        (await B.team()).stash.length === 0,
      'sealed: the turret is back on the board, nothing is sealed and the stash is empty',
    );
  };

  // ---------------------------------------------------------------------
  // Main menu
  await page.setViewportSize({ width: 1920, height: 1080 });
  await goMenu(`?seed=${SEED}`);
  check(
    (await page.locator('#main-menu').count()) === 1 &&
      (await page.locator('#new-run-button').isEnabled()),
    'main menu: New run is available',
  );
  check(
    (await page.evaluate(() => window.__debug.menu.storage())) === 'indexeddb',
    'main menu: runs are saved in IndexedDB',
  );
  check(
    /No saved runs/.test(await page.locator('#main-menu').innerText()) &&
      (await page.locator('#records li').count()) === 4 &&
      (await page.locator('#records').innerText()).split('—').length === 5,
    'main menu: no saved runs yet, and the records are empty',
  );
  check(
    (await page.locator('#main-menu a[href="#debug"]').count()) === 1,
    'main menu: a Developer link reaches the sandbox screens',
  );
  await shot('run-1-main-menu');
  await shotDark('art2-menu');

  // ---------------------------------------------------------------------
  // New run: Core placement
  await page.click('#new-run-button');
  await page.waitForSelector('#core-confirm');
  await page.waitForFunction(() => window.__debug?.placement?.legal);
  await settle();
  const s0 = await R.state();
  check(
    s0.step === 'core_placement' && (await R.screen()) === 'core',
    `new run opens on Core placement (run ${s0.runId})`,
  );
  const runA = s0.runId;
  const bar0 = await page.locator('#run-bar').innerText();
  check(
    /Round 1/.test(bar0) &&
      /Lives 5 \/ 5/.test(bar0) &&
      !/Gold/.test(bar0) &&
      (await page.locator('#menu-button').count()) === 1 &&
      /Place the Core/.test(await page.locator('.topbar-title').innerText()),
    `top bar: round, lives (no gold before the kit) and Menu ("${bar0.replace(/\s+/g, ' ')}"), the step in the title`,
  );
  check(
    await page.locator('#core-confirm').isDisabled(),
    'Core placement: Confirm is disabled until a position is chosen',
  );
  const legal = await page.evaluate(() => window.__debug?.placement?.legal());
  const legalKey = new Set(legal.map((c) => `${c.x},${c.y}`));
  const bt = await page.evaluate(() => ({
    w: window.__debug?.placement?.legal().length,
  }));
  check(bt.w > 10, `Core placement: ${bt.w} legal positions are marked`);
  // An illegal cell: the last column (the Core would hang off the board).
  const bad = (() => {
    for (let x = 23; x >= 0; x--)
      for (let y = 15; y >= 0; y--)
        if (!legalKey.has(`${x},${y}`)) return { x, y };
    return null;
  })();
  const pBad = await page.evaluate(
    ([x, y]) => window.__debug?.placement?.cellToScreen(x, y),
    [bad.x, bad.y],
  );
  await page.mouse.move(pBad.x, pBad.y);
  await settle();
  const badHint = await page.locator('#core-hint').innerText();
  check(
    /edge|water|cliff|node|front|area/i.test(badHint),
    `Core placement: an illegal cell is explained in words ("${badHint}")`,
  );
  await page.mouse.click(pBad.x, pBad.y);
  await settle();
  check(
    (await page.locator('#core-confirm').isDisabled()) &&
      (await page.evaluate(() => window.__debug?.placement?.selected())) ===
        null,
    'Core placement: an illegal cell cannot be chosen, Confirm stays disabled',
  );
  await shot('run-2-core-illegal');
  // Water: also explained.
  const water = await page.evaluate(() => {
    const t = window.__debug.placement;
    return t.legal().length;
  });
  void water;
  const pick = legal[Math.floor(legal.length / 2)];
  const pGood = await page.evaluate(
    ([x, y]) => window.__debug?.placement?.cellToScreen(x, y),
    [pick.x, pick.y],
  );
  await page.mouse.move(pGood.x, pGood.y);
  await settle();
  check(
    (await page.evaluate(() => window.__debug?.placement?.pathCount())) > 0,
    'Core placement: the routes enemy units would take are shown for a legal position',
  );
  // After the illegal click, the hint follows the pointer to a legal cell.
  const goodHint = await page.locator('#core-hint').innerText();
  check(
    /fits here/i.test(goodHint) &&
      !/edge|water|cliff|node|front|area/i.test(goodHint),
    `Core placement: the hint over a legal cell is not stale after an illegal click ("${goodHint}")`,
  );
  await page.mouse.click(pGood.x, pGood.y);
  await settle();
  check(
    !(await page.locator('#core-confirm').isDisabled()) &&
      JSON.stringify(
        await page.evaluate(() => window.__debug?.placement?.selected()),
      ) === JSON.stringify(pick),
    `Core placement: choosing a legal position enables Confirm (${pick.x}, ${pick.y})`,
  );
  await shot('run-3-core-selected');
  await shotDark('art2-core-placement');
  await checkAt1366(
    'Core placement',
    ['#core-confirm'],
    'run-3-core-placement-1366x768',
  );
  await reloadSame('Core placement');

  // Confirm: Core placed, cannot be moved.
  await page.waitForSelector('#core-confirm');
  await settle();
  const pPick = await page.evaluate(
    ([x, y]) => window.__debug?.placement?.cellToScreen(x, y),
    [pick.x, pick.y],
  );
  await page.mouse.click(pPick.x, pPick.y);
  await settle();
  await page.click('#core-confirm');
  await waitStep('build');
  await page.waitForFunction(() => window.__debug?.build?.step() === 'build');
  await settle();
  const t1 = await B.team();
  check(
    t1.cores[0].x === pick.x && t1.cores[0].y === pick.y,
    `Core confirmed at (${pick.x}, ${pick.y}); the first build opens`,
  );
  check(
    (await page.locator('#panel-core').count()) === 0 && t1.stash.length >= 4,
    `first build: the starting kit is in the stash (${t1.stash.length} buildings)`,
  );
  // The Core cannot be moved: drag it somewhere else.
  const actions0 = (await R.state()).actions;
  const pc = await at(t1.cores[0].x, t1.cores[0].y);
  const pTo = await at(t1.cores[0].x + 3, Math.max(0, t1.cores[0].y - 2));
  await page.mouse.move(pc.x, pc.y);
  await page.mouse.down();
  await page.mouse.move(pTo.x, pTo.y, { steps: 6 });
  await page.mouse.up();
  await frames(page, 6);
  await page.keyboard.press('Escape');
  const t1b = await B.team();
  check(
    t1b.cores[0].x === pick.x &&
      t1b.cores[0].y === pick.y &&
      (await R.state()).actions === actions0,
    'the Core cannot be moved after it is confirmed (a drag changes nothing)',
  );
  check(
    (await page.locator('.topbar-tabs button').count()) === 0 &&
      (await page.locator('.topbar-tabs .phase-label').allInnerTexts())
        .join()
        .toLowerCase() === 'build',
    'first build: only a plain Build label, no tab buttons (there is no shop yet)',
  );
  await shot('run-4-first-build');
  const left = await placeKit();
  check(
    left === 0,
    `first build: the starting kit is placed on the board (${left} left in the stash)`,
  );
  {
    // The static sprite layer is rebuilt by an edit (place, rotate, undo) and
    // never by hovering.
    const builds = async () => {
      await frames(page, 15);
      return await page.evaluate(() => window.__debug.sprites().layerBuilds);
    };
    const t0 = await B.team();
    const last = t0.buildings[t0.buildings.length - 1];
    let n = await builds();
    await page.click('[data-action="undo"]');
    let m = await builds();
    check(m > n, `layer: undo rebuilds the static layer (${n} -> ${m})`);
    n = m;
    const box = await page
      .locator(`[data-stash-def="${last.def}"]`)
      .first()
      .boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    const dst = await at(last.x, last.y);
    await page.mouse.move(dst.x, dst.y, { steps: 6 });
    await page.mouse.up();
    m = await builds();
    check(m > n, `layer: placing rebuilds the static layer (${n} -> ${m})`);
    n = m;
    await page.mouse.click(dst.x, dst.y);
    await page.click('[data-action="rotate"]');
    m = await builds();
    check(m > n, `layer: rotating rebuilds the static layer (${n} -> ${m})`);
    n = m;
    for (let i = 0; i < 6; i++) {
      await page.mouse.move(dst.x + 40 + i * 9, dst.y + 30 + i * 7, {
        steps: 3,
      });
    }
    m = await builds();
    check(
      m === n,
      `layer: hovering does not rebuild the static layer (${n} -> ${m})`,
    );
  }
  await reloadSame('the first Build screen');
  await shotDark('art2-build-factory');
  {
    const art = await page.evaluate(() => window.__debug.sprites?.() ?? null);
    check(
      art !== null &&
        art.state === 'ready' &&
        art.spriteFrames > 0 &&
        art.drawn > 0,
      `first build: the board is drawn from the atlas (${JSON.stringify(art)})`,
    );
  }
  await checkAt1366(
    'first build',
    ['#ready-button', '#panel-stash', '#panel-tools', '#panel-inspector'],
    'run-4-first-build-1366x768',
  );
  const placedCount = (await B.team()).buildings.length;
  check(placedCount >= 4, `placed buildings survive a reload (${placedCount})`);

  // ---------------------------------------------------------------------
  // Round 1
  const clickReady = async () => {
    await page.click('#ready-button');
  };
  await clickReady();
  await waitStep('pve_choice');
  await page.waitForSelector('#pve-choice');
  await settle();
  const cards = page.locator('.pve-card');
  check((await cards.count()) === 3, 'PvE choice: three cards');
  const cardTexts = await cards.allInnerTexts();
  check(
    cardTexts.every(
      (t) =>
        /Easy|Medium|Hard/.test(t) &&
        /Threat/i.test(t) &&
        /\+\d+ gold/.test(t) &&
        /Core \d+ health/.test(t),
    ),
    'PvE choice: each card has difficulty, threat and a gold reward',
  );
  check(
    (
      await page.locator('.pve-card [data-field="archetype"]').allInnerTexts()
    ).every((a) => /^[A-Z][a-z]+$/.test(a.trim())) &&
      (
        await page
          .locator('.pve-card [data-field="description"]')
          .allInnerTexts()
      ).every((d) => d.trim().length > 20),
    'PvE choice: archetype names and plain-language descriptions (no ids)',
  );
  const overloadLines = await page
    .locator('.pve-card [data-field="overload"]')
    .allInnerTexts();
  check(
    overloadLines.length === 3 &&
      overloadLines.every((t) =>
        /^At 3:00 both Cores start losing health \(Overload\)\. (Theirs falls first, at \d+:\d\d|Yours falls first, at \d+:\d\d|Both fall at \d+:\d\d|Neither falls before the time limit)/.test(
          t.trim(),
        ),
      ) &&
      !(await page.locator('#pve-choice').innerText()).includes(
        'Destroy the stronghold before Overload',
      ),
    `PvE choice: every card states which Core Overload destroys first ("${overloadLines[0]}")`,
  );
  check(
    /no life/.test(await page.locator('.choice-banner').innerText()),
    'PvE choice: the stakes of losing are stated',
  );
  check(
    /Pick an opponent/.test(
      await page.locator('[data-field="choice-prompt"]').innerText(),
    ) &&
      (await page.locator('.pve-card [data-field="fight"]').allInnerTexts())
        .length === 3,
    'PvE choice: says what to do and each card has a Fight button look',
  );
  await shot('run-5-pve-choice');
  await shotDark('art2-pve-choice');
  await reloadSame('PvE choice');
  await page.click('[data-action="choose"][data-difficulty="easy"]');
  await waitStep('pve_summary');

  // Battle: reload while playing resumes it. Wait until a position past a
  // few seconds of playback has really been stored, pause so it cannot move,
  // reload, and read the tick the moment the battle is mounted again: playing
  // from zero cannot have got there yet.
  const storedTick = () =>
    page.evaluate(() => {
      let best = 0;
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k !== null && k.startsWith('coop:tick:')) {
          best = Math.max(best, Number(window.localStorage.getItem(k)) || 0);
        }
      }
      return best;
    });
  const tps = 10;
  await page.waitForFunction(
    () => (window.__debug?.battle?.tick?.() ?? 0) > 6,
    null,
    { timeout: slow(20000) },
  );
  await page.waitForFunction(
    (n) => {
      let best = 0;
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k !== null && k.startsWith('coop:tick:')) {
          best = Math.max(best, Number(window.localStorage.getItem(k)) || 0);
        }
      }
      return best >= n;
    },
    tps * 6,
    { timeout: slow(40000) },
  );
  await page.click('#pause');
  await page.waitForFunction(() => window.__debug?.battle?.paused());
  const tickBefore = await page.evaluate(() => window.__debug.battle.tick());
  // Pausing stores the position; wait for the stored value to match it.
  await page.waitForFunction(
    (t) => {
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (
          k !== null &&
          k.startsWith('coop:tick:') &&
          Number(window.localStorage.getItem(k)) === t
        ) {
          return true;
        }
      }
      return false;
    },
    tickBefore,
    { timeout: slow(10000) },
  );
  const stored = await storedTick();
  await page.reload();
  await page.waitForFunction(() => window.__debug?.battle?.tick);
  const tickAfter = await page.evaluate(() => window.__debug.battle.tick());
  check(
    (await R.state()).step === 'pve_summary' &&
      stored >= tps * 6 &&
      tickAfter >= stored,
    `battle: a reload mid-battle resumes at the stored position (stored ${stored}, resumed at ${tickAfter}, before ${tickBefore})`,
  );
  const topbar = await page.locator('.topbar').innerText();
  check(
    /Round 1/.test(topbar) && /Lives 5 \/ 5/.test(topbar),
    'battle: the run bar is on the battle screen too',
  );
  await page.click('#skip');
  await page.waitForFunction(
    () => window.__debug?.battle?.phase() === 'summary',
  );
  check(
    await page.evaluate(
      () =>
        window.__debug.battle.storedEventLogHash() ===
        window.__debug.battle.eventLogHash(),
    ),
    'battle: the replayed battle hashes to the result the run stored',
  );
  const reward = await page.locator('[data-field="reward"]').innerText();
  check(
    /gold|No reward/.test(reward),
    `battle summary: the reward is stated ("${reward}")`,
  );
  check(
    !(await page.locator('#watch-again').isDisabled()),
    'battle summary: Watch again is available',
  );
  check(
    /^Continue/.test(await page.locator('#battle-ready').innerText()) &&
      (await page.locator('#panel-enemy [data-field="opp-kind"]').count()) ===
        0,
    'battle summary: the button says Continue; no duplicate opponent tag',
  );
  await shot('run-6-battle-summary');
  await reloadSame('the battle summary');
  await page.waitForFunction(
    () => window.__debug?.battle?.phase() === 'summary',
  );
  const goldBeforeReady = (await R.state()).gold;
  await page.click('#battle-ready');
  await waitStep('event_choice');
  await page.waitForSelector('#event-choice');
  await settle();
  check(
    (await R.state()).gold >= goldBeforeReady,
    'continuing from the summary pays the reward',
  );

  // Event
  const header = await page.locator('#battle-result').innerText();
  check(
    /^Stronghold battle (won|lost) · (Easy|Medium|Hard) · \w+/.test(header) &&
      /gold|No reward/.test(header),
    `event: opens with the battle just fought and what it paid ("${header.replace(/\s+/g, ' ')}")`,
  );
  const eventCards = page.locator('.event-card');
  const nCards = await eventCards.count();
  check(
    nCards >= 1 && nCards <= 3,
    `event: ${nCards} event card(s) offered (1 to 3 is valid)`,
  );
  const evTexts = await page
    .locator('.event-card [data-field="does"]')
    .allInnerTexts();
  check(
    evTexts.every((t) => t.trim().length > 3 && !/evt_|mod_/.test(t)),
    'event: every card says what it does in words',
  );
  await shot('run-7-event-choice');
  await shotDark('art2-event');
  await reloadSame('the event choice');
  // Prefer an event with a follow-up.
  const offers = await page
    .locator('.event-card')
    .evaluateAll((els) =>
      els.map((e) => ({ id: e.dataset.offer, type: e.dataset.type })),
    );
  const withFollow =
    offers.find((o) => o.type === 'workshop') ??
    offers.find((o) => o.type === 'shrine') ??
    offers[0];
  await page.click(
    `[data-action="choose-event"][data-offer="${withFollow.id}"]`,
  );
  await page.waitForFunction(() =>
    ['event_resolve', 'shop'].includes(window.__debug?.run?.state().step),
  );
  if ((await R.state()).step === 'event_resolve') {
    await page.waitForSelector('#event-resolve');
    await settle();
    const nOpts = await page.locator('#event-resolve .event-card').count();
    const resolveText = await page.locator('#event-resolve').innerText();
    check(
      nOpts >= 1 &&
        !/mod_|bld_/.test(resolveText) &&
        (withFollow.type === 'shrine'
          ? /\+\d+%/.test(resolveText)
          : /Tier \d → \d/.test(resolveText) &&
            /\d+ gold/.test(resolveText) &&
            /Board \(\d+, \d+\)|Stash/.test(resolveText)),
      `event follow-up (${withFollow.type}): ${nOpts} option(s) with their effects spelled out`,
    );
    await shot('run-8-event-follow-up');
    await reloadSame('the event follow-up');
    const goldBefore = (await R.state()).gold;
    if (withFollow.type === 'workshop') {
      await runWorkshop(goldBefore);
    } else {
      await page.click(
        '#event-resolve [data-action="choose-option"]:not([disabled])',
      );
      await waitStep('shop');
    }
  } else {
    check(
      true,
      `event: ${withFollow.type} resolved at once (no follow-up to choose)`,
    );
  }

  // Shop: buy one thing, reload.
  await page.waitForSelector('#shop-screen');
  await settle();
  const g0 = Number(await page.locator('#gold').getAttribute('data-gold'));
  const buy = page
    .locator('#offers [data-action="buy"]:not([disabled])')
    .first();
  if ((await buy.count()) > 0) {
    const stash0 = (await page.evaluate(() => window.__debug.shop.state()))
      .stash.length;
    await buy.click();
    await page.waitForFunction(
      (n) => window.__debug.shop.state().stash.length === n,
      stash0 + 1,
    );
    check(
      Number(await page.locator('#gold').getAttribute('data-gold')) < g0,
      'shop: a purchase pays gold and lands in the stash',
    );
  } else {
    check(true, `shop: nothing affordable at ${g0} gold`);
  }
  check(
    (await page.locator('.topbar-tabs button').allInnerTexts()).join() ===
      'Shop,Build',
    'shop step: Shop and Build are two tabs of one step',
  );
  await reloadSame('the shop');
  // Build tab: placing the purchase.
  await page.click('.topbar-tabs button:has-text("Build")');
  await page.waitForFunction(() => window.__debug?.build?.step() === 'shop');
  await settle();
  await page.waitForFunction(
    () => window.__debug?.run?.screen() === 'shop_build',
  );
  check(
    (await R.screen()) === 'shop_build' &&
      (await page.locator('#run-bar').count()) === 1,
    'shop step: the Build tab shows on the same run',
  );
  await placeKit();
  await sealedScenario();
  await page.click('.topbar-tabs button:has-text("Shop")');
  await page.waitForSelector('#shop-screen');
  await shot('run-9-shop');
  await shotDark('art2-shop');
  {
    const shopText = await page.locator('#shop-screen').innerText();
    check(
      /Opponent: ghost of Bundled \w+ bot/.test(shopText) &&
        /Lose: -1 life/.test(shopText),
      'shop (before the PvP battle): the opponent is a bundled ghost, and a loss costs 1 life',
    );
  }
  await page.click('#shop-ready');
  await waitStep('pvp_summary');

  // PvP battle against a bundled ghost (a fresh install has no local ones).
  await page.waitForFunction(() => window.__debug?.battle?.phase, null, {
    timeout: slow(20000),
  });
  const vs = await page.locator('[data-field="vs"]').innerText();
  check(
    /Bundled \w+ bot/.test(vs),
    `PvP battle: the opponent is a bundled ghost ("${vs}")`,
  );
  {
    const scene = await page.evaluate(() => window.__debug.battle.scene());
    check(
      scene[1].buildings > 0,
      `PvP battle: the ghost's factory is on the field (${scene[1].buildings} buildings)`,
    );
  }
  await page.click('#skip');
  await page.waitForFunction(
    () => window.__debug?.battle?.phase() === 'summary',
  );
  const pvpReward = await page.locator('[data-field="reward"]').innerText();
  const pvpWon =
    (await page.locator('[data-field="result-word"]').innerText()) ===
    'Victory';
  check(
    pvpWon ? /gold/.test(pvpReward) : /life/.test(pvpReward),
    `PvP summary: ${pvpWon ? 'a win pays gold' : 'a loss states the life it costs'} ("${pvpReward}")`,
  );
  const lives0 = (await R.state()).lives;
  await page.click('#battle-ready');
  await waitStep('event_choice');
  await page.waitForSelector('#event-choice');
  const livesNow = (await R.state()).lives;
  check(
    pvpWon ? livesNow === lives0 : livesNow === lives0 - 1,
    `PvP result applied: lives ${lives0} -> ${livesNow}`,
  );
  const header2 = await page.locator('#battle-result').innerText();
  check(
    /^Rival party battle (won|lost) · vs\. Bundled \w+ bot/.test(header2),
    `event (after PvP): the header shows the PvP result ("${header2.replace(/\s+/g, ' ')}")`,
  );

  // The player-facing steps at the other size: no horizontal scroll.
  await page.setViewportSize({ width: 1366, height: 768 });
  await settle();
  const sc = await noHScroll(1366);
  check(sc.ok, `event screen: no horizontal scroll at 1366x768 (${sc.sw})`);
  await shot('run-10-event-1366x768');
  await shotDark('art2-event-1366x768');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await settle();

  // Finish round 1: event, shop, ready.
  const advance = async () => {
    const step = (await R.state()).step;
    switch (step) {
      case 'core_placement':
        throw new Error('unexpected core_placement');
      case 'build':
        await page.waitForSelector('#ready-button');
        await page.click('#ready-button');
        break;
      case 'pve_choice':
        await page.waitForSelector('[data-action="choose"]');
        await page.click('[data-action="choose"][data-difficulty="easy"]');
        break;
      case 'pve_summary':
      case 'pvp_summary': {
        await page.waitForFunction(() => window.__debug?.battle?.phase, null, {
          timeout: slow(20000),
        });
        if (
          (await page.evaluate(() => window.__debug.battle.phase())) ===
          'playing'
        ) {
          await page.click('#skip');
        }
        await page.waitForFunction(
          () => window.__debug?.battle?.phase() === 'summary',
        );
        await page.click('#battle-ready');
        break;
      }
      case 'event_choice':
        await page.waitForSelector('[data-action="choose-event"]');
        await page.click('[data-action="choose-event"]');
        break;
      case 'event_resolve': {
        await page.waitForSelector('[data-action="choose-option"]');
        const skip = page.locator(
          '[data-action="choose-option"][data-option="skip"]',
        );
        await page.click(
          (await skip.count()) > 0
            ? '[data-action="choose-option"][data-option="skip"]'
            : '[data-action="choose-option"]:not([disabled])',
        );
        break;
      }
      case 'shop':
        await page.waitForSelector('#shop-ready');
        await page.click('#shop-ready');
        break;
      default:
        throw new Error(`cannot advance from ${step}`);
    }
    await page.waitForFunction(
      ([s, a]) => {
        const st = window.__debug?.run?.state();
        return st !== undefined && (st.step !== s || st.actions !== a);
      },
      [step, (await R.state()).actions],
    );
    await settle();
  };
  const advanceUntil = async (pred, limit = 60) => {
    for (let i = 0; i < limit; i++) {
      const s = await R.state();
      if (pred(s)) return s;
      await advance();
    }
    throw new Error('advanceUntil: limit reached');
  };
  const atRound2Choice = await advanceUntil(
    (s) => s.round === 2 && s.step === 'pve_choice',
  );
  check(
    /Round 2/.test(await page.locator('#run-bar').innerText()),
    'round 1 is complete: round 2 opens on the PvE choice',
  );
  void atRound2Choice;

  // ---------------------------------------------------------------------
  // Leave for the menu; a second run alongside the first
  await page.click('#menu-button');
  await page.waitForSelector('#main-menu');
  await page.waitForSelector(`#run-list [data-run="${runA}"]`);
  await settle();
  const rowA = await page.locator(`[data-run="${runA}"]`).innerText();
  check(
    /Round 2/.test(rowA) &&
      /Lives \d \/ 5/.test(rowA) &&
      /Choose a Stronghold battle/.test(rowA) &&
      /Last played just now/.test(rowA),
    `main menu: the saved run shows round, lives, step and when it was played ("${rowA.replace(/\s+/g, ' ')}")`,
  );
  await page.goto(`${baseUrl}#/?seed=${SEED}`);
  await page.waitForSelector('#new-run-button');
  await page.click('#new-run-button');
  await page.waitForSelector('#core-confirm');
  await page.waitForFunction(() => window.__debug?.run?.state);
  const runB = (await R.state()).runId;
  check(runB !== runA, `a second run was started (${runB})`);
  // Place its Core, then back to the menu.
  await page.waitForFunction(() => window.__debug?.placement?.legal);
  const pickB = (
    await page.evaluate(() => window.__debug?.placement?.legal())
  )[3];
  const pB = await page.evaluate(
    ([x, y]) => window.__debug?.placement?.cellToScreen(x, y),
    [pickB.x, pickB.y],
  );
  await page.mouse.click(pB.x, pB.y);
  await page.click('#core-confirm');
  await waitStep('build');
  // The first run left its round-1 snapshot in the local ghost pool (W3-1),
  // beside the bundled ones (W3-2): this run meets one of them in the shop
  // before its own round-1 PvP battle.
  await advanceUntil((s) => s.step === 'shop' && s.leg === 'pve');
  const ghostState = await R.state();
  check(
    ghostState.pvpOpponent?.kind === 'ghost' &&
      ghostState.pvpOpponent.round === ghostState.round &&
      /^(Runner |Bundled )/.test(ghostState.pvpOpponent.label),
    `second run: the PvP opponent is a ghost of round ${ghostState.round} (${JSON.stringify(ghostState.pvpOpponent)})`,
  );
  await page.waitForSelector('#shop-screen');
  check(
    /Opponent: ghost of (Runner|Bundled)/.test(
      await page.locator('#shop-screen').innerText(),
    ),
    'shop: "Opponent: ghost of ..." is shown before the PvP battle',
  );
  {
    // The first run's snapshot is in this browser's own pool (#111): the
    // opponent check above also passes with a bundled ghost, this does not.
    await hookReady(page, 'ghostPool');
    const mine = await page.evaluate(() =>
      window.__debug.ghostPool.local(1, 1),
    );
    check(
      mine.some((g) => g.runId === runA && g.ownerId.startsWith('dev-')),
      `second run: the local ghost pool holds the first run's round-1 snapshot (${JSON.stringify(mine)})`,
    );
  }
  await reloadSame('the shop with a ghost opponent');
  check(
    JSON.stringify((await R.state()).pvpOpponent) ===
      JSON.stringify(ghostState.pvpOpponent),
    'a reload before the battle keeps the selected ghost',
  );
  await page.click('#menu-button');
  await page.waitForSelector('#main-menu');
  await page.waitForFunction(() => window.__debug?.menu?.runIds().length === 2);
  await page.reload();
  await page.waitForSelector('#main-menu');
  await page.waitForFunction(() => window.__debug?.menu?.runIds().length === 2);
  const ids = await page.evaluate(() => window.__debug.menu.runIds());
  check(
    ids.length === 2 &&
      new Set(ids).size === 2 &&
      ids.includes(runA) &&
      ids.includes(runB),
    'main menu: two saved runs at once, each listed once, after a reload',
  );
  await shot('run-11-main-menu-two-runs');

  // A save from an older major version and a damaged one.
  await page.evaluate(
    async ([from, to]) => {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open('coop-autobattler', 1);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      const rec = await new Promise((res) => {
        const r = db.transaction('saves').objectStore('saves').get(from);
        r.onsuccess = () => res(r.result);
      });
      const old = JSON.parse(JSON.stringify(rec));
      old.runId = to;
      old.runVersion = '0.9';
      old.createArgs.runId = to;
      old.createArgs.runVersion = '0.9';
      old.state.runId = to;
      old.state.runVersion = '0.9';
      await new Promise((res) => {
        const tx = db.transaction('saves', 'readwrite');
        tx.objectStore('saves').put(old, to);
        tx.objectStore('saves').put({ runId: 'broken' }, 'broken');
        tx.oncomplete = res;
      });
      db.close();
    },
    [runA, 'old-version-run'],
  );
  await page.reload();
  await page.waitForSelector('#main-menu');
  // The save of the older major version is wiped at start-up, with a notice;
  // the damaged one (no readable version) stays and is listed.
  await page.waitForFunction(() => window.__debug?.menu?.runIds().length === 3);
  check(
    (await page.locator('#main-menu').innerText()).match(
      /from an older version of the game was removed/i,
    ) !== null &&
      (await page.locator('[data-run="old-version-run"]').count()) === 0,
    'main menu: a run saved by an older major version was removed at start-up, with a notice',
  );
  const damaged = await page.locator('[data-run="broken"]').innerText();
  check(
    /damaged/i.test(damaged),
    'main menu: a damaged saved run is listed with a plain message',
  );
  await page.click('[data-run="broken"] [data-action="discard"]');
  await page.click('[data-run="broken"] [data-action="discard-confirm"]');
  await page.waitForFunction(() => window.__debug?.menu?.runIds().length === 2);
  check(true, 'main menu: the damaged run was discarded on purpose');

  // Two tabs on one run: the other tab's move stops this one.
  await page.click(`[data-run="${runA}"] [data-action="resume"]`);
  await waitStep('pve_choice');
  const tab2 = await context.newPage();
  tab2.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  await tab2.goto(`${baseUrl}#run/${encodeURIComponent(runA)}`);
  await tab2.waitForFunction(() => window.__debug?.run?.state);
  await tab2.click('[data-action="choose"][data-difficulty="medium"]');
  await waitStep('pve_summary', tab2);
  await page.waitForSelector('#run-conflict', { timeout: slow(8000) });
  check(
    /changed in another tab/i.test(
      await page.locator('.run-blocked').first().innerText(),
    ),
    'a run changed in another tab shows "This run changed in another tab" here',
  );
  await tab2.close();
  await page.click('#run-reload');
  await page.waitForFunction(
    () => window.__debug?.run?.state().step === 'pve_summary',
  );
  await page.waitForFunction(() => window.__debug?.run?.screen() === 'battle');
  check(
    (await R.screen()) === 'battle',
    "Reload brings the tab to the other tab's progress (the battle summary)",
  );
  // Resume straight to the current step from the list.
  await page.click('#menu-button');
  await page.waitForSelector('#main-menu');
  await page.click(`[data-run="${runA}"] [data-action="resume"]`);
  await page.waitForFunction(
    () => window.__debug?.run?.state().step === 'pve_summary',
  );
  await page.waitForFunction(() => window.__debug?.run?.screen() === 'battle');
  check(
    (await R.state()).runId === runA && (await R.screen()) === 'battle',
    "Resume goes straight to the run's current step",
  );

  // ---------------------------------------------------------------------
  // Round 2, complete: two full rounds played.
  await advanceUntil((s) => s.round === 3 && s.step === 'pve_choice');
  const afterTwo = await R.state();
  check(
    afterTwo.round === 3,
    `two full rounds played through the real flow (now round ${afterTwo.round}, ${afterTwo.lives} lives)`,
  );

  // ---------------------------------------------------------------------
  // Abandon run B from the list: the same Run over screen.
  await page.click('#menu-button');
  await page.waitForSelector('#main-menu');
  await page.click(`[data-run="${runB}"] [data-action="abandon"]`);
  check(
    /Abandon this run\?/.test(
      await page.locator(`[data-run="${runB}"]`).innerText(),
    ),
    'abandoning asks for confirmation first',
  );
  await page.click(`[data-run="${runB}"] [data-action="abandon-cancel"]`);
  check(
    (await page.locator(`[data-run="${runB}"]`).count()) === 1,
    'cancelling keeps the run',
  );
  await page.click(`[data-run="${runB}"] [data-action="abandon"]`);
  await page.click(`[data-run="${runB}"] [data-action="abandon-confirm"]`);
  await page.waitForSelector('#run-over');
  await settle();
  const over = await page.locator('#run-over').innerText();
  check(
    /Reached round 1/.test(over) &&
      /abandoned/.test(over) &&
      (await page.locator('#final-factory canvas').count()) === 1 &&
      /Round by round/i.test(over),
    'abandoning from the menu ends on the Run over screen (depth, final factory, history)',
  );
  await shot('run-13-run-over-abandoned');
  await reloadSame('the Run over screen');
  await page.waitForSelector('#run-over');
  await page.click('#over-menu');
  await page.waitForSelector('#main-menu');
  await page.waitForFunction(() => window.__debug?.menu?.runIds().length === 1);
  check(
    (await page.locator(`[data-run="${runB}"]`).count()) === 0 &&
      (await page.locator(`[data-run="${runA}"]`).count()) === 1,
    'main menu: the abandoned run left the saved runs; the other stays',
  );
  const records = await page.locator('#records').innerText();
  check(
    /1 player\s+round 2/.test(records),
    `records: the abandoned run's depth is kept ("${records.replace(/\s+/g, ' ')}")`,
  );

  // ---------------------------------------------------------------------
  // Play run A to its end: lives reach 0 against the boss.
  await page.click(`[data-run="${runA}"] [data-action="resume"]`);
  await waitStep('pve_choice');
  const roundsBefore = (await R.state()).round;
  // A battle whose playback fails (debug option) still lets the run go on:
  // the screen says so, states the recorded result and Continue advances the
  // run exactly as after a watched battle.
  {
    await page.evaluate(() =>
      localStorage.setItem('coop-autobattler:debug-fail-playback', '1'),
    );
    await advance(); // PvE choice -> the battle summary step
    await waitStep('pve_summary');
    await page.waitForSelector('#battle-cannot-show');
    const panel = await page.locator('#battle-cannot-show').innerText();
    const before = await R.state();
    check(
      /could not be displayed/i.test(panel) &&
        /Cannot play/.test(panel) &&
        /Result:\s*(Victory|Defeat)/.test(panel) &&
        (await page.locator('#battle-continue').count()) === 1,
      `forced playback failure: says so, states the recorded result, offers Continue ("${panel.replace(/\s+/g, ' ').slice(0, 160)}")`,
    );
    check(
      (await page.evaluate(() => window.__debug?.battle?.phase)) === undefined,
      'forced playback failure: no playback is mounted',
    );
    await page.evaluate(() =>
      localStorage.removeItem('coop-autobattler:debug-fail-playback'),
    );
    await page.click('#battle-continue');
    await waitStep('event_choice');
    await page.waitForSelector('#event-choice');
    const after = await R.state();
    check(
      after.step === 'event_choice' &&
        after.round === before.round &&
        after.gold >= before.gold &&
        after.lives <= before.lives,
      `forced playback failure: Continue advances the run like a watched battle (step ${before.step} -> ${after.step}, gold ${before.gold} -> ${after.gold}, lives ${before.lives} -> ${after.lives})`,
    );
  }
  // Debug option: the boss for every battle from here on (the pool holds no
  // ghost for the later rounds of a real install either).
  await page.evaluate(() =>
    localStorage.setItem('coop-autobattler:debug-force-opponent', 'boss'),
  );
  let ended = false;
  let livesSeen = (await R.state()).lives;
  let bossShops = 0;
  for (let i = 0; i < 90 && !ended; i++) {
    const s = await R.state().catch(() => null);
    if (s === null) break;
    if (s.step === 'run_over') {
      ended = true;
      break;
    }
    if (s.lives < livesSeen) {
      check(
        s.lives === livesSeen - 1,
        `lives drop by exactly one per loss (${livesSeen} -> ${s.lives})`,
      );
    }
    livesSeen = s.lives;
    if (s.step === 'shop' && s.leg === 'pve' && s.pvpOpponent !== null) {
      await page.waitForSelector('#shop-screen');
      const t = await page.locator('#shop-screen').innerText();
      if (s.pvpOpponent.kind === 'boss') {
        bossShops++;
        check(
          /Opponent: the boss/.test(t) && /Lose: -1 life/.test(t),
          `shop (round ${s.round}): the boss is announced before the battle, a loss costs 1 life`,
        );
      }
    }
    await advance().catch(async (e) => {
      // The last battle's Ready can end the run: the screen is then Run over.
      if (!(await page.locator('#run-over').count())) throw e;
    });
    if ((await page.locator('#run-over').count()) > 0) ended = true;
  }
  check(ended, 'the run ends when its lives reach 0 against the boss');
  check(bossShops >= 1, `the forced boss was met (${bossShops} shops)`);
  await page.waitForSelector('#run-over');
  await settle();
  const final = await page.locator('#run-over').innerText();
  const reached = Number(
    (await page.locator('#reached').getAttribute('data-round')) ?? 0,
  );
  const rows = await page.locator('#round-table tbody tr').count();
  check(
    reached >= 3 &&
      rows >= 3 &&
      /Your last life was lost/.test(final) &&
      /Lives lost\s+5/.test(final),
    `Run over: reached round ${reached}, ${rows} rounds in the table, all 5 lives lost`,
  );
  check(
    (await page.locator('#best').getAttribute('data-new-best')) === 'true' &&
      /New best/.test(await page.locator('#best').innerText()),
    `Run over: a new best is flagged ("${await page.locator('#best').innerText()}")`,
  );
  {
    const pvpCells = await page
      .locator('#round-table tbody tr td:nth-child(4)')
      .allInnerTexts();
    const pvpResults = await page
      .locator('#round-table tbody tr td:nth-child(5)')
      .allInnerTexts();
    check(
      pvpCells.some((t) => /^Ghost · Bundled \w+ bot \(bundled\)$/.test(t)) &&
        pvpCells.some((t) => /^the boss/.test(t)),
      `Run over: the table names each round's opponent, a bundled ghost and the boss (${pvpCells.join(' | ')})`,
    );
    check(
      pvpResults.filter((r) => r === 'lost').length === 5,
      `Run over: 5 lost PvP battles for 5 lives (${pvpResults.join(', ')})`,
    );
  }
  await page.evaluate(() =>
    localStorage.removeItem('coop-autobattler:debug-force-opponent'),
  );
  check(
    /Rival party battles/.test(final) &&
      /Stronghold battles/.test(final) &&
      /vs\. bosses/.test(final),
    'Run over: battle records',
  );
  await shot('run-14-run-over');
  await page.setViewportSize({ width: 1366, height: 768 });
  await settle();
  const sc2 = await noHScroll(1366);
  check(sc2.ok, `Run over: no horizontal scroll at 1366x768 (${sc2.sw})`);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await settle();
  {
    // A finished run has no live state: compare what the screen shows.
    const before = await page.locator('#run-over').innerText();
    await page.reload();
    await page.waitForSelector('#run-over');
    await settle();
    check(
      (await page.locator('#run-over').innerText()) === before,
      'reload at Run over after defeat: same screen and same summary',
    );
  }
  void roundsBefore;

  // New run from the run-over screen goes to Core placement.
  await page.click('#over-new-run');
  await page.waitForSelector('#core-confirm');
  await waitStep('core_placement');
  check(
    (await R.state()).step === 'core_placement' &&
      (await R.state()).runId !== runA,
    'Run over: New run starts a fresh run',
  );
  await page.click('#menu-button');
  await page.waitForSelector('#main-menu');
  await page.waitForFunction(() => window.__debug?.menu?.runIds().length === 1);
  const rec2 = await page.locator('#records').innerText();
  check(
    new RegExp(`1 player\\s+round ${reached}`).test(rec2),
    `records: the deepest round (${reached}) is shown on the menu`,
  );
  check(
    (await page.locator('#no-runs').count()) === 0,
    'the new run is listed',
  );

  // Hash routes keep working.
  for (const hash of ['#debug', '#build', '#battle', '#shop']) {
    await page.goto(baseUrl + hash);
    await page.waitForSelector('canvas, #shop-screen, #battle-preparing');
  }
  await page.goto(`${baseUrl}#run/does-not-exist`);
  await page.waitForSelector('.run-blocked');
  check(
    /not found/i.test(await page.locator('.run-blocked').innerText()),
    'an address for a run that does not exist says so, and creates nothing',
  );
  await page.goto(`${baseUrl}#/`);
  await page.waitForSelector('#main-menu');

  // ---------------------------------------------------------------------
  // The debug "Next PvP opponent" control writes the setting and clears it.
  const FORCE_KEY = 'coop-autobattler:debug-force-opponent';
  const forceValue = () =>
    page.evaluate((k) => localStorage.getItem(k), FORCE_KEY);
  await page.goto(`${baseUrl}#debug`);
  await page.waitForSelector('#force-opponent');
  await page.selectOption('#force-opponent', 'boss');
  check(
    (await forceValue()) === 'boss',
    'debug screen: "Next PvP opponent" set to Boss stores the setting',
  );
  await page.selectOption('#force-opponent', 'auto');
  check(
    (await forceValue()) === null,
    'debug screen: "Next PvP opponent" set back to Automatic removes the setting',
  );

  // ---------------------------------------------------------------------
  // The boss with no setting: a real save of a party of two, alive at round 7
  // (made in Node by the real bot, see smoke-seed.mjs), whose PvP opponent the
  // browser selects from an empty bucket, since the bundled ghosts stop at
  // round 6.
  for (const seedArgs of [[], ['siege', '1', '2']]) {
    // The second save is a party the siege bot made, which
    // loses to the boss: the loss branch of the checks below. It keeps the
    // run id: the first run left a round 7 ghost in the browser's pool, which
    // is only skipped for a run of the same id.
    const lossCase = seedArgs.length > 0;
    const ngCheck = (ok, msg) =>
      check(
        ok,
        lossCase
          ? msg.replace('no-ghost boss', 'no-ghost boss, losing party')
          : msg,
      );
    const record = JSON.parse(
      execFileSync(
        'pnpm',
        [
          'exec',
          'tsx',
          path.join(webDir, 'scripts/smoke-seed.mjs'),
          ...seedArgs,
        ],
        { cwd: path.resolve(webDir, '../..'), maxBuffer: 1 << 26 },
      ).toString('utf8'),
    );
    const id = record.runId;
    await goMenu();
    ngCheck((await forceValue()) === null, 'no-ghost boss: no force setting');
    await page.evaluate(
      async ([rec, runId]) => {
        const db = await new Promise((res, rej) => {
          const r = indexedDB.open('coop-autobattler', 1);
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        });
        await new Promise((res) => {
          const tx = db.transaction('saves', 'readwrite');
          tx.objectStore('saves').put(rec, runId);
          tx.oncomplete = res;
        });
        db.close();
      },
      [record, id],
    );
    await page.reload();
    await page.waitForSelector(`[data-run="${id}"]`);
    await page.click(`[data-run="${id}"] [data-action="resume"]`);
    await waitStep('pve_choice');
    const start = await R.state();
    ngCheck(
      start.round >= 7 && start.lives > 0 && start.pvpOpponent === null,
      `no-ghost boss: the saved run is alive at round ${start.round}, lives ${start.lives}, opponent not yet chosen`,
    );
    const actAs2 = async (p) => {
      await page.click(
        `#acting-switch [data-action="act-as"][data-player="${p}"]`,
      );
      await page.waitForFunction(
        (n) => window.__debug?.run?.state().acting === n,
        p,
      );
    };
    // The battle screen may replay for the other player: skip, then continue.
    const finishBattle = async () => {
      await page.waitForFunction(() => window.__debug?.battle?.phase, null, {
        timeout: slow(20000),
      });
      await page.waitForFunction(
        () =>
          window.__debug?.battle?.phase() === 'summary' ||
          document.querySelector('#skip') !== null,
      );
      if (
        (await page.evaluate(() => window.__debug.battle.phase())) !== 'summary'
      ) {
        await page.click('#skip');
        await page.waitForFunction(
          () => window.__debug?.battle?.phase() === 'summary',
        );
      }
    };
    // Both players act at each step until the PvP battle.
    let guard = 0;
    while ((await R.state()).step !== 'pvp_summary' && guard++ < 12) {
      const s = await R.state();
      if (s.step === 'pvp_summary') break;
      if (s.step === 'shop' && s.leg === 'pve') {
        // The controller reads the ghost pool after entering the shop, so the
        // opponent may not be set yet in the state captured above: wait for
        // it (a timeout fails the smoke), then check a fresh read.
        await page.waitForFunction(
          () => window.__debug?.run?.state().pvpOpponent != null,
          null,
          { timeout: slow(20000) },
        );
        const shopNow = await R.state();
        ngCheck(
          shopNow.pvpOpponent?.kind === 'boss' && shopNow.round >= 7,
          `no-ghost boss: the browser's own read of the empty pool gives the boss at round ${shopNow.round}`,
        );
        await page.waitForSelector('#shop-screen');
        const t = await page.locator('#shop-screen').innerText();
        ngCheck(
          /Opponent: the boss/.test(t) && /Lose: -1 life/.test(t),
          'no-ghost boss: the shop announces the boss, a loss costs 1 life',
        );
      }
      for (const p of [0, 1]) {
        // The step may have moved on after the first player.
        if ((await R.state()).step !== s.step) break;
        await actAs2(p);
        if ((await R.state()).step !== s.step) break;
        if (s.step === 'pve_choice') {
          await page.waitForSelector('[data-action="choose"]');
          await page.click('[data-action="choose"][data-difficulty="easy"]');
        } else if (s.step === 'pve_summary') {
          await finishBattle();
          await page.click('#battle-ready');
        } else if (s.step === 'event_choice') {
          await page.waitForSelector('[data-action="choose-event"]');
          await page.click('[data-action="choose-event"]');
        } else if (s.step === 'event_resolve') {
          await page.waitForSelector('[data-action="choose-option"]');
          const skip = page.locator(
            '[data-action="choose-option"][data-option="skip"]',
          );
          await page.click(
            (await skip.count()) > 0
              ? '[data-action="choose-option"][data-option="skip"]'
              : '[data-action="choose-option"]:not([disabled])',
          );
        } else if (s.step === 'shop') {
          await page.waitForSelector('#shop-ready');
          await page.click('#shop-ready');
        } else {
          throw new Error(`no-ghost boss: unexpected step ${s.step}`);
        }
        if (p === 0) await settle();
      }
      // Both players have acted, so the step is over. The last click returns
      // before its action is applied: wait for the step to move on, or the
      // next pass would read the old step and wait for a control that is
      // about to go away.
      await page.waitForFunction(
        ([step, leg]) => {
          const st = window.__debug?.run?.state();
          return st !== undefined && (st.step !== step || st.leg !== leg);
        },
        [s.step, s.leg],
        { timeout: slow(20000) },
      );
    }
    await waitStep('pvp_summary');
    const before = await R.state();
    await actAs2(0);
    await page.waitForFunction(() => window.__debug?.battle?.phase, null, {
      timeout: slow(20000),
    });
    ngCheck(
      /boss/i.test(await page.locator('[data-field="vs"]').innerText()),
      'no-ghost boss: the PvP battle is fought against the boss',
    );
    await finishBattle();
    const won =
      (await page.locator('[data-field="result-word"]').innerText()) ===
      'Victory';
    const own = await page.locator('[data-field="standing-own"]').innerText();
    const foe = await page.locator('[data-field="standing-foe"]').innerText();
    ngCheck(
      /\/ 2$/.test(own) && /\/ 2$/.test(foe),
      `no-ghost boss: one Core per player on each side, the boss has 2 (own ${own}, boss ${foe})`,
    );
    ngCheck(
      won ? /^0 \//.test(foe) : /^[12] \//.test(foe),
      `no-ghost boss: a win needs every boss Core destroyed (${won ? 'won' : 'lost'}, boss Cores standing ${foe})`,
    );
    await page.click('#battle-ready');
    await actAs2(1);
    await finishBattle();
    await page.click('#battle-ready');
    await page.waitForFunction(
      () => window.__debug?.run?.state().step !== 'pvp_summary',
    );
    const after = await R.state();
    ngCheck(
      won ? after.lives === before.lives : after.lives === before.lives - 1,
      `no-ghost boss: the result is applied (${won ? 'won' : 'lost'}, lives ${before.lives} -> ${after.lives}, step ${after.step})`,
    );
    if (lossCase) {
      ngCheck(
        !won && /^[12] \//.test(foe) && after.lives === before.lives - 1,
        `no-ghost boss: the boss wins, Cores standing ${foe} of 2, the party loses exactly 1 life (${before.lives} -> ${after.lives})`,
      );
    }
    await goMenu();
  }

  // ---------------------------------------------------------------------
  // A local party of two (?players=2): one browser, the acting player is
  // switched from the top bar. Every step needs both players to act.
  await goMenu(`?seed=${SEED}&players=2`);
  await page.click('#new-run-button');
  await page.waitForSelector('#core-confirm');
  await page.waitForFunction(() => window.__debug?.placement?.legal);
  const actAs = async (p) => {
    await page.click(
      `#acting-switch [data-action="act-as"][data-player="${p}"]`,
    );
    await page.waitForFunction(
      (n) => window.__debug?.run?.state().acting === n,
      p,
    );
  };
  check(
    (await page.locator('#acting-switch [data-action="act-as"]').count()) ===
      2 &&
      /Waiting for: You, Player 2/.test(
        await page.locator('[data-field="waiting-for"]').innerText(),
      ),
    'two players: the top bar names who still has to act, in words',
  );
  for (const p of [0, 1]) {
    await actAs(p);
    await page.waitForFunction(
      (n) =>
        window.__debug?.placement?.legal().length > 0 &&
        window.__debug.placement
          .legal()
          .every(
            (c) => (n === 0) === c.x < window.__debug?.placement?.plotWidth(),
          ),
      p,
    );
    const spots = await page.evaluate(() => window.__debug?.placement?.legal());
    const spot = spots[Math.floor(spots.length / 2)];
    const at2 = await page.evaluate(
      ([x, y]) => window.__debug?.placement?.cellToScreen(x, y),
      [spot.x, spot.y],
    );
    // A click in the other player's plot is refused, in words.
    const foreign = await page.evaluate(
      ([n, sx, sy]) => {
        const w = window.__debug?.placement?.plotWidth();
        return window.__debug?.placement?.cellToScreen(
          (n === 0 ? w : 0) + (sx % w),
          sy,
        );
      },
      [p, spot.x, spot.y],
    );
    await page.mouse.click(foreign.x, foreign.y);
    await settle();
    check(
      /own area/i.test(await page.locator('#core-hint').innerText()) &&
        (await page.evaluate(() => window.__debug?.placement?.selected())) ===
          null,
      `two players: player ${p + 1} cannot place the Core in another player's area (the reason is shown)`,
    );
    await page.mouse.click(at2.x, at2.y);
    await page.waitForFunction(
      () => !document.querySelector('#core-confirm').disabled,
    );
    if (p === 0) {
      // Ready locks the choice; Unready reopens it; no vote panel exists.
      check(
        (await page.locator('#panel-core').innerText()).search(/vote/i) < 0,
        'two players: no vote UI on the Core placement screen',
      );
      await page.click('#core-confirm');
      await page.waitForSelector('#core-unready');
      // While Ready, a click on another legal spot changes nothing and says why.
      const other = spots.find((c) => c.x !== spot.x || c.y !== spot.y);
      const atOther = await page.evaluate(
        ([x, y]) => window.__debug?.placement?.cellToScreen(x, y),
        [other.x, other.y],
      );
      await page.mouse.click(atOther.x, atOther.y);
      await page.waitForFunction(() =>
        /Unready/.test(document.querySelector('#core-hint')?.textContent ?? ''),
      );
      check(
        JSON.stringify(
          await page.evaluate(() => window.__debug?.placement?.selected()),
        ) === JSON.stringify(spot),
        'two players: while Ready, a click on another spot is refused and the spot stays',
      );
      await page.click('#core-unready');
      await page.waitForSelector('#core-confirm:not([disabled])');
      check(
        JSON.stringify(
          await page.evaluate(() => window.__debug?.placement?.selected()),
        ) === JSON.stringify(spot),
        'two players: Unready reopens the choice, the chosen spot is kept',
      );
    }
    await page.click('#core-confirm');
    await page.waitForFunction(
      (n) =>
        window.__debug?.run?.state().ready[n] === true ||
        window.__debug?.run?.state().step === 'build',
      p,
    );
  }
  check(
    (await R.state()).step === 'build' &&
      (await page.locator('[data-field="waiting-for"]').innerText()).includes(
        'Waiting',
      ),
    'two players: both Cores placed (each in its own area), the first build opens',
  );
  const bothReady = async (step, click) => {
    for (const p of [0, 1]) {
      await actAs(p);
      await click();
      if (p === 0) {
        await page.waitForFunction(
          () =>
            window.__debug?.run?.state().ready[0] === true ||
            window.__debug?.run?.state().voted?.[0] === true,
        );
      }
    }
    await waitStep(step);
  };
  await page.waitForFunction(() => window.__debug?.build?.step() === 'build');

  // One border link: player 1 draws a sending half from an extractor to the
  // border, player 2 a receiving half into a Barracks; they join.
  {
    const t0 = await B.team();
    const w = t0.width / 2;
    const node = t0.nodes
      .filter((n) => n.resource === 'res_a' && n.x < w)
      .sort((a, b) => b.x - a.x)[0];
    if (node === undefined) {
      throw new Error('border link: no res_a node on the left half');
    }
    const dragFromStash = async (def, x, y) => {
      const before = (await B.team()).buildings.length;
      const box = await page
        .locator(`[data-stash-def="${def}"]`)
        .first()
        .boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      const p = await at(x, y);
      await page.mouse.move(p.x, p.y, { steps: 6 });
      await page.mouse.up();
      await page.waitForFunction(
        (n) => window.__debug?.build?.team().buildings.length > n,
        before,
        { timeout: slow(3000) },
      );
    };
    const clickCell = async (x, y) => {
      const p = await at(x, y);
      await page.mouse.click(p.x, p.y);
    };
    const links = () => page.evaluate(() => window.__debug?.build?.links());
    await actAs(0);
    await dragFromStash('bld_extractor', node.x, node.y);
    await page.click('[data-tool="conduit"]');
    await clickCell(node.x, node.y + 1);
    await clickCell(w - 1, node.y + 1);
    await page.waitForFunction(
      () => window.__debug?.build?.links().length === 1,
    );
    const first = await links();
    check(
      first[0].owner === 0 &&
        first[0].kind === 'send' &&
        first[0].state === 'open',
      'border link: a half with no neighbour half is shown as not connected',
    );
    await actAs(1);
    await dragFromStash('bld_barracks', w + 2, node.y + 2);
    await page.click('[data-tool="conduit"]');
    await clickCell(w, node.y + 1);
    await clickCell(w + 2, node.y + 2);
    await page.waitForFunction(
      () => window.__debug?.build?.links().length === 2,
    );
    await page.waitForFunction(() =>
      window.__debug?.build?.links().every((h) => h.state === 'joined'),
    );
    check(
      (await links()).map((h) => h.kind).join() === 'send,receive',
      'border link: the two halves of different players are joined',
    );
    // Owner decision: a neighbour's half is drawn dimmed; mine at full strength.
    check(
      (await links()).every((h) => (h.alpha === 1) === (h.owner === 1)) &&
        (await links()).some((h) => h.owner === 0 && h.alpha < 1),
      "border link: a neighbour's half is dimmed, mine is not (acting player 2)",
    );
    await actAs(0);
    check(
      (await links()).every((h) => (h.alpha === 1) === (h.owner === 0)),
      'border link: dimming follows the acting-player switcher',
    );
    await actAs(1);
    // The Border links list shows only the acting player's own half, in words.
    await page.waitForSelector('#panel-links [data-link-state="joined"]');
    const listed = await page.$$eval(
      '#panel-links [data-field="link-text"]',
      (els) => els.map((e) => e.textContent ?? ''),
    );
    check(
      listed.length === 1 && listed[0].startsWith('Linked with'),
      'border link: the Border links list shows only my half, as linked',
    );
    // The neighbour's half is on the board but offers no Remove button.
    check(
      (await links()).length === 2 &&
        (await page.$$('#panel-links [data-action="remove-link"]')).length ===
          1,
      "border link: a neighbour's half offers no Remove button",
    );
    // A neighbour's half cannot be erased; removing your own half returns the
    // other to "open".
    await page.click('[data-tool="erase"]');
    await clickCell(w - 1, node.y + 1);
    await settle();
    check(
      (await links()).length === 2,
      "border link: a neighbour's half cannot be erased",
    );
    await clickCell(w, node.y + 1);
    await page.waitForFunction(
      () =>
        window.__debug?.build?.links().length === 1 &&
        window.__debug.build.links()[0].state === 'open',
    );
    check(
      (await links())[0].owner === 0,
      'border link: removing one half returns the other to open',
    );
    await page.click('[data-tool="select"]');
  }

  await bothReady('pve_choice', async () => {
    await page.waitForSelector('#ready-button:not([disabled])');
    await page.click('#ready-button');
  });
  await page.waitForSelector('#pve-choice');
  await bothReady('pve_summary', async () => {
    await page.waitForSelector(
      '[data-action="choose"][data-difficulty="easy"]',
    );
    await page.click('[data-action="choose"][data-difficulty="easy"]');
  });
  check(
    (await R.screen()) === 'battle',
    'two players: both PvE votes reach the battle',
  );
  await page.waitForFunction(() => window.__debug?.battle?.phase);
  await page.click('#skip');
  await page.waitForFunction(
    () => window.__debug?.battle?.phase() === 'summary',
  );
  // "Watch again" after one player is Ready: the battle replays and the Ready
  // of that player is kept (the run still waits for the other player).
  const toSummary = async () => {
    await page.waitForFunction(
      () =>
        window.__debug?.battle?.phase() === 'summary' ||
        document.querySelector('#skip') !== null,
      undefined,
      { timeout: slow(10000) },
    );
    if (
      (await page.evaluate(() => window.__debug.battle.phase())) !== 'summary'
    ) {
      await page.click('#skip');
      await page.waitForFunction(
        () => window.__debug?.battle?.phase() === 'summary',
        undefined,
        { timeout: slow(10000) },
      );
    }
  };
  const playerDone = (n) =>
    page.evaluate(
      (i) =>
        window.__debug.run.state().ready[i] === true ||
        window.__debug.run.state().voted?.[i] === true,
      n,
    );
  await actAs(0);
  await toSummary();
  await page.click('#battle-ready');
  await page.waitForFunction(
    () =>
      window.__debug?.run?.state().ready[0] === true ||
      window.__debug?.run?.state().voted?.[0] === true,
    undefined,
    { timeout: slow(10000) },
  );
  await page.click('#watch-again');
  await page.waitForFunction(
    () => window.__debug?.battle?.phase() === 'playing',
    undefined,
    { timeout: slow(10000) },
  );
  check(
    (await page.evaluate(() => window.__debug.battle.tick())) === 0 &&
      (await R.state()).step === 'pve_summary' &&
      (await playerDone(0)),
    'two players: Watch again after Ready replays the battle from the start and the run keeps player 1 Ready',
  );
  await page.click('#skip');
  await page.waitForFunction(
    () => window.__debug?.battle?.phase() === 'summary',
    undefined,
    { timeout: slow(10000) },
  );
  check(
    (await page.locator('#battle-ready').isDisabled()) &&
      !(await page.locator('#watch-again').isDisabled()) &&
      (await playerDone(0)) &&
      !(await playerDone(1)) &&
      (await R.state()).step === 'pve_summary',
    'two players: after the replay the summary still shows player 1 Ready (button disabled, run waiting for player 2)',
  );
  await shot('run-two-player-watch-again-ready');
  await actAs(1);
  await toSummary();
  check(
    !(await page.locator('#battle-ready').isDisabled()) &&
      !(await playerDone(1)),
    'two players: the other player is not Ready and can press Ready on the summary',
  );
  await page.click('#battle-ready');
  await waitStep('event_choice');
  await page.waitForSelector('#event-choice');

  // The event vote: both pick the Workshop, which has a follow-up of its own
  // for each player.
  const workshopOffer = await page
    .locator('.event-card[data-type="workshop"]')
    .first()
    .getAttribute('data-offer');
  check(
    workshopOffer !== null,
    `two players: the Workshop is among the event offers (seed ${SEED})`,
  );
  for (const p of [0, 1]) {
    await actAs(p);
    await page.click(
      `[data-action="choose-event"][data-offer="${workshopOffer}"]`,
    );
    if (p === 0) {
      await page.waitForFunction(
        () => window.__debug?.run?.state().voted?.[0] === true,
        undefined,
        { timeout: slow(10000) },
      );
    }
  }
  await waitStep('event_resolve');
  await page.waitForSelector('#event-resolve');
  await settle();

  const followOptions = async () =>
    (
      await page
        .locator('#event-resolve .event-card[data-option]')
        .evaluateAll((els) =>
          els.map((e) => ({
            id: e.dataset.option,
            affordable: e.dataset.affordable === 'true',
            text: e.innerText,
          })),
        )
    ).map((o) => ({
      ...o,
      price: Number(/(\d+) gold/.exec(o.text)?.[1]),
      from: Number(/Tier (\d) → (\d)/.exec(o.text)?.[1]),
      to: Number(/Tier (\d) → (\d)/.exec(o.text)?.[2]),
      name: o.text.split('\n')[0].trim(),
    }));
  const picks = [];
  const golds = [];
  for (const p of [0, 1]) {
    await actAs(p);
    await page.waitForSelector('#event-resolve [data-field="chosen"]');
    golds[p] = (await R.state()).gold;
    const mine = await followOptions();
    picks[p] = mine.find((o) => o.affordable);
    check(
      mine.length > 0 && picks[p] !== undefined,
      `two players: Workshop follow-up, player ${p + 1} has ${mine.length} option(s) and can afford one (gold ${golds[p]})`,
    );
  }
  check(
    picks[0].id !== picks[1].id,
    'two players: Workshop follow-up, each player is offered their own buildings (the two first picks differ)',
  );
  const chosenLines = () =>
    page.locator('#event-resolve [data-field="chosen"] li').allInnerTexts();
  const waitingCount = () =>
    page.locator('#event-resolve [data-field="waiting"]').count();
  await actAs(0);
  {
    const before = await chosenLines();
    check(
      before.length === 2 &&
        before.every((l) => /choosing/.test(l)) &&
        (await waitingCount()) === 0,
      `two players: Workshop follow-up, nobody has chosen yet (${before.join(' | ')})`,
    );
  }
  const optionButton = (id) =>
    page.locator(
      `#event-resolve [data-action="choose-option"][data-option="${id}"]`,
    );
  const isChosen = (id) =>
    optionButton(id).evaluate((e) => e.classList.contains('selected'));
  await optionButton(picks[0].id).click();
  await page.waitForSelector('#event-resolve [data-field="waiting"]');
  const waitingText = await page
    .locator('#event-resolve [data-field="waiting"]')
    .innerText();
  const lines = await chosenLines();
  check(
    /waiting for/i.test(waitingText) &&
      /Player 2/.test(waitingText) &&
      lines.length === 2 &&
      /has chosen/.test(lines[0]) &&
      /choosing/.test(lines[1]) &&
      !/has chosen/.test(lines[1]),
    `two players: Workshop follow-up, player 1 chose and sees "${waitingText}" with the list ${JSON.stringify(lines)}`,
  );
  check(
    ![waitingText, ...lines].some(
      (t) => t.includes(picks[0].name) || /tier|gold|skip/i.test(t),
    ),
    'two players: Workshop follow-up, the waiting note and the chosen list do not say what was chosen',
  );
  check(
    (await R.state()).gold === golds[0] && (await isChosen(picks[0].id)),
    'two players: Workshop follow-up, nothing is paid until everyone has chosen',
  );
  await shot('run-two-player-workshop-waiting');
  // The choice can be changed while the other player has not chosen.
  await optionButton('skip').click();
  await page.waitForFunction(
    () =>
      document
        .querySelector(
          '#event-resolve [data-action="choose-option"][data-option="skip"]',
        )
        ?.classList.contains('selected') === true,
    undefined,
    { timeout: slow(10000) },
  );
  {
    const l = await chosenLines();
    check(
      /has chosen/.test(l[0]) &&
        /choosing/.test(l[1]) &&
        (await waitingCount()) === 1 &&
        !(await isChosen(picks[0].id)) &&
        (await R.state()).step === 'event_resolve' &&
        (await R.state()).gold === golds[0],
      'two players: Workshop follow-up, player 1 changed the choice to Skip while player 2 had not chosen',
    );
  }
  await optionButton(picks[0].id).click();
  await page.waitForFunction(
    (id) =>
      document
        .querySelector(
          `#event-resolve [data-action="choose-option"][data-option="${id}"]`,
        )
        ?.classList.contains('selected') === true,
    picks[0].id,
    { timeout: slow(10000) },
  );
  // A reload in the middle of the choice resumes in the same state.
  await reloadSame('the Workshop follow-up with one player chosen');
  await page.waitForSelector('#event-resolve [data-field="chosen"]');
  await actAs(0);
  {
    const l = await chosenLines();
    check(
      (await R.state()).step === 'event_resolve' &&
        (await isChosen(picks[0].id)) &&
        /has chosen/.test(l[0]) &&
        /choosing/.test(l[1]) &&
        /waiting for/i.test(
          await page
            .locator('#event-resolve [data-field="waiting"]')
            .innerText(),
        ),
      'two players: Workshop follow-up, after a reload player 1 is still chosen and player 2 still choosing',
    );
  }
  await actAs(1);
  {
    const l = await chosenLines();
    check(
      (await waitingCount()) === 0 &&
        /has chosen/.test(l[0]) &&
        /choosing/.test(l[1]) &&
        !(await isChosen(picks[1].id)),
      'two players: Workshop follow-up, player 2 sees that player 1 has chosen, with no waiting note and nothing chosen yet',
    );
  }
  await optionButton(picks[1].id).click();
  await waitStep('shop');
  await page.waitForSelector('#shop-screen');
  await settle();
  for (const p of [0, 1]) {
    await actAs(p);
    const g = (await R.state()).gold;
    check(
      g === golds[p] - picks[p].price + income,
      `two players: Workshop follow-up, player ${p + 1} paid ${picks[p].price} gold (${golds[p]} -> ${g} with ${income} income)`,
    );
  }
  await page.click('.topbar-tabs button:has-text("Build")');
  await page.waitForFunction(() => window.__debug?.build?.step() === 'shop');
  await settle();
  {
    const t = await B.team();
    const tierOf = (id) =>
      [...t.buildings, ...t.stash].find((b) => b.id === Number(id.slice(1)))
        ?.tier;
    check(
      tierOf(picks[0].id) === picks[0].to &&
        tierOf(picks[1].id) === picks[1].to,
      `two players: Workshop follow-up, both chosen buildings rose a tier (${picks[0].from}->${tierOf(picks[0].id)}, ${picks[1].from}->${tierOf(picks[1].id)})`,
    );
  }
  await page.click('.topbar-tabs button:has-text("Shop")');
  await page.waitForSelector('#shop-screen');
  check(
    (await R.state()).step === 'shop',
    'two players: both Workshop choices made, the run moves on to the shop',
  );
  // The Ready lock on the Shop and Build tabs (two players). Player 1 presses
  // Ready: buying, selling, re-rolling and every board edit are refused, with
  // the lock text; player 2, who is not Ready, is unaffected; Unready reopens
  // everything for player 1.
  {
    const LOCK = 'Ready. Unready to make changes.';
    const shopState = () => page.evaluate(() => window.__debug.shop.state());
    const shopTab = async () => {
      await page.click('.topbar-tabs button:has-text("Shop")');
      await page.waitForSelector('#shop-screen');
      await hookReady(page, 'shop');
      await settle();
    };
    const buildTab = async () => {
      await page.click('.topbar-tabs button:has-text("Build")');
      await page.waitForFunction(
        () => window.__debug?.build?.step() === 'shop',
      );
      await settle();
    };
    // What the player can still change on the Shop tab, as one comparable.
    const shopSnap = async () => {
      const s = await shopState();
      return JSON.stringify({
        gold: s.gold,
        offers: s.offers,
        offerPrices: s.offerPrices,
        stash: s.stash,
        placed: s.placed,
        actions: s.actions,
      });
    };
    const readyOf = async () => (await R.state()).ready;

    // A cell where a wall of player 1's stash can be dropped: found now by
    // placing one and undoing it, so the drops below are legal when open and
    // refused only by the lock.
    const dropWall = async (x, y) => {
      const b = await page
        .locator('[data-stash-def="bld_wall"]')
        .first()
        .boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      const p = await at(x, y);
      await page.mouse.move(p.x, p.y, { steps: 6 });
      await page.mouse.up();
      await frames(page, 4);
    };
    await actAs(0);
    await buildTab();
    let spot = null;
    {
      const t0 = await B.team();
      const before = t0.buildings.length;
      for (let y = 3; y < t0.height - 2 && spot === null; y += 1) {
        for (let x = 1; x < t0.width / 2 - 2 && spot === null; x += 1) {
          await dropWall(x, y);
          if ((await B.team()).buildings.length > before) spot = { x, y };
          else await page.keyboard.press('Escape');
        }
      }
      check(
        spot !== null,
        'two players: a wall of player 1 can be placed before Ready (a legal cell to test the lock against)',
      );
      await page.click('[data-action="undo"]');
      await page.waitForFunction(
        (n) => window.__debug.build.team().buildings.length === n,
        before,
        { timeout: slow(10000) },
      );
    }
    await actAs(0);
    await shopTab();
    const start = await shopState();
    console.log(
      `two players: shop of player 1 before Ready: gold ${start.gold}, offers ${JSON.stringify(start.offers)} at ${JSON.stringify(start.offerPrices)}, stash ${start.stash.length}, placed ${start.placed}`,
    );

    await page.click('#shop-ready');
    await page.waitForFunction(
      () => window.__debug?.run?.state().ready[0],
      null,
      {
        timeout: slow(10000),
      },
    );
    await page.waitForFunction(
      () =>
        document.querySelector('#shop-ready')?.textContent?.includes('Unready'),
      null,
      { timeout: slow(10000) },
    );
    const lockedSnap = await shopSnap();
    // Every live offer, the re-roll and every Sell button are off, each with
    // the lock text as the reason.
    const offerState = await page.$$eval('#offers > li', (els) =>
      els.map((e) => ({
        sold: e.dataset.state === 'sold',
        disabled: e.querySelector('[data-action="buy"]')?.disabled ?? true,
        reason: e.querySelector('[data-field="reason"]')?.textContent ?? '',
      })),
    );
    const live = offerState.filter((o) => !o.sold);
    check(
      live.length > 0 && live.every((o) => o.disabled && o.reason === LOCK),
      `two players: while Ready, every offer's Buy is off and says "${LOCK}" (${live.length} offers)`,
    );
    check(
      (await page.locator('#reroll').isDisabled()) &&
        (await page.locator('[data-field="reroll-reason"]').innerText()) ===
          LOCK,
      'two players: while Ready, Re-roll is off and says why',
    );
    const sellBtns = page.locator('#shop-stash [data-action="sell"]');
    const sellCount = await sellBtns.count();
    let sellOff = true;
    for (let i = 0; i < sellCount; i++) {
      sellOff = sellOff && (await sellBtns.nth(i).isDisabled());
    }
    check(
      sellCount > 0 && sellOff,
      `two players: while Ready, Sell is off on all ${sellCount} stash rows`,
    );
    // Attempts anyway: forced clicks on the disabled buttons, and a drag of a
    // stash row to the sell target.
    for (let i = 0; i < live.length; i++) {
      await page
        .locator('#offers [data-action="buy"]')
        .nth(i)
        .click({ force: true, timeout: slow(3000) });
    }
    await page.locator('#reroll').click({ force: true, timeout: slow(3000) });
    await sellBtns.first().click({ force: true, timeout: slow(3000) });
    await page
      .locator('#shop-stash .stash-row')
      .first()
      .dragTo(page.locator('#sell-target'), {
        force: true,
        timeout: slow(3000),
      });
    await settle();
    await frames(page, 6);
    check(
      (await page.locator('#sell-confirm').count()) === 0 &&
        (await shopSnap()) === lockedSnap,
      'two players: while Ready, buy, re-roll and sell attempts change nothing (gold, offers, stash, board, action count)',
    );
    check(
      (await page.locator('#shop-ready').innerText()).includes('Unready'),
      'two players: while Ready, the Shop shows Unready',
    );
    await shot('run-two-player-shop-ready-locked');

    // The Build tab: no drag from the stash, no hotkey, no click edits.
    await buildTab();
    const boardBefore = JSON.stringify(await B.team());
    const toolBefore = await page.evaluate(
      () => window.__debug.build.ui().tool,
    );
    const dragTarget = (await B.team()).buildings.find((b) => b.owner === 0);
    await dropWall(spot.x, spot.y);
    if (dragTarget !== undefined) {
      const onIt = await at(dragTarget.x, dragTarget.y);
      await page.mouse.click(onIt.x, onIt.y);
    }
    for (const key of ['r', 'c', 'e', 'Delete', 'Backspace']) {
      await page.keyboard.press(key);
    }
    await settle();
    await frames(page, 6);
    check(
      JSON.stringify(await B.team()) === boardBefore &&
        (await page.evaluate(() => window.__debug.build.ui().tool)) ===
          toolBefore &&
        (await page.evaluate(() => window.__debug.build.status().text)) ===
          LOCK,
      'two players: while Ready, dragging from the stash, clicking a building and the r, c, e, Delete keys leave the board and the tool alone and say why',
    );
    check(
      (await page.locator('[data-field="ready-locked"]').count()) === 1 &&
        (await page.locator('[data-tool="conduit"]').isDisabled()) &&
        (await page.locator('[data-tool="erase"]').isDisabled()),
      'two players: while Ready, the Build tab shows the lock and disables the conduit and erase tools',
    );
    await shot('run-two-player-build-ready-locked');

    // Player 2 is not Ready and is unaffected: the Shop is open for them.
    await shopTab();
    await actAs(1);
    {
      const ready = await readyOf();
      const s1 = await shopState();
      const affordable = await page.$$eval('#offers > li', (els) =>
        els.map((e) => ({
          disabled: e.querySelector('[data-action="buy"]')?.disabled ?? true,
          reason: e.querySelector('[data-field="reason"]')?.textContent ?? '',
          slot: Number(e.dataset.slot),
        })),
      );
      const canBuy = affordable.find((o) => !o.disabled);
      check(
        ready[0] === true &&
          ready[1] === false &&
          affordable.every((o) => o.reason !== LOCK) &&
          !(await page.locator('#sell-target').isHidden()) &&
          (await page.locator('#shop-ready').innerText()).includes('Ready') &&
          !(await page.locator('#shop-ready').innerText()).includes('Unready'),
        'two players: player 2 is not locked while player 1 is Ready (no lock text on their offers, their button reads Ready)',
      );
      check(
        canBuy !== undefined,
        `two players: player 2 can afford an offer (gold ${s1.gold})`,
      );
      if (canBuy !== undefined) {
        const stashBefore = (await shopState()).stash.length;
        await page
          .locator('#offers > li')
          .nth(canBuy.slot)
          .locator('[data-action="buy"]')
          .click();
        await page.waitForFunction(
          (n) => window.__debug.shop.state().stash.length > n,
          stashBefore,
          { timeout: slow(10000) },
        );
        const s2 = await shopState();
        check(
          s2.gold < s1.gold &&
            (await readyOf())[0] === true &&
            (await readyOf())[1] === false,
          `two players: player 2 bought while player 1 is Ready (gold ${s1.gold} -> ${s2.gold}), player 1 stays Ready`,
        );
      }
    }

    // Unready reopens everything for player 1.
    await actAs(0);
    await shopTab();
    await page.click('#shop-ready');
    await page.waitForFunction(
      () => !window.__debug?.run?.state().ready[0],
      null,
      {
        timeout: slow(10000),
      },
    );
    await page.waitForFunction(
      () =>
        !document
          .querySelector('#shop-ready')
          ?.textContent?.includes('Unready'),
      null,
      { timeout: slow(10000) },
    );
    const open = await shopState();
    const openOffers = await page.$$eval('#offers > li', (els) =>
      els.map((e) => ({
        sold: e.dataset.state === 'sold',
        disabled: e.querySelector('[data-action="buy"]')?.disabled ?? true,
        reason: e.querySelector('[data-field="reason"]')?.textContent ?? '',
        slot: Number(e.dataset.slot),
      })),
    );
    check(
      openOffers.every((o) => o.reason !== LOCK) &&
        (await page.locator('[data-field="reroll-reason"]').innerText()) !==
          LOCK &&
        (await page.locator('#shop-stash [data-action="sell"]').count()) > 0 &&
        !(await page
          .locator('#shop-stash [data-action="sell"]')
          .first()
          .isDisabled()),
      'two players: after Unready, the lock text is gone and Sell is on again',
    );
    // Sell one stash row (gold goes up), then buy (gold goes down).
    // Not a wall: the wall is dropped on the board below.
    await page
      .locator(
        '#shop-stash .stash-row:not([data-stash-def="bld_wall"]) [data-action="sell"]',
      )
      .first()
      .click();
    await page.waitForSelector('#sell-confirm');
    await page.click('#sell-confirm');
    await page.waitForFunction(
      (g) => window.__debug.shop.state().gold > g,
      open.gold,
      { timeout: slow(10000) },
    );
    const afterSell = await shopState();
    check(
      afterSell.stash.length === open.stash.length - 1,
      `two players: after Unready, selling works (stash ${open.stash.length} -> ${afterSell.stash.length}, gold ${open.gold} -> ${afterSell.gold})`,
    );
    const buyable = await page.$$eval('#offers > li', (els) =>
      els.map((e) => ({
        disabled: e.querySelector('[data-action="buy"]')?.disabled ?? true,
        slot: Number(e.dataset.slot),
      })),
    );
    const slot = buyable.find((o) => !o.disabled);
    check(
      slot !== undefined,
      'two players: after Unready, an offer can be bought',
    );
    if (slot !== undefined) {
      await page
        .locator('#offers > li')
        .nth(slot.slot)
        .locator('[data-action="buy"]')
        .click();
      await page.waitForFunction(
        (n) => window.__debug.shop.state().stash.length > n,
        afterSell.stash.length,
        { timeout: slow(10000) },
      );
      const afterBuy = await shopState();
      check(
        afterBuy.gold < afterSell.gold,
        `two players: after Unready, buying works (gold ${afterSell.gold} -> ${afterBuy.gold})`,
      );
    }
    if (!(await page.locator('#reroll').isDisabled())) {
      const g = (await shopState()).gold;
      await page.click('#reroll');
      await page.waitForFunction(
        (n) => window.__debug.shop.state().gold < n,
        g,
        { timeout: slow(10000) },
      );
      check(true, 'two players: after Unready, re-rolling works');
    } else {
      check(
        (await page.locator('[data-field="reroll-reason"]').innerText()) !==
          LOCK,
        'two players: after Unready, Re-roll is off only for lack of gold, not for the lock',
      );
    }
    // The Build tab edits again: place a stash item on the board.
    await buildTab();
    {
      const t0 = await B.team();
      const before = t0.buildings.length;
      await dropWall(spot.x, spot.y);
      const placed = (await B.team()).buildings.length === before + 1;
      check(
        placed,
        'two players: after Unready, a wall can be dropped on the same cell again',
      );
    }
    await shopTab();
  }

  await goMenu();

  const newErrors = consoleErrors.slice(errorsAtStart);
  check(
    newErrors.length === 0,
    `run flow: no console errors or warnings${newErrors.length ? ': ' + newErrors.join(' | ') : ''}`,
  );
}
