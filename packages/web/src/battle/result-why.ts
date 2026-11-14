/**
 * The one-sentence "why" of a battle result and the "try this next round"
 * suggestion (issue #304). Both come from facts read off the battle record
 * (what was placed, what received its input, where the first breach was,
 * when the Cores fell) by fixed rules, first match wins. Nothing here
 * decides or changes an outcome.
 */

import { screenText, screenTexts } from '../build/texts.js';
import type { WebContent } from '../content.js';
import { buildingName, clock, geometryOf, type Moment } from './derive.js';
import type { BattleRecord } from './playback.js';

/** A building of yours that never got the resource it works on. */
export interface DryBuilding {
  readonly building: string;
  /** Resource name; null when the building takes no named resource. */
  readonly resource: string | null;
  /** The plural of the unit it should have trained; null for turrets. */
  readonly units: string | null;
}

export type BreachSide = 'left' | 'right' | 'middle';

export interface ResultFacts {
  /** Buildings of yours on the board, the Core excluded. */
  readonly placed: number;
  readonly dryProducers: readonly DryBuilding[];
  readonly dryTurrets: readonly DryBuilding[];
  /** The first breach of your side; null if none. */
  readonly breach: { readonly side: BreachSide; readonly time: string } | null;
  /** When your last Core fell; null if one stands. */
  readonly ownFell: string | null;
  /** How many Cores you had (several change the wording). */
  readonly ownCores: number;
  /** When their last Core fell; null if one stands. */
  readonly foeFell: string | null;
  /** The plural name of the unit you trained most, if any. */
  readonly topUnits: string | null;
  readonly coreName: string;
  readonly sourceName: string;
  readonly pathsName: string;
}

const t = (key: string, values: Record<string, string> = {}): string =>
  screenText(screenTexts, key, values);

const plural = (name: string): string => `${name}s`;

/** The side of the board a breach is on, by the x of its view-space focus. */
export function breachSideOf(x: number, width: number): BreachSide {
  const mid = width / 2;
  if (Math.abs(x - mid) <= width * 0.1) return 'middle';
  return x < mid ? 'left' : 'right';
}

function inputName(
  content: WebContent,
  def: { readonly inputs: readonly { readonly resource?: string }[] },
): string | null {
  const id = def.inputs.find((i) => i.resource !== undefined)?.resource;
  return id === undefined ? null : (content.resources.get(id)?.name ?? id);
}

/** Read the facts of side 0 (you) off a battle record. */
export function resultFacts(
  record: BattleRecord,
  content: WebContent,
  moments: readonly Moment[],
  ticksPerSecond: number,
): ResultFacts {
  const delivered = new Set<number>();
  const trained = new Map<number, number>();
  const fired = new Set<number>();
  const lost = new Set<number>();
  for (const e of record.eventLog) {
    if (e.type === 'delivered' && e.side === 0) delivered.add(e.building);
    else if (e.type === 'unit_spawned' && e.side === 0) {
      trained.set(e.building, (trained.get(e.building) ?? 0) + 1);
    } else if (e.type === 'turret_fired' && e.side === 0) {
      fired.add(e.building);
    } else if (e.type === 'building_destroyed' && e.side === 0) {
      lost.add(e.building);
    }
  }
  const dryProducers: DryBuilding[] = [];
  const dryTurrets: DryBuilding[] = [];
  const unitCounts = new Map<string, number>();
  let placed = 0;
  for (const b of record.initialTeams[0].buildings) {
    const def = content.buildings.get(b.def);
    if (def === undefined || def.kind === 'core') continue;
    placed += 1;
    if (def.kind === 'unit_producer') {
      const n = trained.get(b.id) ?? 0;
      const unit = content.presentation.get(def.unit)?.name ?? def.unit;
      if (n > 0) unitCounts.set(unit, (unitCounts.get(unit) ?? 0) + n);
      else if (!lost.has(b.id) && !delivered.has(b.id)) {
        dryProducers.push({
          building: buildingName(content, def),
          resource: inputName(content, def),
          units: plural(unit),
        });
      }
    } else if (
      def.kind === 'defense' &&
      def.defenseType === 'turret' &&
      !lost.has(b.id) &&
      !delivered.has(b.id) &&
      !fired.has(b.id)
    ) {
      dryTurrets.push({
        building: buildingName(content, def),
        resource: inputName(content, def),
        units: null,
      });
    }
  }
  let top: string | null = null;
  let topN = 0;
  for (const [name, n] of unitCounts) {
    if (n > topN) {
      top = name;
      topN = n;
    }
  }
  const breachMoment = moments.find(
    (m) => m.side === 0 && m.kind === 'breach' && m.focus !== null,
  );
  const geo = geometryOf(record);
  const sides = record.summary.sides;
  const fellAt = (s: 0 | 1): string | null => {
    const side = sides[s];
    if (side.coresStanding > 0 || side.cores.length === 0) return null;
    const ticks = side.cores.map((c) => c.destroyedTick ?? 0);
    return clock(Math.max(...ticks), ticksPerSecond);
  };
  const list = content.buildings.list();
  const source = list.find((d) => d.kind === 'source');
  const coreDef = list.find((d) => d.kind === 'core');
  return {
    placed,
    dryProducers,
    dryTurrets,
    breach:
      breachMoment?.focus == null
        ? null
        : {
            side: breachSideOf(breachMoment.focus.x, geo.width),
            time: clock(breachMoment.tick, ticksPerSecond),
          },
    ownFell: fellAt(0),
    ownCores: sides[0].cores.length,
    foeFell: fellAt(1),
    topUnits: top === null ? null : plural(top),
    coreName: (coreDef && content.presentation.get(coreDef.id)?.name) ?? 'Core',
    sourceName: source === undefined ? '' : buildingName(content, source),
    pathsName: t('uiOverlayPaths'),
  };
}

export interface Why {
  /** One sentence, or two when your Core's fall is named first. */
  readonly cause: string;
  /** The "try this next round" advice; null for a win. */
  readonly tip: string | null;
}

/**
 * Pick the cause and the tip. `fallback` is the existing reason text, used
 * when no rule finds something concrete to blame.
 */
export function explainResult(
  facts: ResultFacts,
  won: boolean,
  fallback: string,
): Why {
  const core = facts.coreName;
  if (won) {
    const cause =
      facts.foeFell === null
        ? fallback
        : facts.topUnits === null
          ? t('battleWhyWonCore', { core, time: facts.foeFell })
          : t('battleWhyWon', {
              units: facts.topUnits,
              core,
              time: facts.foeFell,
            });
    return { cause, tip: null };
  }
  const fell =
    facts.ownFell === null
      ? ''
      : t(facts.ownCores > 1 ? 'battleWhyFellLast' : 'battleWhyFell', {
          core,
          time: facts.ownFell,
        });
  const lead = fell === '' ? '' : `${fell} `;
  const conduitTip = (d: DryBuilding & { resource: string }): string =>
    t('battleTipConduit', {
      resource: d.resource,
      source: facts.sourceName,
      building: d.building,
    });
  if (facts.placed === 0) {
    return { cause: t('battleNoBuildings'), tip: t('battleTipNoBuildings') };
  }
  const producer = facts.dryProducers[0];
  if (producer?.resource != null) {
    const p = { ...producer, resource: producer.resource };
    return {
      cause:
        lead +
        t('battleWhyNoInput', {
          building: p.building,
          resource: p.resource,
          units: p.units ?? '',
        }),
      tip: conduitTip(p),
    };
  }
  const turret = facts.dryTurrets[0];
  if (turret?.resource != null) {
    const p = { ...turret, resource: turret.resource };
    return {
      cause:
        lead +
        t('battleWhyTurretDry', {
          building: p.building,
          resource: p.resource,
        }),
      tip: conduitTip(p),
    };
  }
  if (facts.breach !== null) {
    const side =
      facts.breach.side === 'left'
        ? 'battleSideLeft'
        : facts.breach.side === 'right'
          ? 'battleSideRight'
          : 'battleSideMiddle';
    return {
      cause: t('battleWhyBreach', {
        side: t(side),
        time: facts.breach.time,
      }),
      tip: t('battleTipBreach', { paths: facts.pathsName }),
    };
  }
  return { cause: fell === '' ? fallback : fell, tip: t('battleTipGeneric') };
}

/**
 * The life outcome chip next to Victory/Defeat: "No life lost" for a
 * stronghold and for any win, and the life cost of a lost rival party battle,
 * read from the first part of the reward line ("-1 life · +1 gold").
 */
export function lifeChip(
  rivalParty: boolean,
  won: boolean,
  rewardText: string,
): { readonly text: string; readonly lost: boolean } {
  if (won || !rivalParty) return { text: t('battleLifeNone'), lost: false };
  const first = rewardText.split(' · ')[0] ?? '';
  return /life|lives/.test(first)
    ? { text: first, lost: true }
    : { text: t('battleLifeNone'), lost: false };
}
