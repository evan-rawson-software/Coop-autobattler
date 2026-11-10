// Browser smoke test for the web app. Plain Node ESM, not part of the bundle.
//
// Serves packages/web/dist-debug (built with `--mode debug`, which installs
// the read-only window.__debug hook), drives it with Playwright, takes
// screenshots into packages/web/smoke-output/ and exits non-zero on failure.
//
// Run it with `pnpm smoke` from the repository root. It needs Playwright with
// Chromium installed globally (CI has no browser, so CI does not run it).

import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, '..');
const distDir = path.resolve(webDir, process.argv[2] ?? 'dist-debug');
const outDir = path.join(webDir, 'smoke-output');
mkdirSync(outDir, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let file = path.join(distDir, decodeURIComponent(url.pathname));
  if (!file.startsWith(distDir)) {
    res.writeHead(403).end();
    return;
  }
  try {
    if (statSync(file).isDirectory()) file = path.join(file, 'index.html');
    const body = readFileSync(file);
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/`;

const failures = [];
function check(ok, message) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${message}`);
  if (!ok) failures.push(message);
}

const resources = JSON.parse(
  readFileSync(path.resolve(webDir, '../../content/resources.json'), 'utf8'),
).resources;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
});
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') {
    consoleErrors.push(`${m.type()}: ${m.text()}`);
  }
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

const shot = (name) =>
  page.screenshot({ path: path.join(outDir, `${name}.png`) });
const camera = () => page.evaluate(() => window.__debug.camera());
const viewport = () => page.evaluate(() => window.__debug.viewport());
const settle = () =>
  page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
const canvasBox = async () => await page.locator('canvas').boundingBox();

try {
  await page.goto(baseUrl);
  await page.waitForSelector('canvas');
  await page.waitForFunction(
    () => window.__debug?.camera && window.__debug.viewport().w > 0,
  );
  await settle();

  // --- Page basics
  const scroll = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    sh: document.documentElement.scrollHeight,
    iw: window.innerWidth,
    ih: window.innerHeight,
    bw: document.body.scrollWidth,
    bh: document.body.scrollHeight,
  }));
  check(
    scroll.sw <= scroll.iw &&
      scroll.sh <= scroll.ih &&
      scroll.bw <= scroll.iw &&
      scroll.bh <= scroll.ih,
    `no page scrollbar at 1920x1080 (${JSON.stringify(scroll)})`,
  );
  const footer = await page.locator('#build-id').innerText();
  check(
    /Build \S+ . \S+/.test(footer),
    `build identifier footer visible: "${footer}"`,
  );

  // --- Content-driven names: legend and node letters follow resources.json
  const legend = await page.locator('#panel-legend').innerText();
  for (const r of resources) {
    check(
      legend.includes(r.name),
      `legend lists resource name "${r.name}" from content`,
    );
  }

  // --- Default view, party of one
  let cam = await camera();
  let vp = await viewport();
  check(cam.zoom === 32, `camera starts at default zoom (${cam.zoom})`);
  check(
    Math.abs(cam.cx - 12) < 1.7 && Math.abs(cam.cy - 8) < 1.7,
    `camera starts at the board centre (${cam.cx.toFixed(2)}, ${cam.cy.toFixed(2)})`,
  );
  const boardW = 24 * cam.zoom;
  const boardH = 16 * cam.zoom;
  check(
    boardW <= vp.w && boardH <= vp.h,
    `one-plot board fits the view: ${boardW}x${boardH} in ${vp.w}x${vp.h}`,
  );
  const dock = await page.locator('[data-dock="bottom"]').boundingBox();
  const view = await page.locator('.main-view').boundingBox();
  check(
    dock !== null && view !== null && dock.y >= view.y + view.height - 1,
    `bottom dock sits below the board view (dock y=${dock?.y}, view bottom=${view && view.y + view.height})`,
  );
  const counts = await page.evaluate(() => window.__debug.counts());
  check(
    counts.buildings > 5 && counts.conduits > 0,
    `sample has buildings and conduits (${JSON.stringify(counts)})`,
  );
  await shot('1-default-party1');

  // --- Camera presets with four plots
  await page.selectOption('#party-size', '4');
  await settle();
  const centre4 = await camera();
  check(
    Math.abs(centre4.cx - 48) < 0.01,
    `party 4: starts at the board centre x (${centre4.cx})`,
  );
  await page.click('[data-camera="base"]');
  await settle();
  const base4 = await camera();
  check(
    base4.cx !== centre4.cx || base4.cy !== centre4.cy,
    `My base moves the camera (${base4.cx.toFixed(1)}, ${base4.cy.toFixed(1)})`,
  );
  await page.click('[data-camera="center"]');
  await settle();
  const c2 = await camera();
  check(
    Math.abs(c2.cx - centre4.cx) < 0.01 && Math.abs(c2.cy - centre4.cy) < 0.01,
    'Center returns to the centre',
  );
  await page.click('[data-camera="fit"]');
  await settle();
  const fit4 = await camera();
  vp = await viewport();
  check(
    96 * fit4.zoom <= vp.w,
    `party 4 fits the width after Fit (${(96 * fit4.zoom).toFixed(0)} of ${vp.w}px, ${fit4.zoom.toFixed(1)} px/cell)`,
  );
  await shot('2-party4-fit');

  // --- Party 2 with the enemy board
  await page.selectOption('#party-size', '2');
  await page.check('#show-enemy');
  await settle();
  await page.click('[data-camera="fit"]');
  await settle();
  const fit2e = await camera();
  vp = await viewport();
  check(
    fit2e.zoom * (16 + 6 + 16) <= vp.h && fit2e.zoom * 48 <= vp.w,
    `party 2 + enemy fits after Fit (${fit2e.zoom.toFixed(1)} px/cell)`,
  );
  await shot('3-party2-enemy-fit');
  await page.uncheck('#show-enemy');
  await page.selectOption('#party-size', '1');
  await settle();

  // --- Wheel zoom and drag
  const box = await canvasBox();
  const mx = box.x + box.width / 2 + 100;
  const my = box.y + box.height / 2 + 50;
  const before = await camera();
  await page.mouse.move(mx, my);
  await page.mouse.wheel(0, -400);
  await settle();
  const zoomed = await camera();
  check(
    zoomed.zoom > before.zoom,
    `wheel zoom in changes zoom (${before.zoom.toFixed(1)} -> ${zoomed.zoom.toFixed(1)})`,
  );
  await page.mouse.wheel(0, 200);
  await settle();
  const zoomedOut = await camera();
  check(zoomedOut.zoom < zoomed.zoom, 'wheel zoom out reduces zoom');
  await page.mouse.wheel(0, -600);
  await settle();
  const z3 = await camera();
  await page.mouse.move(mx, my);
  await page.mouse.down();
  await page.mouse.move(mx + 80, my + 40, { steps: 8 });
  await page.mouse.up();
  await settle();
  const dragged = await camera();
  check(
    Math.abs(dragged.cx - z3.cx) > 0.1 || Math.abs(dragged.cy - z3.cy) > 0.1,
    `drag pans the camera (${z3.cx.toFixed(2)},${z3.cy.toFixed(2)} -> ${dragged.cx.toFixed(2)},${dragged.cy.toFixed(2)})`,
  );
  const selAfterDrag = await page.evaluate(() => window.__debug.selection());
  check(selAfterDrag === null, 'a drag is not a click (nothing selected)');
  await shot('4-zoomed-in');

  // --- Hover and selection of a building
  await page.click('[data-camera="center"]');
  await settle();
  const b2 = await canvasBox();
  let found = null;
  for (let y = b2.y + 20; y < b2.y + b2.height - 20 && !found; y += 8) {
    for (let x = b2.x + 20; x < b2.x + b2.width - 20; x += 8) {
      await page.mouse.move(x, y);
      const h = await page.evaluate(() => window.__debug.hovered());
      if (h && h.building && h.building !== 'core') {
        found = { x, y, h };
        break;
      }
    }
  }
  check(found !== null, 'found a building under the pointer by hovering');
  if (found) {
    const hoverText = await page.locator('#panel-hover').innerText();
    check(
      hoverText.includes('Building:'),
      'hover panel names what is under the cursor',
    );
    await page.mouse.click(found.x, found.y);
    await settle();
    const sel = await page.evaluate(() => window.__debug.selection());
    check(
      sel !== null && typeof sel.building === 'number',
      'click selects the building',
    );
    const name = await page
      .locator('#panel-selected [data-field="name"]')
      .innerText();
    check(
      name.length > 0,
      `selection panel shows the building name: "${name}"`,
    );
    const panel = await page.locator('#panel-selected').innerText();
    check(
      /Tier/.test(panel) && /Rotation/.test(panel) && /Owner/.test(panel),
      'selection panel shows tier, rotation and owner',
    );
    check(!/\{res_/.test(panel), 'description placeholders are resolved');
  }
  await shot('5-selected');

  // --- 1280x720
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.selectOption('#party-size', '4');
  await settle();
  await page.click('[data-camera="fit"]');
  await settle();
  const sm = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    sh: document.documentElement.scrollHeight,
  }));
  check(
    sm.sw <= 1280 && sm.sh <= 720,
    `no page scrollbar at 1280x720 (${JSON.stringify(sm)})`,
  );
  const overlap = await page.evaluate(() => {
    const r = (s) => document.querySelector(s)?.getBoundingClientRect();
    const v = r('.main-view');
    const rects = ['[data-dock="bottom"]', '[data-dock="right"]'].map(r);
    return rects.some(
      (d) =>
        d &&
        v &&
        d.left < v.right - 1 &&
        d.right > v.left + 1 &&
        d.top < v.bottom - 1 &&
        d.bottom > v.top + 1,
    );
  });
  check(!overlap, 'docks do not overlap the board view at 1280x720');
  await shot('6-1280x720');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.selectOption('#party-size', '1');
  await settle();

  // --- Dark theme
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.click('[data-camera="center"]');
  await settle();
  await shot('7-dark');
  await page.emulateMedia({ colorScheme: 'light' });

  // --- Performance on a dense four-plot sample
  await page.evaluate(() => window.__debug.setDense(true));
  await page.selectOption('#party-size', '4');
  await page.waitForFunction(
    () => window.__debug.counts().buildings > 150,
    null,
    { timeout: 120000 },
  );
  await settle();
  const dense = await page.evaluate(() => window.__debug.counts());
  console.log(`dense sample: ${JSON.stringify(dense)}`);
  check(
    dense.buildings >= 200,
    `dense sample has hundreds of buildings (${dense.buildings} buildings, ${dense.conduits} conduits, ${dense.conduitCells} conduit cells)`,
  );
  await page.click('[data-camera="fit"]');
  await settle();
  await shot('8-dense-fit');

  async function measure(label, action) {
    await page.evaluate(() => {
      window.__frames = [];
      window.__running = true;
      window.__debug.resetDrawStats();
      const tick = (t) => {
        if (!window.__running) return;
        window.__frames.push(t);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await action();
    const result = await page.evaluate(() => {
      window.__running = false;
      const f = window.__frames;
      const d = [];
      for (let i = 1; i < f.length; i++) d.push(f[i] - f[i - 1]);
      d.sort((a, b) => a - b);
      const mean = d.reduce((a, b) => a + b, 0) / Math.max(1, d.length);
      return {
        frames: f.length,
        meanFrameMs: mean,
        p95FrameMs: d[Math.floor(d.length * 0.95)] ?? 0,
        maxFrameMs: d[d.length - 1] ?? 0,
        draw: window.__debug.drawStats(),
      };
    });
    console.log(`perf ${label}: ${JSON.stringify(result)}`);
    return { label, ...result };
  }

  const perfBox = await canvasBox();
  const px = perfBox.x + perfBox.width / 2;
  const py = perfBox.y + perfBox.height / 2;
  const perf = [];
  perf.push(
    await measure('drag at fit zoom', async () => {
      await page.mouse.move(px, py);
      await page.mouse.down();
      for (let i = 0; i < 240; i++) {
        await page.mouse.move(
          px + 150 * Math.sin(i / 20),
          py + 100 * Math.cos(i / 15),
        );
      }
      await page.mouse.up();
    }),
  );
  await page.mouse.move(px, py);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -250);
  await settle();
  const zoomedCam = await camera();
  perf.push(
    await measure(
      `drag zoomed in (${zoomedCam.zoom.toFixed(0)} px/cell)`,
      async () => {
        await page.mouse.move(px, py);
        await page.mouse.down();
        for (let i = 0; i < 240; i++) {
          await page.mouse.move(
            px + 200 * Math.sin(i / 20),
            py + 120 * Math.cos(i / 15),
          );
        }
        await page.mouse.up();
      },
    ),
  );
  perf.push(
    await measure('wheel zoom in and out', async () => {
      await page.mouse.move(px, py);
      for (let i = 0; i < 60; i++) {
        await page.mouse.wheel(0, i % 2 === 0 ? -120 : 120);
      }
    }),
  );
  writeFileSync(
    path.join(outDir, 'perf.json'),
    JSON.stringify({ dense, perf }, null, 2),
  );
  for (const p of perf) {
    check(
      p.meanFrameMs < 33,
      `${p.label}: mean frame ${p.meanFrameMs.toFixed(1)} ms (draw ${p.draw.meanMs.toFixed(2)} ms mean, ${p.draw.maxMs.toFixed(1)} ms max)`,
    );
  }

  check(
    consoleErrors.length === 0,
    `no console errors or warnings${consoleErrors.length ? ': ' + consoleErrors.join(' | ') : ''}`,
  );
} catch (error) {
  console.error(error);
  failures.push(
    `script error: ${error instanceof Error ? error.message : String(error)}`,
  );
} finally {
  await browser.close();
  server.close();
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:`);
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}
console.log(`\nAll checks passed. Screenshots are in ${outDir}`);
