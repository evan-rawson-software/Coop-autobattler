/**
 * Turns team states into drawable shapes (pure; no DOM). Everything here
 * reads `core` data: occupancy for cells and sides, `conduitResource` for
 * conduit colours, content for names and colours. Nothing re-derives rules.
 */

import {
  conduitResource,
  occupancy,
  soleCore,
  type BuildingDef,
  type FeatureCell,
  type Occupancy,
  type PlacedBuilding,
  type Side,
  type TeamState,
  buildingEnd,
} from '@game/core';
import type { WebContent } from '../content.js';
import { mapSalt } from '../sprites/variants.js';
import {
  boxToView,
  cellToView,
  makeLayout,
  sideStep,
  viewToCell,
  type BoardFrame,
  type BoardId,
  type BoardLayout,
} from './layout.js';

export interface ViewRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Notch {
  /** View-space centre of the building cell on the edge. */
  readonly x: number;
  readonly y: number;
  /** Unit step pointing out of the building through this edge. */
  readonly dx: number;
  readonly dy: number;
  readonly kind: 'in' | 'out';
  /** The resource colour an input requires, if any. */
  readonly color: string | null;
}

export interface SceneBuilding {
  readonly instance: PlacedBuilding;
  readonly def: BuildingDef;
  readonly rect: ViewRect;
  readonly label: string;
  readonly solid: boolean;
  readonly notches: readonly Notch[];
}

export interface SceneConduit {
  readonly id: number;
  /** View-space cell centres, from one building to the other. */
  readonly points: readonly { x: number; y: number }[];
  /**
   * View-space centres of the conduit's own cells, in slot order (the cell
   * next to the `from` building first); empty for a direct connection.
   */
  readonly cells: readonly { x: number; y: number }[];
  /** CSS colour, or null while the resource is undetermined. */
  readonly color: string | null;
  /** Position in the resource list, for the dash pattern; -1 if undetermined. */
  readonly pattern: number;
  /** The resource id it carries, or null while undetermined. */
  readonly resource: string | null;
}

/** The scene's name for what `buildingAt` found: a building, or `'core'`. */
function hitOf(
  hit: PlacedBuilding | { readonly core: number } | null,
): PlacedBuilding | 'core' | null {
  return hit !== null && 'core' in hit ? 'core' : hit;
}

export interface SceneNode {
  readonly x: number;
  readonly y: number;
  readonly color: string;
  readonly letter: string;
  /** The resource id, for picking the sprite. */
  readonly resource: string;
}

export interface SceneFeature {
  readonly x: number;
  readonly y: number;
  /** Index in the terrain feature list, for picking a fill. */
  readonly style: number;
  /** The terrain feature id (`ter_lake`, ...), for picking a sprite. */
  readonly feature: string;
}

export interface BoardScene {
  readonly frame: BoardFrame;
  readonly state: TeamState;
  readonly occ: Occupancy;
  readonly features: readonly SceneFeature[];
  readonly nodes: readonly SceneNode[];
  readonly buildings: readonly SceneBuilding[];
  readonly core: { rect: ViewRect; label: string } | null;
  readonly conduits: readonly SceneConduit[];
  /** Per-map salt for picking sprite variants (deterministic). */
  readonly salt: number;
}

/** The neutral strip's terrain, as the battle screen shows it. */
export interface NeutralView {
  /** Zone-local features: `y = 0` is the row next to the own board. */
  readonly features: readonly FeatureCell[];
  /** True until the battle begins: the features are not drawn. */
  readonly hidden: boolean;
}

export interface Scene {
  readonly layout: BoardLayout;
  readonly boards: readonly BoardScene[];
  /** Neutral strip terrain, in view space; null when there is none. */
  readonly neutralFeatures: readonly SceneFeature[];
  readonly neutralHidden: boolean;
}

export const FALLBACK_RESOURCE_COLOR = '#8a8a8a';

/** First character of a name, as shown on nodes. */
export function firstLetter(name: string): string {
  return (Array.from(name)[0] ?? '?').toUpperCase();
}

/** First two characters of a name, as shown on buildings. */
export function shortLabel(name: string): string {
  const chars = Array.from(name);
  const head = (chars[0] ?? '?').toUpperCase();
  const tail = (chars[1] ?? '').toLowerCase();
  return head + tail;
}

const SIDES: readonly Side[] = ['north', 'east', 'south', 'west'];

/** Board-local step for a side: north is +y, east is +x. */
const LOCAL_STEP: Readonly<Record<Side, { x: number; y: number }>> = {
  north: { x: 0, y: 1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: -1 },
  west: { x: -1, y: 0 },
};

function edgeCells(
  cells: readonly { x: number; y: number }[],
  side: Side,
): { x: number; y: number }[] {
  const have = new Set(cells.map((c) => `${String(c.x)},${String(c.y)}`));
  const step = LOCAL_STEP[side];
  return cells.filter(
    (c) => !have.has(`${String(c.x + step.x)},${String(c.y + step.y)}`),
  );
}

function resourceColor(content: WebContent, id: string | undefined): string {
  if (id === undefined) return FALLBACK_RESOURCE_COLOR;
  return content.resources.get(id)?.color ?? FALLBACK_RESOURCE_COLOR;
}

function buildBoard(
  state: TeamState,
  frame: BoardFrame,
  content: WebContent,
): BoardScene {
  const occ = occupancy(state, content);
  const terrainIndex = new Map(
    content.terrain.list().map((t, i) => [t.id, i] as const),
  );

  const features = state.map.features.map((f) => {
    const v = cellToView(frame, f.x, f.y);
    return {
      x: v.x,
      y: v.y,
      style: terrainIndex.get(f.feature) ?? 0,
      feature: f.feature,
    };
  });
  const nodes = state.map.nodes.map((n) => {
    const v = cellToView(frame, n.x, n.y);
    const def = content.resources.get(n.resource);
    return {
      x: v.x + 0.5,
      y: v.y + 0.5,
      color: def?.color ?? FALLBACK_RESOURCE_COLOR,
      letter: firstLetter(def?.name ?? '?'),
      resource: n.resource,
    };
  });

  const buildings: SceneBuilding[] = state.buildings.map((b) => {
    const def = content.buildings.get(b.def);
    if (def === undefined) throw new Error(`Unknown building "${b.def}".`);
    const cells = occ.cellsOf(b);
    const first = cells[0];
    const last = cells[cells.length - 1];
    if (first === undefined || last === undefined) {
      throw new Error('A building covers no cells.');
    }
    const rect = boxToView(frame, first.x, first.y, last.x, last.y);
    const sides = occ.absoluteSides(b);
    const notches: Notch[] = [];
    for (const side of SIDES) {
      const step = sideStep(frame, side);
      for (const inp of sides.inputs) {
        if (inp.side !== side) continue;
        for (const c of edgeCells(cells, side)) {
          const v = cellToView(frame, c.x, c.y);
          notches.push({
            x: v.x + 0.5,
            y: v.y + 0.5,
            dx: step.x,
            dy: step.y,
            kind: 'in',
            color:
              inp.resource === undefined
                ? null
                : resourceColor(content, inp.resource),
          });
        }
      }
      if (sides.outputs.includes(side)) {
        for (const c of edgeCells(cells, side)) {
          const v = cellToView(frame, c.x, c.y);
          notches.push({
            x: v.x + 0.5,
            y: v.y + 0.5,
            dx: step.x,
            dy: step.y,
            kind: 'out',
            color: null,
          });
        }
      }
    }
    const name = content.presentation.get(def.id)?.name ?? def.id;
    return {
      instance: b,
      def,
      rect,
      label: shortLabel(name),
      solid: def.kind === 'defense' && def.defenseType === 'wall',
      notches,
    };
  });

  let core: BoardScene['core'] = null;
  const stateCore = soleCore(state);
  if (stateCore !== null) {
    const coreDef = content.buildings.list().find((d) => d.kind === 'core');
    if (coreDef !== undefined) {
      const fp = coreDef.footprint;
      core = {
        rect: boxToView(
          frame,
          stateCore.x,
          stateCore.y,
          stateCore.x + fp.width - 1,
          stateCore.y + fp.height - 1,
        ),
        label: (
          content.presentation.get(coreDef.id)?.name ?? coreDef.id
        ).toUpperCase(),
      };
    }
  }

  const resourceOrder = new Map(
    content.resources.list().map((r, i) => [r.id, i] as const),
  );
  const byId = new Map(state.buildings.map((b) => [b.id, b] as const));
  const conduits: SceneConduit[] = state.conduits.map((c) => {
    const pts: { x: number; y: number }[] = [];
    const centre = (p: { x: number; y: number }) => {
      const v = cellToView(frame, p.x, p.y);
      return { x: v.x + 0.5, y: v.y + 0.5 };
    };
    const a = byId.get(buildingEnd(c.from)?.building ?? -1);
    const b = byId.get(buildingEnd(c.to)?.building ?? -1);
    const aCells = a ? occ.cellsOf(a) : [];
    const bCells = b ? occ.cellsOf(b) : [];
    const near = (
      cs: readonly { x: number; y: number }[],
      to: { x: number; y: number },
    ) => cs.find((p) => Math.abs(p.x - to.x) + Math.abs(p.y - to.y) === 1);
    const firstCell = c.cells[0];
    const lastCell = c.cells[c.cells.length - 1];
    if (firstCell !== undefined && lastCell !== undefined) {
      const s = near(aCells, firstCell);
      if (s) pts.push(centre(s));
      for (const p of c.cells) pts.push(centre(p));
      const e = near(bCells, lastCell);
      if (e) pts.push(centre(e));
    } else {
      // Direct connection: the two touching building cells.
      for (const pa of aCells) {
        const pb = near(bCells, pa);
        if (pb) {
          pts.push(centre(pa), centre(pb));
          break;
        }
      }
    }
    const res = conduitResource(state, content, c.id);
    return {
      id: c.id,
      points: pts,
      cells: c.cells.map(centre),
      color: res === null ? null : resourceColor(content, res),
      pattern: res === null ? -1 : (resourceOrder.get(res) ?? 0),
      resource: res,
    };
  });

  const m = state.map;
  const salt = mapSalt(m.width, m.height, m.partySize, m.plotWidth, [
    ...m.features,
    ...m.nodes,
  ]);
  return {
    frame,
    state,
    occ,
    features,
    nodes,
    buildings,
    core,
    conduits,
    salt,
  };
}

export function buildScene(
  own: TeamState,
  enemy: TeamState | null,
  neutralHeight: number,
  content: WebContent,
  neutral: NeutralView | null = null,
): Scene {
  const layout = makeLayout(own.map, enemy ? enemy.map : null, neutralHeight);
  const boards = [buildBoard(own, layout.own, content)];
  if (enemy && layout.enemy) {
    boards.unshift(buildBoard(enemy, layout.enemy, content));
  }
  const terrainIndex = new Map(
    content.terrain.list().map((t, i) => [t.id, i] as const),
  );
  const strip = layout.neutral;
  const neutralFeatures: SceneFeature[] =
    neutral === null || neutral.hidden || strip === null
      ? []
      : neutral.features.map((f) => ({
          x: f.x,
          y: strip.y1 - 1 - f.y,
          style: terrainIndex.get(f.feature) ?? 0,
          feature: f.feature,
        }));
  return {
    layout,
    boards,
    neutralFeatures,
    neutralHidden: neutral?.hidden ?? false,
  };
}

/** What a pointer is over, in board-local terms. */
export interface Hit {
  readonly board: BoardId;
  readonly x: number;
  readonly y: number;
  readonly building: PlacedBuilding | 'core' | null;
}

/** Hit test a view-space point using core's occupancy. */
export function hitTest(scene: Scene, vx: number, vy: number): Hit | null {
  for (const b of scene.boards) {
    const c = viewToCell(b.frame, vx, vy);
    if (c) {
      return {
        board: b.frame.id,
        x: c.x,
        y: c.y,
        building: hitOf(b.occ.buildingAt(c.x, c.y)),
      };
    }
  }
  return null;
}

/** View-space centre of the enemy board's Core, if there is one. */
export function enemyCoreCentre(scene: Scene): { x: number; y: number } | null {
  const enemy = scene.boards.find((b) => b.frame.id === 'enemy');
  if (!enemy?.core) return null;
  const r = enemy.core.rect;
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** View-space centre of the own board's Core, if placed. */
export function ownCoreCentre(scene: Scene): { x: number; y: number } | null {
  const own = scene.boards.find((b) => b.frame.id === 'own');
  if (!own?.core) return null;
  const r = own.core.rect;
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}
