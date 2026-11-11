// Sprite preview smoke checks (#67). Called from smoke.mjs with the shared
// page and helpers. Plain Node ESM, not part of the bundle.
//
// Loads the #sprites route, waits for every sheet image, and takes
// screenshots of the main sections into smoke-output/.

export async function runSpritesSmoke({ page, baseUrl, check, shot, settle, consoleErrors }) {
  const errorsBefore = consoleErrors.length;
  const failedRequests = [];
  const onFail = (r) => failedRequests.push(r.url());
  page.on('requestfailed', onFail);
  page.on('response', (r) => {
    if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(`${baseUrl}#sprites`);
  await page.waitForSelector('#sprites-root[data-ready="true"]', { timeout: 15000 });
  await settle();
  const root = await page.evaluate(() => {
    const el = document.querySelector('#sprites-root');
    return {
      loaded: Number(el.dataset.imagesLoaded),
      failed: Number(el.dataset.imagesFailed),
      canvases: document.querySelectorAll('#sprites-root canvas').length,
      cards: document.querySelectorAll('[data-sprite]').length,
    };
  });
  check(
    root.loaded === 5 && root.failed === 0,
    `sprites: all 5 sheet images loaded (${JSON.stringify(root)})`,
  );
  check(
    root.cards > 80 && root.canvases > 200,
    `sprites: the page lists the atlas (${root.cards} cards, ${root.canvases} canvases)`,
  );
  const decoded = await page.evaluate(() =>
    [...document.images].every((i) => i.complete && i.naturalWidth > 0),
  );
  check(decoded, 'sprites: no broken <img> elements on the page');
  const shots = [
    ['.mock-board', 'sprites-1-board'],
    ['.unit-row[data-unit="unit_soldier"]', 'sprites-2-soldier'],
    ['[data-sprite="bld_core"]', 'sprites-3-core'],
  ];
  for (const [sel, name] of shots) {
    const loc = page.locator(sel).first();
    await loc.scrollIntoViewIfNeeded();
    await settle();
    await shot(name);
  }
  for (const [id, name] of [
    ['Mock board patch', 'sprites-top'],
    ['Units', 'sprites-units'],
    ['Buildings', 'sprites-buildings'],
    ['Conduits', 'sprites-conduits'],
    ['Interface', 'sprites-ui'],
  ]) {
    await page.locator('h3', { hasText: id }).first().scrollIntoViewIfNeeded();
    await page.evaluate((t) => {
      const h = [...document.querySelectorAll('h3')].find((e) => e.textContent === t);
      h?.scrollIntoView({ block: 'start' });
    }, id);
    await settle();
    await shot(name);
  }
  page.off('requestfailed', onFail);
  check(
    failedRequests.length === 0,
    `sprites: no failed requests${failedRequests.length ? ': ' + failedRequests.join(' | ') : ''}`,
  );
  check(
    consoleErrors.length === errorsBefore,
    `sprites: no console errors or warnings (${consoleErrors.slice(errorsBefore).join(' | ')})`,
  );
  await page.goto(baseUrl);
}
