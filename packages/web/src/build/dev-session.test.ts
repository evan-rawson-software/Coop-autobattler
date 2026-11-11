import { describe, expect, test } from 'vitest';
import { BuildController } from './build-controller.js';
import { BuildSession } from './session.js';
import { buildRun } from './test-helpers.js';

describe('the dev run on #build survives a visit to the shared run', () => {
  test('returning to #build re-attaches the run that was in progress', async () => {
    const ctl = new BuildController();
    await ctl.enterDev(5);
    const dev = ctl.session as BuildSession;
    const before = dev.run;
    expect(before.actionLog.length).toBeGreaterThan(-1);

    // The Build tab of the Shop step attaches the shared run.
    const shared = await buildRun();
    ctl.attach(shared, true);
    expect(ctl.session).toBe(shared);
    expect(ctl.shared).toBe(true);

    // Back to #build: the same dev session, untouched.
    await ctl.enterDev(5);
    expect(ctl.session).toBe(dev);
    expect(ctl.shared).toBe(false);
    expect(ctl.session?.run).toBe(before);

    // A second round trip keeps working.
    ctl.attach(shared, true);
    await ctl.enterDev(5);
    expect(ctl.session).toBe(dev);
  });

  test('with no dev run yet, #build starts a new one', async () => {
    const ctl = new BuildController();
    ctl.attach(await buildRun(), true);
    await ctl.enterDev(5);
    expect(ctl.shared).toBe(false);
    expect(ctl.session).not.toBeNull();
  });
});
