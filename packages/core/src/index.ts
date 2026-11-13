export { add } from './add.js';
export { isCoreHealth } from './arena-sim.js';
export { sumOverkill } from './battle.js';
export {
  assertWithin,
  MAX_ARENA_CELLS,
  MAX_BREACH_BASE_COST,
  MAX_DAMAGE,
  MAX_HEALTH,
  MAX_HIT,
  MAX_TICK_DAMAGE,
} from './limits.js';
export { loadResources, loadResourcesOrThrow } from './resources.js';
export type {
  Rarity,
  ResourceConfig,
  ResourceDef,
  ResourceId,
  ResourceLoadResult,
} from './resources.js';
export { loadTerrain, loadTerrainOrThrow } from './terrain.js';
export type {
  TerrainConfig,
  TerrainFeatureDef,
  TerrainFeatureId,
  TerrainLoadResult,
} from './terrain.js';
export {
  loadUnits,
  loadUnitsOrThrow,
  maxStrengthPercent,
  unitSpeed,
} from './units.js';
export type {
  AttackType,
  UnitConfig,
  UnitDef,
  UnitId,
  UnitLoadResult,
} from './units.js';
export {
  loadBuildings,
  loadBuildingsOrThrow,
  needHundredthsPerSecond,
  needPer1000,
  oppositeSide,
  productionOf,
  rotateBuilding,
  rotateSide,
} from './buildings.js';
export type {
  BuildingConfig,
  BuildingDef,
  BuildingId,
  BuildingInput,
  BuildingKind,
  BuildingLoadContext,
  BuildingLoadResult,
  CoreBuildingDef,
  CoreTier,
  DefenseBuildingDef,
  DefenseType,
  EconomyBuildingDef,
  EconomyEffectType,
  EconomyTier,
  Footprint,
  RotatedBuilding,
  Rotation,
  RouteBuildingDef,
  RouteType,
  Side,
  SourceBuildingDef,
  SourceTier,
  TierBase,
  Tiers3,
  TurretBuildingDef,
  TurretTier,
  UnitProducerBuildingDef,
  UnitProducerTier,
  WallOrGateBuildingDef,
} from './buildings.js';
export {
  loadPresentation,
  loadPresentationOrThrow,
  TEMPLATE_SLOTS,
  SCREEN_TEXT_SLOTS,
  REASON_TEXT_CODES,
} from './presentation.js';
export type {
  ArchetypeEntry,
  EventEntry,
  PresentationConfig,
  PresentationTemplates,
  PresentationEntry,
  PresentationLoadContext,
  PresentationLoadResult,
} from './presentation.js';
export { formatText, placeholderIds } from './text.js';
export { loadAllContent, loadAllContentOrThrow } from './content.js';
export type { Content, ContentLoadResult, RawContent } from './content.js';
export { Rng } from './rng.js';
export {
  BPS_SCALE,
  assertInt,
  clamp,
  addSaturating,
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
  canonicalJson,
  fnv1a32,
  hashJson,
  sortedKeys,
  toHex8,
  type Json,
} from './hash.js';
export type { SimulationOutput } from './golden-kinds.js';
export { goldenKinds, type SimulationFn } from './golden-kinds.js';
export { loadMapgen, loadMapgenOrThrow } from './mapgen.js';
export type {
  MapgenCliffs,
  MapgenConfig,
  MapgenLakes,
  MapgenLoadContext,
  MapgenLoadResult,
} from './mapgen.js';
export {
  compareCells,
  coreFootprint,
  listLegalCorePositions,
  loadMap,
  loadMapOrThrow,
  queryMap,
  renderMapAscii,
  validateCorePosition,
} from './map.js';
export type {
  Cell,
  CorePositionProblem,
  CorePositionResult,
  FeatureCell,
  GameMap,
  MapContent,
  MapLoadResult,
  MapQuery,
  ResourceNode,
} from './map.js';
export {
  generateMap,
  generateMapWithStats,
  makeMapGenKind,
} from './generate-map.js';
export type { GeneratedMap } from './generate-map.js';
export {
  ROTATIONS,
  addToStash,
  createTeamState,
  buildingEnd,
  conduitTouches,
  detachConduits,
  eraseConduit,
  moveBuilding,
  occupancy,
  placeCore,
  placeFromStash,
  removeFromStash,
  renderTeamStateAscii,
  isBorderEnd,
  returnToStash,
  validateTeamState,
} from './team-state.js';
export type {
  AddToStashResult,
  AnyReason,
  Conduit,
  BorderEnd,
  ConduitEnd,
  CoreReason,
  Occupancy,
  OpFailure,
  OpResult,
  PlacedBuilding,
  PlacementReason,
  StashReason,
  StashedBuilding,
  TeamContent,
  TeamState,
  ValidateTeamStateResult,
} from './team-state.js';
export {
  MAX_PARTY_SIZE,
  decodeConduitId,
  encodeConduitId,
} from './conduit-ids.js';
export {
  SIDE_ORDER,
  addConduit,
  brokenLinks,
  buildFlowGraph,
  conduitResource,
  conduitsLostWith,
} from './conduits.js';
export type {
  AddConduitResult,
  BrokenLink,
  ConduitEndArg,
  ConduitReason,
  FlowEdge,
  FlowGraph,
  FlowInput,
  FlowNode,
  FlowNodeKind,
  FlowOutput,
} from './conduits.js';
export {
  makeFlowGraphKind,
  makeTeamStateOpsKind,
  runTeamStateOps,
} from './team-state-ops.js';
export { loadSimConfig, loadSimConfigOrThrow } from './sim-config.js';
export type { SimConfig, SimConfigLoadResult } from './sim-config.js';
export {
  cloneBoardSim,
  createBoardSim,
  createFlowContext,
  dryRunFlow,
  flowTotals,
  rebuildFlow,
  stepFlow,
  takeFromBuffer,
} from './flow-sim.js';
export type {
  BoardSim,
  ConduitSim,
  ConsumerInputSim,
  ConsumerMode,
  ConsumerPacer,
  ConsumerSim,
  DryRunConsumerInput,
  DryRunNeed,
  DryRunResult,
  DryRunRoute,
  DryRunSource,
  FlowContext,
  FlowPlan,
  FlowTotals,
  RetiredTotals,
  RouteSim,
  SimEvent,
  SourceSim,
} from './flow-sim.js';
export { makeFlowSimKind } from './flow-sim-kind.js';
export {
  createArena,
  removeFromArena,
  toArena,
  toBoard,
  cellIndex,
} from './arena.js';
export type {
  Arena,
  ArenaBuilding,
  ArenaContent,
  ArenaGeometry,
} from './arena.js';
export {
  computeBreach,
  computeField,
  goalBuildings,
  blocksUnit,
  openFor,
} from './arena-paths.js';
export type { Field } from './arena-paths.js';
export {
  arenaOf,
  createArenaContext,
  createArenaSim,
  runArena,
  spawnUnitForTest,
  startArenaBattle,
  stepArena,
  unitStats,
} from './arena-sim.js';
export type {
  ArenaContext,
  ArenaEvent,
  ArenaOptions,
  ArenaSim,
  EnteringSim,
  HealthSim,
  CoreHealthSim,
  BuildingHealthSim,
  ProducerSim,
  TurretSim,
  UnitSim,
  UnitTarget,
} from './arena-sim.js';
export {
  boxDist2,
  buildingDist2,
  buildSolid,
  cellCoord,
  fits,
  pushOutSolid,
} from './geometry.js';
export type { World } from './geometry.js';
export {
  CELL_UNITS,
  MAX_SEPARATION_CAP,
  MAX_UNIT_RADIUS,
  MAX_UNIT_REACH,
} from './limits.js';
export { renderArenaAscii } from './arena-render.js';
export { previewEnemyPaths } from './enemy-paths.js';
export type { EnemyPath } from './enemy-paths.js';
export { makeEnemyPathsKind } from './enemy-paths-kind.js';
export { makeArenaSimKind, summarizeArena } from './arena-sim-kind.js';
export { pickWeightedIndex } from './weighted.js';
export { loadEconomy, loadEconomyOrThrow } from './economy.js';
export type {
  EconomyConfig,
  EconomyLoadContext,
  EconomyLoadResult,
  KitEntry,
  OfferWeight,
  TierOddsRow,
} from './economy.js';
export {
  buyOffer,
  rerollOffers,
  rollOffers,
  sellFromStash,
  sellValue,
  tierOddsFor,
  tierPrice,
} from './shop.js';
export type {
  PlayerShop,
  ShopContent,
  ShopFailure,
  ShopOffer,
  ShopReason,
  ShopResult,
} from './shop.js';

// Sealed unit producers (issue #37).
export { sealedProducers } from './sealed-producers.js';

// Workshop event rules (issue #50).
export { workshopOptions, workshopPrice } from './workshop.js';
export type { WorkshopOption } from './workshop.js';

// In-battle ramp (economy buildings) and Overload (W1-7).
export { rampBonus } from './arena-sim.js';
export type { RampSim } from './arena-sim.js';
export {
  collectorHundredthsPerSecond,
  collectorRatePer1000,
  scaledInterval,
} from './flow-sim.js';
export {
  cappedBonus,
  isOverloadBeat,
  overloadDeadline,
  overloadLevel,
  overloadOutcome,
  type OverloadDeadline,
  type OverloadOutcome,
} from './ramp.js';

// The neutral zone and whole battles (W1-8).
export {
  NEUTRAL_ZONE_STREAM,
  generateNeutralZone,
  generateNeutralZoneWithStats,
  makeNeutralZoneKind,
  neutralZoneProblem,
  renderNeutralZoneAscii,
  zoneBlockedCells,
} from './neutral-zone.js';
export type {
  GeneratedNeutralZone,
  NeutralZone,
  NeutralZoneContent,
} from './neutral-zone.js';
export type { NeutralZoneConfig } from './mapgen.js';
export { simulateBattle, startBattle } from './battle.js';
export type {
  Battle,
  BattleConfig,
  BattleError,
  BattleErrorCode,
  BattleInput,
  BattleOptions,
  BattleReason,
  BattleResult,
  BattleSideSummary,
  CoreSummary,
  BattleSummary,
  SimulateBattleResult,
  StartBattleResult,
  TimelineSample,
  TimelineSide,
} from './battle.js';
export { makeBattleKind } from './battle-kind.js';

// PvE threats (W1-9).
export {
  THREAT_TYPES,
  budgetLimit,
  findArchetype,
  loadThreats,
  loadThreatsOrThrow,
  maxThreatRound,
  threatBudget,
} from './threats.js';
export type {
  ArchetypeDef,
  ArchetypeId,
  LayoutId,
  StrongholdTemplate,
  ThreatType,
  ThreatsConfig,
  ThreatsLoadContext,
  ThreatsLoadResult,
  UnitCost,
  WaveComposition,
  WaveTemplate,
} from './threats.js';
export {
  buildStronghold,
  generateThreat,
  pickArchetypes,
  scaleShare,
  threatSummary,
} from './threat-gen.js';
export type {
  ArchetypePick,
  Stronghold,
  StrongholdBuilding,
  ThreatConfigs,
  ThreatContent,
  ThreatInput,
  ThreatProfile,
  ThreatSummary,
  ThreatWave,
} from './threat-gen.js';
export { layoutStronghold } from './threat-layouts.js';
export {
  simulatePveBattle,
  startPveBattle,
  threatSideOptions,
} from './pve-battle.js';
export type {
  PveBattle,
  PveBattleInput,
  SimulatePveBattleResult,
  StartPveBattleResult,
} from './pve-battle.js';
export type { ScheduledWave, SideOptions } from './arena-sim.js';
export {
  REFERENCE_BOARDS,
  REFERENCE_SEED,
  buildReferenceBoard,
  referenceBoardScript,
} from './reference-boards.js';
export type { ReferenceBoardName, TeamScript } from './reference-boards.js';
export { makePveBattleKind, makeThreatGenKind } from './threat-kind.js';

// Events and run modifiers (W2-3).
export {
  findEvent,
  findModifier,
  loadEvents,
  loadEventsOrThrow,
} from './events.js';
export type {
  EventDef,
  EventParams,
  EventsConfig,
  EventsLoadResult,
  ModifierDef,
} from './events.js';
export {
  MAX_MODIFIER_PERCENT,
  MODIFIER_EFFECT_KINDS,
  MODIFIER_ID,
  MODIFIER_TARGETS,
  heldModifierIds,
  modifierPercent,
  parseModifierEffect,
  parseTeamModifiers,
  withModifier,
} from './modifiers.js';
export type {
  HasModifiers,
  ModifierEffect,
  ModifierEffectKind,
  ModifierTarget,
  TeamModifier,
} from './modifiers.js';
export { raiseTier } from './team-state.js';
export type { RaiseTierReason } from './team-state.js';
export type { RewardsConfig } from './economy.js';

// Reference boards, including the siege board (W1-10).
export {
  ALL_REFERENCE_BOARDS,
  anyReferenceBoardScript,
  buildAnyReferenceBoard,
} from './reference-boards-siege.js';
export type { AnyReferenceBoardName } from './reference-boards-siege.js';

// Ghost snapshots (W3-1).
export {
  GHOST_MAX_ID_LENGTH,
  GHOST_MAX_LABEL_LENGTH,
  GHOST_SNAPSHOT_FORMAT_VERSION,
  GHOST_MAX_BYTES_MARGIN,
  GHOST_MAX_ROUND,
  GHOST_MAX_ERRORS,
  GHOST_MAX_DEPTH,
  GHOST_MAX_STRING_LENGTH,
  ghostMaxSerializedSize,
  ghostTierBound,
  checkGhostSnapshotShape,
  compareGhosts,
  ghostBucketKey,
  ghostBucketOf,
  ghostKey,
  ghostValueBound,
  teamBuildingValue,
  validateGhostSnapshot,
} from './ghost-snapshot.js';
export type {
  GhostBucket,
  GhostOwner,
  GhostPvpRecord,
  GhostSnapshot,
  GhostValidationContext,
  GhostSizeContext,
  GhostValidationResult,
  GhostTierBound,
  GhostValueBound,
} from './ghost-snapshot.js';
