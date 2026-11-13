// Browser smoke test for the web app. Plain Node ESM, not part of the bundle.
//
// Serves packages/web/dist-debug (built with `--mode debug`, which installs
// the read-only window.__debug hook), drives it with Playwright, takes
// screenshots into packages/web/smoke-output/ and exits non-zero on failure.
//
// Run it with `pnpm smoke` from the repository root. It uses the repo's
// pinned Playwright and the Chromium in Playwright's browser path (set
// PLAYWRIGHT_BROWSERS_PATH, or run `playwright install chromium`).
//
// CI_RELAXED_TIMING=1 (set in CI) multiplies the frame-interval limits by 3
// for slow shared runners; unset keeps the strict limits. Waits are on
// conditions with generous timeouts (see smoke-timing.mjs), not fixed sleeps.
// SMOKE_CPU_THROTTLE=<n> throttles Chromium's CPU n-fold to mimic a slow
// runner locally (and scales the timeouts and frame limits with it).

import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runShopSmoke } from './smoke-shop.mjs';
import { runSpritesSmoke } from './smoke-sprites.mjs';
import { runArtSmoke, spritesInfo } from './smoke-art.mjs';
import { runRunSmoke } from './smoke-run.mjs';
import { runWorkerSmoke } from './smoke-worker.mjs';
import {
  CPU_THROTTLE,
  TIMING,
  frames as waitFrames,
  slow,
} from './smoke-timing.mjs';

// Frame-interval limits: x3 on CI (CI_RELAXED_TIMING), and scaled by the CPU
// throttle when one is set on purpose, since that makes every frame slower.
const FRAME_SCALE = TIMING * CPU_THROTTLE;

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
  '.png': 'image/png',
};

// SMOKE_BASE_PATH=/Coop-autobattler/ serves the app under that prefix, like
// GitHub Pages does, to check that relative asset and worker URLs resolve.
const basePath = process.env.SMOKE_BASE_PATH ?? '/';
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith(basePath)) {
    res.writeHead(404).end('not found');
    return;
  }
  let file = path.join(
    distDir,
    decodeURIComponent(url.pathname.slice(basePath.length)),
  );
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
const baseUrl = `http://127.0.0.1:${server.address().port}${basePath}`;

const failures = [];
function check(ok, message) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${message}`);
  if (!ok) failures.push(message);
}

const resources = JSON.parse(
  readFileSync(path.resolve(webDir, '../../content/resources.json'), 'utf8'),
).resources;

const browser = await chromium.launch();

// SMOKE_CPU_THROTTLE=<rate> slows every page's CPU by that factor (CDP
// Emulation.setCPUThrottlingRate) so the slow-runner behaviour of CI can be
// reproduced locally, e.g. `SMOKE_CPU_THROTTLE=5 pnpm smoke`.
//
// Every context made through browser.newContext (here and in the smoke-*.mjs
// modules) also gets a generous default action/wait timeout: Playwright's own
// 30 s default is shorter than the main thread can be busy generating a
// four-plot map on a slow runner, and a timeout there is not a product failure.
if (CPU_THROTTLE > 1) console.log(`CPU throttle: ${CPU_THROTTLE}x`);
{
  const throttle = async (p) => {
    const cdp = await p.context().newCDPSession(p);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
  };
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...args) => {
    const ctx = await newContext(...args);
    ctx.setDefaultTimeout(slow(30000));
    if (CPU_THROTTLE > 1) {
      const newPage = ctx.newPage.bind(ctx);
      ctx.newPage = async (...a) => {
        const p = await newPage(...a);
        await throttle(p);
        return p;
      };
    }
    return ctx;
  };
}

// A context (not browser.newPage) so the Shop checks can open a second tab
// that shares this page's localStorage.
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') {
    consoleErrors.push(`${m.type()}: ${m.text()}`);
  }
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

const shot = (name) =>
  page.screenshot({ path: path.join(outDir, `${name}.png`) });
// A screenshot in the dark scheme, where the pixel skin applies (the page
// itself is driven in the default light scheme).
const shotDark = async (name) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await settle();
  await waitFrames(page, 15);
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  await page.emulateMedia({ colorScheme: 'light' });
  await settle();
};
const camera = () => page.evaluate(() => window.__debug.camera());
const viewport = () => page.evaluate(() => window.__debug.viewport());
const settle = () =>
  page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
const canvasBox = async () => await page.locator('canvas').boundingBox();

try {
  await page.goto(baseUrl + '#debug');
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
  await shotDark('art2-zoomed-in');

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
  // The pixel skin applies once the atlas has loaded: the root carries the
  // marker and the sprite variables hold real image data.
  await page.waitForFunction(
    () => document.documentElement.dataset.skin === 'pixel',
    undefined,
    { timeout: 10000 },
  );
  const skin = await page.evaluate(() => {
    const root = document.documentElement;
    return {
      skin: root.dataset.skin,
      bg: root.style.getPropertyValue('--sprite-ui-bg'),
    };
  });
  check(
    skin.skin === 'pixel' && skin.bg.startsWith('url("data:image/png'),
    `skin: the root has data-skin="pixel" and a sprite background variable (${skin.skin}, ${skin.bg.slice(0, 24)})`,
  );
  await page.emulateMedia({ colorScheme: 'light' });

  // --- Performance on a dense four-plot sample
  await page.evaluate(() => window.__debug.setDense(true));
  await page.selectOption('#party-size', '4');
  await page.waitForFunction(
    () => window.__debug.counts().buildings > 150,
    null,
    { timeout: slow(120000) },
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
      p.meanFrameMs < 33 * FRAME_SCALE,
      `${p.label}: mean frame ${p.meanFrameMs.toFixed(1)} ms (draw ${p.draw.meanMs.toFixed(2)} ms mean, ${p.draw.maxMs.toFixed(1)} ms max)`,
    );
  }

  // =========================================================================
  // Build screen (#build). The layout below is written for the default dev
  // seed (7): if the map generator changes, update BUILD_PLAN.
  // =========================================================================
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(baseUrl + '#build');
  await page.reload();
  await page.waitForFunction(
    () => window.__debug?.build?.step() === 'core_placement',
  );
  await page.waitForSelector('canvas');
  await settle();

  const B = {
    step: () => page.evaluate(() => window.__debug.build.step()),
    status: () => page.evaluate(() => window.__debug.build.status()),
    team: () => page.evaluate(() => window.__debug.build.team()),
    hash: () => page.evaluate(() => window.__debug.build.hash()),
    ui: () => page.evaluate(() => window.__debug.build.ui()),
    counts: () => page.evaluate(() => window.__debug.build.counts()),
    problems: () => page.evaluate(() => window.__debug.build.problems()),
    paths: () => page.evaluate(() => window.__debug.build.enemyPathCount()),
    dry: () => page.evaluate(() => window.__debug.build.dry()),
  };
  const at = (x, y) =>
    page.evaluate(
      ([cx, cy]) => window.__debug.build.cellToScreen(cx, cy),
      [x, y],
    );
  const pause = () => waitFrames(page, 4);
  const moveTo = async (x, y, steps = 3) => {
    const p = await at(x, y);
    await page.mouse.move(p.x, p.y, { steps });
    await settle();
  };
  const clickCell = async (x, y) => {
    await moveTo(x, y, 2);
    await page.mouse.down();
    await page.mouse.up();
    await pause();
  };
  async function dragStash(def, x, y, opts = {}) {
    const b = await page
      .locator(`[data-stash-def="${def}"]`)
      .first()
      .boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    const p = await at(x, y);
    await page.mouse.move(p.x, p.y, { steps: 8 });
    await settle();
    await pause();
    if (opts.shot) await shot(opts.shot);
    if (opts.rotate) {
      await page.keyboard.press('r');
      await pause();
    }
    if (opts.release !== false) {
      await page.mouse.up();
      await pause();
    }
  }
  async function dragBuilding(from, to, opts = {}) {
    const a = await at(from.x, from.y);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    const p = await at(to.x, to.y);
    await page.mouse.move(p.x, p.y, { steps: 8 });
    await settle();
    await pause();
    if (opts.peek) await opts.peek();
    await page.mouse.up();
    await pause();
  }
  const buildingOf = (team, def) => team.buildings.filter((b) => b.def === def);
  const BUILD_PLAN = {
    ex1: { x: 12, y: 9 }, // an Ore node
    barracks: { x: 12, y: 11 },
    ex2: { x: 15, y: 9 }, // a Power node
    turretLeft: { x: 9, y: 11 },
    turretRight: { x: 16, y: 12 },
    wall: { x: 5, y: 15 },
  };

  // --- Core placement
  check(
    (await B.step()) === 'core_placement',
    'build: run starts in core placement',
  );
  const legal = await page.evaluate(() => window.__debug.build.legalCore());
  check(
    legal.length > 20,
    `core placement lists legal positions (${legal.length})`,
  );
  const t0 = await B.team();
  const lake = t0.features[0];
  await moveTo(lake.x, lake.y);
  await shot('build-0a-core-placement-illegal');
  const coreGhostBad = (await B.ui()).coreGhost;
  check(
    coreGhostBad !== null &&
      coreGhostBad.ok === false &&
      coreGhostBad.message.length > 3,
    `core placement over water shows a reason: "${coreGhostBad?.message}"`,
  );
  const corePos = legal.find((c) => c.x === 10 && c.y === 3) ?? legal[0];
  await moveTo(corePos.x, corePos.y);
  await shot('build-0-core-placement');
  await clickCell(corePos.x, corePos.y);
  await page.waitForFunction(() => window.__debug.build.step() === 'build');
  await settle();
  const fresh = await B.team();
  check(
    fresh.cores[0] !== null &&
      fresh.cores[0].x === corePos.x &&
      fresh.cores[0].y === corePos.y,
    `Core placed at (${corePos.x}, ${corePos.y}) and the run entered build`,
  );
  check(
    fresh.stash.length === 7,
    `starting kit is in the stash (${fresh.stash.length} buildings)`,
  );
  const stashText = await page.locator('#panel-stash').innerText();
  check(
    /Extractor/.test(stashText) &&
      /Barracks/.test(stashText) &&
      /×\s*3/.test(stashText),
    'stash panel groups the kit with counts',
  );
  check(
    (await page.locator('.topbar-tabs button').allInnerTexts()).join(',') ===
      'Shop,Build' &&
      (await page.locator('.topbar-tabs button').first().isDisabled()),
    'Shop tab is present and disabled',
  );
  const noScroll = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    sh: document.documentElement.scrollHeight,
  }));
  check(
    noScroll.sw <= 1920 && noScroll.sh <= 1080,
    `build screen fits 1920x1080 without page scroll (${JSON.stringify(noScroll)})`,
  );
  const nodeA = fresh.nodes.find(
    (n) => n.x === BUILD_PLAN.ex1.x && n.y === BUILD_PLAN.ex1.y,
  );
  const nodeB = fresh.nodes.find(
    (n) => n.x === BUILD_PLAN.ex2.x && n.y === BUILD_PLAN.ex2.y,
  );
  check(
    nodeA !== undefined &&
      nodeB !== undefined &&
      nodeA.resource !== nodeB.resource,
    'seed 7 map has the two nodes the smoke plan uses',
  );
  await shot('build-1-fresh');
  const hashes = [await B.hash()];
  const pushHash = async () => hashes.push(await B.hash());

  // --- Place by drag: legal ghost, illegal with reason, real placement
  await dragStash('bld_extractor', BUILD_PLAN.ex1.x, BUILD_PLAN.ex1.y, {
    shot: 'build-2-drag-legal',
    release: false,
  });
  const ghostOk = (await B.ui()).ghost;
  check(
    ghostOk !== null && ghostOk.ok === true,
    'mid-drag ghost over a node is legal',
  );
  await page.mouse.up();
  await pause();
  let team = await B.team();
  check(
    buildingOf(team, 'bld_extractor').length === 1 && team.stash.length === 6,
    'dragging an extractor onto a node places it (stash 7 -> 6)',
  );
  await pushHash();

  // Illegal: an extractor off a node.
  await dragStash('bld_extractor', 8, 7, {
    shot: 'build-3-drag-illegal',
    release: false,
  });
  const ghostBad = (await B.ui()).ghost;
  check(
    ghostBad !== null &&
      ghostBad.ok === false &&
      /Extractors only go on/.test(ghostBad.message),
    `illegal ghost shows core's reason: "${ghostBad?.message}"`,
  );
  await page.mouse.up();
  await pause();
  const stBad = await B.status();
  check(
    stBad.kind === 'error' && /Extractors only go on/.test(stBad.text),
    `status line explains the refusal: "${stBad.text}"`,
  );
  team = await B.team();
  check(team.stash.length === 6, 'a refused drop leaves the stash unchanged');
  // Illegal: on water or a cliff.
  await dragStash('bld_barracks', lake.x, lake.y);
  const stLake = await B.status();
  check(
    stLake.kind === 'error' && /\(\d+, \d+\)/.test(stLake.text),
    `terrain refusal names the cell: "${stLake.text}"`,
  );

  await dragStash('bld_barracks', BUILD_PLAN.barracks.x, BUILD_PLAN.barracks.y);
  await dragStash('bld_extractor', BUILD_PLAN.ex2.x, BUILD_PLAN.ex2.y);
  await dragStash(
    'bld_turret',
    BUILD_PLAN.turretLeft.x,
    BUILD_PLAN.turretLeft.y,
  );
  team = await B.team();
  check(
    team.stash.length === 3 && team.buildings.length === 4,
    'extractors, barracks and turret are placed',
  );
  await pushHash();
  const bk = buildingOf(team, 'bld_barracks')[0];
  const ex1 = team.buildings.find(
    (b) => b.x === BUILD_PLAN.ex1.x && b.y === BUILD_PLAN.ex1.y,
  );
  const ex2 = team.buildings.find(
    (b) => b.x === BUILD_PLAN.ex2.x && b.y === BUILD_PLAN.ex2.y,
  );
  const tu = buildingOf(team, 'bld_turret')[0];

  // --- Problems: click one
  const probs = await B.problems();
  check(
    probs.some((p) => p.kind === 'missing_input') &&
      probs.some((p) => p.kind === 'lost_output'),
    `problems list reports unconnected buildings (${probs.length} items)`,
  );
  await page.click('[data-problem="missing_input"]');
  await pause();
  const afterProblem = await B.ui();
  check(
    afterProblem.selection?.kind === 'building',
    'clicking a problem selects the building and focuses the camera',
  );
  await page.mouse.move(960, 300);
  await page.mouse.wheel(0, -500);
  await settle();
  const camZoomed = await camera();
  await page.click('[data-problem="lost_output"]');
  await settle();
  const camFocus = await camera();
  check(
    camFocus.cx !== camZoomed.cx || camFocus.cy !== camZoomed.cy,
    `clicking a problem moves the camera (${camZoomed.cx.toFixed(1)},${camZoomed.cy.toFixed(1)} -> ${camFocus.cx.toFixed(1)},${camFocus.cy.toFixed(1)})`,
  );
  await page.click('[data-camera="fit"]');
  await settle();

  // --- Rotate the held building, and a placed one
  await dragStash('bld_wall', BUILD_PLAN.wall.x, BUILD_PLAN.wall.y, {
    rotate: true,
    release: false,
  });
  check(
    (await B.ui()).held.rotation === 90,
    'R rotates the building being dragged',
  );
  await page.mouse.up();
  await pause();
  team = await B.team();
  const wall = buildingOf(team, 'bld_wall')[0];
  check(
    wall && wall.rotation === 90,
    'the wall was dropped with the chosen rotation',
  );
  await pushHash();
  await clickCell(BUILD_PLAN.wall.x, BUILD_PLAN.wall.y);
  await page.keyboard.press('r');
  await pause();
  team = await B.team();
  check(
    buildingOf(team, 'bld_wall')[0].rotation === 180,
    'R rotates the selected building in place',
  );
  await pushHash();
  check(
    (await B.status()).text === 'Rotated.',
    'status line confirms the rotation',
  );

  // --- Enemy paths overlay follows walls
  await page.click('[data-overlay="paths"]');
  await settle();
  const pathsWith = await B.paths();
  await shot('build-5-enemy-paths');
  await page.click('[data-tool="select"]');
  await clickCell(BUILD_PLAN.wall.x, BUILD_PLAN.wall.y);
  await page.click('#panel-inspector [data-action="to-stash"]');
  await pause();
  const pathsWithout = await B.paths();
  check(
    pathsWith > 0 && pathsWithout === pathsWith + 1,
    `enemy-path overlay updates when a front-row wall is removed (${pathsWith} -> ${pathsWithout} entries)`,
  );
  await pushHash();
  await page.click('#panel-tools [data-action="undo"]');
  await pause();
  check(
    (await B.paths()) === pathsWith,
    'undoing the return puts the wall (and its path change) back',
  );
  await page.click('#panel-tools [data-action="redo"]');
  await pause();
  await page.click('#panel-tools [data-action="undo"]');
  await pause();
  await page.click('[data-overlay="paths"]');

  // --- Conduit: auto-route extractor 1 -> barracks
  await page.click('[data-tool="conduit"]');
  await clickCell(ex1.x, ex1.y);
  check(
    /Extractor's north side/.test((await B.status()).text),
    'conduit tool: clicking a building shows its free output side',
  );
  await moveTo(bk.x, bk.y);
  await shot('build-8-conduit-preview');
  check(
    (await B.ui()).draftView?.ok === true,
    'live path preview is validated by core (ok) before clicking',
  );
  await clickCell(bk.x, bk.y);
  team = await B.team();
  check(
    team.conduits.length === 1,
    `auto-route connected the extractor to the barracks (${team.conduits[0]?.cells.length} cells)`,
  );
  await pushHash();
  const c1 = team.conduits[0];

  // --- Illegal crossing: extractor 2 -> turret across conduit 1
  const out2 = { x: ex2.x, y: ex2.y + 1 };
  await clickCell(out2.x, out2.y);
  let cx = out2.x;
  while (cx > BUILD_PLAN.turretLeft.x) {
    cx -= 1;
    await clickCell(cx, out2.y);
  }
  check(
    c1.cells.some(
      (c) => c.y === out2.y && c.x < out2.x && c.x > BUILD_PLAN.turretLeft.x,
    ),
    'the manual path really passes through conduit 1',
  );
  await clickCell(tu.x, tu.y);
  const stCross = await B.status();
  check(
    stCross.kind === 'error' &&
      /cross/i.test(stCross.text) &&
      /\(\d+, \d+\)/.test(stCross.text),
    `crossing attempt shows crosses_conduit's message with the cell: "${stCross.text}"`,
  );
  await shot('build-8b-conduit-crossing');
  check(
    (await B.team()).conduits.length === 1,
    'the crossing conduit was not added',
  );
  await page.keyboard.press('Escape');
  await pause();

  // --- Moving: the turret to the right side, then a manual path
  await page.click('[data-tool="select"]');
  await dragBuilding(BUILD_PLAN.turretLeft, BUILD_PLAN.turretRight);
  team = await B.team();
  const tu2 = buildingOf(team, 'bld_turret')[0];
  check(
    tu2.x === BUILD_PLAN.turretRight.x && tu2.y === BUILD_PLAN.turretRight.y,
    'dragging a placed building moves it',
  );
  await pushHash();
  await page.click('[data-tool="conduit"]');
  await clickCell(out2.x, out2.y);
  await clickCell(out2.x, out2.y + 1);
  await clickCell(tu2.x, tu2.y - 1);
  await clickCell(tu2.x, tu2.y);
  team = await B.team();
  check(
    team.conduits.length === 2,
    `manual path connected extractor 2 to the turret (${team.conduits[1]?.cells.length} cells)`,
  );
  await pushHash();

  // --- Moving a connected building warns, detaches, and undo restores it
  await page.click('[data-tool="select"]');
  const hashBeforeMove = await B.hash();
  let warned = '';
  await dragBuilding(
    { x: bk.x, y: bk.y },
    { x: bk.x + 1, y: bk.y },
    {
      peek: async () => {
        warned =
          (await B.status()).text + ' ' + ((await B.ui()).ghost?.warn ?? '');
      },
    },
  );
  team = await B.team();
  check(
    /detach/i.test(warned),
    `moving a connected building warns about detaching: "${warned.trim()}"`,
  );
  check(
    team.conduits.length === 1 &&
      buildingOf(team, 'bld_barracks')[0].x === bk.x + 1,
    'the move detached the barracks conduit',
  );
  await pushHash();
  await page.click('#panel-tools [data-action="undo"]');
  await pause();
  check(
    (await B.hash()) === hashBeforeMove &&
      (await B.team()).conduits.length === 2,
    'undo of a move restores the position and the detached conduit (hash equal)',
  );
  await page.click('#panel-tools [data-action="redo"]');
  await pause();
  check((await B.team()).conduits.length === 1, 'redo re-applies the move');
  await page.click('#panel-tools [data-action="undo"]');
  await pause();

  // --- Erase: a conduit goes, undo brings it back
  const hashFull = await B.hash();
  await page.click('[data-tool="erase"]');
  await clickCell(
    (await B.team()).conduits[1].cells[0].x,
    (await B.team()).conduits[1].cells[0].y,
  );
  check(
    (await B.team()).conduits.length === 1,
    'erase tool removes the clicked conduit',
  );
  await page.click('#panel-tools [data-action="undo"]');
  await pause();
  check(
    (await B.hash()) === hashFull,
    'undo of an erase restores the exact layout',
  );
  await page.click('[data-tool="select"]');

  // --- Undo/redo through everything: hashes match at every step
  const actionsBefore = (await B.counts()).actions;
  const chain = [];
  while ((await B.counts()).undo > 0) {
    chain.push(await B.hash());
    await page.click('#panel-tools [data-action="undo"]');
    await pause();
  }
  const emptyHash = await B.hash();
  const afterUndoAll = await B.team();
  check(
    afterUndoAll.buildings.length === 0 &&
      afterUndoAll.stash.length === 7 &&
      afterUndoAll.conduits.length === 0,
    `undo to the start returns every building to the stash (${chain.length} steps)`,
  );
  check(emptyHash === hashes[0], 'the first layout hash is restored exactly');
  const redoChain = [];
  while ((await B.counts()).redo > 0) {
    await page.click('#panel-tools [data-action="redo"]');
    await pause();
    redoChain.push(await B.hash());
  }
  // The stack also held the earlier erase (undone, so redoable) as its last
  // redo; chain[0] is the complete factory, one redo short of that.
  check(
    redoChain.length === chain.length + 1 &&
      redoChain.every((h, i) => i === 0 || h !== redoChain[i - 1]) &&
      redoChain[chain.length - 1] === chain[0],
    `redo replays all ${chain.length} changes through the same layouts as before (hash equal at every step)`,
  );
  for (let i = 0; i < chain.length; i++) {
    // Undo went full -> ... -> empty; redo goes empty -> ... -> full.
    if (redoChain[chain.length - 1 - i] !== chain[i]) {
      check(
        false,
        `redo step ${chain.length - 1 - i} matches the layout undo left`,
      );
    }
  }
  // Put the factory back (undo the replayed erase).
  await page.click('#panel-tools [data-action="undo"]');
  await pause();
  check(
    (await B.counts()).actions > actionsBefore,
    'undo and redo are dispatched as intents (the action log grew)',
  );
  team = await B.team();
  check(team.conduits.length === 2, 'the factory is complete again after redo');

  // --- Click-to-pick, then click-to-place (touch and keyboard friendly)
  await page.click('[data-stash-def="bld_wall"]');
  await pause();
  check(
    (await B.ui()).held?.mode === 'sticky',
    'clicking a stash entry picks it up (click-to-place mode)',
  );
  await page.keyboard.press('Escape');
  await pause();
  check((await B.ui()).held === null, 'Escape puts a picked-up building down');
  await page.click('[data-stash-def="bld_wall"]');
  await pause();
  await clickCell(7, 15);
  check(
    buildingOf(await B.team(), 'bld_wall').length === 2,
    'click-to-place puts the held building on the clicked cell',
  );
  await page.click('#panel-tools [data-action="undo"]');
  await pause();
  check(
    buildingOf(await B.team(), 'bld_wall').length === 1,
    'undo takes that placement back',
  );

  // --- Flow overlay and dry run
  await page.click('[data-overlay="flow"]');
  await page.click('[data-overlay="dry"]');
  await page.waitForSelector('#dry-table');
  await settle();
  const ov = (await B.ui()).overlays;
  check(
    ov.flow && ov.dry,
    'resource flow and dry run overlays toggle on, independently of enemy paths',
  );
  const dry = await B.dry();
  check(
    dry && dry.sources.length === 2 && dry.sources.every((s) => s.produced > 0),
    `dry run: both extractors produce (${dry?.sources.map((s) => s.produced).join(', ')})`,
  );
  check(
    dry.consumers.every((c) => c.delivered > 0),
    `dry run: both consumers are supplied (${dry.consumers.map((c) => c.delivered).join(', ')})`,
  );
  const tableText = await page.locator('#dry-table').innerText();
  check(
    tableText.includes(String(dry.sources[0].produced)) &&
      tableText.includes(String(dry.consumers[0].delivered)),
    'dry-run table shows the numbers from dryRunFlow',
  );
  await waitFrames(page, 18);
  await shot('build-4-factory-flow');
  await shotDark('art2-build-conduits');
  await page.click('[data-overlay="dry"]');
  check(
    (await page.locator('[data-field="no-problems"]').count()) === 0 ||
      (await B.problems()).length === 0,
    'problems list is consistent with the factory',
  );

  // --- Inspector on the barracks
  await clickCell(bk.x, bk.y);
  await settle();
  const insp = await page.locator('#panel-inspector').innerText();
  check(
    /Barracks/.test(insp) &&
      /Needs/.test(insp) &&
      /Receiving/.test(insp) &&
      /units \/ min/.test(insp),
    'inspector shows needs, receiving and the unit estimate for the barracks',
  );
  const recv = await page.locator('[data-field="receiving"]').innerText();
  const recvNum = Number((/([\d.]+) \/ sec/.exec(recv) ?? [])[1]);
  const row = dry.consumers.find((c) => c.building === bk.id);
  check(
    Math.abs(recvNum - (row.ratePer1000 * 10) / 1000) < 0.06,
    `inspector "receiving" (${recvNum}/s) agrees with dryRunFlow (${row.ratePer1000} per 1000 ticks)`,
  );
  await shot('build-6-inspector-barracks');
  await clickCell(BUILD_PLAN.ex1.x, BUILD_PLAN.ex1.y);
  const exInsp = await page.locator('#panel-inspector').innerText();
  check(/Mines/.test(exInsp), 'inspector shows what an extractor mines');
  const core = (await B.team()).cores[0];
  await clickCell(core.x, core.y);
  check(
    /cannot be moved/.test(await page.locator('#panel-inspector').innerText()),
    'inspector says the Core cannot be moved',
  );
  const conduitCell = (await B.team()).conduits[1].cells[0];
  await clickCell(conduitCell.x, conduitCell.y);
  check(
    /Carries/.test(await page.locator('#panel-inspector').innerText()),
    'clicking a conduit inspects it (resource, length, erase)',
  );
  await page.keyboard.press('Escape');

  // --- 1280x720
  await page.setViewportSize({ width: 1280, height: 720 });
  await settle();
  await page.click('[data-camera="fit"]');
  await settle();
  await waitFrames(page, 9);
  const s720 = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    sh: document.documentElement.scrollHeight,
  }));
  check(
    s720.sw <= 1280 && s720.sh <= 720,
    `build screen has no page scroll at 1280x720 (${JSON.stringify(s720)})`,
  );
  const cam720 = await camera();
  check(
    cam720.zoom >= 16,
    `board stays usable at 1280x720 (${cam720.zoom.toFixed(1)} px/cell)`,
  );
  await shot('build-7-1280x720');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await settle();

  // --- Ready
  await page.click('#ready-button');
  await page.waitForFunction(
    () => window.__debug.build.step() === 'pve_choice',
  );
  check(
    /pve_choice/.test(await page.locator('#step-placeholder').innerText()),
    'Ready moves the run on; a placeholder names the new step',
  );
  await shot('build-9-next-step');
  await page.click('#dev-new-run');
  await page.waitForFunction(
    () => window.__debug.build.step() === 'core_placement',
  );
  check(true, 'the dev button starts a new run');

  // --- Battle screen (W2-8)
  {
    const bd = (name) => page.evaluate((n) => window.__debug.battle[n](), name);
    const waitPhase = (phase, timeout = slow(30000)) =>
      page.waitForFunction(
        (p) => window.__debug?.battle?.phase?.() === p,
        phase,
        { timeout },
      );
    const open = async (hash) => {
      await page.goto(baseUrl + hash);
      await page.reload();
      await page.waitForFunction(
        () =>
          window.__debug?.battle !== undefined &&
          window.__debug.battle.phase !== undefined,
        undefined,
        { timeout: slow(30000) },
      );
    };
    // The golden PvE battles are reproducible through the route: the board is
    // the reference board of the same name, `s` is the battle seed and `ts`
    // the threat seed. The expected values below are read from the golden
    // file, not from anything the page computes.
    const goldenPve = JSON.parse(
      readFileSync(
        path.resolve(webDir, '../../golden/pve-battle.json'),
        'utf8',
      ),
    );
    const golden = (id) => {
      const v = goldenPve.find((x) => x.id === id);
      if (v === undefined) throw new Error(`golden vector ${id} is missing`);
      const sides = v.expected.result.summary.sides;
      // The vector id names its reference board ("pve-battle.<board>-vs-...").
      const board = /^pve-battle\.(.+?)-vs-/.exec(id)?.[1];
      if (board === undefined) throw new Error(`no board in golden id ${id}`);
      return {
        board,
        winner: v.expected.result.result.winner,
        endTick: v.expected.result.result.endTick,
        own: `${sides[0].coreHealth} / ${sides[0].coreMaxHealth}`,
        foe: `${sides[1].coreHealth} / ${sides[1].coreMaxHealth}`,
        hash: (t, s) =>
          `#battle?p=${board}&o=pve:${v.input.threat.archetype}:${v.input.threat.round}:${v.input.threat.type}&s=${s}&ts=${t}`,
        battleSeed: v.input.seed,
        threatSeed: v.input.threat.seed,
      };
    };
    const winGold = golden('pve-battle.rush-vs-rusher-r1');
    const lossGold = golden('pve-battle.rush-vs-rusher-r9-loses');
    const QUICK = winGold.hash(winGold.threatSeed, winGold.battleSeed);
    const coreText = () =>
      page.evaluate(() => [
        document
          .querySelector('[data-field="final-core-own"]')
          ?.textContent?.replace(/\s+/g, ' ')
          .trim(),
        document
          .querySelector('[data-field="final-core-foe"]')
          ?.textContent?.replace(/\s+/g, ' ')
          .trim(),
      ]);

    await open(QUICK);
    await waitPhase('playing');
    const hiddenBefore = await page.evaluate(() => ({
      revealed: window.__debug.battle.revealed(),
      features: window.__debug.neutralFeatureCount(),
    }));
    check(
      !hiddenBefore.revealed && hiddenBefore.features === 0,
      `battle: neutral zone is hidden before the battle starts (${JSON.stringify(hiddenBefore)})`,
    );
    await shot('battle-0-before-start');
    {
      // A solo battle looks as it always did: one Core bar per side.
      const bars = await page.evaluate(() => {
        const n = (s) => document.querySelectorAll(s).length;
        return {
          own: n('[data-field="core-hp-0"]'),
          foe: n('[data-field="core-hp-1"]'),
          perPlayer: n(
            '[data-field^="core-hp-0-"], [data-field^="core-hp-1-"]',
          ),
          groups: n('[data-field="cores-0"], [data-field="cores-1"]'),
        };
      });
      check(
        bars.own === 1 &&
          bars.foe === 1 &&
          bars.perPlayer === 0 &&
          bars.groups === 0,
        `battle: a solo battle shows one Core bar per side (${JSON.stringify(bars)})`,
      );
    }
    {
      // The camera starts at the centre of the map (the neutral zone), at a
      // readable zoom; "Fit battle" is a preset.
      const cam = await camera();
      const vp = await viewport();
      const mid = await page.evaluate(() => {
        const r = document.querySelector('canvas').getBoundingClientRect();
        return { h: r.height };
      });
      console.log(
        `battle camera at start: cx ${cam.cx.toFixed(2)} cy ${cam.cy.toFixed(2)} zoom ${cam.zoom.toFixed(1)} viewport ${vp.w}x${vp.h} (${mid.h})`,
      );
      check(
        cam.zoom >= 30 && cam.zoom <= 34 && Math.abs(cam.cx - 12) < 1.5,
        `battle: the camera starts centred at a readable zoom (zoom ${cam.zoom.toFixed(1)}, centre ${cam.cx.toFixed(1)}, ${cam.cy.toFixed(1)})`,
      );
      const rows = await page.evaluate(() => window.__debug.battle.geometry());
      check(
        Math.abs(cam.cy - rows.height / 2) < 1.5,
        `battle: the camera starts on the neutral zone (cy ${cam.cy.toFixed(1)} of ${rows.height} rows)`,
      );
    }
    {
      // A short screen: the start zoom is lowered so the party's own Core is
      // inside the visible canvas when the board first opens.
      await page.setViewportSize({ width: 1366, height: 768 });
      await open(QUICK);
      await waitPhase('playing');
      await page.waitForFunction(
        () =>
          window.__debug?.ownCoreRect !== undefined &&
          window.__debug.viewport !== undefined &&
          window.__debug.viewport().h > 0 &&
          window.__debug.viewport().h < 700,
        undefined,
        { timeout: slow(10000) },
      );
      const shortStart = await page.evaluate(() => {
        const d = window.__debug;
        const r = d.ownCoreRect();
        const vp = d.viewport();
        const cam = d.camera();
        const px = (x, y) => ({
          x: (x - cam.cx) * cam.zoom + vp.w / 2,
          y: (y - cam.cy) * cam.zoom + vp.h / 2,
        });
        const a = px(r.x, r.y);
        const b = px(r.x + r.w, r.y + r.h);
        return {
          inside: a.x >= 0 && a.y >= 0 && b.x <= vp.w && b.y <= vp.h,
          zoom: cam.zoom,
          vp,
        };
      });
      check(
        shortStart.inside,
        `battle: at 1366x768 the own Core is in view on first open (${JSON.stringify(shortStart)})`,
      );
      check(
        shortStart.zoom < 32,
        'battle: at 1366x768 the start zoom is lowered below the default',
      );
      await shot('battle-0b-start-1366x768');
      await page.setViewportSize({ width: 1920, height: 1080 });
      await open(QUICK);
      await waitPhase('playing');
    }
    const noScrollBattle = await page.evaluate(() => ({
      fits:
        document.documentElement.scrollWidth <= window.innerWidth &&
        document.documentElement.scrollHeight <= window.innerHeight,
    }));
    check(noScrollBattle.fits, 'battle: screen fits 1920x1080 without scroll');
    await page.waitForFunction(
      () => window.__debug?.battle?.revealed(),
      undefined,
      {
        timeout: slow(10000),
      },
    );
    const revealedFeatures = await page.evaluate(() =>
      window.__debug.neutralFeatureCount(),
    );
    check(
      revealedFeatures > 0,
      `battle: neutral zone features appear once playback begins (${revealedFeatures})`,
    );
    const result0 = await bd('result');

    // Speed, pause.
    await page.click('#speed-4');
    check(
      (await bd('speed')) === 4,
      'battle: the 4x button sets the speed to 4',
    );
    await page.waitForFunction(() => window.__debug?.battle?.tick() > 80);
    await page.click('#pause');
    const pausedAt = await bd('tick');
    await waitFrames(page, 24);
    check(
      (await bd('tick')) === pausedAt && (await bd('paused')),
      `battle: pausing stops playback (tick ${pausedAt})`,
    );
    await page.click('#pause');
    await page.waitForFunction(
      (t) => window.__debug?.battle?.tick() > t + 20,
      pausedAt,
    );
    await page.waitForFunction(() => window.__debug?.battle?.tick() > 230);
    await shot('battle-1-playing');
    await shotDark('art2-battle-mid-fight');
    {
      const art = await spritesInfo(page);
      check(
        art !== null && art.state === 'ready' && art.spriteFrames > 0,
        `battle: the board is drawn from the atlas (${JSON.stringify(art)})`,
      );
    }

    // Reload mid-battle resumes the same battle.
    await page.waitForFunction(
      () => Number(/[?&]t=(\d+)/.exec(window.location.hash)?.[1] ?? 0) > 80,
    );
    const hashMid = await page.evaluate(() => window.location.hash);
    const savedTick = Number(/[?&]t=(\d+)/.exec(hashMid)?.[1] ?? 0);
    check(savedTick > 80, `battle: the tick is kept in the URL (${hashMid})`);
    await page.reload();
    await page.waitForFunction(
      () => window.__debug?.battle?.phase?.() !== undefined,
    );
    const resumed = await page.evaluate(() => ({
      tick: window.__debug.battle.tick(),
      revealed: window.__debug.battle.revealed(),
      result: window.__debug.battle.result(),
      features: window.__debug.neutralFeatureCount(),
    }));
    check(
      resumed.tick >= savedTick &&
        resumed.revealed &&
        JSON.stringify(resumed.result) === JSON.stringify(result0),
      `battle: a reload resumes at tick ${resumed.tick} (saved ${savedTick}) with the same result`,
    );

    // Play to the summary at the top speed.
    await page.click('#speed-4');
    await waitPhase('summary', 60000);
    const hashEnd = await bd('stateHash');
    const bannerText = await page.locator('#result-banner').innerText();
    check(
      bannerText.includes(result0.winner === 0 ? 'Victory' : 'Defeat'),
      `battle: the summary banner shows the result of the simulation ("${bannerText.split('\n')[0]}")`,
    );
    const finalCores = await coreText();
    check(
      finalCores[0] === winGold.own && finalCores[1] === winGold.foe,
      `battle: the summary's final Core health matches the golden vector (${finalCores.join(' / ')}; golden ${winGold.own} / ${winGold.foe})`,
    );
    check(
      result0.winner === winGold.winner &&
        result0.endTick === winGold.endTick &&
        (await bd('tick')) === winGold.endTick,
      `battle: the result and end tick match the golden vector (${JSON.stringify(result0)})`,
    );
    const reward = await page.locator('[data-field="reward"]').innerText();
    check(
      /gold/.test(reward),
      `battle: summary shows the reward line ("${reward}")`,
    );
    check(
      (await page.locator('#panel-buildings tbody tr').count()) > 0 &&
        (await page
          .locator('[data-testid="chart-strength-summary"]')
          .count()) === 1 &&
        (await page.locator('#panel-breaches canvas').count()) === 1,
      'battle: summary has the chart, the breach map and the building table',
    );
    await shot('battle-3-summary');

    // Watch again, then skip: the same result.
    await page.click('#watch-again');
    await waitPhase('playing');
    const again = await page.evaluate(() => ({
      tick: window.__debug.battle.tick(),
      revealed: window.__debug.battle.revealed(),
      features: window.__debug.neutralFeatureCount(),
      hash: window.location.hash,
    }));
    check(
      again.tick === 0 &&
        !again.revealed &&
        again.features === 0 &&
        !/t=/.test(again.hash),
      `battle: Watch again starts over with the zone hidden (${JSON.stringify(again)})`,
    );
    await page.click('#skip');
    await waitPhase('summary');
    const skipped = {
      result: await bd('result'),
      hash: await bd('stateHash'),
    };
    check(
      JSON.stringify(skipped.result) === JSON.stringify(result0) &&
        skipped.hash === hashEnd,
      'battle: skipping to the end gives the same result and final state as watching',
    );
    await page.click('#battle-ready');
    check(
      (await bd('ready')) &&
        (await page.locator('#battle-ready').innerText()).includes('Ready') &&
        (await page.locator('#sample-ready').count()) === 1,
      'battle: Ready is confirmed',
    );
    await shot('battle-5-ready');

    // A lost golden PvE battle: Defeat, no life lost, no reward.
    await open(lossGold.hash(lossGold.threatSeed, lossGold.battleSeed));
    await waitPhase('playing');
    await page.click('#skip');
    await waitPhase('summary');
    {
      const cores = await coreText();
      const word = await page.locator('[data-field="result-word"]').innerText();
      const rew = await page.locator('[data-field="reward"]').innerText();
      check(
        cores[0] === lossGold.own &&
          cores[1] === lossGold.foe &&
          word === 'Defeat' &&
          lossGold.winner === 1,
        `battle: a lost golden PvE battle ends as the golden vector says (${word}, ${cores.join(' / ')}; golden ${lossGold.own} / ${lossGold.foe})`,
      );
      check(
        rew === 'No reward',
        `battle: a lost PvE battle shows no cost and no reward ("${rew}")`,
      );
      const reasonText = await page
        .locator('#result-banner .result-detail')
        .innerText();
      check(
        /destroyed/.test(reasonText) && !/more health left/.test(reasonText),
        `battle: the summary explains the result ("${reasonText.slice(0, 70)}...")`,
      );
    }

    // PvE: the enemy side is a stronghold, not a factory with conduits.
    await open('#battle?p=fortify&o=pve:arch_fortress:3:medium&s=2');
    await waitPhase('playing');
    await page.waitForFunction(
      () => window.__debug?.battle?.revealed(),
      undefined,
      {
        timeout: slow(10000),
      },
    );
    await page.click('#speed-4');
    await page.waitForFunction(() => window.__debug?.battle?.tick() > 250);
    {
      const pveScene = await page.evaluate(() => window.__debug.battle.scene());
      const enemyKinds = Object.keys(pveScene[1].kinds).filter(
        (k) => !k.startsWith('core:'),
      );
      check(
        enemyKinds.length > 0 &&
          pveScene[1].buildings > 0 &&
          pveScene[1].conduits === 0 &&
          pveScene[0].conduits > 0,
        `battle: PvE enemy side holds stronghold buildings and no conduits (${JSON.stringify(pveScene[1])}; own conduits ${pveScene[0].conduits})`,
      );
    }
    await shot('battle-4-pve-stronghold');

    // A ghost board, by contrast, is a factory with conduits (so the check
    // above can fail), and Watch again works on it after Skip.
    await open(`#battle?p=${winGold.board}&o=ghost:rush&s=1`);
    await waitPhase('playing');
    {
      const ghostScene = await page.evaluate(() =>
        window.__debug.battle.scene(),
      );
      check(
        ghostScene[1].conduits > 0,
        `battle: a ghost enemy side does have conduits (${ghostScene[1].conduits}), unlike a stronghold`,
      );
      const errorsBefore = consoleErrors.length;
      for (let i = 0; i < 2; i++) {
        await page.click('#skip');
        await waitPhase('summary');
        await page.click('#watch-again');
        await waitPhase('playing');
      }
      await page.click('#skip');
      await waitPhase('summary');
      check(
        consoleErrors.length === errorsBefore,
        `battle: skipping and watching again on a ghost battle raises no page errors (${consoleErrors.slice(errorsBefore).join(' | ')})`,
      );
      // Summary chart markers of moments at the same tick are merged.
      const labels = (
        await page
          .locator('[data-testid="chart-strength-summary"]')
          .getAttribute('data-marker-labels')
      )
        .split(',')
        .filter((l) => l.length > 0);
      check(
        new Set(labels).size === labels.length && labels.length > 0,
        `battle: summary chart markers are distinct (${labels.join(', ')})`,
      );
      await shot('battle-7-ghost-summary');
    }

    // Performance at 4x with hundreds of units.
    await open(`#battle?p=${winGold.board}&o=stress&s=1`);
    await waitPhase('playing');
    await page.waitForFunction(
      () => window.__debug?.battle?.revealed(),
      undefined,
      {
        timeout: slow(10000),
      },
    );
    {
      // The four-plot battle shows eight Core bars, four per side.
      const perSide = await page.evaluate(() => [
        document.querySelectorAll('[data-field^="core-hp-0-"]').length,
        document.querySelectorAll('[data-field^="core-hp-1-"]').length,
      ]);
      check(
        perSide[0] === 4 && perSide[1] === 4,
        `battle: a four-plot battle shows eight Core bars (${perSide.join(' + ')})`,
      );
    }
    await page.click('#speed-4');
    await page.waitForFunction(() => window.__debug?.battle?.tick() > 250);
    await page.evaluate(() => window.__debug.resetDrawStats());
    await page.evaluate(() => window.__debug.battle.frameTimes(true));
    const unitSpritesBefore = await page.evaluate(
      () => window.__debug?.sprites?.()?.unitSprites ?? 0,
    );
    const effectSpritesBefore = await page.evaluate(
      () => window.__debug?.sprites?.()?.effectSprites ?? 0,
    );
    let peak = 0;
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(200);
      peak = Math.max(peak, await bd('unitsAlive'));
    }
    const draw = await page.evaluate(() => window.__debug.drawStats());
    const frames = (
      await page.evaluate(() => window.__debug.battle.frameTimes(true))
    )
      .slice()
      .sort((a, b) => a - b);
    const pct = (q) =>
      frames[Math.min(frames.length - 1, Math.floor(frames.length * q))] ?? 0;
    const p50 = pct(0.5);
    const p95 = pct(0.95);
    const frameMax = frames[frames.length - 1] ?? 0;
    console.log(
      `battle perf: 4x, peak ${peak} units alive, ${frames.length} animation frames, interval p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${frameMax.toFixed(1)} ms; canvas draw mean ${draw.meanMs.toFixed(2)} ms max ${draw.maxMs.toFixed(1)} ms; simulate-up-front ${(await bd('simMs')).toFixed(0)} ms`,
    );
    const unitSpritesAfter = await page.evaluate(
      () => window.__debug?.sprites?.()?.unitSprites ?? 0,
    );
    check(
      unitSpritesAfter - unitSpritesBefore > 1000,
      `battle: units are drawn from the atlas (${unitSpritesAfter - unitSpritesBefore} unit sprites in the stress window)`,
    );
    const effectSpritesAfter = await page.evaluate(
      () => window.__debug?.sprites?.()?.effectSprites ?? 0,
    );
    check(
      effectSpritesAfter - effectSpritesBefore > 0,
      `battle: effects are drawn from the atlas (${effectSpritesAfter - effectSpritesBefore} effect sprites in the stress window)`,
    );
    // `unitsAlive` counts both sides. The stress sample is a four-plot board
    // on both sides with a steady stream of units: a few hundred alive at once.
    check(
      peak >= 300,
      `battle: the stress battle has hundreds of units alive in total (peak ${peak}, at least 300)`,
    );
    check(
      frames.length > 100 / CPU_THROTTLE && p95 < 34 * FRAME_SCALE,
      `battle: smooth at 4x with ${peak} units (frame interval p95 ${p95.toFixed(1)} ms over ${frames.length} frames; limit ${34 * FRAME_SCALE} ms)`,
    );
    // Skip, watch again, play: no page errors (more than 64 units spawned).
    {
      const errorsBefore = consoleErrors.length;
      const hashStress = await (async () => {
        // The battle may already be over (soft collision lets the units
        // through, so the stress battle ends sooner).
        if (
          (await page.evaluate(() => window.__debug.battle.phase())) !==
          'summary'
        ) {
          await page.click('#skip');
        }
        await waitPhase('summary');
        return bd('stateHash');
      })();
      await page.click('#watch-again');
      await waitPhase('playing');
      await page.waitForFunction(
        () => window.__debug?.battle?.revealed(),
        undefined,
        {
          timeout: slow(10000),
        },
      );
      await page.click('#speed-4');
      await page.waitForFunction(() => window.__debug?.battle?.tick() > 100);
      await page.click('#skip');
      await waitPhase('summary');
      check(
        consoleErrors.length === errorsBefore &&
          (await bd('stateHash')) === hashStress,
        `battle: stress battle skipped, watched again and skipped again ends in the same state without page errors (${consoleErrors.slice(errorsBefore).join(' | ')})`,
      );
    }
    await shot('battle-6-stress');

    // Editing the hash by hand: the route follows it, the tick included.
    await open(`#battle?p=${winGold.board}&o=pve:arch_rusher:1:medium&s=1`);
    await waitPhase('playing');
    await page.evaluate((board) => {
      window.location.hash = `#battle?p=${board}&o=pve:arch_rusher:1:medium&s=1&t=120`;
    }, winGold.board);
    await page.waitForFunction(
      () => (window.__debug?.battle?.tick?.() ?? 0) >= 120,
    );
    check(
      (await bd('tick')) >= 120 && (await bd('revealed')),
      `battle: editing only t= in the hash resumes there (tick ${await bd('tick')})`,
    );
    await page.evaluate(() => {
      window.location.hash = '#battle?p=fortify&o=ghost:poor&s=77';
    });
    await page.waitForFunction(
      () => document.querySelector('#pick-seed')?.value === '77',
    );
    check(
      (await page.locator('#pick-board').inputValue()) === 'fortify' &&
        (await page.locator('#pick-opponent').inputValue()) === 'ghost:poor',
      'battle: the seed input and the pickers follow a hand-edited hash',
    );

    // Leaving the screen removes its debug hooks.
    await page.evaluate(() => {
      window.location.hash = '#build';
    });
    await page.waitForFunction(() => window.__debug?.build !== undefined);
    check(
      await page.evaluate(() => window.__debug.battle === undefined),
      'battle: the debug hooks are removed when the screen unmounts',
    );
  }

  await runWorkerSmoke({ browser, baseUrl, check });

  // Shop + Build step (W2-7)
  await runShopSmoke({ page, baseUrl, check, shot, shotDark, settle, webDir });
  await runSpritesSmoke({ page, baseUrl, check, shot, settle, consoleErrors });
  await runArtSmoke({ browser, baseUrl, check, outDir, page, settle });

  // Run flow: menu, Core placement, choices, run end (W2-9)
  await runRunSmoke({
    page,
    baseUrl,
    check,
    shot,
    shotDark,
    settle,
    webDir,
    context,
    consoleErrors,
  });

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
