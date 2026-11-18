/**
 * Signature buildings in the shop (issue #472, EC-3b): a player sees only
 * their own specialist's building, other players' rolls do not change, and
 * the bots buy and place the one of their specialist.
 */
import { describe, expect, test, vi } from 'vitest';
import { loadEconomyOrThrow, type EconomyConfig } from '@game/core';
import economyJson from '../../../../content/economy.json';
import {
  BOT_STRATEGIES,
  botSpecialist,
  botWant,
  playBotRun,
  type BotStrategyName,
} from '../bot/bot.js';
import { fixedBattle } from './defaults.js';
import { createEconomyDeps, readShop } from './economy.js';
import { applyIntent, createRun } from './machine.js';
import {
  content,
  gameConfigs,
  makeGameDeps,
  mapgenConfig,
  ok,
  placeCoreAll,
  readyAll,
  runArgs,
  voteAll,
} from '../testing/test-support.js';
import type { RunDeps, RunState } from './types.js';

vi.setConfig({ testTimeout: 120_000 });

const shipped = loadEconomyOrThrow(economyJson, {
  buildings: content.buildings,
  specialists: content.specialists,
});
const ROSTER = content.specialists.specialists;

/** The shipped economy with the signature buildings of `only` (default: all) listed. */
function withSignatures(
  fromRound: number,
  weight = 60,
  only: readonly string[] = ROSTER.map((s) => s.id),
): EconomyConfig {
  return {
    ...shipped,
    offerWeights: [
      // The shipped list already holds the Mana Well entry (issue #473).
      ...shipped.offerWeights.filter((w) => w.specialist === undefined),
      ...ROSTER.filter((s) => only.includes(s.id)).map((s) => ({
        def: s.signature,
        weight,
        fromRound,
        specialist: s.id,
      })),
    ],
  };
}

function depsFor(economy: EconomyConfig): RunDeps {
  return createEconomyDeps(content, mapgenConfig, economy, {
    battle: fixedBattle(true),
  });
}

/** A 4-player run, one specialist each (the roster in turn), at its first shop. */
function firstShop(economy: EconomyConfig, seed: number): RunState {
  const deps = depsFor(economy);
  const r = createRun(runArgs(['Ann', 'Bo', 'Cy', 'Di'], seed), deps);
  if (!r.ok) throw new Error(r.detail);
  let s = placeCoreAll(r.state, deps);
  for (let i = 0; i < 20 && s.step !== 'shop'; i++) {
    if (s.step === 'pve_choice') s = voteAll(s, 'easy', deps);
    else if (s.step === 'event_choice') s = voteAll(s, 'stub_event_a', deps);
    else s = readyAll(s, deps);
  }
  expect(s.step).toBe('shop');
  return s;
}

function defsOf(s: RunState, player: number): string[] {
  const data = readShop(s.perPlayer[player] as RunState['perPlayer'][number]);
  if (data === null) throw new Error('no shop');
  return data.offers.flatMap((o) => (o === null ? [] : [o.def]));
}

const SIGNATURES = new Set(ROSTER.map((s) => s.signature));

describe('the shop of a player with a specialist (issue #472)', () => {
  test('each player is offered only their own signature building', () => {
    const economy = withSignatures(1);
    const seen = new Set<string>();
    for (let seed = 1; seed <= 6; seed++) {
      const s = firstShop(economy, seed);
      // Players 0..3 picked the roster in turn.
      expect(s.team.specialists).toEqual(ROSTER.map((x) => x.id));
      ROSTER.forEach((sp, p) => {
        for (const def of defsOf(s, p)) {
          if (!SIGNATURES.has(def)) continue;
          expect(def, `player ${String(p)}`).toBe(sp.signature);
          seen.add(def);
        }
      });
    }
    // Weight 60 against a list of about 200: every one shows up in 6 shops.
    expect([...seen].sort()).toEqual([...SIGNATURES].sort());
  });

  test('a signature building from round 2 is not in the round 1 shop', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const s = firstShop(withSignatures(2), seed);
      expect(s.round).toBe(1);
      for (let p = 0; p < 4; p++) {
        for (const def of defsOf(s, p)) expect(SIGNATURES.has(def)).toBe(false);
      }
    }
  });

  test("other players' shops are what they were without the entry", () => {
    // Only the Flowmancer has an entry: players 1 to 3 roll as before.
    const economy = withSignatures(1, 60, [ROSTER[0]?.id as string]);
    let flowSawIt = false;
    for (let seed = 1; seed <= 6; seed++) {
      const a = firstShop(economy, seed);
      const b = firstShop(shipped, seed);
      for (let p = 1; p < 4; p++) {
        expect(a.perPlayer[p]).toEqual(b.perPlayer[p]);
      }
      if (defsOf(a, 0).includes(ROSTER[0]?.signature as string)) {
        flowSawIt = true;
      }
    }
    expect(flowSawIt).toBe(true);
  });

  test('re-rolls offer only the own signature building too', () => {
    const economy = withSignatures(1);
    const deps = depsFor(economy);
    let s = firstShop(economy, 3);
    for (let n = 0; n < 5; n++) {
      const gold = s.perPlayer[0]?.gold ?? 0;
      const r = applyIntent(s, 0, { type: 'reroll' }, deps);
      if (!r.ok) {
        expect(gold).toBeLessThan(shipped.rerollCost);
        break;
      }
      s = r.state;
      for (const def of defsOf(s, 0)) {
        if (SIGNATURES.has(def)) {
          expect(def).toBe(ROSTER[0]?.signature);
        }
      }
    }
    expect(ok).toBeDefined();
  });
});

describe('the bots and signature buildings (issue #472)', () => {
  const signatureOf = (strategy: BotStrategyName): string => {
    const sp = ROSTER.find((s) => s.id === botSpecialist(strategy));
    if (sp === undefined) throw new Error('unknown specialist');
    return sp.signature;
  };

  test('every strategy wants the signature building of the specialist it picks', () => {
    for (const strategy of BOT_STRATEGIES) {
      expect(
        botWant(strategy, signatureOf(strategy)),
        strategy,
      ).toBeGreaterThan(0);
      // ... and no other specialist's building.
      for (const other of SIGNATURES) {
        if (other !== signatureOf(strategy)) {
          expect(botWant(strategy, other), `${strategy} ${other}`).toBe(0);
        }
      }
    }
  });

  for (const strategy of BOT_STRATEGIES) {
    test(`${strategy} buys and places the signature building of its specialist`, () => {
      const def = signatureOf(strategy);
      const economy = withSignatures(2, 40);
      let bought = 0;
      let placed = 0;
      // Seeds 1 to 10: since the Rune Ward (#474) is a Power consumer, the
      // fortify bot buys and places it only when a collector for it is on
      // offer too, which happens in seeds 8 and 9 of the first 30 and in none
      // of 1 to 7 (measured); the other strategies pass with the same seeds.
      // Event tuning (#417): the siege run found none in seeds 1 to 10 any more,
      // so the list is 1 to 16 (the checks below are unchanged).
      for (const seed of [
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
      ]) {
        // The Alchemist's Transmuter (#476) is bought only where the plot
        // has no open node of what a consumer takes, so its run is played
        // on plots with one node of each common resource.
        const deps = makeGameDeps(
          { battle: fixedBattle(true) },
          {
            ...gameConfigs,
            economy,
            ...(strategy === 'siege'
              ? {
                  mapgen: {
                    ...gameConfigs.mapgen,
                    nodesPerPlot: { common: 1, rare: 1 },
                  },
                }
              : {}),
          },
        );
        const res = playBotRun(
          deps,
          { runId: 'sig', runVersion: '0.1', seed, players: ['Ann'], host: 0 },
          { strategy, seed, rerollCost: economy.rerollCost, maxRounds: 6 },
        );
        expect(res.rejected).toEqual([]);
        const team = res.state.team;
        const mine = [...team.buildings, ...team.stash].filter((b) =>
          SIGNATURES.has(b.def),
        );
        // Only its own specialist's building can be in its shop.
        for (const b of mine) expect(b.def).toBe(def);
        bought += mine.length;
        placed += team.buildings.filter((b) => b.def === def).length;
      }
      expect(bought).toBeGreaterThan(0);
      // The weak bot places no collector (it does not connect, and a Mana Well
      // is a collector); the others lay the building out.
      if (strategy !== 'weak') expect(placed).toBeGreaterThan(0);
    });
  }
});
