/**
 * The Build screen's run: a `RunController` over an in-memory save store (the
 * browser store comes later), plus the layout undo stack. Every change is an
 * intent dispatched through the controller, so it is saved before the result
 * comes back. Nothing here mutates state.
 */

import {
  createEconomyDeps,
  createMemorySaveStore,
  startRun,
  type DispatchResult,
  type Intent,
  type RunController,
  type RunState,
} from '@game/session';
import { createStore, type Store } from '../app-state.js';
import { appliedNotice } from '../event/view-model.js';
import { content } from '../content.js';
import { noteRound } from './new-items.js';
import { economy } from './setup.js';
import {
  UndoStack,
  previewActions,
  toIntent,
  type ApplyResult,
  type LayoutAction,
} from './undo.js';

/**
 * Steps in which the layout can be edited: the first `build`, and the `shop`
 * step, which is the same board seen from its other tab (RS-5f).
 */
export function isEditStep(step: string): boolean {
  return step === 'build' || step === 'shop';
}

/** The player index of this (solo) prototype. */
export const ME = 0;

const LAYOUT_INTENTS = new Set([
  'place_building',
  'move_building',
  'return_building',
  'add_conduit',
  'erase_conduit',
  'ready',
  'unready',
]);

export interface SessionView {
  readonly run: RunState;
  readonly undoCount: number;
  readonly redoCount: number;
  /**
   * What the last step did for this player that the next screen should say
   * (the Workshop: "Upgraded Barracks to tier 2 for 16 gold"); cleared when
   * dismissed or when the player presses Ready.
   */
  readonly notice: string | null;
  /**
   * The player this device acts as (this prototype is played locally: one
   * person may control every player of a party; solo it is always 0).
   */
  readonly acting: number;
}

let runCounter = 0;

export class BuildSession {
  readonly stack = new UndoStack();
  readonly store: Store<SessionView>;
  private stepAnchor: string;
  private lockedDetail: string | null = null;
  private notice: string | null = null;

  private lastStamp = 0;
  private actingPlayer = ME;

  /**
   * The time stamped on the next saved action: the current time, but always
   * later than the last one of this session, so two actions in the same
   * millisecond still order.
   */
  private stamp(): number {
    this.lastStamp = Math.max(this.clockNow(), this.lastStamp + 1);
    return this.lastStamp;
  }

  private constructor(
    readonly controller: RunController,
    private readonly clockNow: () => number,
  ) {
    this.stepAnchor = this.anchor();
    this.store = createStore<SessionView>(this.view());
  }

  /**
   * Wrap an existing controller (the Shop route: one run shared by the Shop
   * and Build tabs, saved in a browser store).
   */
  static fromController(
    controller: RunController,
    now: () => number = Date.now,
  ): BuildSession {
    return new BuildSession(controller, now);
  }

  /** Start a run (solo unless `players` names more) with a fixed seed. */
  static async start(
    seed: number,
    now: () => number = Date.now,
    players: readonly string[] = ['You'],
  ): Promise<BuildSession> {
    runCounter += 1;
    const deps = createEconomyDeps(content, content.mapgen, economy);
    const r = await startRun(
      {
        runId: `dev-${String(seed)}-${String(runCounter)}`,
        runVersion: '1.0',
        seed,
        players,
        host: 0,
      },
      deps,
      createMemorySaveStore(),
      now(),
      '1.0.0',
    );
    if (!r.ok) throw new Error(`Could not start a run: ${r.reason}`);
    return new BuildSession(r.controller, now);
  }

  get run(): RunState {
    return this.controller.state;
  }

  private anchor(): string {
    const s = this.controller.state;
    return `${String(s.round)}:${s.leg}:${s.step}`;
  }

  private view(): SessionView {
    noteRound(this.controller.state);
    return {
      run: this.controller.state,
      undoCount: this.stack.undoCount,
      redoCount: this.stack.redoCount,
      notice: this.notice,
      acting: this.actingPlayer,
    };
  }

  /** The player this device acts as now. */
  get acting(): number {
    return this.actingPlayer;
  }

  /**
   * Switch the acting player (a multi-player party played from one browser).
   * The layout history belongs to one player's edits, so it is cleared.
   */
  setActing(player: number): void {
    if (
      player === this.actingPlayer ||
      player < 0 ||
      player >= this.controller.state.players.length
    ) {
      return;
    }
    this.actingPlayer = player;
    this.stack.clear();
    this.publish();
  }

  private publish(): void {
    this.store.set(this.view());
  }

  /**
   * Stop accepting intents (the saved run changed elsewhere). Every later
   * dispatch is refused as `stale` with this text, and nothing is sent
   * to the controller.
   */
  lock(detail: string): void {
    this.lockedDetail = detail;
  }

  get locked(): boolean {
    return this.lockedDetail !== null;
  }

  /** Dispatch one intent. Clears the undo stack at a step change or on any
   * intent that is not a layout change (buying, selling, re-rolling). */
  async dispatch(intent: Intent): Promise<DispatchResult> {
    if (this.lockedDetail !== null) {
      return { ok: false, reason: 'stale', detail: this.lockedDetail };
    }
    const r = await this.controller.dispatch(
      this.actingPlayer,
      intent,
      this.stamp(),
    );
    if (r.ok) {
      if (intent.type === 'ready') this.notice = null;
      for (const e of r.effects) {
        if (e.type === 'custom' && e.name === 'event_resolved') {
          const applied = (e.data as { applied?: unknown }).applied;
          if (Array.isArray(applied)) {
            this.notice =
              appliedNotice(applied, this.actingPlayer, content) ?? this.notice;
          }
        }
      }
      if (
        !LAYOUT_INTENTS.has(intent.type) ||
        this.anchor() !== this.stepAnchor
      ) {
        this.stack.clear();
      }
      this.stepAnchor = this.anchor();
    }
    this.publish();
    return r;
  }

  /**
   * Dispatch an intent as another player of this device (the two-player
   * sample route drives the partner this way). Layout history is untouched.
   */
  async dispatchAs(player: number, intent: Intent): Promise<DispatchResult> {
    if (this.lockedDetail !== null) {
      return { ok: false, reason: 'stale', detail: this.lockedDetail };
    }
    const r = await this.controller.dispatch(player, intent, this.stamp());
    this.publish();
    return r;
  }

  /** Hide the notice. */
  dismissNotice(): void {
    this.notice = null;
    this.publish();
  }

  private async applyAll(
    actions: readonly LayoutAction[],
  ): Promise<ApplyResult> {
    for (const a of actions) {
      const intent = toIntent(this.run.team, a);
      if (intent === null) {
        return { ok: false, reason: 'unknown_conduit' };
      }
      const r = await this.dispatch(intent);
      if (!r.ok) {
        return r.detail === undefined
          ? { ok: false, reason: r.reason }
          : { ok: false, reason: r.reason, detail: r.detail };
      }
    }
    return { ok: true };
  }

  /** Apply a layout change and remember it for undo. */
  async act(action: LayoutAction): Promise<ApplyResult> {
    const before = this.run.team;
    const r = await this.applyAll([action]);
    if (r.ok) {
      this.stack.record(action, before);
      this.publish();
    }
    return r;
  }

  async undo(): Promise<ApplyResult | null> {
    const r = await this.stack.undo(
      (a) => this.applyAll(a),
      (a) => previewActions(this.run.team, content, a, this.actingPlayer),
    );
    this.publish();
    return r;
  }

  async redo(): Promise<ApplyResult | null> {
    const r = await this.stack.redo(
      (a) => this.applyAll(a),
      (a) => previewActions(this.run.team, content, a, this.actingPlayer),
    );
    this.publish();
    return r;
  }
}
