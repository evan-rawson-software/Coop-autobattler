/**
 * View model of the Core placement screen: whether the Core may stand on a
 * cell and why not in plain words, the enemy routes to a candidate position,
 * and the starting kit. Pure: the rules answer in `core`
 * (`validateCorePosition`, `previewEnemyPaths`); this only words them.
 */
import {
  coreFootprint,
  listLegalCorePositions,
  placeCore,
  previewEnemyPaths,
  validateCorePosition,
  type Cell,
  type CorePositionProblem,
  type EconomyConfig,
  type EnemyPath,
  type SimConfig,
  type TeamState,
} from '@game/core';
import type { WebContent } from '../content.js';
import { buildingName } from '../build/view-model.js';

export interface Verdict {
  readonly ok: boolean;
  readonly problem: CorePositionProblem | null;
  /** Plain words for the problem; null when the position is legal. */
  readonly text: string | null;
  /** The cells the Core would cover. */
  readonly cells: readonly Cell[];
}

export function problemText(problem: CorePositionProblem): string {
  switch (problem) {
    case 'out_of_bounds':
      return 'Off the board edge.';
    case 'outside_own_plot':
      return 'Outside your own area.';
    case 'blocked':
      return 'Not on water or cliffs.';
    case 'on_node':
      return 'Not on a resource node.';
    case 'too_far_forward':
      return 'Too close to the front.';
  }
}

/** Two or three words for a label on the board. */
export function shortProblem(problem: CorePositionProblem): string {
  switch (problem) {
    case 'out_of_bounds':
      return 'Off the board';
    case 'outside_own_plot':
      return 'Outside own area';
    case 'blocked':
      return 'Water or cliff';
    case 'on_node':
      return 'Resource node';
    case 'too_far_forward':
      return 'Too close to the front';
  }
}

/** The cells the Core covers with its lowest-x, lowest-y cell at `pos`. */
export function coreCells(content: WebContent, pos: Cell): Cell[] {
  const fp = coreFootprint(content.buildings);
  const cells: Cell[] = [];
  for (let dy = 0; dy < fp.height; dy++) {
    for (let dx = 0; dx < fp.width; dx++) {
      cells.push({ x: pos.x + dx, y: pos.y + dy });
    }
  }
  return cells;
}

/** Whether the Core may stand at `pos`, and if not, why. */
export function verdictAt(
  team: TeamState,
  content: WebContent,
  pos: Cell,
  player: number,
): Verdict {
  const r = validateCorePosition(
    team.map,
    content,
    content.mapgen,
    player,
    pos,
  );
  return {
    ok: r.ok,
    problem: r.ok ? null : r.reason,
    text: r.ok ? null : problemText(r.reason),
    cells: coreCells(content, pos),
  };
}

/**
 * The hint line: a stored message (a refused click or Ready) comes first, so
 * a hover left over after a tap does not hide it; the screen clears it when
 * the pointer moves to another cell or the acting player changes. Otherwise it
 * describes the cell under the pointer, or the chosen cell.
 */
export function hintText(input: {
  readonly hover: Verdict | null;
  readonly selected: Cell | null;
  readonly message: string | null;
  readonly ready?: boolean;
}): string {
  if (input.message !== null) return input.message;
  if (input.hover !== null) {
    return input.hover.ok
      ? input.ready === true
        ? 'Unready to move your Core.'
        : 'Fits here.'
      : (input.hover.text ?? '');
  }
  return '';
}

/**
 * What a screen reader hears about the choice (a live region): the chosen
 * spot, and whether the player is Ready. Empty when nothing is chosen.
 */
export function choiceAnnouncement(
  selected: Cell | null,
  ready: boolean,
): string {
  if (selected === null) return '';
  const at = `Core spot chosen: column ${String(selected.x)}, row ${String(selected.y)}.`;
  return ready ? `${at} You are Ready.` : at;
}

/** A click on the spot that is already chosen: nothing to send. */
export function isRepeatClick(selected: Cell | null, cell: Cell): boolean {
  return selected !== null && selected.x === cell.x && selected.y === cell.y;
}

/** A refusal message and the player it was shown to. */
export interface StoredProblem {
  readonly acting: number;
  readonly text: string;
}

/** A refusal belongs to one player: after a switch it is not shown. */
export function visibleProblem(
  stored: StoredProblem | null,
  acting: number,
): string | null {
  return stored !== null && stored.acting === acting ? stored.text : null;
}

/** Every legal position in the player's own plot, as a lookup by `y * width + x`. */
export function legalSet(
  team: TeamState,
  content: WebContent,
  player: number,
  ready = false,
): Set<number> {
  // A Ready player's Core is locked: no spot is offered.
  if (ready) return new Set();
  const w = team.map.width;
  return new Set(
    listLegalCorePositions(team.map, content, content.mapgen, player).map(
      (c) => c.y * w + c.x,
    ),
  );
}

/**
 * Drop the cells of paths that lie outside the board. `cells` are on the
 * board already (the off-board detour is in `approach`); this is a guard so the
 * screen draws only the board.
 */
export function clipPaths(
  paths: readonly EnemyPath[],
  width: number,
  height: number,
): EnemyPath[] {
  const inside = (c: Cell): boolean =>
    c.x >= 0 && c.y >= 0 && c.x < width && c.y < height;
  return paths
    .filter((p) => inside(p.entry))
    .map((p) => ({
      ...p,
      cells: p.cells.filter(inside),
      approach: p.approach,
      breach: p.breach !== null && inside(p.breach.cell) ? p.breach : null,
    }));
}

/**
 * The routes enemy units would take to a Core placed at `pos`, or null if the
 * position is not legal. The preview runs on a copy of the board with the Core
 * put there; the run itself is untouched.
 */
export function routesFor(
  team: TeamState,
  content: WebContent,
  sim: SimConfig,
  pos: Cell,
  player: number,
): EnemyPath[] | null {
  const placed = placeCore(team, content, content.mapgen, player, pos);
  if (!placed.ok) return null;
  try {
    return clipPaths(
      previewEnemyPaths(placed.state, content, sim),
      team.map.width,
      team.map.height,
    );
  } catch {
    return null;
  }
}

export interface KitRow {
  readonly key: string;
  readonly text: string;
}

/** The starting kit: "Extractor × 2", ..., "10 gold". Names from content. */
export function kitRows(economy: EconomyConfig, content: WebContent): KitRow[] {
  const rows: KitRow[] = economy.startingKit.map((k) => ({
    key: `${k.def}:${String(k.tier)}`,
    text: `${buildingName(content, k.def)}${k.tier > 1 ? ` (tier ${String(k.tier)})` : ''} × ${String(k.count)}`,
  }));
  rows.push({ key: 'gold', text: `${String(economy.startingGold)} gold` });
  return rows;
}
