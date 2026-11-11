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
import { content } from '../content.js';
import { economy } from './setup.js';
import {
  UndoStack,
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
}

let clock = Date.now();
let runCounter = 0;

export class BuildSession {
  readonly stack = new UndoStack();
  readonly store: Store<SessionView>;
  private stepAnchor: string;
  private lockedDetail: string | null = null;

  private constructor(readonly controller: RunController) {
    this.stepAnchor = this.anchor();
    this.store = createStore<SessionView>(this.view());
  }

  /**
   * Wrap an existing controller (the Shop route: one run shared by the Shop
   * and Build tabs, saved in a browser store).
   */
  static fromController(controller: RunController): BuildSession {
    return new BuildSession(controller);
  }

  /** Start a solo run with a fixed seed. */
  static async start(seed: number): Promise<BuildSession> {
    runCounter += 1;
    const deps = createEconomyDeps(content, content.mapgen, economy);
    const r = await startRun(
      {
        runId: `dev-${String(seed)}-${String(runCounter)}`,
        runVersion: '0.1',
        seed,
        players: ['You'],
        host: 0,
      },
      deps,
      createMemorySaveStore(),
      ++clock,
      '0.1.0',
    );
    if (!r.ok) throw new Error(`Could not start a run: ${r.reason}`);
    return new BuildSession(r.controller);
  }

  get run(): RunState {
    return this.controller.state;
  }

  private anchor(): string {
    const s = this.controller.state;
    return `${String(s.round)}:${s.leg}:${s.step}`;
  }

  private view(): SessionView {
    return {
      run: this.controller.state,
      undoCount: this.stack.undoCount,
      redoCount: this.stack.redoCount,
    };
  }

  private publish(): void {
    this.store.set(this.view());
  }

  /**
   * Stop accepting intents (the saved run changed elsewhere). Every later
   * dispatch is refused as `save_failed` with this text, and nothing is sent
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
      return { ok: false, reason: 'save_failed', detail: this.lockedDetail };
    }
    const r = await this.controller.dispatch(ME, intent, ++clock);
    if (r.ok) {
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
    const r = await this.stack.undo((a) => this.applyAll(a));
    this.publish();
    return r;
  }

  async redo(): Promise<ApplyResult | null> {
    const r = await this.stack.redo((a) => this.applyAll(a));
    this.publish();
    return r;
  }
}
