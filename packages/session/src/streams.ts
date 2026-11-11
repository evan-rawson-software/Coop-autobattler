/**
 * Randomness for a run (see README, "RNG streams").
 *
 * The run keeps one `Rng`, saved in `state.rng`. Every purpose gets its own
 * child stream, named by a label that includes the round. Drawing a stream
 * advances the run's generator by one output, so two draws with the same
 * label still differ, and the advanced state is stored back in the run state.
 * Replaying the same intents from the seed therefore redraws the same
 * streams in the same order.
 */
import { Rng } from '@game/core';
import type { RunState } from './types.js';

/**
 * Derive the stream for `label` and return it with the state holding the
 * advanced generator. Pure: the input state is not changed.
 */
export function drawStream(
  state: RunState,
  label: string,
): { readonly state: RunState; readonly stream: Rng } {
  const rng = Rng.fromState(state.rng);
  const stream = rng.child(label);
  rng.nextU32();
  return { state: { ...state, rng: rng.getState() }, stream };
}

/** The root generator of a run: a child of the seed's generator. */
export function rootRng(seed: number): Rng {
  return Rng.fromSeed(seed).child('run');
}

/** The stream labels the step machine uses; `r` is the round number. */
export const streamLabels = {
  kit: 'kit',
  pveOptions: (round: number): string => `pve_options:r${String(round)}`,
  battle: (kind: 'pve' | 'pvp', round: number): string =>
    `battle:${kind}:r${String(round)}`,
  eventOffers: (round: number, leg: string): string =>
    `event_offers:r${String(round)}:${leg}`,
  eventResolve: (round: number, leg: string): string =>
    `event_resolve:r${String(round)}:${leg}`,
  shop: (round: number, leg: string): string => `shop:r${String(round)}:${leg}`,
} as const;
