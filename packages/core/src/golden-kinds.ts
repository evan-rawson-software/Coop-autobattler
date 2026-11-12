/**
 * Registry of golden-vector kinds: `kind` -> pure function from plain JSON
 * input to a plain JSON result (and optionally an event log). To add a kind,
 * add one entry to `goldenKinds`. Functions must be deterministic.
 */
import type { Json } from './hash.js';
import { Rng } from './rng.js';

export interface SimulationOutput {
  result: Json;
  eventLog?: Json[];
}

export type SimulationFn = (input: Json) => SimulationOutput;

function obj(input: Json): Record<string, Json> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('input must be an object');
  }
  return input as Record<string, Json>;
}

function num(o: Record<string, Json>, key: string): number {
  const v = o[key];
  if (typeof v !== 'number')
    throw new TypeError(`input.${key} must be a number`);
  return v;
}

function prngU32(input: Json): SimulationOutput {
  const o = obj(input);
  const rng = Rng.fromSeed(num(o, 'seed'));
  const values: number[] = [];
  for (let i = 0; i < num(o, 'count'); i++) values.push(rng.nextU32());
  return { result: { values } };
}

function prngSample(input: Json): SimulationOutput {
  const o = obj(input);
  const rng = Rng.fromSeed(num(o, 'seed'));
  const ints: number[] = [];
  for (let i = 0; i < num(o, 'count'); i++)
    ints.push(rng.nextInt(num(o, 'bound')));
  const items = Array.from({ length: num(o, 'shuffleLength') }, (_, i) => i);
  const shuffled = rng.shuffle(items);
  const picked = rng.pick(items);
  return { result: { ints, shuffled, picked, state: rng.getState() } };
}

function prngChild(input: Json): SimulationOutput {
  const o = obj(input);
  const label = o['label'];
  if (typeof label !== 'string' && typeof label !== 'number') {
    throw new TypeError('input.label must be a string or number');
  }
  const parent = Rng.fromSeed(num(o, 'seed'));
  const child = parent.child(label);
  const values: number[] = [];
  for (let i = 0; i < num(o, 'count'); i++) values.push(child.nextU32());
  return { result: { parentState: parent.getState(), values } };
}

export const goldenKinds: Readonly<Record<string, SimulationFn>> = {
  'prng-u32': prngU32,
  'prng-sample': prngSample,
  'prng-child': prngChild,
};
