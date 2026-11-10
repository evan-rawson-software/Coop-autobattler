/** ASCII rendering of a battle (W1-5), for debugging and tests. */

import type { ArenaContent } from './arena.js';
import { arenaOf, type ArenaSim } from './arena-sim.js';

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
    const k = u.y * width + u.x;
    seen.set(k, (seen.get(k) ?? 0) | (u.side === 0 ? 1 : 2));
  }
  for (const [k, mask] of seen) {
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
