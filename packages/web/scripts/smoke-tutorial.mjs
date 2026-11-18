// The guided tutorial smoke (issue #309). Called from smoke.mjs with the
// shared page and helpers. Plain Node ESM, not part of the bundle.
//
// Starts "Play the tutorial", walks its steps (Place the Core, Mine Ore, feed
// a Barracks, power an Arc turret with the second Siphon on a Spark node),
// checks the coach card, the checklist, the locked slots and Ready, reloads
// to see the step resume, asserts the Arc turret is powered and "Before you
// fight" has no warnings before Ready (issue #322), then skips with
// confirmation. A plain "New run" shows no tips at all.

import { hookReady, slow } from './smoke-timing.mjs';

const ORE = 'res_a';
const POWER = 'res_b';

export async function runTutorialSmoke({ page, baseUrl, check, shot, settle }) {
  const card = page.locator('[data-field="tutorial-card"]');
  const listItems = page.locator('.tut-checklist li');
  const goMenu = async () => {
    await page.goto(`${baseUrl}#/?seed=7`);
    await page.waitForSelector('#main-menu');
    await page.waitForFunction(
      () => window.__debug?.menu?.storage() !== 'loading',
    );
    await settle();
  };
  const at = (x, y) =>
    page.evaluate(
      ([cx, cy]) => window.__debug.build.cellToScreen(cx, cy),
      [x, y],
    );
  const team = async () => {
    await hookReady(page, 'build');
    return await page.evaluate(() => window.__debug.build.team());
  };
  const title = async () =>
    (await card.locator('.tut-title').textContent()).trim();
  // The specialist pick comes first in every new run (RS-13): take the first
  // card and Ready; the Core placement opens.
  const pickSpecialist = async () => {
    await page.waitForSelector('#specialist-ready');
    await page.click('[data-action="pick-specialist"]');
    await page.waitForFunction(
      () => !document.querySelector('#specialist-ready')?.disabled,
    );
    await page.click('#specialist-ready');
    await page.waitForSelector('#core-confirm');
  };

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => {
    try {
      localStorage.removeItem('coop:tutorial-progress');
      localStorage.removeItem('coop:tutorial-completed');
      localStorage.removeItem('coop:phase-tips-seen');
    } catch {
      // Storage may be blocked.
    }
  });
  // The stores read storage once, at load.
  await page.reload();

  // A plain new run has no tutorial.
  await goMenu();
  await page.click('#new-run-button');
  await pickSpecialist();
  await settle();
  check(
    (await card.count()) === 0,
    'tutorial: a plain New run shows no tutorial card',
  );

  // Step 1: Place your Core.
  await goMenu();
  await page.click('#tutorial-button');
  await pickSpecialist();
  await page.waitForFunction(() => window.__debug?.placement?.legal);
  await settle();
  check(
    (await card.count()) === 1 && /Tutorial · 1 of 6/.test(await title()),
    `tutorial: step 1 of 6 on the Place Core screen ("${await title()}")`,
  );
  check(
    (await page
      .locator('.frame-info > [data-field="tutorial-card"]:first-child')
      .count()) === 1 &&
      (await page.locator('.frame-info > [data-field="phase-tip"]').count()) ===
        0,
    'tutorial: the coach card is first in the info rail, with no separate phase box',
  );
  check(
    /Place your Core/.test(await card.locator('h3').innerText()) &&
      (await card.locator('p strong').first().innerText()) === 'Place Core',
    'tutorial: step 1 points at Place Core',
  );
  check(
    (await card.locator('.tut-progress li').count()) === 6 &&
      (await listItems.count()) === 0,
    'tutorial: a 6-segment progress bar, no checklist on step 1',
  );
  await shot('tutorial-1-place-core');
  const legal = await page.evaluate(() => window.__debug.placement.legal());
  const pick = legal[Math.floor(legal.length / 2)];
  const pg = await page.evaluate(
    ([x, y]) => window.__debug.placement.cellToScreen(x, y),
    [pick.x, pick.y],
  );
  await page.mouse.click(pg.x, pg.y);
  await settle();
  await page.click('#core-confirm');
  await page.waitForFunction(() => window.__debug?.build?.step() === 'build');
  await settle();

  // Step 2: Mine some Ore.
  check(
    /Tutorial · 2 of 6/.test(await title()) &&
      /Mine some Ore/.test(await card.locator('h3').innerText()),
    `tutorial: step 2 "Mine some Ore" after the Core (${await title()})`,
  );
  check(
    (await listItems.count()) === 6 &&
      (await page.locator('.tut-checklist li.done').count()) === 1 &&
      (await page.locator('.tut-checklist li.current').count()) === 1,
    'tutorial: "Your first base" lists 6 steps, 1 done, 1 current',
  );
  check(
    (await page.locator('#ready-button').isDisabled()) &&
      /Unlocks at step 5/.test(await page.locator('#ready-button').innerText()),
    'tutorial: Ready is disabled and says "Unlocks at step 5"',
  );
  const extractor = page.locator('.stash-item[data-stash-def="bld_extractor"]');
  check(
    (await extractor.evaluate((e) => e.classList.contains('tut-target'))) &&
      !(await extractor.isDisabled()),
    'tutorial: the Siphon slot is ringed and usable',
  );
  const others = page.locator(
    '.stash-item:not([data-stash-def="bld_extractor"])',
  );
  const nOthers = await others.count();
  let lockedAll = nOthers > 0;
  for (let i = 0; i < nOthers; i++) {
    const o = others.nth(i);
    lockedAll &&=
      (await o.isDisabled()) &&
      (await o.evaluate((e) => e.classList.contains('tut-locked')));
  }
  check(lockedAll, `tutorial: the other ${nOthers} slots are faded and locked`);
  check(
    (await page
      .locator('.frame-info > [data-field="tutorial-card"] + .tut-checklist')
      .count()) === 1 &&
      (await page
        .locator('.tut-checklist')
        .evaluate((e) => getComputedStyle(e).position === 'static')),
    'tutorial: the checklist flows in the rail right under the coach card',
  );
  check(
    (await page.locator('#panel-overlay-legend').count()) === 0 &&
      (await page.locator('.key-hints').count()) === 0 &&
      (await page.locator('#panel-next-fight').count()) === 0,
    'tutorial: Map key, Keys and Next fight are hidden before step 5',
  );
  await shot('tutorial-2-mine-ore');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await settle();
  await shot('tutorial-2-mine-ore-1080p');
  await page.setViewportSize({ width: 1280, height: 800 });
  await settle();

  // A locked slot's key does nothing.
  const before = (await team()).stash.length;
  await page.keyboard.press('2');
  await settle();
  check(
    (await page.evaluate(() => window.__debug.build.ui().held)) === null &&
      (await team()).stash.length === before,
    'tutorial: a locked slot cannot be picked with its number key',
  );

  // Drag the Siphon onto an Ore node.
  const t0 = await team();
  const core0 = t0.cores[0];
  const byCore = (a, b) =>
    Math.hypot(a.x - core0.x, a.y - core0.y) -
    Math.hypot(b.x - core0.x, b.y - core0.y);
  const freeOf = (t, resource) =>
    t.nodes
      .filter(
        (n) =>
          n.resource === resource &&
          !t.buildings.some((b) => b.x === n.x && b.y === n.y),
      )
      .sort(byCore);
  const nodes = freeOf(t0, ORE);
  let placed = false;
  for (const node of nodes) {
    const box = await extractor.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    const p = await at(node.x, node.y);
    await page.mouse.move(p.x, p.y, { steps: 6 });
    await page.mouse.up();
    await page
      .waitForFunction(
        (n) => window.__debug.build.team().buildings.length > n,
        t0.buildings.length,
        { timeout: slow(600) },
      )
      .catch(() => undefined);
    if ((await team()).buildings.length > t0.buildings.length) {
      placed = true;
      break;
    }
    await page.keyboard.press('Escape');
  }
  check(placed, 'tutorial: a Siphon can be dragged onto a node');
  await settle();
  check(
    /Tutorial · 3 of 6/.test(await title()) &&
      /Feed a Barracks/.test(await card.locator('h3').innerText()) &&
      (await page.locator('.tut-checklist li.done').count()) === 2,
    `tutorial: the Siphon on a node finishes step 2 (${await title()})`,
  );
  // Select the new Siphon: the checklist must not cover the Selected panel.
  const placedAt = (await team()).buildings.find(
    (b) => b.x === nodes.find((n) => n.x === b.x && n.y === b.y)?.x,
  );
  if (placedAt !== undefined) {
    const cp = await at(placedAt.x, placedAt.y);
    await page.mouse.click(cp.x, cp.y);
    await settle();
  }
  const overlap = await page.evaluate(() => {
    const l = document.querySelector('.tut-checklist')?.getBoundingClientRect();
    const s = document
      .querySelector('#panel-inspector')
      ?.getBoundingClientRect();
    if (!l || !s) return null;
    return !(l.bottom <= s.top || s.bottom <= l.top);
  });
  check(
    overlap === false,
    `tutorial: the checklist box does not intersect the Selected panel (${String(overlap)})`,
  );
  const barracks = page.locator('.stash-item[data-stash-def="bld_barracks"]');
  check(
    !(await barracks.isDisabled()) &&
      (await barracks.evaluate((e) => e.classList.contains('tut-target'))),
    'tutorial: the Barracks slot unlocks and is ringed at step 3',
  );
  await shot('tutorial-3-feed-barracks');

  // Reload: the step resumes from the run.
  await page.reload();
  await page.waitForFunction(() => window.__debug?.build?.step() === 'build');
  await settle();
  check(
    /Tutorial · 3 of 6/.test(await title()) &&
      (await page.locator('.tut-checklist li.done').count()) === 2,
    'tutorial: a reload resumes at step 3',
  );

  // Steps 3 and 4: Barracks fed by a conduit, Arc turret powered by the second
  // Siphon on a Spark node (issue #322).
  const dragSlot = async (def, x, y) => {
    const box = await page
      .locator(`.stash-item[data-stash-def="${def}"]`)
      .first()
      .boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    const p = await at(x, y);
    await page.mouse.move(p.x, p.y, { steps: 6 });
    await page.mouse.up();
    await settle();
  };
  // Place `def` on the first candidate cell where it fits and, if a conduit
  // is wanted, can be wired (a cliff or water may be in the way): a building
  // that cannot be wired goes back to the inventory.
  const placeAny = async (def, cells, wire = null) => {
    const n0 = (await team()).buildings.length;
    for (const c of cells) {
      await dragSlot(def, c.x, c.y);
      const t = await team();
      if (t.buildings.length <= n0) {
        await page.keyboard.press('Escape');
        continue;
      }
      if (wire === null) return c;
      const built = t.buildings.find((b) => b.x === c.x && b.y === c.y);
      if (await wire(built)) return c;
      const p = await at(c.x, c.y);
      await page.mouse.click(p.x, p.y);
      await settle();
      await page.click('#panel-inspector [data-action="to-stash"]');
      await settle();
    }
    return null;
  };
  const around = (cx, cy, minDy, maxR) => {
    const out = [];
    for (let dy = minDy; dy <= maxR; dy++)
      for (let dx = -maxR; dx <= maxR; dx++)
        out.push({ x: cx + dx, y: cy + dy });
    return out
      .filter((c) => c.x >= 0 && c.y >= 0)
      .sort(
        (a, b) =>
          Math.hypot(a.x - cx, a.y - cy - minDy) -
          Math.hypot(b.x - cx, b.y - cy - minDy),
      );
  };
  const connect = async (from, to) => {
    const n0 = (await team()).conduits.length;
    await page.click('[data-tool="conduit"]');
    for (const c of [from, to]) {
      const p = await at(c.x, c.y);
      await page.mouse.move(p.x, p.y, { steps: 2 });
      await page.mouse.down();
      await page.mouse.up();
      await settle();
    }
    const ok = (await team()).conduits.length > n0;
    await page.click('[data-tool="select"]');
    return ok;
  };
  const tdef = (t, def) => t.buildings.filter((b) => b.def === def);

  const t1 = await team();
  const ex1 = tdef(t1, 'bld_extractor')[0];
  const bkAt = await placeAny(
    'bld_barracks',
    around(ex1.x, ex1.y, 2, 6),
    (bk) => connect(ex1, bk),
  );
  check(
    bkAt !== null,
    'tutorial: a Barracks near the Siphon can be wired to it with a conduit',
  );
  await page.waitForFunction(
    () => document.querySelector('.tut-checklist li.done:nth-child(3)'),
    null,
    { timeout: slow(5000) },
  );
  check(
    /Tutorial · 4 of 6/.test(await title()) &&
      (await page.locator('.tut-checklist li.done').count()) === 3,
    `tutorial: a fed Barracks finishes step 3 (${await title()})`,
  );

  // Step 4: the Arc turret next to the Core, without Spark it stays step 4.
  const core = (await team()).cores[0];
  const tuAt = await placeAny('bld_turret', around(core.x, core.y, 3, 5));
  check(
    tuAt !== null,
    'tutorial: an Arc turret can be placed next to the Core',
  );
  await settle();
  const tu = tdef(await team(), 'bld_turret')[0];
  check(
    /Tutorial · 4 of 6/.test(await title()) &&
      (await page.locator('.tut-checklist li.done').count()) === 3 &&
      /Power an Arc turret next to the Core/.test(
        await page.locator('.tut-checklist li[data-step="4"]').innerText(),
      ),
    'tutorial: an Arc turret without Spark does not finish step 4',
  );
  check(
    (await page.evaluate(() => window.__debug.build.problems())).some((p) =>
      /Arc turret has no conduit into its Spark input/.test(p.text),
    ),
    'tutorial: Before you fight warns the Arc turret has no conduit into its Spark input',
  );
  await shot('tutorial-4-power-turret');

  // The second Siphon goes on a Spark node near the Core.
  const powerNodes = freeOf(await team(), POWER);
  check(powerNodes.length > 0, 'tutorial: a Spark node is free on the map');
  const pwAt = await placeAny('bld_extractor', powerNodes.slice(0, 3), (ex) =>
    connect(ex, tu),
  );
  check(
    pwAt !== null,
    'tutorial: the second Siphon goes on a Spark node and a conduit reaches the Arc turret',
  );
  await settle();
  check(
    !(await page.evaluate(() => window.__debug.build.problems())).some((p) =>
      /Arc turret has no conduit/.test(p.text),
    ),
    'tutorial: the Arc turret receives Spark before the fight',
  );
  check(
    /Tutorial · 5 of 6/.test(await title()) &&
      (await page.locator('.tut-checklist li.done').count()) === 4,
    `tutorial: a powered Arc turret finishes step 4 (${await title()})`,
  );
  // The coach card never says the base is ready while a warning is listed.
  // Partly fed is a note, not a warning: the tutorial's lone Spark Siphon
  // leaves the Arc turret at 50%, and the card still says ready.
  const warnings = await page.evaluate(
    () => window.__debug.build.problems().filter((p) => p.warning).length,
  );
  const cardText = await card.innerText();
  check(
    warnings === 0
      ? /Your base is ready/.test(cardText)
      : /Before you fight/.test(cardText) &&
          !/Your base is ready/.test(cardText),
    `tutorial: "Your base is ready" only without blocking warnings (${warnings} listed)`,
  );
  check(
    warnings === 0,
    `tutorial: the tutorial's own path leaves no blocking warning (${warnings} listed)`,
  );
  await shot('tutorial-5-ready');

  // Skip asks first, then hides every tip and unlocks everything.
  await page.click('[data-action="tutorial-skip"]');
  check(
    (await card.locator('[data-field="skip-confirm"]').count()) === 1 &&
      (await card.count()) === 1,
    'tutorial: Skip asks for confirmation',
  );
  await shot('tutorial-skip-confirm');
  await page.click('[data-action="tutorial-skip-no"]');
  check(
    (await card.locator('[data-field="skip-confirm"]').count()) === 0,
    'tutorial: "Keep going" closes the question',
  );
  await page.click('[data-action="tutorial-skip"]');
  await page.click('[data-action="tutorial-skip-yes"]');
  await settle();
  check(
    (await card.count()) === 0 &&
      (await page.locator('.tut-checklist').count()) === 0 &&
      (await page.locator('.tut-locked').count()) === 0 &&
      !/Unlocks at step 5/.test(
        await page.locator('#ready-button').innerText(),
      ),
    'tutorial: after Skip no card, checklist or locks remain',
  );
  await page.reload();
  await page.waitForFunction(() => window.__debug?.build?.step() === 'build');
  await settle();
  check(
    (await card.count()) === 0,
    'tutorial: a skipped tutorial stays skipped after a reload',
  );
  await page.evaluate(() => {
    try {
      localStorage.removeItem('coop:tutorial-progress');
    } catch {
      // Storage may be blocked.
    }
  });
}
