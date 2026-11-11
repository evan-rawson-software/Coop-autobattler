/** Helpers for the ghost tests: play whole runs through a controller. */
import type { GhostSnapshot } from '@game/core';
import {
  createMemoryGhostStore,
  type MemoryGhostStore,
} from './ghost-store.js';
import { startRun, type RunController } from './run-controller.js';
import { createMemorySaveStore } from './save-store-memory.js';
import { corePosition, makeGameDeps } from './test-support.js';
import type { CreateRunArgs, Intent, RunDeps, RunState } from './types.js';

export const INSTALLED = '0.1.0';

export interface Rig {
  readonly saves: ReturnType<typeof createMemorySaveStore>;
  readonly ghosts: MemoryGhostStore;
}

export function newRig(): Rig {
  return { saves: createMemorySaveStore(), ghosts: createMemoryGhostStore() };
}

/** Deps with the ghost pool on, for an install called `ownerId`. */
export function ghostDeps(ownerId: string): RunDeps {
  return makeGameDeps({ ghosts: { ownerId } });
}

export interface Game {
  readonly controller: RunController;
  readonly args: CreateRunArgs;
  readonly deps: RunDeps;
}

let clock = 1000;

export async function begin(
  rig: Rig,
  deps: RunDeps,
  args: Partial<CreateRunArgs> & { runId: string },
): Promise<Game> {
  const full: CreateRunArgs = {
    runVersion: '0.1',
    seed: 7,
    players: ['Ann'],
    host: 0,
    ...args,
  };
  const r = await startRun(full, deps, rig.saves, clock++, INSTALLED, {
    ghostStore: rig.ghosts,
  });
  if (!r.ok) throw new Error(`startRun: ${r.reason}`);
  return { controller: r.controller, args: full, deps };
}

async function send(g: Game, player: number, intent: Intent): Promise<void> {
  const r = await g.controller.dispatch(player, intent, clock++);
  if (!r.ok) {
    throw new Error(
      `${intent.type} rejected: ${r.reason} ${r.detail ?? ''} (step ${g.controller.state.step})`,
    );
  }
}

/** One default move of everyone in the current step. */
export async function stepOnce(g: Game): Promise<void> {
  const s = g.controller.state;
  const n = s.players.length;
  const all = Array.from({ length: n }, (_, i) => i);
  switch (s.step) {
    case 'core_placement': {
      const pos = corePosition(s);
      await send(g, 0, { type: 'propose_core', ...pos });
      for (const p of all.slice(1))
        await send(g, p, { type: 'vote', choice: pos });
      return;
    }
    case 'pve_choice':
      for (const p of all) await send(g, p, { type: 'vote', choice: 'easy' });
      return;
    case 'event_choice': {
      const o = (s.pending as { options: { id: string }[] }).options[0];
      for (const p of all)
        await send(g, p, { type: 'vote', choice: o?.id ?? '' });
      return;
    }
    case 'event_resolve': {
      const fu = (
        s.pending as {
          followUp: { perPlayer?: boolean; options: { id: string }[] };
        }
      ).followUp;
      const id = fu.perPlayer === true ? 'skip' : (fu.options[0]?.id ?? '');
      for (const p of all)
        await send(g, p, { type: 'event_choose', choice: id });
      return;
    }
    default:
      for (const p of all) await send(g, p, { type: 'ready' });
  }
}

export async function playUntil(
  g: Game,
  stop: (s: RunState) => boolean,
  check: (s: RunState) => void = () => undefined,
): Promise<RunState> {
  for (let i = 0; i < 400; i++) {
    const s = g.controller.state;
    check(s);
    if (stop(s) || s.step === 'run_over') return s;
    await stepOnce(g);
  }
  throw new Error('did not reach the stop');
}

/** The snapshots of a bucket, typed. */
export async function listBucket(
  rig: Rig,
  gameVersion: string,
  partySize: number,
  round: number,
): Promise<GhostSnapshot[]> {
  return (await rig.ghosts.list({
    gameVersion,
    partySize,
    round,
  })) as GhostSnapshot[];
}
