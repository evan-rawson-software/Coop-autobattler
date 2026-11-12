// Smoke checks of the simulation worker (#53): the stress battle is prepared
// in a real Worker while the page keeps animating, with no long main-thread
// task; and with Workers removed the same screen still works (fallback).

import { slow } from './smoke-timing.mjs';

async function newPage(browser, removeWorkers) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
      errors.push(`${m.type()}: ${m.text()}`);
    }
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  if (removeWorkers) {
    await page.addInitScript(() => {
      delete window.Worker;
    });
  }
  return { context, page, errors };
}

/** Open the stress battle from another route and watch the page while it
 * prepares: animation frames counted, long tasks recorded. */
async function prepareStress(page, baseUrl) {
  await page.goto(baseUrl + '#debug');
  await page.waitForFunction(() => window.__debug?.camera);
  await page.evaluate(() => {
    const probe = { frames: 0, longTasks: [], running: true };
    window.__probe = probe;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) probe.longTasks.push(e.duration);
    }).observe({ entryTypes: ['longtask'] });
    const tick = () => {
      probe.frames++;
      if (probe.running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    window.location.hash = '#battle?p=rush&o=stress&s=1';
  });
  await page.waitForFunction(
    () => window.__debug?.battle?.phase?.() === 'playing',
    undefined,
    { timeout: slow(60000) },
  );
  return page.evaluate(() => {
    window.__probe.running = false;
    return {
      frames: window.__probe.frames,
      longTasks: window.__probe.longTasks,
      info: window.__debug.battle.simInfo(),
      simMs: window.__debug.battle.simMs(),
      ticks: window.__debug.battle.endTick?.(),
    };
  });
}

export async function runWorkerSmoke({ browser, baseUrl, check }) {
  // --- Real worker
  {
    const { context, page, errors } = await newPage(browser, false);
    try {
      const r = await prepareStress(page, baseUrl);
      const worst = Math.max(0, ...r.longTasks);
      console.log(
        `sim worker: worker ${r.info.usesWorker}, simulate ${r.simMs.toFixed(0)} ms in the worker, round trip ${r.info.roundTripMs.toFixed(0)} ms, main-thread prepare ${r.info.prepareMs.toFixed(0)} ms, ${r.frames} animation frames meanwhile, long tasks [${r.longTasks.map((d) => d.toFixed(0)).join(', ')}] ms`,
      );
      check(
        r.info.usesWorker && !r.info.ranOnMainThread,
        'sim worker: the stress battle was simulated in a real Worker',
      );
      check(
        r.frames >= 3,
        `sim worker: animation frames keep advancing while the stress battle prepares (${r.frames} frames in ${r.info.roundTripMs.toFixed(0)} ms)`,
      );
      check(
        worst <= slow(100),
        `sim worker: no main-thread task over 100 ms while preparing (worst ${worst.toFixed(0)} ms)`,
      );
      check(
        errors.length === 0,
        `sim worker: no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`,
      );
    } finally {
      await context.close();
    }
  }
  // --- Fallback without Workers
  {
    const { context, page, errors } = await newPage(browser, true);
    try {
      const r = await prepareStress(page, baseUrl);
      console.log(
        `sim worker (fallback): simulate ${r.simMs.toFixed(0)} ms on the main thread, ${r.frames} animation frames meanwhile, long tasks [${r.longTasks.map((d) => d.toFixed(0)).join(', ')}] ms`,
      );
      check(
        !r.info.usesWorker && r.info.ranOnMainThread,
        'sim worker: without Workers the same screen simulates on the main thread',
      );
      // Positive control: the same observer sees a task that blocks the main
      // thread, so the worker run's "no long task" check above can fail when
      // it should. The task spins by wall clock for well over the 100 ms
      // bound, so a fast runner cannot finish it under the bound.
      const controlMs = 300;
      const control = await page.evaluate(async (ms) => {
        const probe = window.__probe;
        const before = probe.longTasks.length;
        // A timer task of the page itself: the observer does not report a
        // task that the automation's own evaluate call runs.
        await new Promise((resolve) =>
          setTimeout(() => {
            const t0 = performance.now();
            while (performance.now() - t0 < ms) {
              // busy loop
            }
            resolve();
          }, 0),
        );
        // Long-task entries are delivered asynchronously after the task.
        for (let i = 0; i < 50 && probe.longTasks.length === before; i++) {
          await new Promise((r) => setTimeout(r, 20));
        }
        return probe.longTasks.slice(before);
      }, controlMs);
      const fallbackWorst = Math.max(0, ...control);
      check(
        control.length >= 1 && fallbackWorst > 100,
        `sim worker (fallback): the long-task observer sees a ${controlMs} ms blocking task (worst ${fallbackWorst.toFixed(0)} ms)`,
      );
      check(
        errors.length === 0,
        `sim worker: the fallback raises no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`,
      );
    } finally {
      await context.close();
    }
  }
}
