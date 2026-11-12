/**
 * The Build screen's interaction logic: tools, dragging, the conduit draft,
 * selection and the status line. A plain class around a store; no DOM. It
 * asks `core` (through `ops.ts`) whether an action would be accepted, and
 * makes changes only by dispatching intents through `BuildSession`.
 */

import {
  coreFootprint,
  corePlayerAt,
  listLegalCorePositionsAnyPlot,
  occupancy,
  validateCorePosition,
  type Cell,
  type ConduitEnd,
  type PlacedBuilding,
  type Rotation,
  type TeamState,
  conduitTouches,
  isBorderEnd,
} from '@game/core';
import { createStore, type Store } from '../app-state.js';
import type { BoardPointerEvent } from '../board/BoardView.js';
import { content } from '../content.js';
import { extendPath, proposePath } from './autoroute.js';
import {
  anchorUnderCursor,
  footprintCells,
  nextRotation,
  outsideCells,
  sameCell,
} from './geometry.js';
import {
  previewConduit,
  previewMove,
  previewPlace,
  type Verdict,
} from './ops.js';
import {
  parseCell,
  reasonMessage,
  selectionNote,
  type SelectionCause,
} from './reasons.js';
import { BuildSession, isEditStep, type SessionView } from './session.js';
import {
  chooseInput,
  freeOutputSides,
  markerAt,
  sideMarkers,
} from './sides.js';
import { buildingName } from './view-model.js';
import { DEFAULT_SEED } from './setup.js';
import { READY_LOCK_TEXT } from './lock.js';
import type { LayoutAction } from './undo.js';

export type Tool = 'select' | 'conduit' | 'erase';

export type Selection =
  | { readonly kind: 'building'; readonly id: number }
  | { readonly kind: 'core' }
  | { readonly kind: 'conduit'; readonly id: number }
  | null;

export interface Held {
  readonly id: number;
  readonly rotation: Rotation;
  /** `drag`: button still down after a press on the stash; `sticky`: picked by click. */
  readonly mode: 'drag' | 'sticky';
}

export interface Moving {
  readonly id: number;
  readonly origin: {
    readonly x: number;
    readonly y: number;
    readonly rotation: Rotation;
  };
  /** The grabbed cell relative to the building's lowest cell. */
  readonly offset: Cell;
  readonly rotation: Rotation;
  readonly start: Cell;
  readonly started: boolean;
}

export interface Draft {
  readonly building: number;
  readonly from: ConduitEnd | null;
  readonly cells: readonly Cell[];
  readonly pressed: boolean;
  readonly dragged: boolean;
}

export interface Ghost {
  readonly defId: string | null;
  readonly cells: readonly Cell[];
  readonly ok: boolean;
  readonly message: string | null;
  readonly warn: string | null;
}

export interface DraftView {
  readonly cells: readonly Cell[];
  /** null while no end is aimed at; then no verdict exists. */
  readonly ok: boolean | null;
  readonly message: string | null;
  readonly offending: Cell | null;
  readonly target: ConduitEnd | null;
}

export interface Status {
  readonly text: string;
  readonly kind: 'info' | 'ok' | 'error';
}

export interface Overlays {
  readonly flow: boolean;
  readonly paths: boolean;
  readonly dry: boolean;
}

export interface Ui {
  readonly tool: Tool;
  readonly selection: Selection;
  readonly held: Held | null;
  readonly moving: Moving | null;
  readonly draft: Draft | null;
  readonly hover: Cell | null;
  readonly overlays: Overlays;
  /** Ticks for the dry run (10 ticks are one second). */
  readonly dryTicks: number;
  readonly status: Status;
  readonly ghost: Ghost | null;
  readonly draftView: DraftView | null;
  /** The last refused conduit, kept visible with its offending cell. */
  readonly attempt: {
    readonly cells: readonly Cell[];
    readonly offending: Cell | null;
  } | null;
  /** Core placement: what the cursor would do. */
  readonly coreGhost: Ghost | null;
}

export interface Model {
  readonly view: SessionView | null;
  readonly ui: Ui;
  readonly seed: number;
}

const INITIAL_UI: Ui = {
  tool: 'select',
  selection: null,
  held: null,
  moving: null,
  draft: null,
  hover: null,
  overlays: { flow: false, paths: false, dry: false },
  dryTicks: 600,
  status: { text: 'Starting a run.', kind: 'info' },
  ghost: null,
  draftView: null,
  attempt: null,
  coreGhost: null,
};

export function conduitAt(team: TeamState, cell: Cell) {
  return team.conduits.find((c) => c.cells.some((p) => sameCell(p, cell)));
}

function attachedCount(team: TeamState, id: number): number {
  return team.conduits.filter((c) => conduitTouches(c, id)).length;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export class BuildController {
  readonly model: Store<Model>;
  session: BuildSession | null = null;
  /** Set by the screen: centre the camera on a board cell. */
  focusCell: (c: Cell) => void = () => {};
  private ui: Ui = INITIAL_UI;
  private seed = DEFAULT_SEED;
  private unsub: (() => void) | null = null;
  private legalCore: Cell[] = [];

  constructor() {
    this.model = createStore<Model>({
      view: null,
      ui: INITIAL_UI,
      seed: this.seed,
    });
  }

  // ---- Run lifecycle ------------------------------------------------------

  /** True when the session belongs to the shared Shop + Build run. */
  shared = false;
  /** The dev run (`#build`), kept aside while the shared run is attached. */
  private devSession: BuildSession | null = null;
  private devSeed = DEFAULT_SEED;

  /**
   * Show the dev run on `#build`: the one that was in progress before the
   * shared run was attached, or else a new one.
   */
  async enterDev(seed: number): Promise<void> {
    const dev = this.devSession;
    if (this.shared && dev !== null) {
      this.devSession = null;
      this.seed = this.devSeed;
      this.attach(dev, false);
      return;
    }
    await this.newRun(seed);
  }

  async newRun(seed: number): Promise<void> {
    this.unsub?.();
    this.seed = seed;
    this.shared = false;
    this.ui = {
      ...INITIAL_UI,
      status: { text: 'Starting a run.', kind: 'info' },
    };
    this.session = null;
    this.emit();
    this.attach(await BuildSession.start(seed));
  }

  /**
   * Work on an existing session (the shared Shop + Build run). The UI state
   * (tool, selection) starts fresh; the run itself is untouched.
   */
  attach(s: BuildSession, shared = false): void {
    if (shared && !this.shared && this.session !== null) {
      this.devSession = this.session;
      this.devSeed = this.seed;
    }
    this.unsub?.();
    this.shared = shared;
    this.session = s;
    this.legalCore =
      s.run.step === 'core_placement'
        ? listLegalCorePositionsAnyPlot(s.run.team.map, content, content.mapgen)
        : [];
    this.unsub = s.store.subscribe(() => {
      this.afterState();
    });
    this.ui = {
      ...INITIAL_UI,
      status: {
        text:
          s.run.step === 'core_placement'
            ? 'Choose where the Core goes. It cannot be moved afterwards.'
            : 'Ready to build.',
        kind: 'info',
      },
    };
    this.afterState();
  }

  get legalCorePositions(): readonly Cell[] {
    return this.legalCore;
  }

  team(): TeamState | null {
    return this.session?.run.team ?? null;
  }

  private step(): string {
    return this.session?.run.step ?? 'none';
  }

  // ---- State plumbing -----------------------------------------------------

  private emit(): void {
    this.model.set({
      view: this.session?.store.get() ?? null,
      ui: this.ui,
      seed: this.seed,
    });
  }

  private set(patch: Partial<Ui>): void {
    this.ui = { ...this.ui, ...patch };
    this.derive();
    this.emit();
  }

  /** The team changed (or the session did): drop stale selections, redo previews. */
  private afterState(): void {
    const team = this.team();
    let sel = this.ui.selection;
    if (team !== null && sel !== null) {
      const id = sel.kind === 'core' ? 0 : sel.id;
      const gone =
        sel.kind === 'building'
          ? !team.buildings.some((b) => b.id === id)
          : sel.kind === 'conduit'
            ? !team.conduits.some((c) => c.id === id)
            : team.cores.every((c) => c === null);
      if (gone) sel = null;
    }
    this.ui = { ...this.ui, selection: sel };
    this.derive();
    this.emit();
  }

  /** Recompute everything that is a function of (team, ui). */
  private derive(): void {
    const team = this.team();
    const ui = this.ui;
    let ghost: Ghost | null = null;
    let coreGhost: Ghost | null = null;
    let draftView: DraftView | null = null;
    if (team !== null && this.step() === 'core_placement') {
      coreGhost = this.computeCoreGhost(team, ui.hover);
    } else if (team !== null && isEditStep(this.step())) {
      ghost = this.computeGhost(team, ui);
      draftView = this.computeDraftView(team, ui);
    }
    this.ui = { ...ui, ghost, draftView, coreGhost };
  }

  private computeCoreGhost(team: TeamState, hover: Cell | null): Ghost | null {
    if (hover === null) return null;
    const fp = coreFootprint(content.buildings);
    const cells: Cell[] = [];
    for (let dy = 0; dy < fp.height; dy++) {
      for (let dx = 0; dx < fp.width; dx++) {
        cells.push({ x: hover.x + dx, y: hover.y + dy });
      }
    }
    const r = validateCorePosition(
      team.map,
      content,
      content.mapgen,
      corePlayerAt(team.map, content, hover.x),
      hover,
    );
    return {
      defId: null,
      cells,
      ok: r.ok,
      message: r.ok ? null : reasonMessage(r.reason),
      warn: null,
    };
  }

  private computeGhost(team: TeamState, ui: Ui): Ghost | null {
    const hover = ui.hover;
    if (hover === null) return null;
    if (ui.held !== null) {
      const item = team.stash.find((s) => s.id === ui.held?.id);
      const def =
        item === undefined ? undefined : content.buildings.get(item.def);
      if (item === undefined || def === undefined) return null;
      const a = anchorUnderCursor(def, ui.held.rotation, hover);
      const v = previewPlace(team, content, {
        id: item.id,
        x: a.x,
        y: a.y,
        rotation: ui.held.rotation,
      });
      return {
        defId: def.id,
        cells: footprintCells(def, a.x, a.y, ui.held.rotation),
        ok: v.ok,
        message: v.ok ? null : reasonMessage(v.reason, v.detail),
        warn: null,
      };
    }
    if (ui.moving?.started === true) {
      const m = ui.moving;
      const b = team.buildings.find((x) => x.id === m.id);
      const def = b === undefined ? undefined : content.buildings.get(b.def);
      if (b === undefined || def === undefined) return null;
      const x = hover.x - m.offset.x;
      const y = hover.y - m.offset.y;
      const v = previewMove(team, content, {
        id: b.id,
        x,
        y,
        rotation: m.rotation,
      });
      const n = attachedCount(team, b.id);
      return {
        defId: def.id,
        cells: footprintCells(def, x, y, m.rotation),
        ok: v.ok,
        message: v.ok ? null : reasonMessage(v.reason, v.detail),
        warn:
          n > 0
            ? `Moving detaches ${String(n)} ${plural(n, 'conduit', 'conduits')}.`
            : null,
      };
    }
    return null;
  }

  /** The full finish of the draft aimed at a building: path and verdict. */
  private resolveFinish(
    team: TeamState,
    draft: Draft,
    target: ConduitEnd,
  ): { to: ConduitEnd; cells: Cell[] | null; verdict: Verdict | null } {
    const from = draft.from as ConduitEnd;
    const b = team.buildings.find((x) => x.id === target.building);
    let cells: Cell[] | null = [...draft.cells];
    if (b !== undefined) {
      const occ = occupancy(team, content);
      const last = draft.cells[draft.cells.length - 1];
      const edge = outsideCells(occ.cellsOf(b), target.side);
      if (last === undefined || !edge.some((c) => sameCell(c, last))) {
        cells = proposePath(team, content, from, target, draft.cells);
      }
    }
    if (cells === null) return { to: target, cells: null, verdict: null };
    return {
      to: target,
      cells,
      verdict: previewConduit(team, content, from, target, cells),
    };
  }

  /** What the cursor is aiming the draft at: an input marker or a building. */
  private draftTarget(
    team: TeamState,
    draft: Draft,
    cell: Cell,
  ): ConduitEnd | null {
    const inMarker = markerAt(
      sideMarkers(team, content, 'in', null, draft.building),
      cell,
    );
    if (inMarker !== null)
      return { building: inMarker.building, side: inMarker.side };
    const hit = occupancy(team, content).buildingAt(cell.x, cell.y);
    if (hit !== null && !('core' in hit) && hit.id !== draft.building) {
      return chooseInput(
        team,
        content,
        hit,
        draft.cells[draft.cells.length - 1] ?? cell,
      );
    }
    return null;
  }

  private computeDraftView(team: TeamState, ui: Ui): DraftView | null {
    const d = ui.draft;
    if (ui.tool !== 'conduit' || d === null || d.from === null) return null;
    const hover = ui.hover;
    if (hover === null) {
      return {
        cells: d.cells,
        ok: null,
        message: null,
        offending: null,
        target: null,
      };
    }
    const target = this.draftTarget(team, d, hover);
    if (target !== null) {
      const r = this.resolveFinish(team, d, target);
      if (r.cells === null) {
        return {
          cells: d.cells,
          ok: false,
          message: 'No route to that side.',
          offending: null,
          target,
        };
      }
      const v = r.verdict;
      return {
        cells: r.cells,
        ok: v?.ok ?? false,
        message: v === null || v.ok ? null : reasonMessage(v.reason, v.detail),
        offending:
          v !== null && !v.ok && v.detail !== undefined
            ? parseCell(v.detail)
            : null,
        target,
      };
    }
    const occ = occupancy(team, content);
    if (occ.buildingAt(hover.x, hover.y) !== null) {
      return {
        cells: d.cells,
        ok: null,
        message: null,
        offending: null,
        target: null,
      };
    }
    const ext = extendPath(team, content, d.from, d.cells, hover);
    return {
      cells: ext ?? d.cells,
      ok: null,
      message: null,
      offending: null,
      target: null,
    };
  }

  // ---- Status -------------------------------------------------------------

  private say(text: string, kind: Status['kind'] = 'info'): void {
    this.set({ status: { text, kind } });
  }

  private refuse(
    reason: string,
    detail?: string,
    cause?: SelectionCause,
  ): void {
    this.say(reasonMessage(reason, detail, cause), 'error');
  }

  // ---- Simple setters -----------------------------------------------------

  setTool(tool: Tool): void {
    this.set({
      tool,
      held: null,
      moving: null,
      draft: null,
      attempt: null,
      status: {
        text:
          tool === 'conduit'
            ? 'Conduit: click a building, then its output side, then click toward an input side.'
            : tool === 'erase'
              ? 'Erase conduit: click a conduit.'
              : 'Select / move: click to select, drag a building to move it.',
        kind: 'info',
      },
    });
  }

  setOverlay(key: keyof Overlays, on: boolean): void {
    this.set({ overlays: { ...this.ui.overlays, [key]: on } });
  }

  setDryTicks(ticks: number): void {
    if (Number.isInteger(ticks) && ticks >= 0 && ticks <= 100000) {
      this.set({ dryTicks: ticks });
    }
  }

  select(selection: Selection): void {
    this.set({ selection });
  }

  hover(cell: Cell | null): void {
    const h = this.ui.hover;
    if (h === cell || (h !== null && cell !== null && sameCell(h, cell)))
      return;
    this.set({ hover: cell });
  }

  cancel(): void {
    const u = this.ui;
    if (u.held !== null || u.moving !== null || u.draft !== null) {
      this.set({
        held: null,
        moving: null,
        draft: null,
        attempt: null,
        status: { text: 'Cancelled.', kind: 'info' },
      });
    } else if (u.selection !== null) {
      this.set({ selection: null });
    }
  }

  // ---- Stash --------------------------------------------------------------

  /** Pointer pressed on a stash entry: start a drag. */
  beginDrag(id: number): void {
    if (!isEditStep(this.step())) return;
    this.set({
      held: { id, rotation: 0, mode: 'drag' },
      moving: null,
      draft: null,
      attempt: null,
      selection: null,
      status: {
        text: 'Drop on the board. R rotates. Esc cancels.',
        kind: 'info',
      },
    });
  }

  /** Pointer released on the same stash entry: it was a click, keep holding. */
  stickHeld(): void {
    const h = this.ui.held;
    if (h?.mode !== 'drag') return;
    this.set({
      held: { ...h, mode: 'sticky' },
      status: {
        text: 'Click a cell to place it. R rotates. Esc cancels.',
        kind: 'info',
      },
    });
  }

  /** A press (drag) on the stash ended somewhere that is not the board. */
  dropOutside(): void {
    if (this.ui.held?.mode === 'drag') this.set({ held: null });
  }

  /** Pick by click (keyboard or touch): hold without a drag. */
  pickFromStash(id: number): void {
    this.beginDrag(id);
    this.stickHeld();
  }

  private async dropHeld(cell: Cell | null): Promise<void> {
    const s = this.session;
    const h = this.ui.held;
    if (s === null || h === null) return;
    const team = s.run.team;
    const item = team.stash.find((x) => x.id === h.id);
    const def =
      item === undefined ? undefined : content.buildings.get(item.def);
    if (cell === null || item === undefined || def === undefined) {
      this.set({ held: null });
      return;
    }
    const a = anchorUnderCursor(def, h.rotation, cell);
    const r = await s.act({
      t: 'place',
      id: item.id,
      x: a.x,
      y: a.y,
      rotation: h.rotation,
    });
    if (r.ok) {
      this.set({
        held: null,
        selection: { kind: 'building', id: item.id },
        status: {
          text: `Placed ${buildingName(content, def.id)}.`,
          kind: 'ok',
        },
      });
    } else {
      const msg = reasonMessage(r.reason, r.detail);
      this.set({
        held: h.mode === 'drag' ? null : h,
        status: { text: msg, kind: 'error' },
      });
    }
  }

  // ---- Rotate, return, erase ---------------------------------------------

  async rotate(): Promise<void> {
    const s = this.session;
    if (s === null) return;
    if (this.ui.held !== null) {
      this.set({
        held: {
          ...this.ui.held,
          rotation: nextRotation(this.ui.held.rotation),
        },
      });
      return;
    }
    if (this.ui.moving?.started === true) {
      const m = this.ui.moving;
      this.set({ moving: { ...m, rotation: nextRotation(m.rotation) } });
      return;
    }
    const sel = this.ui.selection;
    if (sel === null || sel.kind !== 'building') {
      this.say('Select a building to rotate.', 'info');
      return;
    }
    const b = s.run.team.buildings.find((x) => x.id === sel.id);
    if (b === undefined) return;
    const rotation = nextRotation(b.rotation);
    const v = previewMove(s.run.team, content, {
      id: b.id,
      x: b.x,
      y: b.y,
      rotation,
    });
    if (!v.ok) {
      this.refuse(v.reason, v.detail);
      return;
    }
    const n = attachedCount(s.run.team, b.id);
    const r = await s.act({ t: 'move', id: b.id, x: b.x, y: b.y, rotation });
    if (r.ok) {
      this.say(
        n > 0
          ? `Rotated. ${String(n)} ${plural(n, 'conduit was', 'conduits were')} detached.`
          : 'Rotated.',
        'ok',
      );
    } else this.refuse(r.reason, r.detail);
  }

  async returnSelected(): Promise<void> {
    const s = this.session;
    const sel = this.ui.selection;
    if (s === null) return;
    if (sel?.kind === 'core') {
      this.say('The Core cannot be moved or stashed.', 'error');
      return;
    }
    if (sel === null || sel.kind !== 'building') {
      this.say('Select a building to return to the stash.', 'info');
      return;
    }
    const b = s.run.team.buildings.find((x) => x.id === sel.id);
    const n = attachedCount(s.run.team, sel.id);
    const r = await s.act({ t: 'return', id: sel.id });
    if (r.ok) {
      this.set({
        selection: null,
        status: {
          text:
            n > 0
              ? `Returned ${b === undefined ? 'building' : buildingName(content, b.def)} to the stash. ${String(n)} ${plural(n, 'conduit was', 'conduits were')} detached.`
              : `Returned ${b === undefined ? 'building' : buildingName(content, b.def)} to the stash.`,
          kind: 'ok',
        },
      });
    } else this.refuse(r.reason, r.detail);
  }

  async eraseConduit(id: number): Promise<void> {
    const s = this.session;
    if (s === null) return;
    const c = s.run.team.conduits.find((x) => x.id === id);
    // Halves of border links have no session intent yet (issue #136).
    if (c === undefined || isBorderEnd(c.from) || isBorderEnd(c.to)) {
      this.refuse('unknown_conduit');
      return;
    }
    const r = await s.act({
      t: 'erase',
      from: c.from,
      to: c.to,
      cells: c.cells,
    });
    if (r.ok) {
      this.set({
        selection:
          this.ui.selection?.kind === 'conduit' ? null : this.ui.selection,
        status: { text: 'Conduit erased.', kind: 'ok' },
      });
    } else this.refuse(r.reason, r.detail);
  }

  /** The viewing player has pressed Ready: edits (and undo) are locked. */
  private isReady(): boolean {
    return this.session?.run.perPlayer[0]?.ready === true;
  }

  async undo(): Promise<void> {
    const s = this.session;
    if (s === null) return;
    if (this.isReady()) {
      this.say(READY_LOCK_TEXT, 'info');
      return;
    }
    const r = await s.undo();
    if (r === null) this.say('Nothing to undo in this step.', 'info');
    else if (r.ok) this.say('Undone.', 'ok');
    else
      this.say(
        `Undo failed: ${reasonMessage(r.reason, r.detail)} History cleared.`,
        'error',
      );
  }

  async redo(): Promise<void> {
    const s = this.session;
    if (s === null) return;
    if (this.isReady()) {
      this.say(READY_LOCK_TEXT, 'info');
      return;
    }
    const r = await s.redo();
    if (r === null) this.say('Nothing to redo.', 'info');
    else if (r.ok) this.say('Redone.', 'ok');
    else
      this.say(
        `Redo failed: ${reasonMessage(r.reason, r.detail)} History cleared.`,
        'error',
      );
  }

  async toggleReady(): Promise<void> {
    const s = this.session;
    if (s === null) return;
    const readyNow = s.run.perPlayer[0]?.ready === true;
    const before = s.run.step;
    const r = await s.dispatch({ type: readyNow ? 'unready' : 'ready' });
    if (!r.ok) {
      this.refuse(r.reason, r.detail, r.selectionFailure);
      return;
    }
    if (s.run.step !== before) {
      this.set({
        selection: null,
        held: null,
        moving: null,
        draft: null,
        status: {
          text: `Everyone is ready: the run moves from ${before} to ${s.run.step}.`,
          kind: 'ok',
        },
      });
    } else {
      this.say(
        readyNow ? 'Not ready.' : 'Ready. Waiting for the others.',
        'ok',
      );
    }
    if (r.selectionFailure !== undefined) {
      this.say(selectionNote(r.selectionFailure), 'error');
    }
  }

  // ---- Pointer ------------------------------------------------------------

  /** From the board view. Returns true to capture the pointer. */
  onBoardPointer(ev: BoardPointerEvent): boolean {
    const cell = ev.hit === null ? null : { x: ev.hit.x, y: ev.hit.y };
    if (this.step() === 'core_placement') return this.corePointer(ev, cell);
    if (!isEditStep(this.step())) return false;
    switch (ev.type) {
      case 'down':
        return this.down(ev, cell);
      case 'move':
        this.move(cell);
        return true;
      case 'up':
        this.up(ev, cell);
        return true;
    }
  }

  private corePointer(ev: BoardPointerEvent, cell: Cell | null): boolean {
    if (ev.type === 'move') {
      this.hover(cell);
      return true;
    }
    if (ev.type !== 'down' || cell === null) return false;
    void this.proposeCore(cell);
    return true;
  }

  private async proposeCore(cell: Cell): Promise<void> {
    const s = this.session;
    if (s === null) return;
    const r = await s.dispatch({ type: 'propose_core', x: cell.x, y: cell.y });
    if (r.ok) {
      this.legalCore = [];
      this.set({
        hover: null,
        status: {
          text: 'Core placed. Build your factory from the stash.',
          kind: 'ok',
        },
      });
    } else this.refuse(r.reason, r.detail);
  }

  private down(ev: BoardPointerEvent, cell: Cell | null): boolean {
    const s = this.session;
    const hit = ev.hit;
    if (s === null) return false;
    const u = this.ui;
    if (cell !== null && u.hover !== null && !sameCell(u.hover, cell)) {
      this.hover(cell);
    }
    if (u.held !== null) {
      void this.dropHeld(cell);
      return true;
    }
    const team = s.run.team;
    if (u.tool === 'select') {
      if (hit === null || cell === null) return false;
      if (hit.building === 'core') {
        this.set({ selection: { kind: 'core' } });
        return true;
      }
      if (hit.building !== null) {
        const b = hit.building;
        this.set({
          selection: { kind: 'building', id: b.id },
          moving: {
            id: b.id,
            origin: { x: b.x, y: b.y, rotation: b.rotation },
            offset: { x: cell.x - b.x, y: cell.y - b.y },
            rotation: b.rotation,
            start: cell,
            started: false,
          },
        });
        return true;
      }
      const c = conduitAt(team, cell);
      if (c !== undefined) {
        this.set({ selection: { kind: 'conduit', id: c.id } });
        return true;
      }
      return false;
    }
    if (u.tool === 'erase') {
      if (cell === null) return false;
      const c = conduitAt(team, cell);
      if (c === undefined) return false;
      void this.eraseConduit(c.id);
      return true;
    }
    // Conduit tool.
    if (cell === null) return false;
    return this.conduitDown(team, cell, hit?.building ?? null);
  }

  private conduitDown(
    team: TeamState,
    cell: Cell,
    building: PlacedBuilding | 'core' | null,
  ): boolean {
    const d = this.ui.draft;
    if (d === null || d.from === null) {
      // Start: an output marker, or a building.
      const outs = sideMarkers(team, content, 'out', d?.building ?? null);
      const m = markerAt(outs, cell);
      if (m !== null) {
        this.set({
          draft: {
            building: m.building,
            from: { building: m.building, side: m.side },
            cells: [cell],
            pressed: true,
            dragged: false,
          },
          attempt: null,
          status: {
            text: 'Drag or click toward an input side. Esc cancels.',
            kind: 'info',
          },
        });
        return true;
      }
      if (building !== null && building !== 'core') {
        this.pickForConduit(team, building);
        return true;
      }
      if (building === 'core') {
        this.say('The Core has no output side.', 'error');
        return true;
      }
      return false;
    }
    // A draft is under way.
    if (building !== null && building !== 'core') {
      if (building.id === d.building) {
        this.say('A conduit goes between two different buildings.', 'error');
        return true;
      }
      this.set({ draft: { ...d, pressed: true, dragged: false } });
      void this.finishDraft(building);
      return true;
    }
    if (building === 'core') {
      this.say('The Core has no input side.', 'error');
      return true;
    }
    const target = this.draftTarget(team, d, cell);
    if (target !== null) {
      const b = team.buildings.find((x) => x.id === target.building);
      if (b !== undefined) void this.finishDraft(b, target);
      return true;
    }
    const ext = extendPath(team, content, d.from, d.cells, cell);
    if (ext === null) {
      this.say('No route to that cell.', 'error');
      return true;
    }
    this.set({
      draft: { ...d, cells: ext, pressed: true, dragged: false },
      attempt: null,
    });
    return true;
  }

  private pickForConduit(team: TeamState, b: PlacedBuilding): void {
    const outs = freeOutputSides(team, content, b);
    const name = buildingName(content, b.def);
    if (outs.length === 0) {
      this.say(`${name} has no free output side.`, 'error');
      return;
    }
    if (outs.length === 1) {
      this.set({
        draft: {
          building: b.id,
          from: { building: b.id, side: outs[0] as ConduitEnd['side'] },
          cells: [],
          pressed: false,
          dragged: false,
        },
        attempt: null,
        status: {
          text: `From ${name}'s ${outs[0] as string} side: click an input side or a building.`,
          kind: 'info',
        },
      });
      return;
    }
    this.set({
      draft: {
        building: b.id,
        from: null,
        cells: [],
        pressed: false,
        dragged: false,
      },
      attempt: null,
      status: { text: `${name}: pick one of its output sides.`, kind: 'info' },
    });
  }

  private move(cell: Cell | null): void {
    const s = this.session;
    if (s === null) return;
    const u = this.ui;
    if (cell !== null) this.hover(cell);
    else this.hover(null);
    if (u.moving !== null && !u.moving.started && cell !== null) {
      if (!sameCell(cell, u.moving.start)) {
        const n = attachedCount(s.run.team, u.moving.id);
        this.set({
          moving: { ...u.moving, started: true },
          status:
            n > 0
              ? {
                  text: `Moving detaches ${String(n)} ${plural(n, 'conduit', 'conduits')}.`,
                  kind: 'info',
                }
              : u.status,
        });
      }
      return;
    }
    const d = u.draft;
    if (d !== null && d.pressed && d.from !== null && cell !== null) {
      const team = s.run.team;
      const occ = occupancy(team, content);
      if (occ.buildingAt(cell.x, cell.y) !== null) return;
      const last = d.cells[d.cells.length - 1];
      if (last !== undefined && sameCell(last, cell)) return;
      const ext = extendPath(team, content, d.from, d.cells, cell);
      if (ext !== null)
        this.set({ draft: { ...d, cells: ext, dragged: true } });
    }
  }

  private up(ev: BoardPointerEvent, cell: Cell | null): void {
    const s = this.session;
    if (s === null) return;
    const u = this.ui;
    if (u.held?.mode === 'drag' && ev.external) {
      void this.dropHeld(cell);
      return;
    }
    if (u.moving !== null) {
      const m = u.moving;
      this.set({ moving: null });
      if (m.started && cell !== null) {
        void this.commitMove(m, cell);
      } else if (m.started) {
        this.say('Move cancelled.', 'info');
      }
      return;
    }
    const d = u.draft;
    if (d !== null && d.pressed) {
      this.set({ draft: { ...d, pressed: false } });
      if (d.dragged && cell !== null && d.from !== null) {
        const hit = occupancy(s.run.team, content).buildingAt(cell.x, cell.y);
        if (hit !== null && !('core' in hit) && hit.id !== d.building) {
          void this.finishDraft(hit);
        }
      }
    }
  }

  private async commitMove(m: Moving, cell: Cell): Promise<void> {
    const s = this.session;
    if (s === null) return;
    const x = cell.x - m.offset.x;
    const y = cell.y - m.offset.y;
    const n = attachedCount(s.run.team, m.id);
    const r = await s.act({ t: 'move', id: m.id, x, y, rotation: m.rotation });
    if (r.ok) {
      this.say(
        n > 0
          ? `Moved. ${String(n)} ${plural(n, 'conduit was', 'conduits were')} detached.`
          : 'Moved.',
        'ok',
      );
    } else this.refuse(r.reason, r.detail);
  }

  private async finishDraft(
    b: PlacedBuilding,
    side?: ConduitEnd,
  ): Promise<void> {
    const s = this.session;
    const d = this.ui.draft;
    if (s === null || d === null || d.from === null) return;
    const team = s.run.team;
    const target =
      side ??
      chooseInput(team, content, b, d.cells[d.cells.length - 1] ?? null);
    const r = this.resolveFinish(team, d, target);
    if (r.cells === null) {
      this.say('No route to that side.', 'error');
      return;
    }
    const act: LayoutAction = {
      t: 'add',
      from: d.from,
      to: r.to,
      cells: r.cells,
    };
    const v = r.verdict;
    if (v === null || !v.ok) {
      this.set({
        attempt: {
          cells: r.cells,
          offending:
            v !== null && v.detail !== undefined ? parseCell(v.detail) : null,
        },
        status: {
          text: v === null ? 'No route.' : reasonMessage(v.reason, v.detail),
          kind: 'error',
        },
      });
      return;
    }
    const res = await s.act(act);
    if (res.ok) {
      this.set({
        draft: null,
        attempt: null,
        status: {
          text: `Conduit added (${String(r.cells.length)} ${plural(r.cells.length, 'cell', 'cells')}).`,
          kind: 'ok',
        },
      });
    } else this.refuse(res.reason, res.detail);
  }

  /** Backspace while drawing: drop the last cell of the draft. */
  draftBack(): void {
    const d = this.ui.draft;
    if (d === null) return;
    if (d.cells.length === 0) this.set({ draft: null });
    else this.set({ draft: { ...d, cells: d.cells.slice(0, -1) } });
  }

  /** Keyboard. Returns true when handled. */
  key(e: {
    key: string;
    ctrlKey: boolean;
    shiftKey: boolean;
    metaKey: boolean;
  }): boolean {
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') {
      void (e.shiftKey ? this.redo() : this.undo());
      return true;
    }
    if ((e.ctrlKey || e.metaKey) && k === 'y') {
      void this.redo();
      return true;
    }
    if (e.ctrlKey || e.metaKey) return false;
    if (!isEditStep(this.step())) return false;
    // A Ready player's edit tools are disabled; the keys must not reach them.
    if (this.isReady() && (k === 'r' || k === 'c' || k === 'e')) {
      this.say(READY_LOCK_TEXT, 'info');
      return true;
    }
    switch (k) {
      case 'r':
        void this.rotate();
        return true;
      case 'escape':
        this.cancel();
        return true;
      case 'backspace':
        if (this.ui.draft !== null) {
          this.draftBack();
          return true;
        }
        return false;
      case 'v':
        this.setTool('select');
        return true;
      case 'c':
        this.setTool('conduit');
        return true;
      case 'e':
        this.setTool('erase');
        return true;
      default:
        return false;
    }
  }
}
