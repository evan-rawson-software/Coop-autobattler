/** Helpers for the ghost tests: play whole runs through a controller. */
import { Rng, type GhostSnapshot } from '@game/core';
import {
  createMemoryGhostStore,
  type MemoryGhostStore,
} from '../app/ghost-store.js';
import { SELECT_GHOST } from '../rules/ghosts.js';
import { applyIntent, createRun } from '../rules/machine.js';
import { startRun, type RunController } from '../app/run-controller.js';
import { createMemorySaveStore } from '../app/save-store-memory.js';
import { coreMove, makeGameDeps } from './test-support.js';
import type {
  CreateRunArgs,
  Effect,
  Intent,
  Json,
  RunDeps,
  RunState,
} from '../rules/types.js';

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
      for (const p of all) await send(g, p, coreMove(s, p));
      for (const p of all) await send(g, p, { type: 'ready' });
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

// ---------------------------------------------------------------------------
// A simple buying and upgrading bot, pure (no controller, no store)

/** The state of a bot-played run and what it produced. */
export interface BotRun {
  readonly state: RunState;
  /** The `ghost_snapshot` effects, in order. */
  readonly snapshots: GhostSnapshot[];
}

type Applied = { state: RunState; effects: readonly Effect[] } | null;

function tryApply(
  state: RunState,
  player: number,
  intent: Intent,
  deps: RunDeps,
  snapshots: GhostSnapshot[],
): Applied {
  const r = applyIntent(state, player, intent, deps);
  if (!r.ok) return null;
  for (const fx of r.effects) {
    if (fx.type === 'ghost_snapshot') snapshots.push(fx.snapshot);
  }
  return { state: r.state, effects: r.effects };
}

function stepOf(s: RunState): string {
  return s.step;
}

interface Opt {
  id?: string;
  type?: string;
  player?: number;
  tier?: number;
  price?: number;
  affordable?: boolean;
}

function optionsOf(v: unknown, key: string): Opt[] {
  const p = v as Record<string, unknown> | null;
  const o = p === null ? undefined : p[key];
  return Array.isArray(o) ? (o as Opt[]) : [];
}

/**
 * One step of the bot: the whole party does one default thing. In a shop it
 * buys everything it can afford (and re-rolls while it has gold left), in an
 * event it prefers the Workshop and upgrades the highest-tier building it can
 * afford. Ghost selection picks the boss. Returns null if it is stuck.
 */
export function botStep(
  start: RunState,
  deps: RunDeps,
  rng: Rng,
  snapshots: GhostSnapshot[],
  candidates: (s: RunState) => readonly unknown[] = () => [],
): RunState | null {
  let s = start;
  const n = s.players.length;
  const put = (player: number, intent: Intent): boolean => {
    const r = tryApply(s, player, intent, deps, snapshots);
    if (r === null) return false;
    s = r.state;
    return true;
  };
  switch (s.step) {
    case 'core_placement': {
      for (let p = 0; p < n; p++) {
        if (!put(p, coreMove(s, p))) return null;
      }
      for (let p = 0; p < n; p++) {
        if (!put(p, { type: 'ready' })) return null;
      }
      return s;
    }
    case 'pve_choice':
      for (let p = 0; p < n; p++) {
        if (!put(p, { type: 'vote', choice: 'hard' })) {
          if (!put(p, { type: 'vote', choice: 'easy' })) return null;
        }
      }
      return s;
    case 'event_choice': {
      const opts = optionsOf(s.pending, 'options');
      const pick = opts.find((o) => o.type === 'workshop') ?? opts[0] ?? {};
      for (let p = 0; p < n; p++) {
        if (!put(p, { type: 'vote', choice: pick.id ?? '' })) return null;
      }
      return s;
    }
    case 'event_resolve': {
      const fu = (s.pending as { followUp: unknown }).followUp;
      const opts = optionsOf(fu, 'options');
      const per = (fu as { perPlayer?: boolean }).perPlayer === true;
      for (let p = 0; p < n; p++) {
        // Players whose only choice was the automatic skip leave the step
        // done as soon as the others have chosen.
        if (stepOf(s) !== 'event_resolve') break;
        const mine = per
          ? opts
              .filter((o) => o.player === p && o.affordable === true)
              .sort((a, b) => (b.tier ?? 0) - (a.tier ?? 0))
          : opts;
        const choice = mine[0]?.id ?? 'skip';
        if (!put(p, { type: 'event_choose', choice })) {
          if (!put(p, { type: 'event_choose', choice: 'skip' })) return null;
        }
      }
      return s;
    }
    case 'shop': {
      if (s.leg === 'pve' && s.pvpOpponent === null && deps.ghosts) {
        const list = candidates(s) as unknown as Json;
        if (!put(s.host, { type: SELECT_GHOST, candidates: list })) return null;
      }
      for (let p = 0; p < n; p++) {
        for (let guard = 0; guard < 12; guard++) {
          const me = s.perPlayer[p];
          const shop = me?.shop as {
            offers?: ({ price: number } | null)[];
          } | null;
          const offers = shop?.offers ?? [];
          const gold = me?.gold ?? 0;
          const slots = offers.flatMap((o, i) =>
            o !== null && o.price <= gold ? [i] : [],
          );
          const slot = slots[rng.nextInt(Math.max(1, slots.length))];
          if (slot !== undefined && put(p, { type: 'buy', slot })) continue;
          if (gold >= 3 && rng.nextInt(2) === 0 && put(p, { type: 'reroll' })) {
            continue;
          }
          break;
        }
      }
      for (let p = 0; p < n; p++) if (!put(p, { type: 'ready' })) return null;
      return s;
    }
    default:
      for (let p = 0; p < n; p++) if (!put(p, { type: 'ready' })) return null;
      return s;
  }
}

/** Play a whole run with the bot until `stop` or the end (or `maxSteps`). */
export function botRun(
  deps: RunDeps,
  args: CreateRunArgs,
  seed: number,
  stop: (s: RunState) => boolean,
  candidates?: (s: RunState) => readonly unknown[],
  maxSteps = 600,
): BotRun {
  const created = createRun(args, deps);
  if (!created.ok) throw new Error(created.detail);
  let state = created.state;
  const snapshots: GhostSnapshot[] = [];
  const rng = Rng.fromSeed(seed);
  for (let i = 0; i < maxSteps && !stop(state); i++) {
    if (state.step === 'run_over') break;
    const next = botStep(state, deps, rng, snapshots, candidates);
    if (next === null) throw new Error(`bot stuck in ${state.step}`);
    state = next;
  }
  return { state, snapshots };
}
