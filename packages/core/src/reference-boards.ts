/**
 * Reference boards (W1-9): three deterministic solo boards on the map
 * generated for a fixed seed, written as `team-state-ops` scripts so they can
 * be used as golden-vector inputs and built with the ordinary team-state
 * operations. They exist for tests and for later tuning tools; none of them is
 * a rule. See docs/rules-reference.md, "Reference boards".
 *
 * All use `seed` 5 with party size 1 (a 24 x 16 board) and the Core at
 * (11, 5). `rush`, `fortify` and `siege` (see `reference-boards-siege.ts`)
 * each have a shop value of 330 gold and beat each other in a circle (CB-21),
 * every battle ending with a destroyed Core: rush beats siege, fortify beats
 * rush, siege beats fortify.
 *
 * - `rush`: unit production and five walls. Tier 3 extractors on the Ore
 *   nodes at (10, 1) and (21, 4) each feed a tier 3 barracks directly; a
 *   tier 1 extractor on the Ore node at (8, 8) feeds a tier 1 barracks.
 *   Walls: tier 2 at (10, 8), (13, 8), (9, 8) and (14, 8), tier 1 at (9, 7).
 * - `fortify`: defences first, an army behind them. Tier 2 turrets at (13, 7)
 *   and (16, 8), each fed through a conduit by its own tier 2 extractor on
 *   the Power nodes at (19, 5) and (23, 6) (each turret fires at half rate);
 *   a tier 2 extractor on the Ore node at (10, 1) feeds a tier 2 barracks and
 *   one on (8, 8) feeds a tier 2 armory. Ten walls: tier 2 at (10, 8),
 *   (13, 8) and (9, 8), tier 1 at (14, 8), (9, 7), (14, 7), (9, 4), (12, 8),
 *   (11, 8) and (9, 6).
 * - `poor`: the starting kit placed badly: one tier 1 extractor feeds a
 *   far-away tier 1 barracks through a long conduit, the other extractor has
 *   no conduit, the turret is unpowered and in a corner, the three walls
 *   stand in a corner.
 */

import type { ArenaContent } from './arena.js';
import type { Json } from './hash.js';
import type { MapgenConfig } from './mapgen.js';
import type { Side } from './buildings.js';
import { runTeamStateOps } from './team-state-ops.js';
import type { TeamState } from './team-state.js';

export type ReferenceBoardName = 'rush' | 'fortify' | 'poor';
export const REFERENCE_BOARDS: readonly ReferenceBoardName[] = [
  'rush',
  'fortify',
  'poor',
];

/** The map seed of every reference board. */
export const REFERENCE_SEED = 5;

/** A `team-state-ops` input script. */
export interface TeamScript {
  readonly seed: number;
  readonly partySize: number;
  readonly ops: readonly Json[];
}

type Point = readonly [number, number];

/** Records the ops of a board; instance IDs follow the counter of the state. */
class Script {
  private readonly ops: Json[] = [];
  private nextId = 1;

  core(x: number, y: number): void {
    this.ops.push({ op: 'placeCore', actor: 0, x, y });
  }

  /** Stash and place a building; returns its instance ID. */
  put(def: string, x: number, y: number, tier = 1): number {
    const id = this.nextId++;
    this.ops.push({ op: 'addToStash', def, tier, owner: 0 });
    this.ops.push({ op: 'placeFromStash', actor: 0, id, x, y, rotation: 0 });
    return id;
  }

  /** A conduit; `path` lists corner points of straight runs (inclusive). */
  link(
    from: number,
    fromSide: Side,
    to: number,
    toSide: Side,
    path: readonly Point[] = [],
  ): void {
    const cells: { x: number; y: number }[] = [];
    path.forEach((p, i) => {
      const prev = path[i - 1];
      if (prev === undefined) {
        cells.push({ x: p[0], y: p[1] });
        return;
      }
      const dx = Math.sign(p[0] - prev[0]);
      const dy = Math.sign(p[1] - prev[1]);
      for (let x = prev[0] + dx, y = prev[1] + dy; ; x += dx, y += dy) {
        cells.push({ x, y });
        if (x === p[0] && y === p[1]) break;
      }
    });
    this.ops.push({
      op: 'addConduit',
      actor: 0,
      from: { building: from, side: fromSide },
      to: { building: to, side: toSide },
      cells,
    });
  }

  script(): TeamScript {
    return { seed: REFERENCE_SEED, partySize: 1, ops: this.ops };
  }
}

function rush(): TeamScript {
  const s = new Script();
  s.core(11, 5);
  const e1 = s.put('bld_extractor', 10, 1, 3);
  const b1 = s.put('bld_barracks', 9, 2, 3);
  const e2 = s.put('bld_extractor', 21, 4, 3);
  const b2 = s.put('bld_barracks', 21, 5, 3);
  const e3 = s.put('bld_extractor', 8, 8, 1);
  const b3 = s.put('bld_barracks', 8, 9, 1);
  for (const [x, y, tier] of [
    [10, 8, 2],
    [13, 8, 2],
    [9, 8, 2],
    [14, 8, 2],
    [9, 7, 1],
  ] as const) {
    s.put('bld_wall_block', x, y, tier);
  }
  s.link(e1, 'north', b1, 'south');
  s.link(e2, 'north', b2, 'south');
  s.link(e3, 'north', b3, 'south');
  return s.script();
}

function fortify(): TeamScript {
  const s = new Script();
  s.core(11, 5);
  const x1 = s.put('bld_extractor', 19, 5, 2);
  const t1 = s.put('bld_turret', 13, 7, 2);
  const x2 = s.put('bld_extractor', 23, 6, 2);
  const t2 = s.put('bld_turret', 16, 8, 2);
  const e1 = s.put('bld_extractor', 10, 1, 2);
  const b1 = s.put('bld_barracks', 9, 2, 2);
  const e2 = s.put('bld_extractor', 8, 8, 2);
  const a1 = s.put('bld_armory', 8, 9, 2);
  for (const [x, y, tier] of [
    [10, 8, 2],
    [13, 8, 2],
    [9, 8, 2],
    [14, 8, 1],
    [9, 7, 1],
    [14, 7, 1],
    [9, 4, 1],
    [12, 8, 1],
    [11, 8, 1],
    [9, 6, 1],
  ] as const) {
    s.put('bld_wall_block', x, y, tier);
  }
  s.link(x1, 'north', t1, 'south', [
    [19, 6],
    [13, 6],
  ]);
  s.link(x2, 'north', t2, 'south', [
    [23, 7],
    [16, 7],
  ]);
  s.link(e1, 'north', b1, 'south');
  s.link(e2, 'north', a1, 'south');
  return s.script();
}

function poor(): TeamScript {
  const s = new Script();
  s.core(11, 5);
  const e1 = s.put('bld_extractor', 10, 1);
  const b1 = s.put('bld_barracks', 2, 12);
  s.link(e1, 'north', b1, 'south', [
    [10, 2],
    [10, 11],
    [3, 11],
  ]);
  s.put('bld_extractor', 21, 4);
  s.put('bld_wall_block', 0, 0);
  s.put('bld_wall_block', 1, 0);
  s.put('bld_wall_block', 2, 0);
  s.put('bld_turret', 22, 0);
  return s.script();
}

/** The `team-state-ops` script of a reference board. */
export function referenceBoardScript(name: ReferenceBoardName): TeamScript {
  switch (name) {
    case 'rush':
      return rush();
    case 'fortify':
      return fortify();
    case 'poor':
      return poor();
  }
}

/** Build a reference board; throws if any operation of its script is rejected. */
export function buildReferenceBoard(
  name: ReferenceBoardName,
  content: ArenaContent,
  mapgen: MapgenConfig,
): TeamState {
  const { results, state } = runTeamStateOps(
    referenceBoardScript(name) as unknown as Json,
    content,
    mapgen,
  );
  results.forEach((r, i) => {
    const o = r as { ok?: boolean; reason?: string };
    if (o.ok !== true) {
      throw new Error(
        `Reference board "${name}": operation ${String(i)} was rejected (${o.reason ?? 'unknown'}).`,
      );
    }
  });
  return state;
}
