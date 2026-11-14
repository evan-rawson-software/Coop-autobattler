import { describe, expect, test } from 'vitest';
import { sealedProducers } from './sealed-producers.js';
import { generateMap } from './generate-map.js';
import { addToStash } from './team-state.js';
import { randomTeam } from './testing/teams.js';
import {
  Lab,
  TIMING,
  board,
  content,
  mapgen,
  type Pairs,
} from './testing/support.js';

/** Cells of the ring around the box [x0..x1] x [y0..y1]. */
function ring(x0: number, y0: number, x1: number, y1: number): Pairs {
  const out: Pairs = [];
  for (let x = x0 - 1; x <= x1 + 1; x++) {
    for (let y = y0 - 1; y <= y1 + 1; y++) {
      const inside = x >= x0 && x <= x1 && y >= y0 && y <= y1;
      if (!inside) out.push([x, y]);
    }
  }
  return out;
}

function walled(
  skip: (x: number, y: number) => string | null = () => 'bld_wall',
  map = board([]),
) {
  const lab = new Lab(map);
  const barracks = lab.put('bld_barracks', 10, 5);
  for (const [x, y] of ring(10, 5, 11, 6)) {
    const def = skip(x, y);
    if (def !== null) lab.put(def, x, y);
  }
  return { lab, barracks };
}

describe('sealedProducers (issue #37, 3a)', () => {
  test('a producer in the open is not sealed; no producers gives none', () => {
    const lab = new Lab(board([]));
    lab.put('bld_barracks', 10, 5);
    lab.put('bld_wall', 3, 3);
    expect(sealedProducers(lab.state, content)).toEqual([]);
    expect(sealedProducers(new Lab(board([])).state, content)).toEqual([]);
  });

  test('a barracks enclosed by walls is sealed', () => {
    const { lab, barracks } = walled();
    expect(sealedProducers(lab.state, content)).toEqual([barracks]);
  });

  test('any building closes the ring, not just walls', () => {
    const { lab, barracks } = walled((x, y) =>
      x === 9 && y === 4 ? 'bld_turret' : 'bld_wall',
    );
    expect(sealedProducers(lab.state, content)).toEqual([barracks]);
  });

  test('a gate in the ring makes it walkable', () => {
    const { lab } = walled((x, y) =>
      x === 12 && y === 5 ? 'bld_gate' : 'bld_wall',
    );
    expect(sealedProducers(lab.state, content)).toEqual([]);
  });

  test('a ring of lake and cliff plus walls is sealed', () => {
    const features = [
      { x: 9, y: 4, feature: 'ter_lake' },
      { x: 10, y: 4, feature: 'ter_lake' },
      { x: 11, y: 4, feature: 'ter_cliff' },
      { x: 12, y: 4, feature: 'ter_cliff' },
      { x: 9, y: 5, feature: 'ter_lake' },
      { x: 12, y: 6, feature: 'ter_cliff' },
    ];
    const map = { ...board([]), features };
    const blocked = new Set(
      features.map((f) => `${String(f.x)},${String(f.y)}`),
    );
    const { lab, barracks } = walled(
      (x, y) => (blocked.has(`${String(x)},${String(y)}`) ? null : 'bld_wall'),
      map,
    );
    expect(sealedProducers(lab.state, content)).toEqual([barracks]);
    // Replace one wall by open ground: no longer sealed.
    const open = walled(
      (x, y) =>
        blocked.has(`${String(x)},${String(y)}`) || (x === 12 && y === 5)
          ? null
          : 'bld_wall',
      map,
    );
    expect(sealedProducers(open.lab.state, content)).toEqual([]);
  });

  test('a 2x2 producer with one free exit cell is not sealed when that cell leads out', () => {
    const { lab } = walled((x, y) => (x === 9 && y === 5 ? null : 'bld_wall'));
    expect(sealedProducers(lab.state, content)).toEqual([]);
  });

  test('a 2x2 producer whose only free exit cell is itself walled in is sealed', () => {
    // Free pocket cell (9, 5) west of the barracks; wall it off one step out.
    const lab = new Lab(board([]));
    const barracks = lab.put('bld_barracks', 10, 5);
    const around = new Set<string>();
    for (const [x, y] of ring(10, 5, 11, 6))
      around.add(`${String(x)},${String(y)}`);
    around.delete('9,5');
    for (const key of around) {
      const [x, y] = key.split(',').map(Number) as [number, number];
      lab.put('bld_wall', x, y);
    }
    // The pocket (9,5) is bounded by (8,5), (9,4), (9,6) and the barracks.
    for (const [x, y] of [[8, 5]] as Pairs) lab.put('bld_wall', x, y);
    expect(sealedProducers(lab.state, content)).toEqual([barracks]);
    const lab2 = new Lab(board([]));
    lab2.put('bld_barracks', 10, 5);
    for (const key of around) {
      const [x, y] = key.split(',').map(Number) as [number, number];
      lab2.put('bld_wall', x, y);
    }
    // (8, 5) left open: the pocket leads out.
    expect(sealedProducers(lab2.state, content)).toEqual([]);
  });

  test('an enclosed building that is not a producer is not listed; unplaced ones never count', () => {
    const lab = new Lab(board([]));
    const turret = lab.put('bld_turret', 10, 5);
    for (const [x, y] of ring(10, 5, 10, 5)) lab.put('bld_wall', x, y);
    expect(turret).toBeGreaterThan(0);
    expect(sealedProducers(lab.state, content)).toEqual([]);
    const stashed = addToStash(lab.state, content, {
      def: 'bld_barracks',
      tier: 1,
      owner: 0,
    });
    if (!stashed.ok) throw new Error('stash');
    expect(sealedProducers(stashed.state, content)).toEqual([]);
  });

  test('a producer on the front row can always spawn onto the zone', () => {
    const lab = new Lab(board([]));
    const barracks = lab.put('bld_barracks', 10, 14);
    for (const [x, y] of ring(10, 14, 11, 15)) {
      if (y <= 15) lab.put('bld_wall', x, y);
    }
    expect(barracks).toBeGreaterThan(0);
    expect(sealedProducers(lab.state, content)).toEqual([]);
  });

  test('several producers: only the sealed ones, in id order', () => {
    const { lab, barracks } = walled();
    const free = lab.put('bld_barracks', 2, 2);
    const second = lab.put('bld_barracks', 16, 8);
    for (const [x, y] of ring(16, 8, 17, 9)) lab.put('bld_wall', x, y);
    expect(free).toBeGreaterThan(0);
    expect(sealedProducers(lab.state, content)).toEqual([barracks, second]);
  });

  test('is fast on a full four-plot board', () => {
    const map = generateMap(3, 4, content, mapgen);
    let team = randomTeam(3, 4);
    // Fill the board with walls so the search touches most of it.
    const lab = new Lab(map);
    lab.state = team;
    for (let i = 0; i < 400; i++) {
      try {
        lab.put('bld_wall', (i * 7) % map.width, (i * 5) % map.height);
      } catch {
        // occupied or blocked: skip
      }
    }
    team = lab.state;
    sealedProducers(team, content);
    const t0 = Date.now();
    const runs = 200;
    for (let i = 0; i < runs; i++) sealedProducers(team, content);
    const each = (Date.now() - t0) / runs;
    expect(each).toBeLessThan(5 * TIMING);
  });
});
