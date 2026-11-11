// Shared timing helpers for the smoke scripts. Plain Node ESM.

/** 3 on slow shared CI runners (CI_RELAXED_TIMING=1), else 1. */
export const TIMING = process.env.CI_RELAXED_TIMING === '1' ? 3 : 1;

/** The CPU throttle rate the smoke browser runs under (SMOKE_CPU_THROTTLE). */
export const CPU_THROTTLE = Math.max(
  1,
  Number(process.env.SMOKE_CPU_THROTTLE ?? 1) || 1,
);

/**
 * Scale a wait timeout (ms) for slow shared runners and CPU throttling. Waits
 * resolve as soon as their condition holds, so a long timeout costs nothing on
 * a passing run; it only bounds how long a real failure takes to report.
 */
export const slow = (ms) => ms * TIMING * CPU_THROTTLE;

/**
 * Wait until a screen has installed its read-only debug hook
 * (window.__debug.<name>). The hooks are set when the screen mounts, which on a
 * slow runner can be after the element the script just waited for appeared.
 */
export const hookReady = (page, name) =>
  page.waitForFunction((n) => window.__debug?.[n] !== undefined, name);

/**
 * Wait for `n` animation frames to be presented. A fixed sleep assumes the
 * page renders at a known rate; this scales with however loaded the machine
 * is, so "let the app react" holds on a slow runner too.
 */
export const frames = (page, n = 6) =>
  page.evaluate(
    (count) =>
      new Promise((resolve) => {
        let left = count;
        const tick = () =>
          --left <= 0 ? resolve() : requestAnimationFrame(tick);
        requestAnimationFrame(tick);
      }),
    n,
  );
