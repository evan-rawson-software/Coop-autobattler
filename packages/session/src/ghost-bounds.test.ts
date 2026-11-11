/**
 * Bounds on the local ghost pool: the work done per selection (#84) and a
 * player's own earlier runs staying in the pool (#79).
 */
import { describe, expect, test } from 'vitest';
import { ghostKey, type GhostSnapshot } from '@game/core';
import {
  begin,
  ghostDeps,
  INSTALLED,
  listBucket,
  newRig,
  playUntil,
} from './ghost-test-support.js';
import { GHOST_KEEP_PER_OWNER_BUCKET } from './ghost-store.js';
import {
  MAX_GHOST_CANDIDATES,
  MAX_GHOST_ROWS_VALIDATED,
  ghostContext,
  presentCandidates,
} from './ghosts.js';
import { replayRun } from './machine.js';
import { openRun } from './run-controller.js';
import type { RunState } from './types.js';

const atShop = (round: number) => (s: RunState) =>
  s.step === 'shop' && s.leg === 'pve' && s.round === round;

/** A valid round-1 snapshot of another install, and a run waiting at its shop. */
async function setup() {
  const rig = newRig();
  const a = await begin(rig, ghostDeps('dev-a'), { runId: 'run-a', seed: 7 });
  await playUntil(a, (s) => s.step === 'pvp_summary' && s.round === 1);
  const [src] = await listBucket(rig, '0.1', 1, 1);
  if (src === undefined) throw new Error('no snapshot');
  const deps = ghostDeps('dev-b');
  const b = await begin(rig, deps, { runId: 'run-b', seed: 9 });
  const state = await playUntil(b, atShop(1));
  return { rig, src, deps, b, state };
}

/** `count` copies of `src` as distinct runs; `team` counts the rows read. */
function rows(
  src: GhostSnapshot,
  count: number,
  touched: Set<number>,
  valid: boolean,
): unknown[] {
  const out: unknown[] = [];
  for (let i = 0; i < count; i++) {
    const row = {
      ...src,
      owner: { id: `x${String(i).padStart(3, '0')}`, label: 'X' },
      runId: `r${String(i)}`,
    };
    Object.defineProperty(row, 'team', {
      enumerable: true,
      get() {
        touched.add(i);
        return valid ? src.team : { stand: 'not a team' };
      },
    });
    out.push(row);
  }
  return out;
}

describe('bounded work per selection', () => {
  test('200 valid rows: 16 are presented and at most the bound is validated', async () => {
    const { src, deps, state } = await setup();
    const ctx = ghostContext(deps);
    if (ctx === null) throw new Error('ghosts are on');
    const touched = new Set<number>();
    const got = presentCandidates(rows(src, 200, touched, true), state, ctx);
    expect(got).toHaveLength(MAX_GHOST_CANDIDATES);
    expect(touched.size).toBeLessThanOrEqual(MAX_GHOST_ROWS_VALIDATED);
  });

  test('200 invalid rows: none is presented and at most the bound is validated', async () => {
    const { src, deps, state } = await setup();
    const ctx = ghostContext(deps);
    if (ctx === null) throw new Error('ghosts are on');
    const touched = new Set<number>();
    const got = presentCandidates(rows(src, 200, touched, false), state, ctx);
    expect(got).toEqual([]);
    expect(touched.size).toBe(MAX_GHOST_ROWS_VALIDATED);
  });

  test('the walk order is fixed: the same rows in any order give the same candidates', async () => {
    const { src, deps, state } = await setup();
    const ctx = ghostContext(deps);
    if (ctx === null) throw new Error('ghosts are on');
    const all = rows(src, 100, new Set<number>(), true);
    const first = presentCandidates(all, state, ctx).map(ghostKey);
    const second = presentCandidates([...all].reverse(), state, ctx).map(
      ghostKey,
    );
    expect(second).toEqual(first);
    expect(first).toHaveLength(MAX_GHOST_CANDIDATES);
  });

  test('the run own snapshots and ghosts already fought are skipped before any validation', async () => {
    const { src, deps, state } = await setup();
    const ctx = ghostContext(deps);
    if (ctx === null) throw new Error('ghosts are on');
    const touched = new Set<number>();
    const all = rows(src, 3, touched, true);
    const own = { ...src, runId: state.runId };
    const fought = {
      ...state,
      ghostsFought: [ghostKey(all[0] as GhostSnapshot)],
    };
    const got = presentCandidates([own, ...all], fought, ctx);
    expect(got.map((g) => g.runId)).toEqual(['r1', 'r2']);
    expect(touched.has(0)).toBe(false);
  });
});

describe('own earlier runs in the local pool', () => {
  test('a later run of the same install can meet an earlier one', async () => {
    const { rig, state } = await setup();
    // run-b is another owner here; now play run-a2 as the same install as run-a.
    expect(state.pvpOpponent?.ghost?.runId).toBe('run-a');
    const again = await begin(rig, ghostDeps('dev-a'), {
      runId: 'run-a2',
      seed: 11,
    });
    const s = await playUntil(again, atShop(1));
    expect(s.pvpOpponent?.kind).toBe('ghost');
    expect(s.pvpOpponent?.ghost?.runId).toBe('run-a');
  });

  test('reload before the battle gives the same opponent although the pool evicted it, and replay agrees', async () => {
    const { rig, src, deps, b, state } = await setup();
    const chosen = JSON.parse(JSON.stringify(state.pvpOpponent)) as unknown;
    expect(state.pvpOpponent?.ghost?.runId).toBe('run-a');
    // The chosen owner plays more runs: the 6th snapshot evicts the oldest,
    // which is the one drawn.
    for (let i = 0; i < GHOST_KEEP_PER_OWNER_BUCKET; i++) {
      await rig.ghosts.save({ ...src, runId: `later-${String(i)}` });
    }
    const listed = (await listBucket(rig, '0.1', 1, 1)).map((g) => g.runId);
    expect(listed).not.toContain('run-a');
    const reopened = await openRun('run-b', deps, rig.saves, INSTALLED, {
      ghostStore: rig.ghosts,
    });
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    await reopened.controller.prepare(5000);
    expect(
      JSON.parse(JSON.stringify(reopened.controller.state.pvpOpponent)),
    ).toEqual(chosen);
    // Replay needs no store and gives the same state.
    const live = reopened.controller.state;
    const r = replayRun(b.args, live.actionLog, deps);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state).toEqual(live);
  });
});
