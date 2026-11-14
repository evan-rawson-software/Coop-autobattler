/**
 * ASCII pictures of a map, a team state, a neutral zone and a battle (W1-5),
 * for the command-line tools, debugging and tests. Not rules.
 */

import { sortedIntEntries } from './collections.js';
import type { ArenaContent } from './arena.js';
import { arenaOf, type ArenaSim } from './arena-sim.js';
import { CELL_UNITS } from './limits.js';
import { allCoreCells, defCells } from './board-cells.js';
import type { Cell, GameMap, MapContent } from './map.js';
import type { NeutralZone } from './neutral-zone.js';
import type { TeamContent, TeamState } from './team-state.js';

// ---------------------------------------------------------------------------
// Battle

const LETTERS: Readonly<Record<string, string>> = {
  source: 'S',
  route: 'R',
  unit_producer: 'U',
  defense: 'D',
  economy: 'E',
  core: 'C',
};

/**
 * One character per arena cell, side 1 at the top (arena `y = height - 1`)
 * down to side 0 at the bottom. Units are `0` or `1` for their side (`*` when
 * both sides share a cell). Buildings are letters (`S` source, `R` route, `U` unit producer,
 * `D` defense, `E` economy, `C` Core), upper case for side 0 and lower case
 * for side 1. Terrain is `~` lake, `#` cliff, `?` other, `%` blocked gap cell;
 * `.` is open ground. The last line is a legend.
 */
export function renderArenaAscii(sim: ArenaSim, content: ArenaContent): string {
  const arena = arenaOf(sim, content);
  const { width, height } = arena.geom;
  const grid: string[][] = [];
  for (let y = 0; y < height; y++)
    grid.push(new Array<string>(width).fill('.'));
  const put = (x: number, y: number, ch: string): void => {
    const row = grid[y];
    if (row !== undefined) row[x] = ch;
  };
  const featureChar = (id: string): string =>
    id === 'ter_lake' ? '~' : id === 'ter_cliff' ? '#' : '?';
  sim.teams.forEach((team, side) => {
    for (const f of team.map.features) {
      const def = content.terrain.get(f.feature);
      if (def === undefined || !def.blocksMovement) continue;
      const x = side === 0 ? f.x : width - 1 - f.x;
      const y = side === 0 ? f.y : height - 1 - f.y;
      put(x, y, featureChar(f.feature));
    }
  });
  for (const g of sim.gapBlocked) put(g.x, g.y, '%');
  for (const b of arena.buildings) {
    if (!b.alive) continue;
    const letter = LETTERS[b.kind] ?? '?';
    const ch = b.side === 0 ? letter : letter.toLowerCase();
    for (const c of b.cells) put(c.x, c.y, ch);
  }
  const seen = new Map<number, number>();
  for (const u of sim.units) {
    const k =
      Math.min(height - 1, Math.floor(u.py / CELL_UNITS)) * width +
      Math.min(width - 1, Math.floor(u.px / CELL_UNITS));
    seen.set(k, (seen.get(k) ?? 0) | (u.side === 0 ? 1 : 2));
  }
  for (const [k, mask] of sortedIntEntries(seen)) {
    put(
      k % width,
      Math.floor(k / width),
      mask === 1 ? '0' : mask === 2 ? '1' : '*',
    );
  }
  const lines: string[] = [];
  for (let y = height - 1; y >= 0; y--) lines.push((grid[y] ?? []).join(''));
  lines.push(
    'legend: 0/1=unit of side 0/1 *=both sides .=open ~=lake #=cliff %=blocked gap S/R/U/D/E/C=side 0 building (lower case: side 1) (side 1 on top)',
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Map

const FEATURE_CHARS: Readonly<Record<string, string>> = {
  ter_lake: '~',
  ter_cliff: '#',
};

function resourceLetter(index: number): string {
  return index < 26 ? String.fromCharCode(97 + index) : '*';
}

/**
 * One character per cell, front row (`y = height - 1`) first so the enemy is
 * above: `.` open, `~` lake, `#` cliff (`?` any other feature), and a letter
 * per resource node: `a` for the first resource in the resource list, `b` for
 * the second, and so on. The last line is a legend.
 */
export function renderMapAscii(map: GameMap, content: MapContent): string {
  const resourceIds = content.resources.list().map((r) => r.id);
  const grid: string[][] = [];
  for (let y = 0; y < map.height; y++) {
    grid.push(new Array<string>(map.width).fill('.'));
  }
  const put = (x: number, y: number, ch: string): void => {
    const row = grid[y];
    if (row !== undefined && x >= 0 && x < map.width) row[x] = ch;
  };
  for (const f of map.features) put(f.x, f.y, FEATURE_CHARS[f.feature] ?? '?');
  for (const n of map.nodes) {
    put(n.x, n.y, resourceLetter(resourceIds.indexOf(n.resource)));
  }
  const lines: string[] = [];
  for (let y = map.height - 1; y >= 0; y--)
    lines.push((grid[y] ?? []).join(''));
  const letters = resourceIds.map((id, i) => `${resourceLetter(i)}=${id}`);
  lines.push(
    `legend: .=open ~=lake #=cliff ${letters.join(' ')} (front row on top)`,
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Team state

const KIND_LETTERS: Readonly<Record<string, string>> = {
  source: 'S',
  route: 'R',
  unit_producer: 'U',
  defense: 'D',
  economy: 'E',
};

/**
 * Like `renderMapAscii` (front row on top), with buildings drawn over the
 * map: `S` source, `R` route, `U` unit producer, `D` defense, `E` economy,
 * `C` Core, and `*` for each conduit path cell. A final line gives the legend. The map's own characters (`.`
 * open, `~` lake, `#` cliff, lowercase letters for resource nodes) show
 * where no building stands.
 */
export function renderTeamStateAscii(
  state: TeamState,
  content: TeamContent,
): string {
  const lines = renderMapAscii(state.map, content).split('\n');
  const legend = lines.pop() ?? '';
  const grid = lines.map((l) => l.split(''));
  const paint = (c: Cell, ch: string): void => {
    const row = grid[state.map.height - 1 - c.y];
    if (row !== undefined && c.x >= 0 && c.x < row.length) row[c.x] = ch;
  };
  for (const b of state.buildings) {
    const def = content.buildings.get(b.def);
    if (def === undefined) continue;
    const ch = KIND_LETTERS[def.kind] ?? '?';
    for (const c of defCells(def, b.x, b.y, b.rotation)) paint(c, ch);
  }
  for (const conduit of state.conduits) {
    for (const c of conduit.cells) paint(c, '*');
  }
  for (const c of allCoreCells(state.cores, content)) paint(c, 'C');
  return [
    ...grid.map((r) => r.join('')),
    `${legend} | S=source R=route U=unit_producer D=defense E=economy C=core *=conduit`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Neutral zone

/** ASCII picture of a zone, `y = 0` (side 0's edge) first: `~` lake, `#` cliff, `?` other, `.` open. */
export function renderNeutralZoneAscii(
  zone: NeutralZone,
  lakeFeature: string,
  cliffFeature: string,
): string {
  const rows: string[] = [];
  for (let y = 0; y < zone.depth; y++) {
    let row = '';
    for (let x = 0; x < zone.width; x++) {
      const f = zone.features.find((c) => c.x === x && c.y === y)?.feature;
      row +=
        f === undefined
          ? '.'
          : f === lakeFeature
            ? '~'
            : f === cliffFeature
              ? '#'
              : '?';
    }
    rows.push(row);
  }
  return rows.join('\n');
}
