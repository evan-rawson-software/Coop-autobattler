import { hashJson } from '@game/core';
import type { BattleDetail, RunState } from '@game/session';
import { describe, expect, test } from 'vitest';
import { content } from '../content.js';
import { reachStep, realDeps } from '../run/test-run.js';
import { replayMatches, simulateRecord } from './playback.js';
import { describeRunBattle, rewardLine } from './run-battle.js';
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
    expect(r.value.reward(false)).toBe('No reward, and no life lost');
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
    const core = run.team.core as { x: number; y: number };
    const changed: RunState = {
      ...run,
      team: { ...run.team, core: { x: core.x + 1, y: core.y } },
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
    expect(rewardLine('pve', true, deps, 5)).toBe('+5 gold when you continue');
    expect(rewardLine('pve', false, deps, 5)).toBe(
      'No reward, and no life lost',
    );
  });
  test('PvP: gold on a win; a life and consolation gold on a loss', () => {
    expect(rewardLine('pvp', true, deps, null)).toBe(
      `+${String(deps.rewards?.pvpWin)} gold when you continue`,
    );
    expect(rewardLine('pvp', false, deps, null)).toBe(
      `−1 life · +${String(deps.rewards?.pvpLoss)} gold consolation`,
    );
  });
});
