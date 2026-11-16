import { describe, expect, test, vi } from 'vitest';
import {
  BOT_STRATEGIES,
  playBotRun,
  type BotRunResult,
  type BotStrategyName,
} from './bot.js';
import { isRecord } from '../rules/json-guards.js';
import type { Json, RunDeps } from '../rules/types.js';
import { makeGameDeps } from '../testing/test-support.js';

// Whole bot runs, as in bot.test.ts.
vi.setConfig({ testTimeout: 120_000 });

/** Units the party's producers made, by unit definition, over every battle. */
type Spawned = Record<string, number>;

function play(
  strategy: BotStrategyName,
  seed: number,
): BotRunResult & { spawned: Spawned } {
  const base = makeGameDeps();
  const spawned: Spawned = {};
  const inner = base.battle;
  const deps: RunDeps = {
    ...base,
    battle: {
      ...(inner.replay === undefined
        ? {}
        : { replay: inner.replay.bind(inner) }),
      resolve(input) {
        const result = inner.resolve(input);
        // Replay the battle that was just resolved and count what it made.
        const pending = isRecord(input.state.pending)
          ? input.state.pending
          : {};
        const rep = inner.replay?.({
          ...input.state,
          pending: {
            ...pending,
            option: input.option,
            battle: result as unknown as Json,
          },
        });
        if (rep !== undefined && rep.ok) {
          while (!rep.battle.isOver()) rep.battle.step();
          for (const e of rep.battle.eventLog) {
            if (e.type === 'unit_spawned' && e.side === 0) {
              spawned[e.def] = (spawned[e.def] ?? 0) + 1;
            }
          }
        }
        return result;
      },
    },
  };
  const r = playBotRun(
    deps,
    {
      runId: 'chains',
      runVersion: '0.1',
      seed,
      players: ['Ann', 'Bo'],
      host: 0,
    },
    { strategy, seed, rerollCost: 1 },
  );
  return { ...r, spawned };
}

function onBoard(r: BotRunResult, def: string): number {
  return r.state.team.buildings.filter((b) => b.def === def).length;
}

/** Conduits into and out of a building. */
function wiring(r: BotRunResult, id: number): { into: number; out: number } {
  const cs = r.state.team.conduits;
  return {
    into: cs.filter((c) => 'building' in c.to && c.to.building === id).length,
    out: cs.filter((c) => 'building' in c.from && c.from.building === id)
      .length,
  };
}

// Fixed seeds found to build each chain (the bot is deterministic). Market day
// (#410) changed which events the bot is offered from round 2, so the seeds
// were searched again: 8 for both chains, 66 for the Foundry. Drill (#411)
// changed them again: rush Composite 51, fortify Aether 8, Foundry 3. Pact
// (#413) joins the pool from round 4, so the first seeds that build each chain
// were searched again over 1 to 80: rush Composite 27, fortify Aether 26,
// Foundry 13.
describe('the bot builds the Foundry and the refining chains (issue #384)', () => {
  test('rush builds the Composite chain and its Golems fight', () => {
    for (const seed of [27]) {
      const r = play('rush', seed);
      expect(r.rejected).toEqual([]);
      expect(onBoard(r, 'bld_refinery_ab')).toBeGreaterThan(0);
      expect(onBoard(r, 'bld_golem_forge')).toBeGreaterThan(0);
      expect(r.spawned['unit_golem'] ?? 0).toBeGreaterThan(0);
    }
  });

  test('fortify builds the Aether chain and its casters fight', () => {
    for (const seed of [26]) {
      const r = play('fortify', seed);
      expect(r.rejected).toEqual([]);
      expect(onBoard(r, 'bld_refinery_bc')).toBeGreaterThan(0);
      expect(onBoard(r, 'bld_spire')).toBeGreaterThan(0);
      expect(r.spawned['unit_caster'] ?? 0).toBeGreaterThan(0);
    }
  });

  test('a Foundry is built and its heavies fight', () => {
    const r = play('rush', 13);
    expect(r.rejected).toEqual([]);
    expect(onBoard(r, 'bld_foundry')).toBeGreaterThan(0);
    expect(r.spawned['unit_heavy'] ?? 0).toBeGreaterThan(0);
  });

  test('many seeded runs: Ready is never blocked and no chain is half-wired', () => {
    for (const strategy of BOT_STRATEGIES) {
      for (let seed = 1; seed <= 3; seed++) {
        const r = play(strategy, seed);
        // A half-wired chain that sealed a producer in would refuse Ready.
        expect(r.rejected).toEqual([]);
        for (const b of r.state.team.buildings) {
          if (b.def === 'bld_refinery_ab' || b.def === 'bld_refinery_bc') {
            expect(wiring(r, b.id)).toEqual({ into: 2, out: 1 });
          }
          if (b.def === 'bld_foundry') {
            expect(wiring(r, b.id).into).toBe(2);
          }
        }
      }
    }
  });
});
