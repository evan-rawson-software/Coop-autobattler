/**
 * Sealed unit producers (issue #37, part 3a): a placed unit-producing
 * building whose units could never reach the front row of the board. Pure;
 * used by the session package to refuse Ready while one exists. The rule is
 * stated in docs/rules-reference.md, "Sealed unit producers".
 */
import { createArena } from './arena.js';
import { NEIGHBORS, openFor } from './arena-paths.js';
import type { TeamContent, TeamState } from './team-state.js';

/**
 * The ids of the placed unit producers of `team` that are sealed in, in
 * ascending order. Stash entries are not placed and never count.
 *
 * Rule. Take the board as the arena sees it for side 0 (terrain that blocks
 * movement, the Core and every placed building; conduits are not obstacles).
 * A cell is walkable if it is not blocked terrain and not covered by a
 * building, except that a gate is walkable (units of its own side walk
 * through it, which is what `openFor` says for side 0). The front row is the
 * board's last row (`y = height - 1`), the one next to the neutral zone. A
 * producer is NOT sealed if any cell of its footprint is on the front row (it
 * can spawn onto the first zone row), or if at least one cell 4-adjacent to
 * its footprint (a spawn cell) is walkable and a chain of 4-adjacent walkable
 * cells leads from it to a walkable cell of the front row. Otherwise it is
 * sealed. The neutral zone itself is not consulted (it does not exist while
 * building). One breadth-first search from the front row serves all producers.
 */
export function sealedProducers(
  team: TeamState,
  content: TeamContent,
): number[] {
  const producers = team.buildings.filter(
    (b) => content.buildings.get(b.def)?.kind === 'unit_producer',
  );
  if (producers.length === 0) return [];
  // Side 0 is this team; the other side is the same board with nothing on it.
  const arena = createArena(
    team,
    { ...team, core: null, buildings: [], conduits: [], stash: [] },
    0,
    content,
  );
  const width = arena.geom.width;
  const h = arena.geom.boardHeight;
  const reach = new Uint8Array(width * h);
  const queue = new Int32Array(width * h);
  let tail = 0;
  const front = (h - 1) * width;
  for (let x = 0; x < width; x++) {
    if (openFor(arena, 0, front + x)) {
      reach[front + x] = 1;
      queue[tail++] = front + x;
    }
  }
  for (let head = 0; head < tail; head++) {
    const k = queue[head] ?? 0;
    const x = k % width;
    const y = (k - x) / width;
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= h) continue;
      const nk = ny * width + nx;
      if (reach[nk] === 1 || !openFor(arena, 0, nk)) continue;
      reach[nk] = 1;
      queue[tail++] = nk;
    }
  }
  const sealed: number[] = [];
  for (const p of producers) {
    const ref = arena.byId[0]?.get(p.id);
    const b = ref === undefined ? undefined : arena.buildings[ref];
    if (b === undefined) continue;
    let free = false;
    for (const c of b.cells) {
      if (c.y === h - 1) free = true;
      for (const [dx, dy] of NEIGHBORS) {
        const nx = c.x + dx;
        const ny = c.y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= h) continue;
        if (reach[ny * width + nx] === 1) free = true;
      }
      if (free) break;
    }
    if (!free) sealed.push(p.id);
  }
  return sealed.sort((a, b) => a - b);
}
