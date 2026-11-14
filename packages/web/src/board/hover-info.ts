/**
 * What the board's hover tooltip says about a cell (issue #308): pure, no DOM.
 * One title and a few lines for the thing under the pointer, in this order of
 * precedence: a building or Core (walls by their mask cells, through core's
 * occupancy), a conduit cell, a resource node, a terrain feature, the front
 * row. Names, stats and terrain text are the ones the Selected panel and the
 * presentation file already have; only the glue sentences are new.
 */

import {
  buildingEnd,
  conduitResource,
  formatText,
  type Conduit,
  type ConduitEnd,
  type BorderEnd,
  type TeamState,
} from '@game/core';
import type { WebContent } from '../content.js';
import { cardStats } from '../build/card-stats.js';
import { simConfig } from '../build/setup.js';
import { screenText, screenTexts, type ScreenTexts } from '../build/texts.js';
import { buildingName, resourceName } from '../build/view-model.js';
import type { BoardScene, Hit, Scene, SceneFeature } from './scene.js';
import type { BoardId } from './layout.js';

/** What the swatch before the title is coloured from. */
export type HoverTone =
  'resource' | 'terrain' | 'front' | 'building' | 'core' | 'unit';

export interface HoverInfo {
  readonly title: string;
  /** One line, or a few for a building's stats; never empty. */
  readonly lines: readonly string[];
  readonly tone: HoverTone;
  /** A resource's CSS colour, for `tone: 'resource'`. */
  readonly color: string | null;
  /** The owning player of a building or unit, for the owner colour. */
  readonly owner: number | null;
  /** Which board (or side) it is on; 'enemy' texts address the viewer. */
  readonly board: BoardId;
}

export interface HoverOptions {
  /** The viewing player, to tell their own Core from a partner's. */
  readonly basePlayer?: number | null | undefined;
  readonly texts?: ScreenTexts;
}

const NONE: readonly string[] = [];

function terrainInfo(
  content: WebContent,
  feature: string,
  board: BoardId,
): HoverInfo | null {
  const entry = content.presentation.get(feature);
  if (entry === undefined) return null;
  return {
    title: entry.name,
    lines: [formatText(entry.description, content.resources)],
    tone: 'terrain',
    color: null,
    owner: null,
    board,
  };
}

function endName(
  content: WebContent,
  team: TeamState,
  end: ConduitEnd | BorderEnd,
  texts: ScreenTexts,
): string {
  const e = buildingEnd(end);
  const def =
    e === null ? undefined : team.buildings.find((b) => b.id === e.building);
  return def === undefined
    ? screenText(texts, 'hoverBorder')
    : buildingName(content, def.def);
}

function conduitInfo(
  content: WebContent,
  team: TeamState,
  c: Conduit,
  board: BoardId,
  texts: ScreenTexts,
): HoverInfo {
  const res = conduitResource(team, content, c.id);
  const from = endName(content, team, c.from, texts);
  const to = endName(content, team, c.to, texts);
  return {
    title: screenText(texts, 'uiConduitName'),
    lines: [
      res === null
        ? screenText(texts, 'hoverConduitLineUnknown', { from, to })
        : screenText(texts, 'hoverConduitLine', {
            resource: resourceName(content, res),
            from,
            to,
          }),
    ],
    tone: 'resource',
    color: res === null ? null : (content.resources.get(res)?.color ?? null),
    owner: null,
    board,
  };
}

function describeBoardCell(
  b: BoardScene,
  hit: Hit,
  content: WebContent,
  o: HoverOptions,
): HoverInfo | null {
  const texts = o.texts ?? screenTexts;
  const board = b.frame.id;
  const { x, y } = hit;
  const found = b.occ.buildingAt(x, y);

  if (found !== null && 'core' in found) {
    const def = content.buildings.list().find((d) => d.kind === 'core');
    const entry =
      def === undefined ? undefined : content.presentation.get(def.id);
    const mine =
      board === 'own' &&
      (o.basePlayer === undefined ||
        o.basePlayer === null ||
        o.basePlayer === found.core);
    return {
      title: screenText(texts, mine ? 'hoverCoreOwn' : 'hoverCoreFoe'),
      lines:
        entry === undefined
          ? NONE.concat(def?.id ?? '')
          : [formatText(entry.description, content.resources)],
      tone: 'core',
      color: null,
      owner: found.core,
      board,
    };
  }
  if (found !== null) {
    const def = content.buildings.get(found.def);
    if (def === undefined) return null;
    const stats = cardStats(content, simConfig, def, found.tier, texts);
    const lines = [stats.effect, stats.uses, stats.collects, stats.health]
      .filter((l): l is string => l !== null && l !== '')
      .slice();
    return {
      title: screenText(texts, 'hoverBuildingTitle', {
        name: buildingName(content, found.def),
        tier: String(found.tier),
      }),
      lines:
        lines.length > 0
          ? lines
          : [
              formatText(
                content.presentation.get(found.def)?.description ?? '',
                content.resources,
              ),
            ],
      tone: 'building',
      color: null,
      owner: found.owner,
      board,
    };
  }

  const conduit = b.state.conduits.find((c) =>
    c.cells.some((cell) => cell.x === x && cell.y === y),
  );
  if (conduit !== undefined) {
    return conduitInfo(content, b.state, conduit, board, texts);
  }

  const node = b.state.map.nodes.find((n) => n.x === x && n.y === y);
  if (node !== undefined) {
    const source = content.buildings.list().find((d) => d.kind === 'source');
    const resource = resourceName(content, node.resource);
    return {
      title: screenText(texts, 'hoverNodeTitle', { resource }),
      lines: [
        screenText(texts, 'hoverNodeLine', {
          building:
            source === undefined ? '' : buildingName(content, source.id),
          resource,
        }),
      ],
      tone: 'resource',
      color: content.resources.get(node.resource)?.color ?? null,
      owner: null,
      board,
    };
  }

  const feature = b.state.map.features.find((f) => f.x === x && f.y === y);
  if (feature !== undefined)
    return terrainInfo(content, feature.feature, board);

  if (y === b.frame.h - 1) {
    return {
      title: screenText(texts, 'hoverFrontTitle'),
      lines: [
        screenText(
          texts,
          board === 'own' ? 'hoverFrontLine' : 'hoverFrontFoeLine',
        ),
      ],
      tone: 'front',
      color: null,
      owner: null,
      board,
    };
  }
  return null;
}

/** The tooltip for the board cell `hit`, or null when it is plain ground. */
export function describeHit(
  scene: Scene,
  hit: Hit,
  content: WebContent,
  o: HoverOptions = {},
): HoverInfo | null {
  const b = scene.boards.find((x) => x.frame.id === hit.board);
  return b === undefined ? null : describeBoardCell(b, hit, content, o);
}

/** The terrain of the neutral strip under a view-space point, if any. */
export function describeNeutral(
  features: readonly SceneFeature[],
  vx: number,
  vy: number,
  content: WebContent,
): HoverInfo | null {
  const f = features.find(
    (t) => Math.floor(vx) === t.x && Math.floor(vy) === t.y,
  );
  return f === undefined ? null : terrainInfo(content, f.feature, 'own');
}
