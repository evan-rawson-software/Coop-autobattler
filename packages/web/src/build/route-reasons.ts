/**
 * Why a conduit route is not possible, where that can be known (pure): an
 * output or input that faces the board edge, a side that a building blocks.
 * Anything else is the generic "no free path" text. This is wording only;
 * `core` decides what is legal.
 */

import {
  occupancy,
  type BorderEnd,
  type Cell,
  type ConduitEnd,
  type PlacedBuilding,
  type Side,
  type TeamState,
  isBorderEnd,
} from '@game/core';
import type { WebContent } from '../content.js';
import { outsideCells } from './geometry.js';
import { facesBoardEdge, outputFacesEdge } from './sides.js';
import { screenText, screenTexts } from './texts.js';
import { buildingName } from './view-model.js';

const tx = (key: string, values: Record<string, string> = {}): string =>
  screenText(screenTexts, key, values);

function inBounds(team: TeamState, c: Cell): boolean {
  return c.x >= 0 && c.y >= 0 && c.x < team.map.width && c.y < team.map.height;
}

/** The name of the building or Core that fills all cells outside a side. */
function blockerOf(
  team: TeamState,
  content: WebContent,
  b: PlacedBuilding,
  side: Side,
): string | null {
  const occ = occupancy(team, content);
  const out = outsideCells(occ.cellsOf(b), side).filter((c) =>
    inBounds(team, c),
  );
  if (out.length === 0) return null;
  let name: string | null = null;
  for (const c of out) {
    const hit = occ.buildingAt(c.x, c.y);
    if (hit === null) return null;
    if (name !== null) continue;
    if ('core' in hit) {
      const def = content.buildings.list().find((d) => d.kind === 'core');
      name =
        def === undefined
          ? null
          : (content.presentation.get(def.id)?.name ?? null);
    } else name = buildingName(content, hit.def);
  }
  return name;
}

/**
 * Why no route was found from `from` (a building output, or null when it is
 * not a building) to `to` (an input side, or null for a plain cell).
 */
export function whyNoRoute(
  team: TeamState,
  content: WebContent,
  from: ConduitEnd | BorderEnd | null,
  to: ConduitEnd | null,
): string {
  if (from !== null && !isBorderEnd(from)) {
    const b = team.buildings.find((x) => x.id === from.building);
    if (b !== undefined) {
      const name = buildingName(content, b.def);
      if (facesBoardEdge(team, content, b, from.side)) {
        return tx('statusOutputFacesEdge', { name });
      }
      const blocker = blockerOf(team, content, b, from.side);
      if (blocker !== null) {
        return tx('statusOutputBlockedBy', { name, blocker });
      }
    }
  }
  if (to !== null) {
    const b = team.buildings.find((x) => x.id === to.building);
    if (b !== undefined) {
      if (facesBoardEdge(team, content, b, to.side)) {
        return tx('statusInputFacesEdge', {
          name: buildingName(content, b.def),
        });
      }
      const blocker = blockerOf(team, content, b, to.side);
      if (blocker !== null) return tx('statusSideBlockedBy', { name: blocker });
    }
  }
  return tx('statusNoFreePath');
}

/** "No route to that side." and the reason, as one message. */
export function noRouteMessage(
  baseKey: string,
  team: TeamState,
  content: WebContent,
  from: ConduitEnd | BorderEnd | null,
  to: ConduitEnd | null,
): string {
  return tx('statusNoRouteWhy', {
    text: tx(baseKey),
    why: whyNoRoute(team, content, from, to),
  });
}

/** "Placed X.", with a warning when its output faces the board edge. */
export function placedMessage(
  team: TeamState,
  content: WebContent,
  b: PlacedBuilding,
): { text: string; warn: boolean } {
  const name = buildingName(content, b.def);
  const placed = tx('statusPlaced', { name });
  if (!outputFacesEdge(team, content, b)) return { text: placed, warn: false };
  return {
    text: `${placed} ${tx('statusOutputFacesEdge', { name })}`,
    warn: true,
  };
}
