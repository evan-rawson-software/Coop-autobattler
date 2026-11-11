// Sprite board smoke checks (issue #80). Called from smoke.mjs with the shared
// browser and helpers. Plain Node ESM, not part of the bundle.
//
// The board draws from the atlas once it has loaded, and falls back to the
// flat shapes while it has not or if it never does. Both are checked here:
// once normally, and once with the atlas request (then a sheet) blocked.

import path from 'node:path';

export const spritesInfo = (page) =>
  page.evaluate(() => window.__debug?.sprites?.() ?? null);

/** Wait until the sprite state leaves `idle` and `loading`. */
export const waitSprites = (page, timeout = 15000) =>
  page.waitForFunction(
    () => {
      const s = window.__debug?.sprites?.();
      return s !== undefined && s.state !== 'idle' && s.state !== 'loading';
    },
    undefined,
    { timeout },
  );

/** Count non-transparent pixels in the board canvas (a blank board has none). */
const inkedPixels = (page) =>
  page.evaluate(() => {
    const cv = document.querySelector('canvas[data-testid="board-canvas"]');
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return -1;
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  });

export async function runArtSmoke({
  browser,
  baseUrl,
  check,
  outDir,
  page,
  settle,
}) {
  // --- Normal: the board is drawn from the atlas.
  await page.goto(`${baseUrl}#debug`);
  await page.waitForSelector('canvas[data-testid="board-canvas"]');
  await waitSprites(page);
  await settle();
  await page.waitForTimeout(150);
  const ok = await spritesInfo(page);
  check(
    ok !== null && ok.state === 'ready',
    `art: the atlas and sheets load (${JSON.stringify(ok)})`,
  );
  check(
    ok !== null && ok.spriteFrames > 0 && ok.drawn > 0 && ok.layerBuilds > 0,
    `art: the Debug board is drawn from the atlas (${JSON.stringify(ok)})`,
  );
  const cam = await page.evaluate(() => window.__debug.camera());
  check(
    cam.zoom >= 12,
    `art: sprites are used at this zoom (${cam.zoom.toFixed(1)} px a cell)`,
  );

  // --- The atlas itself is a separate asset, not part of the first paint.
  const assets = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((e) => e.name.split('/').pop() ?? ''),
  );
  check(
    assets.some((a) => /^atlas-.*\.json$/.test(a)) &&
      assets.some((a) => /^tiles-.*\.png$/.test(a)),
    `art: the atlas JSON and the tiles sheet are separate requests (${assets.filter((a) => /atlas|tiles|buildings|ui-/.test(a)).join(', ')})`,
  );

  // --- Fallback: the atlas request fails; the board must still render.
  for (const [what, pattern] of [
    ['atlas JSON', '**/assets/atlas-*.json'],
    ['tiles sheet', '**/assets/tiles-*.png'],
  ]) {
    const ctx = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    });
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    p.on('console', (m) => {
      // The blocked request itself is logged by the browser; that is expected.
      if (
        (m.type() === 'error' || m.type() === 'warning') &&
        !/Failed to load resource|ERR_FAILED|net::/.test(m.text())
      ) {
        errors.push(`${m.type()}: ${m.text()}`);
      }
    });
    await p.route(pattern, (route) => route.abort());
    await p.goto(`${baseUrl}#debug`);
    await p.waitForSelector('canvas[data-testid="board-canvas"]');
    await waitSprites(p);
    await p.waitForFunction(
      () => window.__debug?.camera && window.__debug.viewport().w > 0,
    );
    await p.waitForTimeout(300);
    const info = await spritesInfo(p);
    const inked = await inkedPixels(p);
    check(
      info !== null &&
        info.state === 'failed' &&
        info.spriteFrames === 0 &&
        info.flatFrames > 0,
      `art fallback (${what} blocked): the state is failed and only flat frames were drawn (${JSON.stringify(info)})`,
    );
    check(
      inked > 100000,
      `art fallback (${what} blocked): the board still renders (${inked} inked pixels)`,
    );
    if (what === 'atlas JSON') {
      await p.screenshot({ path: path.join(outDir, 'art2-fallback-flat.png') });
    }
    check(
      errors.length === 0,
      `art fallback (${what} blocked): no uncaught errors${errors.length ? ': ' + errors.join(' | ') : ''}`,
    );
    await ctx.close();
  }
}
