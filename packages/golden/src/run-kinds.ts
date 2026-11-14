/**
 * Golden kinds over the run (`@game/session`): `shop-roll` and `run-replay`.
 * Built like the content kinds in `kinds.ts`: a factory takes the loaded
 * content and configuration. This package is test-only; nothing here ships.
 */
import {
  Rng,
  hashJson,
  rerollOffers,
  rollOffers,
  type Content,
  type Json,
  type ShopOffer,
} from '@game/core';
import type { SimulationFn } from './kinds/prng.js';
import {
  createGameDeps,
  drawStream,
  fixedBattle,
  readShop,
  replayRun,
  type GameConfigs,
  type LoggedAction,
  type RunState,
} from '@game/session';

function obj(v: Json | undefined, what: string): Record<string, Json> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw new TypeError(`${what} must be an object`);
  }
  return v as Record<string, Json>;
}

function num(o: Record<string, Json>, key: string): number {
  const v = o[key];
  if (typeof v !== 'number') throw new TypeError(`input.${key} must be a number`);
  return v;
}

function str(o: Record<string, Json>, key: string): string {
  const v = o[key];
  if (typeof v !== 'string') throw new TypeError(`input.${key} must be a string`);
  return v;
}

function list(o: Record<string, Json>, key: string): Json[] {
  const v = o[key];
  if (!Array.isArray(v)) throw new TypeError(`input.${key} must be an array`);
  return v as Json[];
}

const offerRow = (o: ShopOffer | null): Json =>
  o === null ? null : `${String(o.slot)} ${o.def} t${String(o.tier)} ${String(o.price)}`;

/**
 * `shop-roll`: input `{seed, before, round, leg, players, rerolls}`. The run
 * generator starts at `rootRng(seed)`; each label in `before` is drawn from it
 * in order (as the step machine does earlier in a run); then the shop stream
 * `shop:r<round>:<leg>` is drawn. Player `i` rolls from its child `p<i>`, then
 * re-rolls `rerolls` times from the same stream.
 */
export function makeShopRollKind(
  content: Content,
  configs: Pick<GameConfigs, 'economy'>,
): SimulationFn {
  return (input) => {
    const o = obj(input, 'input');
    const round = num(o, 'round');
    let state = {
      rng: Rng.fromSeed(num(o, 'seed')).child('run').getState(),
    } as unknown as RunState;
    for (const label of list(o, 'before')) {
      if (typeof label !== 'string') throw new TypeError('before: strings');
      state = drawStream(state, label).state;
    }
    const label = `shop:r${String(round)}:${str(o, 'leg')}`;
    const drawn = drawStream(state, label);
    const players: Json[] = [];
    for (let p = 0; p < num(o, 'players'); p++) {
      const rng = drawn.stream.child(`p${String(p)}`);
      const rolls: Json[] = [
        rollOffers(rng, round, content, configs.economy).map(offerRow),
      ];
      for (let r = 0; r < num(o, 'rerolls'); r++) {
        const again = rerollOffers(
          { gold: configs.economy.rerollCost, offers: [] },
          rng,
          round,
          content,
          configs.economy,
        );
        if (!again.ok) throw new Error(again.reason);
        rolls.push(again.shop.offers.map(offerRow));
      }
      players.push({ rolls, stream: rng.getState() });
    }
    return { result: { label, runState: drawn.state.rng, players } };
  };
}

/**
 * `run-replay`: input `{seed, players, actions}` where `actions` is the list of
 * `{player, intent}` in order. Replays them from `createRun` with the wired
 * game rules and a battle resolver that always wins, and reports the final
 * state: step, round, gold, shop offers, the run generator and the hash of the
 * whole run state.
 */
export function makeRunReplayKind(
  content: Content,
  configs: GameConfigs,
): SimulationFn {
  const deps = createGameDeps(content, configs, { battle: fixedBattle(true) });
  return (input) => {
    const o = obj(input, 'input');
    const actions: LoggedAction[] = list(o, 'actions').map((a, i) => {
      const e = obj(a, 'action');
      return { n: i + 1, player: num(e, 'player'), intent: e['intent'] ?? null };
    });
    const r = replayRun(
      {
        runId: 'golden',
        runVersion: '0.1',
        seed: num(o, 'seed'),
        players: list(o, 'players').map(String),
        host: 0,
      },
      actions,
      deps,
    );
    if (!r.ok) {
      return { result: { ok: false, reason: r.reason, at: r.at ?? null } };
    }
    const s = r.state;
    return {
      result: {
        ok: true,
        step: s.step,
        round: s.round,
        actions: s.actionLog.length,
        gold: s.perPlayer.map((p) => p.gold),
        shops: s.perPlayer.map((p) => {
          const shop = readShop(p);
          return shop === null ? null : shop.offers.map(offerRow);
        }),
        rng: s.rng,
        stateHash: hashJson(s),
      },
    };
  };
}
