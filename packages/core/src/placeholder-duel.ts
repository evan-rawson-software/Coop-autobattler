/**
 * PLACEHOLDER simulation. It exists only to prove the determinism and
 * golden-vector pipeline; it contains no real game rules and will be removed
 * or replaced by the real simulation.
 *
 * Two counters trade integer hits (random damage) until one reaches zero.
 */
import type { Json } from './hash.js';
import { Rng } from './rng.js';
import { assertInt, clamp, maxInt, mulBps } from './int.js';

export interface SimulationOutput {
  result: Json;
  eventLog?: Json[];
}

function readNumber(o: Record<string, Json>, key: string): number {
  const v = o[key];
  if (typeof v !== 'number') throw new TypeError(`input.${key} missing`);
  assertInt(v, key);
  return v;
}

export function placeholderDuel(input: Json): SimulationOutput {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('placeholder-duel: input must be an object');
  }
  const o = input as Record<string, Json>;
  const seed = readNumber(o, 'seed');
  const maxDamage = clamp(readNumber(o, 'maxDamage'), 1, 1000000);
  const critBps = clamp(readNumber(o, 'critBps'), 0, 100000);
  const hp = [
    clamp(readNumber(o, 'hpA'), 1, 1000000),
    clamp(readNumber(o, 'hpB'), 1, 1000000),
  ];

  const rng = Rng.fromSeed(seed);
  const eventLog: Json[] = [];
  let turn = 0;
  let attacker = rng.nextInt(2);
  while ((hp[0] ?? 0) > 0 && (hp[1] ?? 0) > 0) {
    turn += 1;
    let damage = 1 + rng.nextInt(maxDamage);
    const crit = rng.nextInt(4) === 0;
    if (crit) damage += mulBps(damage, critBps);
    const target = 1 - attacker;
    const left = maxInt((hp[target] ?? 0) - damage, 0);
    hp[target] = left;
    eventLog.push({ turn, attacker, target, damage, crit, targetHp: left });
    attacker = target;
  }
  return {
    result: {
      winner: (hp[0] ?? 0) > 0 ? 0 : 1,
      turns: turn,
      hpA: hp[0] ?? 0,
      hpB: hp[1] ?? 0,
    },
    eventLog,
  };
}
