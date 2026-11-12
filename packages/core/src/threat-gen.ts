/**
 * PvE threat generation (W1-9): a pure function from `(seed, round, type,
 * party size, archetype)` to a plain-JSON `ThreatProfile`, plus the stronghold
 * builder, the archetype picker and the choice-screen summary. See
 * docs/rules-reference.md, "PvE threats".
 */

import type { ArenaContent } from './arena.js';
import type { BuildingConfig, BuildingId } from './buildings.js';
import { divFloor, mulPct } from './int.js';
import { MAX_HEALTH } from './limits.js';
import { coreFootprint } from './map.js';
import type { MapgenConfig } from './mapgen.js';
import { Rng } from './rng.js';
import { layoutStronghold } from './threat-layouts.js';
import {
  THREAT_TYPES,
  findArchetype,
  threatBudget,
  type ArchetypeId,
  type ThreatType,
  type ThreatsConfig,
} from './threats.js';
import {
  addToStash,
  createTeamState,
  placeFromStash,
  type TeamState,
} from './team-state.js';
import { maxStrengthPercent, type UnitId } from './units.js';

// ---------------------------------------------------------------------------
// Profile (plain JSON, schemas/threat-profile.schema.json)

export interface ThreatWave {
  readonly tick: number;
  readonly unit: UnitId;
  readonly count: number;
}

export interface StrongholdBuilding {
  readonly def: BuildingId;
  readonly tier: number;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
}

export interface Stronghold {
  readonly coreHealth: number;
  readonly buildings: readonly StrongholdBuilding[];
  readonly corePosition: { readonly x: number; readonly y: number };
}

export interface ThreatProfile {
  readonly archetype: ArchetypeId;
  readonly type: ThreatType;
  readonly round: number;
  readonly partySize: number;
  readonly budget: number;
  readonly unitStrengthPercent: number;
  readonly waves: readonly ThreatWave[];
  readonly stronghold: Stronghold;
}

export interface ThreatInput {
  readonly seed: number;
  readonly round: number;
  readonly type: ThreatType;
  readonly partySize: number;
  readonly archetype: ArchetypeId;
}

export type ThreatContent = Pick<ArenaContent, 'units' | 'buildings'>;

export interface ThreatConfigs {
  readonly threats: ThreatsConfig;
  readonly mapgen: MapgenConfig;
}

// ---------------------------------------------------------------------------
// Helpers

/**
 * floor(total * part / whole) without overflow: `total` is split into a
 * quotient and a remainder by `whole` first. Requires `0 <= part <= whole`,
 * `whole > 0`; and `remainder * part` to be a safe integer, which holds when
 * `whole * part` is.
 */
export function scaleShare(total: number, part: number, whole: number): number {
  const q = divFloor(total, whole);
  const r = total - q * whole;
  return q * part + divFloor(r * part, whole);
}

function ceilDiv(a: number, b: number): number {
  return -divFloor(-a, b);
}

/** Tier-1 price and ID of the first building of a defense type. */
function defenseOf(
  buildings: BuildingConfig,
  type: 'wall' | 'turret',
): { id: BuildingId; price: number } {
  for (const b of buildings.list()) {
    if (b.kind === 'defense' && b.defenseType === type) {
      const tier = b.tiers[0];
      return { id: b.id, price: tier.price };
    }
  }
  throw new Error(`Threat: the content has no ${type} building.`);
}

// ---------------------------------------------------------------------------
// Generation

/**
 * Generate a threat profile. Pure and deterministic. Steps, in order (all in
 * integers, see the rules reference for the details):
 *
 * 1. `B = threatBudget(...)`; `waveBudget = floor(B * waveSharePercent / 100)`;
 *    `S = B - waveBudget` is the stronghold budget.
 * 2. Randomness: `T = Rng.fromSeed(seed).child("threat").child(round)`;
 *    `wavesRng = T.child("waves")`, `holdRng = T.child("stronghold")`.
 * 3. Waves: sizes, composition (one `wavesRng.nextInt(2J + 1)` per
 *    composition entry of each non-signature wave, in wave then entry order),
 *    unit counts and the strength conversion.
 * 4. Stronghold: wall and turret counts, layout (turret and gap positions
 *    from `holdRng`), Core health.
 * 5. Content bounds (a safety net): `unitStrengthPercent` is clamped to the
 *    largest value that keeps every unit type within MAX_HEALTH / MAX_DAMAGE,
 *    and the Core health to MAX_HEALTH. With the shipped content no threat of
 *    rounds 1..maxThreatRound reaches either clamp (threat-bounds.test.ts).
 */
export function generateThreat(
  input: ThreatInput,
  content: ThreatContent,
  configs: ThreatConfigs,
): ThreatProfile {
  const { threats, mapgen } = configs;
  const { seed, round, type, partySize } = input;
  if (!THREAT_TYPES.includes(type)) {
    throw new RangeError(`generateThreat: unknown type "${type}".`);
  }
  if (partySize > mapgen.maxPartySize) {
    throw new RangeError('generateThreat: party size exceeds the map limit.');
  }
  const arch = findArchetype(threats, input.archetype);
  if (arch === undefined) {
    throw new RangeError(
      `generateThreat: unknown archetype "${input.archetype}".`,
    );
  }
  const budget = threatBudget(threats, round, type, partySize);
  const waveBudget = mulPct(budget, arch.waveSharePercent);
  const strongholdBudget = budget - waveBudget;

  const root = Rng.fromSeed(seed).child('threat').child(round);
  const wavesRng = root.child('waves');
  const holdRng = root.child('stronghold');

  // --- Waves -------------------------------------------------------------
  const tpl = arch.waves;
  const costOf = (u: UnitId): number => {
    const c = threats.unitCost.find((e) => e.unit === u);
    if (c === undefined) throw new Error(`Threat: no unit cost for "${u}".`);
    return c.cost;
  };
  const sizes: number[] = [];
  for (let k = 0, s = 100; k < tpl.count; k++) {
    sizes.push(s);
    s = mulPct(s, tpl.growthPercent);
  }
  const sizeSum = sizes.reduce((a, b) => a + b, 0);
  const jitter = threats.compositionJitterPercent;

  interface PlannedWave {
    tick: number;
    entries: { unit: UnitId; n: number }[];
  }
  const planned: PlannedWave[] = [];
  sizes.forEach((size, k) => {
    const wb = scaleShare(waveBudget, size, sizeSum);
    const sig = tpl.signature;
    let comp: { unit: UnitId; weight: number }[];
    if (sig !== undefined && (k + 1) % sig.everyNthWave === 0) {
      comp = [{ unit: sig.unit, weight: 1 }];
    } else {
      comp = tpl.composition.map((c) => {
        const delta = wavesRng.nextInt(2 * jitter + 1) - jitter;
        return { unit: c.unit, weight: mulPct(c.weight * 100, 100 + delta) };
      });
      if (comp.every((c) => c.weight === 0)) {
        comp = tpl.composition.map((c) => ({ unit: c.unit, weight: c.weight }));
      }
    }
    const weightSum = comp.reduce((a, c) => a + c.weight, 0);
    const entries = comp.map((c) => ({
      unit: c.unit,
      n: divFloor(scaleShare(wb, c.weight, weightSum), costOf(c.unit)),
    }));
    if (entries.every((e) => e.n === 0)) {
      // At least one unit per wave: the heaviest-weighted entry (first on ties).
      let best = 0;
      comp.forEach((c, i) => {
        if (c.weight > (comp[best]?.weight ?? 0)) best = i;
      });
      const e = entries[best];
      if (e !== undefined) e.n = 1;
    }
    planned.push({ tick: tpl.firstTick + k * tpl.intervalTicks, entries });
  });

  // Strength conversion: cap the largest wave at maxUnitsPerWavePerPlot * party.
  const cap = threats.maxUnitsPerWavePerPlot * partySize;
  const largest = Math.max(
    ...planned.map((w) => w.entries.reduce((a, e) => a + e.n, 0)),
  );
  let unitStrengthPercent = 0;
  if (largest > cap) {
    unitStrengthPercent = ceilDiv(100 * largest, cap) - 100;
    for (const w of planned) {
      for (const e of w.entries) e.n = divFloor(e.n * cap, largest);
      if (w.entries.every((e) => e.n === 0)) {
        // Keep at least one unit: the entry with the most units before
        // scaling is not known any more, so use the first entry.
        const first = w.entries[0];
        if (first !== undefined) first.n = 1;
      }
    }
  }
  // Safety net: the strength may not push any unit type's health or damage
  // past MAX_HEALTH / MAX_DAMAGE; the excess is lost. Not reached by the
  // shipped content within maxThreatRound.
  const strengthLimit = content.units
    .list()
    .reduce(
      (m, def) => Math.min(m, maxStrengthPercent(def)),
      Number.MAX_SAFE_INTEGER,
    );
  unitStrengthPercent = Math.min(unitStrengthPercent, strengthLimit);
  const waves: ThreatWave[] = [];
  for (const w of planned) {
    for (const e of w.entries) {
      if (e.n > 0) waves.push({ tick: w.tick, unit: e.unit, count: e.n });
    }
  }

  // --- Stronghold --------------------------------------------------------
  const sh = arch.stronghold;
  const wall = defenseOf(content.buildings, 'wall');
  const turret = defenseOf(content.buildings, 'turret');
  const fp = coreFootprint(content.buildings);
  const idealWalls = Math.min(
    divFloor(mulPct(strongholdBudget, sh.wallSharePercent), wall.price),
    threats.maxWallsPerPlot * partySize,
  );
  const idealTurrets = Math.min(
    divFloor(mulPct(strongholdBudget, sh.turretSharePercent), turret.price),
    threats.maxTurretsPerPlot * partySize,
  );
  const plan = layoutStronghold(
    sh.layout,
    threats.layouts,
    {
      width: partySize * mapgen.plotWidth,
      height: mapgen.plotDepth,
      plotWidth: mapgen.plotWidth,
      coreWidth: fp.width,
      coreHeight: fp.height,
    },
    partySize,
    idealWalls,
    idealTurrets,
    holdRng,
  );
  const buildings: StrongholdBuilding[] = [
    ...plan.walls.map((c) => ({
      def: wall.id,
      tier: 1,
      x: c.x,
      y: c.y,
      rotation: 0,
    })),
    ...plan.turrets.map((c) => ({
      def: turret.id,
      tier: 1,
      x: c.x,
      y: c.y,
      rotation: 0,
    })),
  ].sort((a, b) => a.y - b.y || a.x - b.x);
  const spent =
    plan.walls.length * wall.price + plan.turrets.length * turret.price;
  const coreHealth = Math.min(
    MAX_HEALTH,
    Math.max(
      threats.minCoreHealth,
      mulPct(strongholdBudget - spent, sh.coreHealthPerBudget),
    ),
  );

  return {
    archetype: input.archetype,
    type,
    round,
    partySize,
    budget,
    unitStrengthPercent,
    waves,
    stronghold: { coreHealth, buildings, corePosition: plan.core },
  };
}

// ---------------------------------------------------------------------------
// The stronghold as a team state

/**
 * The stronghold of a profile as a team state: a board of the party's size
 * (`partySize * plotWidth` by `plotDepth`) with no features and no nodes, the
 * Core at `corePosition` and the listed buildings placed, built with the
 * ordinary team-state operations (so every placement rule is checked). The
 * buildings get instance IDs 1, 2, ... in list order and owner = the plot
 * they stand in. Throws if anything is rejected: that is a generator bug.
 */
export function buildStronghold(
  profile: ThreatProfile,
  content: ArenaContent,
  mapgen: MapgenConfig,
): TeamState {
  const size = profile.partySize;
  let state = createTeamState({
    width: size * mapgen.plotWidth,
    height: mapgen.plotDepth,
    partySize: size,
    plotWidth: mapgen.plotWidth,
    features: [],
    nodes: [],
  });
  // The stronghold's single Core stands mid-board, which is not inside one
  // player's plot, so it is stored directly instead of through `placeCore`
  // (PP-2). PvE strongholds get one Core per player in issue #138.
  state = {
    ...state,
    cores: state.cores.map((c, p) =>
      p === 0
        ? {
            x: profile.stronghold.corePosition.x,
            y: profile.stronghold.corePosition.y,
          }
        : c,
    ),
  };
  for (const b of profile.stronghold.buildings) {
    const owner = Math.min(
      size - 1,
      Math.max(0, divFloor(b.x, mapgen.plotWidth)),
    );
    const stash = addToStash(state, content, {
      def: b.def,
      tier: b.tier,
      owner,
    });
    if (!stash.ok) {
      throw new Error(
        `Threat stronghold: ${b.def} was rejected (${stash.reason}).`,
      );
    }
    const placed = placeFromStash(stash.state, content, {
      id: stash.id,
      x: b.x,
      y: b.y,
      rotation: b.rotation,
    });
    if (!placed.ok) {
      throw new Error(
        `Threat stronghold: ${b.def} at (${String(b.x)}, ${String(b.y)}) was rejected (${placed.reason}).`,
      );
    }
    state = placed.state;
  }
  return state;
}

// ---------------------------------------------------------------------------
// Choosing archetypes and the choice-screen summary

export interface ArchetypePick {
  readonly easy: ArchetypeId;
  readonly medium: ArchetypeId;
  readonly hard: ArchetypeId;
}

/**
 * The archetypes offered for easy, medium and hard this round. Candidates are
 * the archetypes with `bossOnly` false, in file order; `rng =
 * Rng.fromSeed(seed).child("archetypes").child(round)`; the list is shuffled
 * once (`rng.shuffle`) and easy, medium, hard take positions 0, 1, 2 (wrapping
 * around when there are fewer than three, so with three or more they are
 * distinct). If every archetype is boss-only they are all candidates.
 */
export function pickArchetypes(
  seed: number,
  round: number,
  threats: ThreatsConfig,
): ArchetypePick {
  let pool = threats.archetypes.filter((a) => !a.bossOnly).map((a) => a.id);
  if (pool.length === 0) pool = threats.archetypes.map((a) => a.id);
  const order = Rng.fromSeed(seed)
    .child('archetypes')
    .child(round)
    .shuffle(pool);
  const at = (i: number): ArchetypeId => order[i % order.length] ?? '';
  return { easy: at(0), medium: at(1), hard: at(2) };
}

export interface ThreatSummary {
  readonly archetype: ArchetypeId;
  readonly type: ThreatType;
  /** 1 (easy), 2 (medium) or 3 (hard and boss). */
  readonly level: number;
  /** Units in all waves together. */
  readonly totalUnits: number;
  /** Tick of the first wave, or null when there are no waves. */
  readonly firstWaveTick: number | null;
  readonly coreHealth: number;
  readonly walls: number;
  readonly turrets: number;
}

/** A small plain object for the choice screen. */
export function threatSummary(
  profile: ThreatProfile,
  content: Pick<ThreatContent, 'buildings'>,
): ThreatSummary {
  let walls = 0;
  let turrets = 0;
  for (const b of profile.stronghold.buildings) {
    const def = content.buildings.get(b.def);
    if (def?.kind !== 'defense') continue;
    if (def.defenseType === 'wall') walls += 1;
    else if (def.defenseType === 'turret') turrets += 1;
  }
  return {
    archetype: profile.archetype,
    type: profile.type,
    level: profile.type === 'easy' ? 1 : profile.type === 'medium' ? 2 : 3,
    totalUnits: profile.waves.reduce((a, w) => a + w.count, 0),
    firstWaveTick: profile.waves.reduce<number | null>(
      (a, w) => (a === null || w.tick < a ? w.tick : a),
      null,
    ),
    coreHealth: profile.stronghold.coreHealth,
    walls,
    turrets,
  };
}
