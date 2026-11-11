export { add } from './add.js';
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
export { loadUnits, loadUnitsOrThrow } from './units.js';
export type {
  Targeting,
  UnitConfig,
  UnitDef,
  UnitId,
  UnitLoadResult,
} from './units.js';
export {
  loadBuildings,
  loadBuildingsOrThrow,
  oppositeSide,
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
export { loadPresentation, loadPresentationOrThrow } from './presentation.js';
export type {
  PresentationConfig,
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
  divFloor,
  maxInt,
  minInt,
  modFloor,
  mulBps,
  mulDiv,
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
export { placeholderDuel, type SimulationOutput } from './placeholder-duel.js';
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
  detachConduits,
  eraseConduit,
  moveBuilding,
  occupancy,
  placeCore,
  placeFromStash,
  removeFromStash,
  renderTeamStateAscii,
  returnToStash,
  validateTeamState,
} from './team-state.js';
export type {
  AddToStashResult,
  AnyReason,
  Conduit,
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
  SIDE_ORDER,
  addConduit,
  buildFlowGraph,
  conduitResource,
} from './conduits.js';
export type {
  AddConduitResult,
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
  ConsumerSim,
  DryRunConsumerInput,
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
  TARGETINGS,
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
  HealthSim,
  ProducerSim,
  TurretSim,
  UnitSim,
  UnitTarget,
} from './arena-sim.js';
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

// In-battle ramp (economy buildings) and Overload (W1-7).
export { rampBonus } from './arena-sim.js';
export type { RampSim } from './arena-sim.js';
export { scaledInterval } from './flow-sim.js';
export { cappedBonus, isOverloadBeat, overloadLevel } from './ramp.js';

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
