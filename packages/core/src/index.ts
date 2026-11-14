/**
 * The public surface of @game/core, grouped by area. Each source file appears
 * once. Section names refer to docs/rules-reference.md.
 */

// ---------------------------------------------------------------------------
// Integer maths, hashing and random numbers (see "The PRNG", "Integer math conventions", "Canonical JSON and the hash")
export {
  addSaturating,
  assertInt,
  BPS_SCALE,
  clamp,
  compareFractions,
  divFloor,
  maxInt,
  minInt,
  modFloor,
  mulBps,
  mulDiv,
  mulInt,
  mulPct,
} from './int.js';
export {
  assertWithin,
  CELL_UNITS,
  MAX_ARENA_CELLS,
  MAX_BREACH_BASE_COST,
  MAX_DAMAGE,
  MAX_HEALTH,
  MAX_HIT,
  MAX_SEPARATION_CAP,
  MAX_TICK_DAMAGE,
  MAX_UNIT_RADIUS,
  MAX_UNIT_REACH,
} from './limits.js';
export {
  boxDist2,
  buildingDist2,
  buildSolid,
  cellCoord,
  fits,
  pushOutSolid,
  type World,
} from './geometry.js';
export {
  canonicalJson,
  canonicalJsonOrNull,
  fnv1a32,
  hashJson,
  type Json,
  sortedKeys,
  toHex8,
} from './hash.js';
export { Rng } from './rng.js';
export { pickWeightedIndex } from './weighted.js';

// ---------------------------------------------------------------------------
// Content: loaders and configuration types (see "Content bounds")
export {
  type Content,
  type ContentLoadResult,
  loadAllContent,
  loadAllContentOrThrow,
  type RawContent,
} from './content.js';
export {
  loadResources,
  loadResourcesOrThrow,
  type Rarity,
  type ResourceConfig,
  type ResourceDef,
  type ResourceId,
  type ResourceLoadResult,
} from './resources.js';
export {
  loadTerrain,
  loadTerrainOrThrow,
  type TerrainConfig,
  type TerrainFeatureDef,
  type TerrainFeatureId,
  type TerrainLoadResult,
} from './terrain.js';
export {
  type AttackType,
  loadUnits,
  loadUnitsOrThrow,
  maxStrengthPercent,
  type UnitConfig,
  type UnitDef,
  type UnitId,
  type UnitLoadResult,
  unitSpeed,
} from './units.js';
export {
  type BuildingConfig,
  type BuildingDef,
  type BuildingId,
  type BuildingInput,
  type BuildingKind,
  type BuildingLoadContext,
  type BuildingLoadResult,
  type CoreBuildingDef,
  type CoreTier,
  type DefenseBuildingDef,
  type DefenseType,
  type EconomyBuildingDef,
  type EconomyEffectType,
  type EconomyTier,
  type Footprint,
  loadBuildings,
  loadBuildingsOrThrow,
  needHundredthsPerSecond,
  needPer1000,
  oppositeSide,
  productionOf,
  rotateBuilding,
  type RotatedBuilding,
  rotateSide,
  type Rotation,
  type RouteBuildingDef,
  type RouteType,
  type Side,
  type SourceBuildingDef,
  type SourceTier,
  type TierBase,
  type Tiers3,
  type TurretBuildingDef,
  type TurretTier,
  type UnitProducerBuildingDef,
  type UnitProducerTier,
  type WallOrGateBuildingDef,
} from './buildings.js';
export {
  loadMapgen,
  loadMapgenOrThrow,
  type MapgenCliffs,
  type MapgenConfig,
  type MapgenLakes,
  type MapgenLoadContext,
  type MapgenLoadResult,
  type NeutralZoneConfig,
} from './mapgen.js';
export {
  loadSimConfig,
  loadSimConfigOrThrow,
  type SimConfig,
  type SimConfigLoadResult,
} from './sim-config.js';
export {
  type EconomyConfig,
  type EconomyLoadContext,
  type EconomyLoadResult,
  type KitEntry,
  loadEconomy,
  loadEconomyOrThrow,
  type OfferWeight,
  type RewardsConfig,
  type TierOddsRow,
} from './economy.js';
export {
  type EventDef,
  type EventParams,
  type EventsConfig,
  type EventsLoadResult,
  findEvent,
  findModifier,
  loadEvents,
  loadEventsOrThrow,
  type ModifierDef,
} from './events.js';
export {
  type ArchetypeDef,
  type ArchetypeId,
  budgetLimit,
  findArchetype,
  type LayoutId,
  loadThreats,
  loadThreatsOrThrow,
  maxThreatRound,
  type StrongholdTemplate,
  THREAT_TYPES,
  threatBudget,
  type ThreatsConfig,
  type ThreatsLoadContext,
  type ThreatsLoadResult,
  type ThreatType,
  type UnitCost,
  type WaveComposition,
  type WaveTemplate,
} from './threats.js';
export {
  type HasModifiers,
  heldModifierIds,
  MAX_MODIFIER_PERCENT,
  MODIFIER_EFFECT_KINDS,
  MODIFIER_ID,
  MODIFIER_TARGETS,
  type ModifierEffect,
  type ModifierEffectKind,
  modifierPercent,
  type ModifierTarget,
  parseModifierEffect,
  parseTeamModifiers,
  type TeamModifier,
  withModifier,
} from './modifiers.js';

// ---------------------------------------------------------------------------
// Presentation text (display only; never read by the rules)
export {
  type ArchetypeEntry,
  type EventEntry,
  loadPresentation,
  loadPresentationOrThrow,
  type PresentationConfig,
  type PresentationEntry,
  type PresentationLoadContext,
  type PresentationLoadResult,
  type PresentationTemplates,
  REASON_TEXT_CODES,
  SCREEN_TEXT_SLOTS,
  TEMPLATE_SLOTS,
} from './presentation.js';
export { formatText, placeholderIds } from './text.js';

// ---------------------------------------------------------------------------
// Maps and the team state (see "Map generation", "Team state and placement", "Conduits")
export {
  type Cell,
  compareCells,
  coreFootprint,
  type CorePositionProblem,
  type CorePositionResult,
  type FeatureCell,
  type GameMap,
  listLegalCorePositions,
  loadMap,
  loadMapOrThrow,
  type MapContent,
  type MapLoadResult,
  type MapQuery,
  queryMap,
  type ResourceNode,
  validateCorePosition,
} from './map.js';
export {
  type GeneratedMap,
  generateMap,
  generateMapWithStats,
} from './generate-map.js';
export {
  addToStash,
  type AddToStashResult,
  type AnyReason,
  type BorderEnd,
  buildingEnd,
  type Conduit,
  type ConduitEnd,
  conduitTouches,
  type CoreReason,
  createTeamState,
  detachConduits,
  eraseConduit,
  isBorderEnd,
  moveBuilding,
  type Occupancy,
  occupancy,
  type OpFailure,
  type OpResult,
  placeCore,
  type PlacedBuilding,
  placeFromStash,
  type PlacementReason,
  raiseTier,
  type RaiseTierReason,
  removeFromStash,
  returnToStash,
  ROTATIONS,
  type StashedBuilding,
  type StashReason,
  type TeamContent,
  type TeamState,
  validateTeamState,
  type ValidateTeamStateResult,
} from './team-state.js';
export { runTeamStateOps } from './team-state-ops.js';
export {
  addConduit,
  type AddConduitResult,
  type BrokenLink,
  brokenLinks,
  buildFlowGraph,
  type ConduitEndArg,
  type ConduitReason,
  conduitResource,
  conduitsLostWith,
  type FlowEdge,
  type FlowGraph,
  type FlowInput,
  type FlowNode,
  type FlowNodeKind,
  type FlowOutput,
  SIDE_ORDER,
} from './conduits.js';
export {
  decodeConduitId,
  encodeConduitId,
  MAX_PARTY_SIZE,
} from './conduit-ids.js';
export { sealedProducers } from './sealed-producers.js';

// ---------------------------------------------------------------------------
// Flow of one board (see "Tick order")
export {
  type BoardSim,
  cloneBoardSim,
  collectorHundredthsPerSecond,
  collectorRatePer1000,
  type ConduitSim,
  type ConsumerInputSim,
  type ConsumerMode,
  type ConsumerPacer,
  type ConsumerSim,
  createBoardSim,
  createFlowContext,
  type DryRunConsumerInput,
  dryRunFlow,
  type DryRunNeed,
  type DryRunResult,
  type DryRunRoute,
  type DryRunSource,
  type FlowContext,
  type FlowPlan,
  type FlowTotals,
  flowTotals,
  rebuildFlow,
  type RetiredTotals,
  type RouteSim,
  scaledInterval,
  type SimEvent,
  type SourceSim,
  stepFlow,
  takeFromBuffer,
} from './flow-sim.js';

// ---------------------------------------------------------------------------
// Battles (see "The arena", "One battle tick", "The neutral zone", "Battles")
export {
  type Arena,
  type ArenaBuilding,
  type ArenaContent,
  type ArenaGeometry,
  cellIndex,
  createArena,
  removeFromArena,
  toArena,
  toBoard,
} from './arena.js';
export {
  type ArenaContext,
  type ArenaEvent,
  arenaOf,
  type ArenaOptions,
  type ArenaSim,
  type BuildingHealthSim,
  type CoreHealthSim,
  createArenaContext,
  createArenaSim,
  type EnteringSim,
  type HealthSim,
  isCoreHealth,
  type ProducerSim,
  rampBonus,
  type RampSim,
  runArena,
  type ScheduledWave,
  type SideOptions,
  spawnUnitForTest,
  startArenaBattle,
  stepArena,
  type TurretSim,
  type UnitSim,
  unitStats,
  type UnitTarget,
} from './arena-sim.js';
export {
  blocksUnit,
  computeBreach,
  computeField,
  type Field,
  goalBuildings,
  openFor,
} from './arena-paths.js';
export {
  type GeneratedNeutralZone,
  generateNeutralZone,
  generateNeutralZoneWithStats,
  NEUTRAL_ZONE_STREAM,
  type NeutralZone,
  type NeutralZoneContent,
  neutralZoneProblem,
  zoneBlockedCells,
} from './neutral-zone.js';
export {
  cappedBonus,
  isOverloadBeat,
  type OverloadDeadline,
  overloadDeadline,
  overloadLevel,
  type OverloadOutcome,
  overloadOutcome,
} from './ramp.js';
export { coreMaxHealth } from './max-health.js';
export {
  type Battle,
  type BattleConfig,
  type BattleError,
  type BattleErrorCode,
  type BattleInput,
  type BattleOptions,
  type BattleReason,
  type BattleResult,
  type BattleSideSummary,
  type BattleSummary,
  type CoreSummary,
  simulateBattle,
  type SimulateBattleResult,
  startBattle,
  type StartBattleResult,
  sumOverkill,
  type TimelineSample,
  type TimelineSide,
} from './battle.js';
export { type EnemyPath, previewEnemyPaths } from './enemy-paths.js';

// ---------------------------------------------------------------------------
// PvE threats (see "PvE threats")
export {
  type ArchetypePick,
  buildStronghold,
  generateThreat,
  pickArchetypes,
  scaleShare,
  type Stronghold,
  type StrongholdBuilding,
  type ThreatConfigs,
  type ThreatContent,
  type ThreatInput,
  type ThreatProfile,
  type ThreatSummary,
  threatSummary,
  type ThreatWave,
} from './threat-gen.js';
export { layoutStronghold } from './threat-layouts.js';
export {
  type PveBattle,
  type PveBattleInput,
  simulatePveBattle,
  type SimulatePveBattleResult,
  startPveBattle,
  type StartPveBattleResult,
  threatSideOptions,
} from './pve-battle.js';

// ---------------------------------------------------------------------------
// Shops and the Workshop (see "Shops and gold")
export {
  buyOffer,
  type PlayerShop,
  rerollOffers,
  rollOffers,
  sellFromStash,
  sellValue,
  type ShopContent,
  type ShopFailure,
  type ShopOffer,
  type ShopReason,
  type ShopResult,
  tierOddsFor,
  tierPrice,
} from './shop.js';
export {
  type WorkshopOption,
  workshopOptions,
  workshopPrice,
  workshopPriceOrNull,
} from './workshop.js';

// ---------------------------------------------------------------------------
// Ghosts (see "Ghosts")
export {
  checkGhostSnapshotShape,
  compareGhosts,
  GHOST_MAX_BYTES_MARGIN,
  GHOST_MAX_DEPTH,
  GHOST_MAX_ERRORS,
  GHOST_MAX_ID_LENGTH,
  GHOST_MAX_LABEL_LENGTH,
  GHOST_MAX_ROUND,
  GHOST_MAX_SERIALIZED_BYTES,
  GHOST_MAX_STRING_LENGTH,
  GHOST_SNAPSHOT_FORMAT_VERSION,
  type GhostBucket,
  ghostBucketKey,
  ghostBucketOf,
  ghostKey,
  ghostMaxSerializedSize,
  type GhostOwner,
  type GhostPvpRecord,
  type GhostSizeContext,
  type GhostSnapshot,
  type GhostTierBound,
  ghostTierBound,
  type GhostValidationContext,
  type GhostValidationResult,
  type GhostValueBound,
  ghostValueBound,
  teamBuildingValue,
  validateGhostSnapshot,
} from './ghost-snapshot.js';

// ---------------------------------------------------------------------------
// Reference boards and ASCII pictures (tools, tests and debugging; not rules)
export {
  buildReferenceBoard,
  REFERENCE_BOARDS,
  REFERENCE_SEED,
  type ReferenceBoardName,
  referenceBoardScript,
  type TeamScript,
} from './reference-boards.js';
export {
  ALL_REFERENCE_BOARDS,
  type AnyReferenceBoardName,
  anyReferenceBoardScript,
  buildAnyReferenceBoard,
} from './reference-boards-siege.js';
export {
  renderArenaAscii,
  renderMapAscii,
  renderNeutralZoneAscii,
  renderTeamStateAscii,
} from './ascii-render.js';
