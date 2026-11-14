import { hashJson } from '@game/core';
import type { BattleDetail, RunState } from '@game/session';
import { describe, expect, test } from 'vitest';
import { content } from '../content.js';
import { reachStep, realDeps, send } from '../run/test-run.js';
import { replayMatches, simulateRecord } from './playback.js';
import { createMemoryStorage } from '../run/local-storage-store.js';
import {
  clearRunTicks,
  clearTick,
  describeRunBattle,
  readTick,
  rewardLine,
  storedOutcome,
  tickKey,
  writeTick,
} from './run-battle.js';
import { battleConfig } from './setup.js';

function detailOf(run: RunState): BattleDetail {
  return (run.pending as unknown as { battle: { detail: BattleDetail } }).battle
    .detail;
}

describe('the battle of a run', () => {
  test('a PvE summary describes the stored battle and plays out to its result', () => {
    const run = reachStep('pve_summary');
    const r = describeRunBattle(run, realDeps());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.kind).toBe('pve');
    expect(r.value.title).toBe('Round 1 · PvE battle');
    expect(r.value.opponent.kind).toBe('pve');
    expect(r.value.opponent.name).toMatch(/\(\w+\)$/);

    const made = simulateRecord(r.value.battle, content, battleConfig);
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    // The screen shows exactly the battle the session resolved.
    const detail = detailOf(run);
    expect(made.record.result.winner === 0).toBe(
      (run.pending as { battle: { won: boolean } }).battle.won,
    );
    expect(hashJson(made.record.eventLog)).toBe(detail.summary.eventLogHash);
    expect(made.record.result.endTick).toBe(detail.summary.endTick);
  });

  test('a PvP summary plays the generated boss', () => {
    const run = reachStep('pvp_summary');
    const r = describeRunBattle(run, realDeps());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.kind).toBe('pvp');
    expect(r.value.opponent).toMatchObject({ kind: 'boss', label: 'Boss' });
    expect(r.value.battle.kind).toBe('pve');
    const made = simulateRecord(r.value.battle, content, battleConfig);
    expect(made.ok).toBe(true);
    if (made.ok) {
      expect(hashJson(made.record.eventLog)).toBe(
        detailOf(run).summary.eventLogHash,
      );
    }
  });

  test('the outcome, opponent and reward come from the run state', () => {
    const run = reachStep('pve_summary');
    const pending = run.pending as unknown as {
      battle: { won: boolean; detail: BattleDetail };
    };
    // Flip the stored outcome: the screen follows the state, not a re-sim.
    const flipped = {
      ...run,
      pending: {
        ...pending,
        battle: { ...pending.battle, won: !pending.battle.won },
      },
    } as unknown as RunState;
    const r = describeRunBattle(flipped, realDeps());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.won).toBe(!pending.battle.won);
    expect(r.value.reward(true)).toMatch(/gold/);
    expect(r.value.reward(false)).toBe('No reward');
  });

  test('a stored hash that the replay does not reach is a mismatch', () => {
    const run = reachStep('pvp_summary');
    const ok = describeRunBattle(run, realDeps());
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    const made = simulateRecord(ok.value.battle, content, battleConfig);
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(replayMatches(made.record, ok.value.storedEventLogHash)).toBe(true);

    const pending = run.pending as unknown as {
      battle: { detail: BattleDetail };
    };
    const tampered = {
      ...run,
      pending: {
        ...pending,
        battle: {
          ...pending.battle,
          detail: {
            ...pending.battle.detail,
            summary: {
              ...pending.battle.detail.summary,
              eventLogHash: 'tampered',
            },
          },
        },
      },
    } as unknown as RunState;
    const bad = describeRunBattle(tampered, realDeps());
    expect(bad.ok).toBe(true);
    if (!bad.ok) return;
    expect(bad.value.storedEventLogHash).toBe('tampered');
    expect(replayMatches(made.record, bad.value.storedEventLogHash)).toBe(
      false,
    );
  });

  test('a step with no battle says so instead of throwing', () => {
    const r = describeRunBattle(reachStep('build'), realDeps());
    expect(r).toMatchObject({ ok: false });
  });

  test('a changed factory refuses the replay', () => {
    const run = reachStep('pve_summary');
    const core = run.team.cores[0] as { x: number; y: number };
    const changed: RunState = {
      ...run,
      team: {
        ...run.team,
        cores: run.team.cores.map((c) =>
          c === null ? null : { x: core.x + 1, y: core.y },
        ),
      },
    };
    expect(describeRunBattle(changed, realDeps())).toMatchObject({
      ok: false,
      message: expect.stringMatching(/factory changed/) as unknown,
    });
  });
});

describe('reward lines', () => {
  const deps = realDeps();
  test('PvE: gold on a win, nothing and no life lost on a loss', () => {
    expect(rewardLine('pve', true, deps, 5)).toBe('+5 gold');
    expect(rewardLine('pve', false, deps, 5)).toBe('No reward');
  });
  test('PvP: gold on a win; a life and consolation gold on a loss', () => {
    expect(rewardLine('pvp', true, deps, null)).toBe(
      `+${String(deps.rewards?.pvpWin)} gold`,
    );
    expect(rewardLine('pvp', false, deps, null)).toBe(
      `−1 life · +${String(deps.rewards?.pvpLoss)} gold`,
    );
  });
});

describe('playback positions', () => {
  test("a battle's key goes when the player moves past it; a run's keys when it ends", () => {
    const storage = createMemoryStorage();
    const run = reachStep('pve_summary');
    const other = { ...run, actionCounter: run.actionCounter + 7 };
    const stranger = { ...run, runId: 'someone-else' };
    for (const r of [run, other, stranger]) writeTick(tickKey(r), 40, storage);
    expect(readTick(tickKey(run), storage)).toBe(40);

    clearTick(tickKey(run), storage);
    expect(readTick(tickKey(run), storage)).toBe(0);
    expect(readTick(tickKey(other), storage)).toBe(40);

    clearRunTicks(run.runId, storage);
    expect(readTick(tickKey(other), storage)).toBe(0);
    // Another run's position is not touched.
    expect(readTick(tickKey(stranger), storage)).toBe(40);
    expect(storage.length).toBe(1);
  });
});

describe('a battle that cannot be shown', () => {
  const withoutDetail = (run: RunState): RunState => {
    const pending = run.pending as unknown as {
      battle: Record<string, unknown>;
    };
    const battle = { ...pending.battle };
    delete battle['detail'];
    return { ...run, pending: { ...pending, battle } } as unknown as RunState;
  };

  test('the recorded outcome (result and reason) is read from the run state', () => {
    const run = reachStep('pve_summary');
    const out = storedOutcome(run);
    expect(out).not.toBeNull();
    expect(out?.won).toBe(
      (run.pending as unknown as { battle: { won: boolean } }).battle.won,
    );
    expect(out?.reason).toBe(detailOf(run).summary.reason);
  });

  test('a replay that fails still reports the recorded outcome', () => {
    const run = reachStep('pve_summary');
    const core = run.team.cores[0] as { x: number; y: number };
    const changed: RunState = {
      ...run,
      team: {
        ...run.team,
        cores: run.team.cores.map((c) =>
          c === null ? null : { x: core.x + 1, y: core.y },
        ),
      },
    };
    const r = describeRunBattle(changed, realDeps());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.outcome).toEqual(storedOutcome(run));
    expect(r.outcome).not.toBeNull();
  });

  test('a missing stored detail or option keeps the outcome when there is one', () => {
    const run = reachStep('pve_summary');
    const r = describeRunBattle(withoutDetail(run), realDeps());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.outcome?.won).toBe(storedOutcome(run)?.won);
    expect(r.outcome?.reason).toBeNull();

    const noOption = {
      ...run,
      pending: { ...(run.pending as object), option: null },
    } as unknown as RunState;
    const o = describeRunBattle(noOption, realDeps());
    expect(o.ok).toBe(false);
    if (!o.ok) expect(o.outcome).not.toBeNull();
  });

  test('a step with no recorded result has no outcome (the screen offers the menu)', () => {
    const r = describeRunBattle(reachStep('build'), realDeps());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.outcome).toBeNull();
    expect(storedOutcome(reachStep('build'))).toBeNull();
    const mangled = {
      ...reachStep('pve_summary'),
      pending: { battle: { won: 'yes' } },
    } as unknown as RunState;
    expect(storedOutcome(mangled)).toBeNull();
  });

  test('describing a malformed run never throws', () => {
    const broken = {
      ...reachStep('pve_summary'),
      team: null,
    } as unknown as RunState;
    const r = describeRunBattle(broken, realDeps());
    expect(r.ok).toBe(false);
  });

  test('Continue is the ordinary Ready: the state after it is the same without playback', () => {
    const run = reachStep('pve_summary');
    // Ready never looks at playback, so an unplayable battle continues alike.
    const watched = send(run, { type: 'ready' });
    const unplayable = send(withoutDetail(run), { type: 'ready' });
    expect(unplayable.step).toBe(watched.step);
    expect(unplayable.lives).toBe(watched.lives);
    expect(unplayable.round).toBe(watched.round);
  });
});
