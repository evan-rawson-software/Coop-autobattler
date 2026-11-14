/**
 * The tutorial's six steps (issue #309), derived from the real run state so a
 * reload resumes at the right step. Pure: nothing here reads or writes the
 * run; the only extra state is the player's "Skip this step" for the Turret,
 * which lives in the tutorial store.
 *
 *   1 Place your Core          2 Mine Ore with an Extractor
 *   3 Feed a Barracks          4 Guard the Core with a Turret (skippable)
 *   5 Press Ready, pick a fight   6 Watch the battle
 */
import {
  occupancy,
  type BuildingDef,
  type Cell,
  type TeamState,
} from '@game/core';
import type { RunState } from '@game/session';
import type { WebContent } from '../content.js';
import type { FlowView } from '../build/view-model.js';

export const TUTORIAL_STEP_COUNT = 6;

export type StepNo = 1 | 2 | 3 | 4 | 5 | 6;
export const STEP_NUMBERS: readonly StepNo[] = [1, 2, 3, 4, 5, 6];

/** How far from the Core a Turret still counts as guarding it. */
export const TURRET_NEAR_CORE = 8;

/** What the board shows, as far as the tutorial cares. */
export interface TutorialFacts {
  /** An Extractor of the player sits on a resource node. */
  readonly extractor: boolean;
  readonly barracksPlaced: boolean;
  /** A placed Barracks received its resource in the dry run. */
  readonly barracksFed: boolean;
  /** A Turret of the player stands near the Core. */
  readonly turret: boolean;
}

/** The building defs the tutorial teaches, found by what they are. */
export interface TutorialDefs {
  readonly extractor: string | null;
  readonly barracks: string | null;
  readonly turret: string | null;
}

export function tutorialDefs(content: WebContent): TutorialDefs {
  let extractor: string | null = null;
  let barracks: string | null = null;
  let turret: string | null = null;
  for (const def of content.buildings.list()) {
    const id = def.id;
    if (def.kind === 'source') extractor ??= id;
    else if (def.kind === 'unit_producer') barracks ??= id;
    else if (def.kind === 'defense' && def.defenseType === 'turret')
      turret ??= id;
  }
  return { extractor, barracks, turret };
}

function chebyshev(a: Cell, b: Cell): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** The cells of the player's Core (its footprint from the lowest cell). */
export function coreCellsOf(
  team: TeamState,
  content: WebContent,
  player: number,
): readonly Cell[] {
  const at = team.cores[player];
  if (at === null || at === undefined) return [];
  const def: BuildingDef | undefined = content.buildings
    .list()
    .find((b) => b.kind === 'core');
  const w = def?.footprint.width ?? 1;
  const h = def?.footprint.height ?? 1;
  const out: Cell[] = [];
  for (let dy = 0; dy < h; dy++)
    for (let dx = 0; dx < w; dx++) out.push({ x: at.x + dx, y: at.y + dy });
  return out;
}

export function tutorialFacts(
  team: TeamState,
  content: WebContent,
  player: number,
  flow: FlowView | null,
): TutorialFacts {
  const defs = tutorialDefs(content);
  const mine = team.buildings.filter((b) => b.owner === player);
  const extractor = mine.some(
    (b) =>
      b.def === defs.extractor &&
      team.map.nodes.some((n) => n.x === b.x && n.y === b.y),
  );
  const barracks = mine.filter((b) => b.def === defs.barracks);
  const fed = barracks.some((b) =>
    (flow?.dry.consumers ?? []).some(
      (c) => c.building === b.id && c.delivered > 0,
    ),
  );
  const core = coreCellsOf(team, content, player);
  const occ = occupancy(team, content);
  const turret = mine.some(
    (b) =>
      b.def === defs.turret &&
      occ
        .cellsOf(b)
        .some((c) => core.some((k) => chebyshev(c, k) <= TURRET_NEAR_CORE)),
  );
  return {
    extractor,
    barracksPlaced: barracks.length > 0,
    barracksFed: fed,
    turret,
  };
}

/** Where the player is in the tutorial. */
export type TutorialPosition =
  | { readonly kind: 'step'; readonly n: StepNo }
  | { readonly kind: 'closing' }
  | { readonly kind: 'off' };

export interface TutorialInput {
  readonly run: RunState;
  readonly facts: TutorialFacts;
  readonly turretSkipped: boolean;
  /** The battle playback has reached its result. */
  readonly battleDone: boolean;
}

/** Each step's finished flag, index 0 is step 1. */
export function stepsDone(i: TutorialInput): readonly boolean[] {
  const s = i.run.step;
  const fought =
    s === 'pve_battle' ||
    s === 'pve_summary' ||
    s === 'event_choice' ||
    s === 'event_resolve';
  return [
    s !== 'core_placement',
    i.facts.extractor || fought,
    i.facts.barracksFed || fought,
    i.facts.turret || i.turretSkipped || fought,
    fought,
    (s === 'pve_summary' && i.battleDone) ||
      s === 'event_choice' ||
      s === 'event_resolve',
  ];
}

export function tutorialPosition(i: TutorialInput): TutorialPosition {
  const { run } = i;
  if (run.round > 1 || run.leg !== 'pve') return { kind: 'off' };
  switch (run.step) {
    case 'core_placement':
      return { kind: 'step', n: 1 };
    case 'build':
    case 'shop': {
      const d = stepsDone(i);
      for (const n of [2, 3, 4] as const) {
        if (d[n - 1] !== true) return { kind: 'step', n };
      }
      return { kind: 'step', n: 5 };
    }
    case 'pve_choice':
      return { kind: 'step', n: 5 };
    case 'pve_battle':
      return { kind: 'step', n: 6 };
    case 'pve_summary':
      return i.battleDone ? { kind: 'closing' } : { kind: 'step', n: 6 };
    default:
      return { kind: 'off' };
  }
}

/** The first of steps 2 to 4 that was not done: where a loss points back to. */
export function brokenStep(
  facts: TutorialFacts,
  turretSkipped: boolean,
): 2 | 3 | 4 | null {
  if (!facts.extractor) return 2;
  if (!facts.barracksFed) return 3;
  if (!facts.turret && !turretSkipped) return 4;
  return null;
}

/** The inventory defs that are usable at a step; null means all. */
export function allowedDefs(
  n: StepNo | null,
  defs: TutorialDefs,
): ReadonlySet<string> | null {
  if (n === null || n >= 5) return null;
  const out = new Set<string>();
  const add = (d: string | null): void => {
    if (d !== null) out.add(d);
  };
  if (n >= 2) add(defs.extractor);
  if (n >= 3) add(defs.barracks);
  if (n >= 4) add(defs.turret);
  return out;
}

/** The slot to point at in each build step. */
export function highlightDef(n: StepNo, facts: TutorialFacts, d: TutorialDefs) {
  if (n === 2) return d.extractor;
  if (n === 3) return facts.barracksPlaced ? null : d.barracks;
  if (n === 4) return d.turret;
  return null;
}

/** The resource the Barracks eats (the tutorial's "Ore"); null if unknown. */
export function oreResource(content: WebContent): string | null {
  const id = tutorialDefs(content).barracks;
  const def = id === null ? undefined : content.buildings.get(id);
  return def?.inputs[0]?.resource ?? null;
}

/** Ore nodes with nothing on them: the rings of step 2. */
export function freeNodes(team: TeamState, content: WebContent): Cell[] {
  const occ = occupancy(team, content);
  const ore = oreResource(content);
  return team.map.nodes
    .filter(
      (n) =>
        (ore === null || n.resource === ore) &&
        occ.buildingAt(n.x, n.y) === null,
    )
    .map((n) => ({ x: n.x, y: n.y }));
}

/** Is there a node of the Turret's resource (Power) near the Core? */
export function powerNearCore(
  team: TeamState,
  content: WebContent,
  player: number,
): boolean {
  const id = tutorialDefs(content).turret;
  const need = id === null ? undefined : content.buildings.get(id)?.inputs[0];
  if (need === undefined) return false;
  const core = coreCellsOf(team, content, player);
  return team.map.nodes.some(
    (n) =>
      n.resource === need.resource &&
      core.some((c) => chebyshev(n, c) <= TURRET_NEAR_CORE + 4),
  );
}
