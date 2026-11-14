/**
 * Fuzz: seeded multi-run sequences against ONE shared ghost pool. Every state
 * of every run passes `validateRunState`, every opponent is eligible and
 * valid, and every finished run replays from its arguments and action log with
 * no store at all and ends in the very same state.
 */
import { describe, expect, test } from 'vitest';
import { Rng, ghostKey, validateGhostSnapshot } from '@game/core';
import { verifyLastBattle } from './replay.js';
import {
  begin,
  ghostDeps,
  newRig,
  playUntil,
  type Game,
} from '../testing/ghost-test-support.js';
import { GHOST_KEEP_PER_OWNER_BUCKET } from '../app/ghost-store.js';
import { ghostContext } from './ghosts.js';
import { replayRun } from './machine.js';
import type { RunState } from './types.js';
import { validateRunState } from './validate.js';

const SEQUENCES = 3;
const RUNS_PER_SEQUENCE = 5;

describe('ghost pool fuzz', () => {
  for (let seq = 0; seq < SEQUENCES; seq++) {
    test(`sequence ${String(seq)}: shared pool, validated states, replay with an empty store`, async () => {
      const rng = Rng.fromSeed(1000 + seq);
      const rig = newRig();
      const finished: { game: Game; end: RunState }[] = [];
      let ghostBattles = 0;
      for (let i = 0; i < RUNS_PER_SEQUENCE; i++) {
        // A mix of owners (a few installs) and party sizes.
        const owner = `dev-${String(rng.nextInt(3))}`;
        const players =
          rng.nextInt(4) === 0 ? ['Ann', 'Bob'] : [`P${String(i)}`];
        const game = await begin(rig, ghostDeps(owner), {
          runId: `s${String(seq)}-r${String(i)}`,
          seed: rng.nextU32(),
          players,
        });
        const target = 1 + rng.nextInt(3);
        const ctx = ghostContext(game.deps);
        if (ctx === null) throw new Error('ghosts are on');
        const check = (s: RunState): void => {
          const v = validateRunState(JSON.parse(JSON.stringify(s)), game.deps);
          expect(v.ok ? [] : v.errors).toEqual([]);
          const g = s.pvpOpponent?.ghost;
          if (g) {
            expect(g.round).toBe(s.round);
            expect(g.partySize).toBe(s.players.length);
            expect(g.gameVersion).toBe(s.runVersion);
            expect(g.runId).not.toBe(s.runId);
            expect(s.ghostsFought).not.toContain(ghostKey(g));
            expect(validateGhostSnapshot(g, ctx).ok).toBe(true);
          }
        };
        const end = await playUntil(
          game,
          (s) =>
            s.step === 'run_over' ||
            (s.step === 'pvp_summary' && s.round >= target),
          check,
        );
        check(end);
        if (end.step === 'pvp_summary') {
          expect(verifyLastBattle(end, game.deps)).toBe(true);
          if (end.thisRound.pvp?.opponent.kind === 'ghost') ghostBattles++;
        }
        finished.push({ game, end });
      }
      // The sequence met at least one ghost in the shared pool.
      expect(ghostBattles).toBeGreaterThan(0);
      for (const { game, end } of finished) {
        const live = game.controller.state;
        // Replay needs no store: the candidates are in the action log.
        const r = replayRun(game.args, live.actionLog, game.deps);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.state).toEqual(live);
        expect(end.actionLog.length).toBeLessThanOrEqual(live.actionLog.length);
      }
      // At most the cap per owner per bucket, whatever was played.
      const seen = new Set<string>();
      for (const round of [1, 2, 3]) {
        for (const partySize of [1, 2]) {
          const list = (await rig.ghosts.list({
            gameVersion: '0.1',
            partySize,
            round,
          })) as { owner: { id: string } }[];
          const ids = list.map((g) => g.owner.id);
          for (const id of new Set(ids)) {
            expect(ids.filter((x) => x === id).length).toBeLessThanOrEqual(
              GHOST_KEEP_PER_OWNER_BUCKET,
            );
          }
          for (const id of ids) seen.add(id);
        }
      }
      expect(seen.size).toBeGreaterThan(0);
    }, 120_000);
  }
});
