/**
 * Presentation text for one language: a display name and a short description
 * per building, unit, and terrain feature, plus display text for archetypes,
 * event types and run modifiers, and the sentence templates the screens fill
 * in. Rules never live here. Texts may mention a resource as `{res_x}` (see
 * `formatText`).
 */

import { sortedKeys } from './hash.js';
import type { BuildingConfig } from './buildings.js';
import {
  isRecord,
  rejectUnknownKeys,
  unwrapOrThrow,
  type LoadResult,
} from './load-util.js';
import type { ResourceConfig } from './resources.js';
import { placeholderIds } from './text.js';
import type { TerrainConfig } from './terrain.js';
import type { UnitConfig } from './units.js';

export interface PresentationEntry {
  readonly name: string;
  /** May contain `{res_x}` placeholders; pass it through `formatText`. */
  readonly description: string;
}

export interface ArchetypeEntry extends PresentationEntry {
  /** What the archetype tests of the player's factory. */
  readonly tests: string;
}

export interface EventEntry {
  readonly name: string;
  readonly icon: string;
  /** One line of flavour; may be empty. */
  readonly flavour: string;
}

/** Sentence templates with `{slot}` placeholders (see `TEMPLATE_SLOTS`). */
export interface PresentationTemplates {
  /** Building effect lines, by template key. */
  readonly effects: Readonly<Record<string, string>>;
  /** Building kind labels, by building kind. */
  readonly kinds: Readonly<Record<string, string>>;
  /** The words after `Needs:` when a building takes no named resource. */
  readonly needs: { readonly nothing: string; readonly any: string };
  /** Build and Shop screen texts (rates, supply, border links), by key. */
  readonly screens: Readonly<Record<string, string>>;
}

export interface PresentationConfig {
  /** Entry for a building, unit, or terrain ID; undefined if unknown. */
  get(id: string): PresentationEntry | undefined;
  /** Display text of a PvE archetype ID. */
  archetype(id: string): ArchetypeEntry | undefined;
  /** Display text of an event TYPE (`workshop`, ...). */
  event(type: string): EventEntry | undefined;
  /** Display name of a run modifier ID. */
  modifier(id: string): { readonly name: string } | undefined;
  readonly templates: PresentationTemplates;
}

/**
 * The slots each effect template may use, besides `{res_x}` resource IDs.
 * The web fills them from the building's rules numbers.
 */
export const TEMPLATE_SLOTS: Readonly<Record<string, readonly string[]>> = {
  source: [],
  splitter: ['outs'],
  merger: ['ins'],
  crossover: [],
  unit_producer: ['unit', 'cost', 'resource'],
  wall: [],
  gate: [],
  turret: ['damage', 'range', 'seconds', 'cost', 'resource'],
  source_speed: ['step', 'cost', 'resource', 'max'],
  unit_strength: ['step', 'cost', 'resource', 'max'],
  core: [],
};

/** Rejection reason codes that have a message (`reason_<code>`). */
export const REASON_TEXT_CODES: readonly string[] = [
  'unknown_building',
  'invalid_rotation',
  'not_owner',
  'outside_own_plot',
  'out_of_bounds',
  'blocked_by_feature',
  'overlaps_core',
  'overlaps_building',
  'overlaps_conduit',
  'invalid_border',
  'border_spot_in_use',
  'source_needs_node',
  'node_reserved',
  'core_already_placed',
  'core_not_placed',
  'blocked',
  'on_node',
  'too_far_forward',
  'unknown_definition',
  'core_not_allowed',
  'invalid_tier',
  'invalid_owner',
  'not_an_output',
  'not_an_input',
  'side_in_use',
  'invalid_path',
  'crosses_conduit',
  'resource_mismatch',
  'would_loop',
  'unknown_conduit',
  'invalid_conduit_id',
  'wrong_step',
  'not_a_player',
  'not_host',
  'already_ready',
  'not_ready',
  'locked_ready',
  'sealed_producer',
  'invalid_intent',
  'invalid_choice',
  'unknown_intent',
  'save_failed',
  'invalid_state',
  'ghost_selection_pending',
  'already_selected',
  'replay_mismatch',
];

/**
 * The slots each Build and Shop screen text may use. The web fills them in:
 * rates are hundredths already formatted (`1.25`), `{name}` and `{player}`
 * are player names, `{count}` a whole number.
 */
export const SCREEN_TEXT_SLOTS: Readonly<Record<string, readonly string[]>> = {
  collects: ['rate'],
  usesRate: ['resource', 'rate'],
  unitsWord: [],
  stepsWord: [],
  shotsWord: [],
  inspectorCollects: ['rate'],
  inspectorTopSpeed: ['speed', 'unit'],
  inspectorNeeds: ['rate'],
  inspectorStalled: ['percent'],
  inspectorSupplied: ['gets'],
  inspectorUnderSupplied: ['gets'],
  tableSupplied: [],
  tableUnderSupplied: [],
  problemUnderSupplied: ['name', 'gets', 'needs'],
  partnerUnderSuppliedOne: ['player'],
  partnerUnderSuppliedMany: ['player', 'count'],
  linkActive: [],
  linkIdle: [],
  linkBrokenLoop: [],
  linkBrokenMark: [],
  linkBrokenMismatch: ['building'],
  linkBrokenSomeBuilding: [],
  linkJoined: ['name', 'verb'],
  linkSameKind: ['name', 'verb'],
  linkOpen: ['verb'],
  linkSending: [],
  linkReceiving: [],
  playerFallback: ['number'],
  coreLabel: ['name'],
  reasonUnknown: ['reason'],
  reasonWithCause: ['text', 'cause'],
  reasonPlayerToAct: ['text', 'number'],
  selectionNote: ['cause'],
  statusStarting: [],
  statusChooseCore: [],
  statusReadyToBuild: [],
  statusToolConduit: [],
  statusToolErase: [],
  statusToolSelect: [],
  statusCancelled: [],
  statusDropHint: [],
  statusClickHint: [],
  statusPlaced: ['name'],
  statusSelectRotate: [],
  statusRotated: [],
  statusRotatedDetachedOne: ['count'],
  statusRotatedDetachedMany: ['count'],
  statusCoreFixed: [],
  statusSelectReturn: [],
  statusBuildingWord: [],
  statusReturned: ['name'],
  statusReturnedDetachedOne: ['name', 'count'],
  statusReturnedDetachedMany: ['name', 'count'],
  statusConduitErased: [],
  statusNothingUndo: [],
  statusUndone: [],
  statusUndoRefused: ['cause', 'history'],
  statusNothingRedo: [],
  statusRedone: [],
  statusRedoRefused: ['cause', 'history'],
  statusHistoryKept: [],
  statusHistoryCleared: [],
  statusEveryoneReady: ['before', 'after'],
  statusNotReady: [],
  statusReadyWaiting: [],
  statusCorePlaced: [],
  statusConduitDrag: [],
  statusCoreNoOutput: [],
  statusReceiving: [],
  statusTwoBuildings: [],
  statusCoreNoInput: [],
  statusNoRouteCell: [],
  statusNoFreeOutput: ['name'],
  statusFromSide: ['name', 'side'],
  statusPickOutput: ['name'],
  statusMovingDetachesOne: ['count'],
  statusMovingDetachesMany: ['count'],
  statusMoveCancelled: [],
  statusMoved: [],
  statusMovedDetachedOne: ['count'],
  statusMovedDetachedMany: ['count'],
  statusNoRouteBorder: [],
  statusNoRouteSide: [],
  statusNoRoute: [],
  statusBorderHalf: [],
  statusConduitAddedOne: ['count'],
  statusConduitAddedMany: ['count'],
  battleTimeMoreCores: ['core', 'own', 'foe'],
  battleTimeLargerShare: ['core', 'ownhealth', 'ownmax', 'foehealth', 'foemax'],
  battleTieOverkillTime: ['core'],
  battleTieBuildingDamageDouble: ['core'],
  battleTieBuildingDamageTime: ['core'],
  battleTieKillsDouble: ['core'],
  battleTieKillsTime: ['core'],
  battleTieAttackerDouble: ['core'],
  battleTieAttackerTime: ['core'],
  battleGenericCoreDestroyed: ['core'],
  battleGenericCoreDestroyedTheirs: ['core'],
  battleGenericCoreDestroyedYours: ['core'],
  battleGenericOverkill: ['core'],
  battleGenericBuildingDamage: ['core'],
  battleGenericKills: ['core'],
  battleGenericAttacker: ['core'],
  battleGenericTimeLimit: ['core'],
  battleFailWrongStep: [],
  battleFailNoReplay: [],
  battleFailNoStoredBattle: [],
  battleFailTeamChanged: [],
  battleCannotShow: ['reason'],
  readyLock: [],
  sealedHint: [],
  sealedBlockedOne: ['labels', 'hint'],
  sealedBlockedMany: ['labels', 'hint'],
  problemNothingFeeding: ['name'],
  problemNoConduitAny: ['name'],
  problemNoConduitResource: ['name', 'resource'],
  problemStalled: ['name', 'percent'],
  problemStarved: ['name', 'resource'],
  problemFreeNodesOne: ['name', 'stashed', 'count'],
  problemFreeNodesMany: ['names', 'stashed', 'count'],
  problemStashOne: ['count'],
  problemStashMany: ['count'],
  rateOnBoard: ['rate'],
  eventWaiting: ['names'],
  eventChosenDone: [],
  eventChosenPending: [],
  uiInspectorInput: [],
  uiInspectorReceiving: [],
  uiInspectorReceivingEstimate: ['resource', 'rate'],
  uiInspectorReceivingNothing: [],
  uiInspectorMines: [],
  uiInspectorMinesRate: ['resource', 'rate'],
  uiInspectorMinesLost: ['rate'],
  uiInspectorBackedUp: [],
  uiInspectorProduces: [],
  uiInspectorFires: [],
  uiInspectorSteps: [],
  uiInspectorDerived: ['rate', 'things', 'cost', 'resource', 'limit'],
  uiInspectorDerivedAtMost: ['max'],
  uiUnitWord: [],
  uiShotWord: [],
  uiStepWord: [],
  uiInspectorHint: [],
  uiInspectorCoreFixed: [],
  uiInspectorCarriesUnknown: [],
  uiInspectorSealed: ['hint'],
  uiDryRunRegion: [],
  uiDryRunTitle: ['secs'],
  uiDryRunClose: [],
  uiDryRunSource: [],
  uiDryRunResource: [],
  uiDryRunProduced: [],
  uiDryRunLost: [],
  uiDryRunRate: [],
  uiDryRunNoSources: [],
  uiDryRunConsumer: [],
  uiDryRunDelivered: [],
  uiDryRunPerSec: [],
  uiDryRunNeed: [],
  uiDryRunSupply: [],
  uiDryRunNoConsumers: [],
  uiLinksTitle: [],
  uiLinksEmpty: [],
  uiLinksCarries: ['resource'],
  uiLinksRemove: [],
  uiPartyEditing: [],
  uiPartyReadyYes: [],
  uiPartyReadyNo: [],
  uiSwitchPlayingAs: [],
  uiSwitchGroup: [],
  uiSwitchDone: [],
  uiSwitchToAct: [],
  uiSwitchEveryoneDone: [],
  uiSwitchWaiting: ['names'],
  uiSwitchAnnounce: ['name'],
  uiShopNotEnoughGold: [],
  uiShopNoSuchOffer: [],
  uiShopNotInStash: [],
  uiShopNotOwner: [],
  uiShopStale: ['message'],
  uiRunConflictBody: [],
  uiRunConflictTitle: [],
  uiRunDiscardSample: [],
  uiRunRemoveNote: [],
  uiRunRemoveWarning: [],
  uiRunUnopenableKept: [],
  uiRunUnopenableTitle: [],
  uiShopUses: ['needs'],
  uiShopHealth: ['health'],
  uiCellsDirect: [],
  uiCellsMany: ['count'],
  uiCellsOne: ['count'],
  uiComingSoon: [],
  uiConduitName: [],
  uiCoreClick: [],
  uiCoreTitle: [],
  uiInspectorMeta: ['kind', 'tier'],
  uiInspectorOwnedBy: ['owner'],
  uiLblBorderLink: [],
  uiLblCarries: [],
  uiLblCollects: [],
  uiLblConduits: [],
  uiLblErase: [],
  uiLblHealth: [],
  uiLblLength: [],
  uiLblNeeds: [],
  uiLblTopSpeed: [],
  uiNoProblems: [],
  uiOverlayDry: ['secs'],
  uiOverlayDryTicks: [],
  uiOverlayDryTip: [],
  uiOverlayAdvanced: [],
  uiTierTip: ['tier'],
  uiOverlayFlow: [],
  uiOverlayPaths: [],
  uiOverlayTicksPerSecond: ['ticks'],
  uiPanelOverlays: [],
  uiPanelParty: [],
  uiPanelPartySolo: [],
  uiPanelProblems: [],
  uiPanelSelected: [],
  uiPanelStash: [],
  uiPanelTools: [],
  uiPartyNext: ['leg', 'ready', 'total'],
  uiPartyReady: [],
  uiPartyUnready: [],
  uiProblemsMore: ['n'],
  uiShopNextUnknown: [],
  uiShopSoldOut: [],
  uiStartingRun: [],
  uiToolConduit: [],
  uiToolConduitTip: [],
  uiToolErase: [],
  uiToolRedo: [],
  uiToolRedoTip: [],
  uiToolReturnToStash: [],
  uiToolRotateKey: [],
  uiToolRotateTip: [],
  uiToolSelect: [],
  uiToolUndo: [],
  uiToolUndoTip: [],
  rateGetsNeeds: ['gets', 'needs'],
  runOverTitle: [],
  runOverReached: ['round'],
  runOverReasonAbandoned: [],
  runOverReasonParty: [],
  runOverReasonSolo: [],
  runOverPlayersOne: ['count'],
  runOverPlayersMany: ['count'],
  runOverBestFirst: ['label'],
  runOverBestNew: ['label', 'round'],
  runOverBestKept: ['label', 'round'],
  runOverNone: [],
  runOverWon: [],
  runOverLost: [],
  runOverWonTip: [],
  runOverLostTip: [],
  runOverPveRow: ['difficulty', 'name'],
  runOverTally: ['won', 'lost'],
  runOverByDifficultyCounts: ['easy', 'medium', 'hard'],
  runOverPanelThisRun: [],
  runOverStatPvp: [],
  runOverStatGhosts: [],
  runOverStatBosses: [],
  runOverStatPve: [],
  runOverStatByDifficulty: [],
  runOverStatLivesLost: [],
  runOverPanelFactory: [],
  runOverFactoryCountsOne: ['count', 'tier', 'stash'],
  runOverFactoryCountsMany: ['count', 'tier', 'stash'],
  runOverPanelRounds: [],
  runOverNoBattle: [],
  runOverColRound: [],
  runOverColPve: [],
  runOverColPvp: [],
  runOverNewRun: [],
  runOverMainMenu: [],
  runOverBackToMenu: [],
  battleCoresCount: ['label', 'standing', 'total'],
  battleCoreStanding: ['label', 'number'],
  battleCoreFallen: ['label', 'number'],
  battleKindGhost: [],
  battleKindPve: [],
  battleOverloadKey: [],
  battleOverloadBegins: [],
  battleZoneRevealed: [],
  battleSideYour: [],
  battleSideTheir: [],
  battleSideEnemy: [],
  battleSideStronghold: [],
  battleLogCoreFell: ['who', 'core', 'number'],
  battleLogCoreDestroyed: ['who', 'core'],
  battleSummaryCoresStanding: ['core', 'own', 'foe', 'fell'],
  battleSummaryCoreFell: ['who', 'core', 'number', 'time'],
  battleSummaryDetail: ['reason', 'time', 'core', 'own', 'foe'],
  battleSummaryTiebreak: ['ownbuild', 'foebuild', 'ownkills', 'foekills'],
  battleVictory: [],
  battleDefeat: [],
  battleVsOpponent: ['name'],
  battleMismatch: ['result'],
  battleNeutralZone: [],
  battleNeutralZoneHidden: [],
  battleIntro: [],
  battlePanelYourSide: [],
  battlePanelProduction: [],
  battleColYou: [],
  battleColThem: [],
  battleRowUnitsAlive: [],
  battleRowUnitsLost: [],
  battlePanelStrength: [],
  battleStrengthUnit: [],
  battlePanelLog: [],
  battleLogEmpty: [],
  battlePanelSpeed: [],
  battleSkip: [],
  battlePlay: [],
  battlePause: [],
  battleWallsNone: ['walls'],
  battleWallsStanding: ['walls', 'standing', 'total'],
  battleRampSteps: ['count'],
  battlePanelSummaryChart: [],
  battleSummaryDoubleFallWin: ['core', 'time'],
  battleSummaryDoubleFallLoss: ['core', 'time'],
  battlePanelBreachesWon: [],
  battlePanelBreaches: [],
  battleNoBreach: [],
  battleNoBuildings: [],
  battlePanelBuildings: [],
  battleColBuilding: [],
  battleColProduced: [],
  battleColReceived: [],
  battleColUnits: [],
  battleColDamage: [],
  battleColUpgrades: [],
  battleColLost: [],
  battleCountSuffix: ['count'],
  battleLostOf: ['lost', 'count'],
  battleLostOfFirst: ['lost', 'count', 'time'],
  battlePanelNext: [],
  battleWatchAgain: [],
  choiceFight: [],
  choiceSubtitle: [],
  eventSubtitle: [],
  eventChoose: [],
  battleReady: [],
  battleContinueEvent: [],
  battleContinue: [],
  battleReadyDone: [],
  uiCameraPanel: [],
  uiCameraCenter: [],
  uiCameraMyBase: [],
  uiCameraTheirBase: [],
  uiCameraFitBattle: [],
  uiCameraFit: [],
  overloadStronghold: ['at', 'when'],
  overloadYours: ['at', 'when'],
  overloadBoth: ['at', 'when'],
  overloadNeither: ['at'],
  ...Object.fromEntries(
    REASON_TEXT_CODES.map((code) => [`reason_${code}`, [] as string[]]),
  ),
};

const KIND_LABEL_KEYS = [
  'source',
  'route',
  'unit_producer',
  'defense',
  'economy',
  'core',
] as const;

export interface PresentationLoadContext {
  readonly buildings: BuildingConfig;
  readonly units: UnitConfig;
  readonly terrain: TerrainConfig;
  /** When given, `{res_x}` placeholders are checked against it. */
  readonly resources?: ResourceConfig;
  /**
   * When given, every one of these must have display text and no other ID
   * may (archetypes and modifiers by ID, events by type). They come from
   * threats.json and events.json, which load after the files above.
   */
  readonly archetypeIds?: readonly string[];
  readonly eventTypes?: readonly string[];
  readonly modifierIds?: readonly string[];
}

export type PresentationLoadResult = LoadResult<PresentationConfig>;

const GROUPS = ['buildings', 'units', 'terrain'] as const;
const SINGULAR = {
  buildings: 'building',
  units: 'unit',
  terrain: 'terrain feature',
} as const;
const ENTRY_KEYS = new Set(['name', 'description']);

/**
 * Validate parsed presentation data. Every building, unit, and terrain
 * feature must have exactly one entry, and no entry may name anything else.
 */
export function loadPresentation(
  data: unknown,
  context: PresentationLoadContext,
): PresentationLoadResult {
  if (!isRecord(data)) {
    return {
      ok: false,
      errors: [
        'Presentation file must be an object with "buildings", "units", and "terrain".',
      ],
    };
  }
  const errors: string[] = [];
  rejectUnknownKeys(
    data,
    new Set<string>([
      ...GROUPS,
      'archetypes',
      'events',
      'modifiers',
      'templates',
      '$schema',
    ]),
    'presentation',
    errors,
  );
  const expected: Record<(typeof GROUPS)[number], readonly string[]> = {
    buildings: context.buildings.list().map((d) => d.id),
    units: context.units.list().map((d) => d.id),
    terrain: context.terrain.list().map((d) => d.id),
  };
  const entries = new Map<string, PresentationEntry>();

  for (const group of GROUPS) {
    const raw = data[group];
    if (!isRecord(raw)) {
      errors.push(`presentation: "${group}" must be an object keyed by ID.`);
      continue;
    }
    for (const id of expected[group]) {
      if (!(id in raw)) {
        errors.push(`presentation.${group}: missing entry for "${id}".`);
      }
    }
    for (const id of sortedKeys(raw)) {
      const value = raw[id];
      const at = `presentation.${group}["${id}"]`;
      if (!expected[group].includes(id)) {
        errors.push(`${at}: not a defined ${SINGULAR[group]} ID.`);
        continue;
      }
      if (!isRecord(value)) {
        errors.push(`${at}: must be an object with "name" and "description".`);
        continue;
      }
      rejectUnknownKeys(value, ENTRY_KEYS, at, errors);
      const { name, description } = value;
      let usable = true;
      if (typeof name !== 'string' || name.trim() === '') {
        errors.push(`${at}: missing or empty "name".`);
        usable = false;
      }
      if (typeof description !== 'string' || description.trim() === '') {
        errors.push(`${at}: missing or empty "description".`);
        usable = false;
      }
      if (
        usable &&
        typeof name === 'string' &&
        typeof description === 'string'
      ) {
        checkResources(name, `${at}.name`, context.resources, errors);
        checkResources(
          description,
          `${at}.description`,
          context.resources,
          errors,
        );
        entries.set(id, { name, description });
      }
    }
  }

  const archetypes = readGroup(
    data,
    'archetypes',
    /^arch_[a-z0-9_]+$/,
    ['name', 'description', 'tests'],
    context.archetypeIds,
    context.resources,
    errors,
  );
  const events = readGroup(
    data,
    'events',
    /^[a-z][a-z0-9_]*$/,
    ['name', 'icon', 'flavour'],
    context.eventTypes,
    context.resources,
    errors,
  );
  const modifiers = readGroup(
    data,
    'modifiers',
    /^mod_[a-z0-9_]+$/,
    ['name'],
    context.modifierIds,
    context.resources,
    errors,
  );
  const templates = readTemplates(data['templates'], context.resources, errors);

  if (errors.length > 0 || templates === undefined) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    config: {
      get: (id) => entries.get(id),
      archetype: (id) => archetypes.get(id) as ArchetypeEntry | undefined,
      event: (type) => events.get(type) as EventEntry | undefined,
      modifier: (id) => modifiers.get(id) as { name: string } | undefined,
      templates,
    },
  };
}

type Fields = Record<string, string>;

function checkResources(
  text: string,
  at: string,
  resources: ResourceConfig | undefined,
  errors: string[],
): void {
  if (resources === undefined) return;
  for (const ref of placeholderIds(text)) {
    if (resources.get(ref) === undefined) {
      errors.push(`${at}: placeholder {${ref}} is not a known resource.`);
    }
  }
}

/** Read a group of flat string-field entries keyed by ID. */
function readGroup(
  data: Record<string, unknown>,
  group: string,
  idPattern: RegExp,
  fields: readonly string[],
  expectedIds: readonly string[] | undefined,
  resources: ResourceConfig | undefined,
  errors: string[],
): Map<string, Fields> {
  const out = new Map<string, Fields>();
  const raw = data[group];
  if (!isRecord(raw)) {
    errors.push(`presentation: "${group}" must be an object keyed by ID.`);
    return out;
  }
  if (expectedIds !== undefined) {
    for (const id of expectedIds) {
      if (!(id in raw)) {
        errors.push(`presentation.${group}: missing entry for "${id}".`);
      }
    }
  }
  const allowed = new Set(fields);
  for (const id of sortedKeys(raw)) {
    const at = `presentation.${group}["${id}"]`;
    const value = raw[id];
    if (!idPattern.test(id)) {
      errors.push(`${at}: not a valid ID.`);
      continue;
    }
    if (expectedIds !== undefined && !expectedIds.includes(id)) {
      errors.push(`${at}: not a defined ID.`);
      continue;
    }
    if (!isRecord(value)) {
      errors.push(`${at}: must be an object.`);
      continue;
    }
    rejectUnknownKeys(value, allowed, at, errors);
    const entry: Fields = {};
    let usable = true;
    for (const f of fields) {
      const v = value[f];
      // Only an event's flavour line may be empty.
      const mayBeEmpty = f === 'flavour';
      if (typeof v !== 'string' || (!mayBeEmpty && v.trim() === '')) {
        errors.push(`${at}: missing or empty "${f}".`);
        usable = false;
        continue;
      }
      checkResources(v, `${at}.${f}`, resources, errors);
      entry[f] = v;
    }
    if (usable) out.set(id, entry);
  }
  return out;
}

/** Slot names (`{seconds}`) in a template; resource IDs are not slots. */
function slotsOf(template: string): string[] {
  return [...template.matchAll(/\{([a-z]+)\}/g)].map((m) => m[1] as string);
}

function readTemplates(
  raw: unknown,
  resources: ResourceConfig | undefined,
  errors: string[],
): PresentationTemplates | undefined {
  if (!isRecord(raw)) {
    errors.push(
      'presentation: "templates" must be an object with "effects", "kinds", "needs" and "screens".',
    );
    return undefined;
  }
  rejectUnknownKeys(
    raw,
    new Set(['effects', 'kinds', 'needs', 'screens']),
    'presentation.templates',
    errors,
  );
  const before = errors.length;
  const text = (v: unknown, at: string, slots: readonly string[]): string => {
    if (typeof v !== 'string' || v.trim() === '') {
      errors.push(`${at}: missing or empty text.`);
      return '';
    }
    checkResources(v, at, resources, errors);
    for (const slot of slotsOf(v)) {
      if (!slots.includes(slot)) {
        errors.push(`${at}: unknown placeholder {${slot}}.`);
      }
    }
    return v;
  };
  const exact = (
    group: string,
    keys: readonly string[],
    slotsFor: (key: string) => readonly string[],
  ): Record<string, string> => {
    const obj = raw[group];
    const out: Record<string, string> = {};
    if (!isRecord(obj)) {
      errors.push(`presentation.templates: "${group}" must be an object.`);
      return out;
    }
    for (const key of sortedKeys(obj)) {
      if (!keys.includes(key)) {
        errors.push(`presentation.templates.${group}["${key}"]: unknown key.`);
      }
    }
    for (const key of keys) {
      out[key] = text(
        obj[key],
        `presentation.templates.${group}["${key}"]`,
        slotsFor(key),
      );
    }
    return out;
  };
  const effects = exact(
    'effects',
    sortedKeys(TEMPLATE_SLOTS),
    (k) => TEMPLATE_SLOTS[k] ?? [],
  );
  const kinds = exact('kinds', KIND_LABEL_KEYS, () => []);
  const needs = exact('needs', ['any', 'nothing'], () => []);
  const screens = exact(
    'screens',
    sortedKeys(SCREEN_TEXT_SLOTS),
    (k) => SCREEN_TEXT_SLOTS[k] ?? [],
  );
  if (errors.length > before) return undefined;
  return {
    screens,
    effects,
    kinds,
    needs: { nothing: needs['nothing'] as string, any: needs['any'] as string },
  };
}

/** Like loadPresentation, but throws one Error listing every problem. */
export function loadPresentationOrThrow(
  data: unknown,
  context: PresentationLoadContext,
): PresentationConfig {
  return unwrapOrThrow('presentation text', loadPresentation(data, context));
}
