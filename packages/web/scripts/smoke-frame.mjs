// The shared game frame (issue #299): in every in-run phase the same zones sit
// against the board's edges, the map rail has the same controls in the same
// order, and the primary button is at the right end of the action tray and
// shows "Space". Called from the run and shop smokes at each phase.

/** The map rail's controls, in order, in every phase. */
export const RAIL_ORDER =
  'zoom-in,zoom-out,fit,flow,paths,dry,center,base,enemy-base';

/** Max gap between a zone and the board edge it is attached to, in px. */
const GAP = 10;

export async function checkFrame(page, check, label) {
  const m = await page.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      return { l: r.left, t: r.top, r: r.right, b: r.bottom };
    };
    const rail = [
      ...document.querySelectorAll(
        '.frame-rail [data-camera], .frame-rail [data-overlay]',
      ),
    ].map((e) => e.dataset.camera ?? e.dataset.overlay);
    const primary = document.querySelector('.frame-tray .primary-button');
    const tray = document.querySelector('.frame-tray');
    const content = document.querySelector('.tray-content');
    return {
      board: rect('.frame-board'),
      rail: rect('.frame-rail'),
      tray: rect('.frame-tray'),
      info: rect('.frame-info'),
      railOrder: rail.join(),
      primary: primary === null ? null : primary.getBoundingClientRect().right,
      primaryText: primary?.textContent ?? '',
      primaryLast: tray !== null && tray.lastElementChild === primary,
      contentRight: content?.getBoundingClientRect().right ?? 0,
      scrollW: document.documentElement.scrollWidth,
      scrollH: document.documentElement.scrollHeight,
      vw: innerWidth,
      vh: innerHeight,
    };
  });
  const near = (a, b) => Math.abs(a - b) <= GAP;
  const { board: b, rail: r, tray: t, info: i } = m;
  const ok = b !== null && r !== null && t !== null && i !== null;
  check(ok, `${label}: the frame has board, map rail, tray and info rail`);
  if (!ok) return;
  check(
    m.railOrder === RAIL_ORDER,
    `${label}: the map rail has the same controls in the same order (${m.railOrder})`,
  );
  check(
    near(r.r, b.l) && near(r.t, b.t),
    `${label}: the map rail is attached to the board's left edge (gap ${(b.l - r.r).toFixed(0)}px)`,
  );
  check(
    near(t.t, b.b) && near(t.l, b.l) && near(t.r, b.r),
    `${label}: the action tray is attached below the board, the same width`,
  );
  check(
    near(i.l, b.r) && near(i.t, b.t) && near(i.b, t.b),
    `${label}: the info rail is attached to the right, as tall as board and tray`,
  );
  check(
    m.primaryLast &&
      m.primary !== null &&
      Math.abs(m.primary - (t.r - 7)) <= 3 &&
      /Space/.test(m.primaryText),
    `${label}: the primary button is at the right end of the tray and shows Space ("${m.primaryText.replace(/\s+/g, ' ')}")`,
  );
  check(
    m.scrollW <= m.vw && m.scrollH <= m.vh,
    `${label}: no page scroll (${m.scrollW}x${m.scrollH} in ${m.vw}x${m.vh})`,
  );
}
