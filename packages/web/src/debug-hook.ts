/**
 * A small read-only window into the running page for the smoke script. It is
 * only installed in dev and in builds made with `--mode debug`; a normal
 * production build drops it.
 */

import type { Camera } from './board/camera.js';
import type { Hit } from './board/scene.js';
import type { Selection } from './board/render.js';

export interface DebugHook {
  camera?: () => Camera;
  viewport?: () => { w: number; h: number };
  hovered?: () => Hit | null;
  selection?: () => Selection | null;
  /** Mean and count of canvas draw times in milliseconds. */
  drawStats?: () => { count: number; meanMs: number; maxMs: number };
  resetDrawStats?: () => void;
  /** Switch the debug screen's sample to the dense one. */
  setDense?: (dense: boolean) => void;
  /** Number of buildings and conduit cells in the own board. */
  counts?: () => { buildings: number; conduits: number; conduitCells: number };
  build?: BuildDebug;
  shop?: ShopDebug;
  /** The second player of the two-player sample route (`?players=2`). */
  partner?: PartnerDebug;
  battle?: BattleDebug;
  run?: RunDebug;
  placement?: PlacementDebug;
  menu?: MenuDebug;
  /** The sprite atlas: load state and how much was drawn from it. */
  sprites?: () => {
    state: string;
    drawn: number;
    spriteFrames: number;
    flatFrames: number;
    layerBuilds: number;
    tintCache: number;
  };
  /** Terrain cells of the neutral strip that are currently drawn. */
  neutralFeatureCount?: () => number;
}

/** Read-only view of the run behind the run screens, for the smoke script. */
export interface RunDebug {
  /** The screen the router chose (`core`, `pve_choice`, ...). */
  screen: () => string;
  /** Plain data: run id, step, round, lives, gold, action count, state hash. */
  state: () => unknown;
}

/** Read-only view of the Core placement screen for the smoke script. */
export interface PlacementDebug {
  legal: () => readonly { x: number; y: number }[];
  cellToScreen: (x: number, y: number) => { x: number; y: number } | null;
  selected: () => { x: number; y: number } | null;
  pathCount: () => number;
}

/** Read-only view of the main menu for the smoke script. */
export interface MenuDebug {
  storage: () => string;
  runIds: () => readonly string[];
}

/** Read-only view of the Battle screen for the smoke script. */
export interface BattleDebug {
  phase: () => string;
  tick: () => number;
  endTick: () => number;
  speed: () => number;
  paused: () => boolean;
  revealed: () => boolean;
  /** The result of the up-front simulation. */
  result: () => { winner: number; reason: string; endTick: number };
  /** Final Core health of both sides from the up-front simulation. */
  coreHealth: () => readonly [number, number];
  /** Hash of the visual simulation's current state. */
  stateHash: () => string;
  /** Hash of the simulated event log, and the hash the run state stored. */
  eventLogHash: () => string;
  storedEventLogHash: () => string | null;
  unitsAlive: () => number;
  simMs: () => number;
  /** How the latest simulation ran (worker or main thread) and its timing. */
  simInfo: () => {
    usesWorker: boolean;
    ranOnMainThread: boolean;
    roundTripMs: number;
    /** Main-thread time to set up playback from the received record. */
    prepareMs: number;
  };
  ready: () => boolean;
  /** Per side, what the visual simulation's board holds. */
  scene: () => DebugScene;
  /**
   * Animation frame intervals in milliseconds while playing, oldest first;
   * `true` clears the record.
   */
  frameTimes: (reset?: boolean) => readonly number[];
  setSpeed: (speed: 1 | 2 | 4) => void;
  /** Arena size in cells (both boards and the neutral strip). */
  geometry: () => { width: number; height: number };
}

export interface DebugSceneSide {
  readonly buildings: number;
  readonly conduits: number;
  /** Building count by `kind:id`. */
  readonly kinds: Readonly<Record<string, number>>;
}
export type DebugScene = readonly [DebugSceneSide, DebugSceneSide];

/** Read-only view of the Build screen for the smoke script. */
export interface BuildDebug {
  step: () => string;
  /** Hash of the layout (see build/undo.ts `layoutHash`). */
  hash: () => string;
  team: () => unknown;
  status: () => { text: string; kind: string };
  ui: () => unknown;
  counts: () => { undo: number; redo: number; actions: number };
  /** Client pixel position of the centre of a board cell. */
  cellToScreen: (x: number, y: number) => { x: number; y: number } | null;
  problems: () => readonly { id: string; kind: string; text: string }[];
  legalCore: () => readonly { x: number; y: number }[];
  /** Ids of the placed unit producers sealed off from the front row. */
  sealed: () => readonly number[];
  enemyPathCount: () => number;
  dry: () => unknown;
}

/** Read-only view of the Shop tab for the smoke script. */
export interface PartnerDebug {
  ready: () => Promise<boolean>;
  unready: () => Promise<boolean>;
  isReady: () => boolean;
}

export interface ShopDebug {
  /** Which mount of the Shop tab this is (1, 2, ...): changes on every remount. */
  mounts: () => number;
  /** Plain data: step, gold, offers, stash, ready flag, action count, undo depth. */
  state: () => unknown;
}

declare global {
  interface Window {
    __debug?: DebugHook;
  }
}

export const DEBUG_HOOK: boolean =
  import.meta.env.DEV || import.meta.env.MODE === 'debug';

export function registerDebug(patch: DebugHook): void {
  if (!DEBUG_HOOK) return;
  window.__debug = { ...window.__debug, ...patch };
}

/** Remove hooks that belong to a screen that has gone away. */
export function unregisterDebug(...keys: (keyof DebugHook)[]): void {
  if (!DEBUG_HOOK || window.__debug === undefined) return;
  window.__debug = Object.fromEntries(
    Object.entries(window.__debug).filter(
      ([k]) => !(keys as string[]).includes(k),
    ),
  );
}
