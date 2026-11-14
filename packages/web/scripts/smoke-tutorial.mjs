// The guided tutorial smoke (issue #309). Called from smoke.mjs with the
// shared page and helpers. Plain Node ESM, not part of the bundle.
//
// Starts "Play the tutorial", walks its first steps (Place the Core, Mine
// Ore), checks the coach card, the checklist, the locked slots and Ready,
// reloads to see the step resume, then skips with confirmation. A plain
// "New run" shows no tips at all.

import { hookReady, slow } from './smoke-timing.mjs';

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
  await page.waitForSelector('#core-confirm');
  await settle();
  check(
    (await card.count()) === 0,
    'tutorial: a plain New run shows no tutorial card',
  );

  // Step 1: Place your Core.
  await goMenu();
  await page.click('#tutorial-button');
  await page.waitForSelector('#core-confirm');
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
      (await card.locator('p strong').first().innerText()) === 'green area',
    'tutorial: step 1 names the green area',
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
    'tutorial: the Extractor slot is ringed and usable',
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
    (await page.locator('.frame-info > .tut-checklist').count()) === 1 &&
      (await page.evaluate(() => {
        const l = document
          .querySelector('.tut-checklist')
          .getBoundingClientRect();
        const i = document.querySelector('.frame-info').getBoundingClientRect();
        return Math.abs(l.bottom - i.bottom) < 24;
      })),
    'tutorial: the checklist is pinned to the bottom of the info rail',
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

  // Drag the Extractor onto an Ore node.
  const t0 = await team();
  const barracksNeeds = null;
  void barracksNeeds;
  const nodes = t0.nodes.filter(
    (n) => !t0.buildings.some((b) => b.x === n.x && b.y === n.y),
  );
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
  check(placed, 'tutorial: an Extractor can be dragged onto a node');
  await settle();
  check(
    /Tutorial · 3 of 6/.test(await title()) &&
      /Feed a Barracks/.test(await card.locator('h3').innerText()) &&
      (await page.locator('.tut-checklist li.done').count()) === 2,
    `tutorial: the Extractor on a node finishes step 2 (${await title()})`,
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
