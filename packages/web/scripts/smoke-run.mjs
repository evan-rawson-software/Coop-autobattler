// Run flow smoke checks (issue W2-9). Called from smoke.mjs with the shared
// page and helpers. Plain Node ESM, not part of the bundle.
//
// Plays real runs from the main menu with fixed seeds: Core placement, the
// first build, PvE choice, battle (skipped), event with its follow-up, shop,
// PvP battle, a second round, the run-over screen (by defeat and by
// abandoning), reloads at each screen, and several saved runs at once.

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
      mark(t.core.x, t.core.y, 2, 2);
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
          disabled: e.querySelector('[data-action="choose-option"]').disabled,
        })),
      );
    const parsed = opts.map((o) => ({
      ...o,
      price: Number(/Costs (\d+) gold/.exec(o.text)?.[1]),
      from: Number(/Tier (\d) → tier (\d)/.exec(o.text)?.[1]),
      to: Number(/Tier (\d) → tier (\d)/.exec(o.text)?.[2]),
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
            `Upgraded .+ to tier ${pickOpt.to} for ${pickOpt.price} gold`,
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
    mark(t.core.x, t.core.y, 2, 2);
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
        /Ready is blocked: Barracks \(column \d+, row \d+\) is walled in\. Its units cannot reach the front/.test(
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
      /Walled in\. Its units cannot reach the front — open a path or add a gate\./.test(
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
      /Place the Core/.test(bar0) &&
      (await page.locator('#menu-button').count()) === 1 &&
      /saved after every action/i.test(bar0),
    `top bar: round, lives, step (no gold before the kit), Menu, and the saved note ("${bar0.replace(/\s+/g, ' ')}")`,
  );
  check(
    await page.locator('#core-confirm').isDisabled(),
    'Core placement: Confirm is disabled until a position is chosen',
  );
  const legal = await page.evaluate(() => window.__debug.placement.legal());
  const legalKey = new Set(legal.map((c) => `${c.x},${c.y}`));
  const bt = await page.evaluate(() => ({
    w: window.__debug.placement.legal().length,
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
    ([x, y]) => window.__debug.placement.cellToScreen(x, y),
    [bad.x, bad.y],
  );
  await page.mouse.move(pBad.x, pBad.y);
  await settle();
  const badHint = await page.locator('#core-hint').innerText();
  check(
    /edge|Water|cliff|node|front/i.test(badHint),
    `Core placement: an illegal cell is explained in words ("${badHint}")`,
  );
  await page.mouse.click(pBad.x, pBad.y);
  await settle();
  check(
    (await page.locator('#core-confirm').isDisabled()) &&
      (await page.evaluate(() => window.__debug.placement.selected())) === null,
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
    ([x, y]) => window.__debug.placement.cellToScreen(x, y),
    [pick.x, pick.y],
  );
  await page.mouse.move(pGood.x, pGood.y);
  await settle();
  check(
    (await page.evaluate(() => window.__debug.placement.pathCount())) > 0,
    'Core placement: the routes enemy units would take are shown for a legal position',
  );
  // After the illegal click, the hint follows the pointer to a legal cell.
  const goodHint = await page.locator('#core-hint').innerText();
  check(
    /fits here/i.test(goodHint) &&
      !/edge|Water|cliff|node|front/i.test(goodHint),
    `Core placement: the hint over a legal cell is not stale after an illegal click ("${goodHint}")`,
  );
  await page.mouse.click(pGood.x, pGood.y);
  await settle();
  check(
    !(await page.locator('#core-confirm').isDisabled()) &&
      JSON.stringify(
        await page.evaluate(() => window.__debug.placement.selected()),
      ) === JSON.stringify(pick),
    `Core placement: choosing a legal position enables Confirm (${pick.x}, ${pick.y})`,
  );
  await shot('run-3-core-selected');
  await shotDark('art2-core-placement');
  await reloadSame('Core placement');

  // Confirm: Core placed, cannot be moved.
  await page.waitForSelector('#core-confirm');
  await settle();
  const pPick = await page.evaluate(
    ([x, y]) => window.__debug.placement.cellToScreen(x, y),
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
    t1.core.x === pick.x && t1.core.y === pick.y,
    `Core confirmed at (${pick.x}, ${pick.y}); the first build opens`,
  );
  check(
    (await page.locator('#panel-core').count()) === 0 && t1.stash.length >= 4,
    `first build: the starting kit is in the stash (${t1.stash.length} buildings)`,
  );
  // The Core cannot be moved: drag it somewhere else.
  const actions0 = (await R.state()).actions;
  const pc = await at(t1.core.x, t1.core.y);
  const pTo = await at(t1.core.x + 3, Math.max(0, t1.core.y - 2));
  await page.mouse.move(pc.x, pc.y);
  await page.mouse.down();
  await page.mouse.move(pTo.x, pTo.y, { steps: 6 });
  await page.mouse.up();
  await frames(page, 6);
  await page.keyboard.press('Escape');
  const t1b = await B.team();
  check(
    t1b.core.x === pick.x &&
      t1b.core.y === pick.y &&
      (await R.state()).actions === actions0,
    'the Core cannot be moved after it is confirmed (a drag changes nothing)',
  );
  check(
    (await page.locator('.topbar-tabs button').allInnerTexts()).join() ===
      'Build',
    'first build: only the Build tab (there is no shop yet)',
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
        /^Overload at 3:00 would (destroy (the stronghold's Core first at \d+:\d\d — outlasting it wins|your Core first at \d+:\d\d — break the stronghold before then|both Cores at \d+:\d\d)|not destroy either Core)/.test(
          t.trim(),
        ),
      ) &&
      !(await page.locator('#pve-choice').innerText()).includes(
        'Destroy the stronghold before Overload',
      ),
    `PvE choice: every card states which Core Overload destroys first ("${overloadLines[0]}")`,
  );
  check(
    /no life lost/.test(await page.locator('.choice-banner').innerText()),
    'PvE choice: the stakes of losing are stated',
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
  await page.waitForFunction(() => window.__debug.battle.paused());
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
  await page.waitForFunction(() => window.__debug.battle.phase() === 'summary');
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
  await shot('run-6-battle-summary');
  await reloadSame('the battle summary');
  await page.waitForFunction(() => window.__debug.battle.phase() === 'summary');
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
    /^PvE battle (won|lost) · (Easy|Medium|Hard) · \w+/.test(header) &&
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
    evTexts.every((t) => t.trim().length > 10 && !/evt_|mod_/.test(t)),
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
          : /Tier \d → tier \d/.test(resolveText) &&
            /Costs \d+ gold/.test(resolveText) &&
            /On the board at column \d+, row \d+|In your stash/.test(
              resolveText,
            )),
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
      /Opponent: a ghost of Bundled \w+ bot \(shipped with the game\)/.test(
        shopText,
      ) && /Lose: -1 life/.test(shopText),
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
  await page.waitForFunction(() => window.__debug.battle.phase() === 'summary');
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
    /^PvP battle (won|lost) · vs\. Bundled \w+ bot/.test(header2),
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
          () => window.__debug.battle.phase() === 'summary',
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
      /Choose a PvE battle/.test(rowA) &&
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
    await page.evaluate(() => window.__debug.placement.legal())
  )[3];
  const pB = await page.evaluate(
    ([x, y]) => window.__debug.placement.cellToScreen(x, y),
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
    /Opponent: a ghost of (Runner|Bundled)/.test(
      await page.locator('#shop-screen').innerText(),
    ),
    'shop: "Opponent: a ghost of ..." is shown before the PvP battle',
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

  // A save from an older version and a damaged one.
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
      old.runVersion = '0.0';
      old.createArgs.runId = to;
      old.createArgs.runVersion = '0.0';
      old.state.runId = to;
      old.state.runVersion = '0.0';
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
  await page.waitForFunction(() => window.__debug?.menu?.runIds().length === 4);
  const oldRow = await page.locator('[data-run="old-version-run"]').innerText();
  check(
    /older version: some things may have changed/i.test(oldRow),
    'main menu: a run saved by an older version says so',
  );
  await page.click('[data-run="old-version-run"] [data-action="resume"]');
  await page.waitForSelector('#version-prompt');
  check(
    /some things may have changed/i.test(
      await page.locator('#version-prompt').innerText(),
    ),
    'resuming an older-version run shows the "some things may have changed" prompt',
  );
  await shot('run-12-older-version-prompt');
  await page.click('#version-continue');
  await page.waitForSelector('#version-prompt', { state: 'detached' });
  await waitStep('pve_choice');
  check(
    (await R.state()).runId === 'old-version-run' &&
      (await R.state()).step === 'pve_choice',
    'continuing from the prompt opens the run at its step',
  );
  await page.click('#menu-button');
  await page.waitForSelector('#main-menu');
  await page.waitForFunction(() => window.__debug?.menu?.runIds().length === 4);
  // Abandon the old-version copy; discard the damaged one.
  await page.click('[data-run="old-version-run"] [data-action="abandon"]');
  await page.click(
    '[data-run="old-version-run"] [data-action="abandon-confirm"]',
  );
  await page.waitForSelector('#run-over');
  await page.click('#over-menu');
  await page.waitForSelector('#main-menu');
  await page.waitForFunction(() => window.__debug?.menu?.runIds().length === 3);
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
    /cannot be undone/.test(
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
    /PvP battles/.test(final) &&
      /PvE battles/.test(final) &&
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

  const newErrors = consoleErrors.slice(errorsAtStart);
  check(
    newErrors.length === 0,
    `run flow: no console errors or warnings${newErrors.length ? ': ' + newErrors.join(' | ') : ''}`,
  );
}
