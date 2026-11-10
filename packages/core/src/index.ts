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
