import { addToStash } from '@game/core';
import { describe, expect, test } from 'vitest';
import { content } from '../content.js';
import { BuildController } from './build-controller.js';
import { proposePath } from './autoroute.js';
import { buildRun, firstFit, stashIds } from './test-helpers.js';
import { screenText, screenTexts } from './texts.js';
import { buildingName } from './view-model.js';

// Every status, battle, lock and problem text, filled with sample values and
// pinned to its exact string, so a swapped or reworded key fails (issues #57
// and #142).
const TABLE: readonly (readonly [string, Record<string, string>, string])[] = [
  [
    'battleCannotShow',
    { reason: 'odd_reason' },
    'The battle cannot be shown (odd_reason).',
  ],
  ['battleFailNoReplay', {}, 'This game cannot play battles back.'],
  [
    'battleFailNoStoredBattle',
    {},
    'The battle of this run was not stored, so it cannot be shown.',
  ],
  [
    'battleFailTeamChanged',
    {},
    'The factory changed since the battle, so it cannot be shown again.',
  ],
  ['battleFailWrongStep', {}, 'There is no battle to show in this step.'],
  ['battleGenericAttacker', { core: 'Core' }, 'Full tie: you win.'],
  [
    'battleGenericBuildingDamage',
    { core: 'Core' },
    'Tie: more damage to buildings wins.',
  ],
  ['battleGenericCoreDestroyed', { core: 'Core' }, 'Last Core destroyed.'],
  [
    'battleGenericCoreDestroyedYours',
    { core: 'Core' },
    'Your Core was destroyed.',
  ],
  [
    'battleGenericCoreDestroyedTheirs',
    { core: 'Core' },
    'Their Core was destroyed.',
  ],
  ['battleGenericKills', { core: 'Core' }, 'Tie: more kills wins.'],
  [
    'battleGenericOverkill',
    { core: 'Core' },
    'Both Cores fell at the same moment: less overkill damage wins.',
  ],
  [
    'battleGenericTimeLimit',
    { core: 'Core' },
    'Time ran out: more Cores standing, then more Core health, wins.',
  ],
  [
    'battleTieAttackerDouble',
    { core: 'Core' },
    'Both Cores fell at the same moment and every tiebreak was even, so you win.',
  ],
  [
    'battleTieAttackerTime',
    { core: 'Core' },
    'Time ran out and every tiebreak was even, so you win.',
  ],
  [
    'battleTieBuildingDamageDouble',
    { core: 'Core' },
    'Both Cores fell at the same moment: more damage to buildings wins.',
  ],
  [
    'battleTieBuildingDamageTime',
    { core: 'Core' },
    'Time ran out with Cores even: more damage to buildings wins.',
  ],
  [
    'battleTieKillsDouble',
    { core: 'Core' },
    'Both Cores fell at the same moment, building damage even: more kills wins.',
  ],
  [
    'battleTieKillsTime',
    { core: 'Core' },
    'Time ran out with Cores and building damage even: more kills wins.',
  ],
  [
    'battleTieOverkillTime',
    { core: 'Core' },
    'Time ran out with Cores even: less overkill damage wins.',
  ],
  [
    'battleTimeLargerShare',
    {
      core: 'Core',
      ownhealth: '40',
      ownmax: '50',
      foehealth: '30',
      foemax: '60',
    },
    'Time ran out: more Core health left wins.',
  ],
  [
    'battleTimeMoreCores',
    { core: 'Core', own: '2', foe: '1' },
    'Time ran out: more Cores standing wins (2 vs 1).',
  ],
  ['eventChosenDone', {}, 'has chosen'],
  ['eventChosenPending', {}, 'choosing…'],
  ['eventWaiting', { names: 'Ann, Bo' }, 'Waiting for Ann, Bo.'],
  [
    'problemFreeNodesMany',
    { names: 'Mills', stashed: '2', count: '3' },
    'You have 2 Mills to place. Put them on a resource node (3 free).',
  ],
  [
    'problemFreeNodesOne',
    { name: 'Mill', stashed: '1', count: '3' },
    'You have 1 Mill to place. Put it on a resource node (3 free).',
  ],
  [
    'problemNoConduitAny',
    { name: 'Mill' },
    'Mill has no conduit into an input.',
  ],
  [
    'problemNoConduitResource',
    { name: 'Mill', resource: 'Ore' },
    'Mill has no conduit into its Ore input.',
  ],
  ['problemNothingFeeding', { name: 'Mill' }, 'Mill has nothing feeding it.'],
  [
    'problemStalled',
    { name: 'Mill', percent: '97' },
    'Mill is stalled 97% of the time: output backs up.',
  ],
  [
    'problemStarved',
    { name: 'Mill', resource: 'Ore' },
    'Mill receives no Ore in the dry run.',
  ],
  ['problemStashMany', { count: '3' }, '3 buildings in the stash.'],
  ['problemStashOne', { count: '3' }, '3 building in the stash.'],
  ['rateOnBoard', { rate: '0.40' }, '0.40/s'],
  ['readyLock', {}, 'Ready. Unready to make changes.'],
  ['linkActive', {}, 'carrying'],
  ['linkIdle', {}, 'idle'],
  [
    'inspectorStalled',
    { percent: '97' },
    'Stalled 97% of the time: output backs up',
  ],
  [
    'sealedBlockedMany',
    { labels: 'Barracks (column 3, row 5)', hint: 'Hint.' },
    'Ready is blocked: Barracks (column 3, row 5) are walled in. Hint.',
  ],
  [
    'sealedBlockedOne',
    { labels: 'Barracks (column 3, row 5)', hint: 'Hint.' },
    'Ready is blocked: Barracks (column 3, row 5) is walled in. Hint.',
  ],
  ['sealedHint', {}, 'Open a path or add a gate.'],
  ['statusBorderHalf', {}, 'Border link added. Waiting for your neighbour.'],
  ['statusBuildingWord', {}, 'building'],
  ['statusCancelled', {}, 'Cancelled.'],
  ['statusChooseCore', {}, "Place your Core. It can't be moved later."],
  ['statusClickHint', {}, 'R rotates · Esc cancels.'],
  ['statusConduitAddedMany', { count: '3' }, 'Conduit added (3 cells).'],
  ['statusConduitAddedOne', { count: '3' }, 'Conduit added (3 cell).'],
  ['statusConduitDrag', {}, 'Click toward an input side. Esc cancels.'],
  ['statusConduitErased', {}, 'Conduit erased.'],
  ['statusCoreFixed', {}, 'The Core cannot be moved or stashed.'],
  ['statusCoreNoInput', {}, 'The Core has no input side.'],
  ['statusCoreNoOutput', {}, 'The Core has no output side.'],
  ['statusCorePlaced', {}, 'Core placed.'],
  ['statusDropHint', {}, 'R rotates · Esc cancels.'],
  [
    'statusEveryoneReady',
    { after: 'the stronghold choice' },
    'Everyone is ready: on to the stronghold choice.',
  ],
  [
    'statusFromSide',
    { name: 'Mill', side: 'north' },
    "From Mill's north side: click an input side or a building.",
  ],
  ['statusHistoryCleared', {}, 'History cleared.'],
  ['statusHistoryKept', {}, 'History unchanged.'],
  ['statusMoveCancelled', {}, 'Move cancelled.'],
  ['statusMoved', {}, 'Moved.'],
  [
    'statusMovedDetachedMany',
    { count: '3' },
    'Moved. 3 conduits were detached.',
  ],
  ['statusMovedDetachedOne', { count: '3' }, 'Moved. 3 conduit was detached.'],
  ['statusMovingDetachesMany', { count: '3' }, 'Moving detaches 3 conduits.'],
  ['statusMovingDetachesOne', { count: '3' }, 'Moving detaches 3 conduit.'],
  ['statusNoFreeOutput', { name: 'Mill' }, 'Mill has no free output side.'],
  ['statusNoRoute', {}, 'No route.'],
  ['statusNoRouteBorder', {}, 'No route to that border spot.'],
  ['statusNoRouteCell', {}, 'No route to that cell.'],
  ['statusNoRouteSide', {}, 'No route to that side.'],
  ['statusNotReady', {}, 'Not ready.'],
  ['statusNothingRedo', {}, 'Nothing to redo.'],
  ['statusNothingUndo', {}, 'Nothing to undo in this step.'],
  ['statusPickOutput', { name: 'Mill' }, 'Mill: pick one of its output sides.'],
  ['statusPlaced', { name: 'Mill' }, 'Placed Mill.'],
  ['statusReadyToBuild', {}, 'Ready to build.'],
  ['statusReadyWaiting', {}, 'Ready.'],
  ['statusReceiving', {}, 'Click an input side. Esc cancels.'],
  [
    'statusRedoRefused',
    { cause: 'Because.', history: 'History cleared.' },
    'Redo refused: Because. History cleared.',
  ],
  ['statusRedone', {}, 'Redone.'],
  ['statusReturned', { name: 'Mill' }, 'Returned Mill to the stash.'],
  [
    'statusReturnedDetachedMany',
    { name: 'Mill', count: '3' },
    'Returned Mill to the stash. 3 conduits were detached.',
  ],
  [
    'statusReturnedDetachedOne',
    { name: 'Mill', count: '3' },
    'Returned Mill to the stash. 3 conduit was detached.',
  ],
  ['statusRotated', {}, 'Rotated.'],
  [
    'statusRotatedDetachedMany',
    { count: '3' },
    'Rotated. 3 conduits were detached.',
  ],
  [
    'statusRotatedDetachedOne',
    { count: '3' },
    'Rotated. 3 conduit was detached.',
  ],
  ['statusSelectReturn', {}, 'Select a building to return to the stash.'],
  ['statusSelectRotate', {}, 'Select a building to rotate.'],
  ['statusStarting', {}, 'Starting a run.'],
  [
    'statusToolConduit',
    {},
    "Click a building's output side, then an input side.",
  ],
  ['statusToolErase', {}, 'Click a conduit to erase it.'],
  ['statusToolSelect', {}, 'Click to select, drag to move.'],
  ['statusTwoBuildings', {}, 'A conduit goes between two different buildings.'],
  [
    'statusUndoRefused',
    { cause: 'Because.', history: 'History cleared.' },
    'Undo refused: Because. History cleared.',
  ],
  ['statusUndone', {}, 'Undone.'],

  ['collects', { rate: '@rate' }, 'Collects @rate/s'],
  ['coreLabel', { name: '@name' }, "@name's Core"],
  ['inspectorSupplied', { gets: '@gets' }, ' · supplied'],
  ['inspectorUnderSupplied', { gets: '@gets' }, ' · gets @gets/s'],
  ['linkJoined', { name: '@name', verb: '@verb' }, 'Linked with @name (@verb)'],
  ['linkOpen', { verb: '@verb' }, 'Not connected (@verb)'],
  ['linkBrokenLoop', {}, 'Link broken: it would form a loop'],
  [
    'linkBrokenMismatch',
    { building: '@building' },
    'Link broken: it would send a second resource into @building',
  ],
  ['linkBrokenMark', {}, 'Link broken'],
  ['linkBrokenSomeBuilding', {}, 'a building'],
  ['linkReceiving', {}, 'receiving'],
  [
    'linkSameKind',
    { name: '@name', verb: '@verb' },
    'Cannot join: @name is also @verb',
  ],
  ['linkSending', {}, 'sending'],
  [
    'usesRate',
    { resource: '@resource', rate: '@rate' },
    'Uses @resource @rate/s',
  ],
  [
    'partnerUnderSuppliedMany',
    { player: '@player', count: '@count' },
    '@player has @count under-supplied buildings.',
  ],
  [
    'partnerUnderSuppliedOne',
    { player: '@player' },
    '@player has 1 under-supplied building.',
  ],
  ['playerFallback', { number: '@number' }, 'Player @number'],
  [
    'problemUnderSupplied',
    { name: '@name', gets: '@gets', needs: '@needs' },
    '@name gets @gets/s of the @needs/s it needs.',
  ],
  [
    'reasonPlayerToAct',
    { text: '@text', number: '@number' },
    '@text Player @number has to pick a spot.',
  ],
  ['reasonUnknown', { reason: '@reason' }, 'Not allowed (@reason).'],
  [
    'reasonWithCause',
    { text: '@text', cause: '@cause' },
    '@text It could not be chosen yet: @cause',
  ],
  [
    'selectionNote',
    { cause: '@cause' },
    'Next opponent not chosen yet: @cause Retrying on your next action.',
  ],
  ['shotsWord', {}, 'shots'],
  ['stepsWord', {}, 'steps'],
  ['tableSupplied', {}, 'supplied'],
  ['tableUnderSupplied', {}, 'Under-supplied'],
  ['unitsWord', {}, 'units'],

  ['uiInspectorMinesLost', { rate: '0.5' }, ' · 0.5/s lost (no conduit)'],
  [
    'uiLegendFlow',
    {},
    'Moving dots: resources travelling along a conduit. Red dashed conduit: nothing flows through it. Red outline: a building that gets nothing. LOW: it gets less than it needs. Numbers on buildings (zoom in to see them): items per second.',
  ],
  [
    'uiLegendPaths',
    {},
    'Dashed line: the way enemy soldiers walk from the front edge to your Core (where several routes share a stretch, the dashes overlap and look solid). Triangle: where a route starts at the front edge. A short stub at the front edge: the route steps off the board to get around a wall. Ring and cross: the building the soldiers would attack when the way is sealed.',
  ],
  ['phaseBuild', {}, 'the build'],
  ['phaseCorePlacement', {}, 'the Core placement'],
  ['phaseEventChoice', {}, 'the event choice'],
  ['phaseEventResolve', {}, 'the event result'],
  ['phasePveBattle', {}, 'the stronghold battle'],
  ['phasePveChoice', {}, 'the stronghold choice'],
  ['phasePveSummary', {}, 'the stronghold battle results'],
  ['phasePvpBattle', {}, 'the rival party battle'],
  ['phasePvpSummary', {}, 'the rival party results'],
  ['phaseRunOver', {}, 'the end of the run'],
  ['phaseShop', {}, 'the shop'],
  ['uiInspectorBackedUp', {}, 'Backed up'],
  ['uiInspectorProduces', {}, 'Trains'],
  ['uiInspectorFires', {}, 'Fires'],
  ['uiInspectorSteps', {}, 'Steps'],
  [
    'uiInspectorDerived',
    {
      rate: '6',
      things: 'units',
      cost: '2',
      resource: 'Ore',
      limit: ', at most 9/min',
    },
    '~6 units/min (2 Ore each, at most 9/min)',
  ],
  ['uiInspectorDerivedAtMost', { max: '9' }, ', at most 9/min'],
  ['uiUnitWord', {}, 'unit'],
  ['uiShotWord', {}, 'shot'],
  ['uiStepWord', {}, 'step'],
  ['uiInspectorHint', {}, 'Nothing selected.'],
  ['uiInspectorCoreFixed', {}, 'The Core cannot be moved.'],
  ['uiInspectorCarriesUnknown', {}, 'Not determined yet'],
  ['uiInspectorSealed', { hint: 'Hint.' }, 'Walled in. Hint.'],
  ['uiDryRunRegion', {}, 'Test run'],
  ['uiDryRunTitle', { secs: '10' }, 'Test run · 10 s'],
  ['uiDryRunClose', {}, 'Close dry run'],
  ['uiDryRunSource', {}, 'Source'],
  ['uiDryRunResource', {}, 'Resource'],
  ['uiDryRunProduced', {}, 'Produced'],
  ['uiDryRunLost', {}, 'Lost'],
  ['uiDryRunRate', {}, 'Rate/s'],
  ['uiDryRunNoSources', {}, 'No sources placed.'],
  ['uiDryRunConsumer', {}, 'Consumer'],
  ['uiDryRunDelivered', {}, 'Delivered'],
  ['uiDryRunPerSec', {}, 'Per sec'],
  ['uiDryRunNeed', {}, 'Need/s'],
  ['uiDryRunSupply', {}, 'Supply'],
  ['uiDryRunNoConsumers', {}, 'No consumers placed.'],
  ['uiLinksTitle', {}, 'Border links'],
  ['uiLinksEmpty', {}, 'None.'],
  ['uiLinksCarries', { resource: 'Ore' }, ' · carries Ore'],
  ['uiLinksRemove', {}, 'Remove my half'],
  ['uiPartyEditing', {}, 'editing the board'],
  ['uiPartyReadyYes', {}, 'ready: yes'],
  ['uiPartyReadyNo', {}, 'ready: no'],
  ['uiSwitchPlayingAs', {}, 'Playing as'],
  ['uiSwitchGroup', {}, 'Acting player'],
  ['uiSwitchDone', {}, '(done)'],
  ['uiSwitchToAct', {}, '(to act)'],
  ['uiSwitchEveryoneDone', {}, 'Everyone is done.'],
  ['uiSwitchWaiting', { names: 'Ann, Bo' }, 'Waiting for: Ann, Bo'],
  ['uiSwitchAnnounce', { name: 'Ann' }, 'Now playing as Ann'],
  ['uiShopNotEnoughGold', {}, 'Not enough gold.'],
  ['uiShopNoSuchOffer', {}, 'That offer is gone.'],
  ['uiShopNotInStash', {}, 'That building is not in your stash.'],
  ['uiShopNotOwner', {}, 'That building belongs to another player.'],
  [
    'uiShopStale',
    { message: 'The run changed.' },
    'The run changed. Nothing was changed. Reload to see the saved run.',
  ],
  [
    'uiRunConflictBody',
    {},
    'This run is open in another tab. Reload to continue here. Nothing here can be changed until you do.',
  ],
  [
    'uiRunDiscardSample',
    {},
    'Discarding it starts a new sample run and cannot be undone.',
  ],
  [
    'uiRunRemoveNote',
    {},
    'Removing the save deletes it for good, with no summary and no record.',
  ],
  [
    'uiRunRemoveWarning',
    {},
    'Remove this save? It is deleted for good, with no summary and no record of the run.',
  ],
  ['uiRunConflictTitle', {}, 'This run changed in another tab'],
  [
    'uiRunUnopenableKept',
    {},
    'It has not been deleted. Closing this tab or fixing the cause may let it open.',
  ],
  ['uiRunUnopenableTitle', {}, 'The saved run cannot be opened'],
  ['uiCellsDirect', {}, ' (direct)'],
  ['uiCellsMany', { count: '@count' }, '@count cells'],
  ['uiCellsOne', { count: '@count' }, '@count cell'],
  ['uiComingSoon', {}, 'Coming soon'],
  ['uiConduitName', {}, 'Conduit'],
  ['uiCoreClick', { count: '@count' }, 'Click a green dot to place your Core.'],
  ['uiCoreTitle', {}, 'Core placement'],
  ['uiInspectorMeta', { kind: '@kind', tier: '@tier' }, '@kind · tier @tier'],
  ['uiInspectorOwnedBy', { owner: 'Sam' }, ' · owned by Sam'],
  ['uiLblBorderLink', {}, 'Border link'],
  ['uiLblCarries', {}, 'Carries'],
  ['uiLblConduits', {}, 'Conduits'],
  ['uiLblErase', {}, 'Erase'],
  ['uiLblHealth', {}, 'Health'],
  ['uiLblLength', {}, 'Length'],
  ['uiNoProblems', {}, '✓ No problems'],
  ['uiOverlayDry', { secs: '@secs' }, 'Test run @secs s'],
  ['uiOverlayDryTicks', {}, 'Test run length (ticks)'],
  [
    'uiOverlayDryTip',
    {},
    'Runs the factory for a while without a battle, to show what each building would receive and make.',
  ],
  ['uiOverlayAdvanced', {}, 'Advanced'],
  ['uiTierTip', { tier: '@tier' }, 'Tier @tier. Higher tiers are stronger.'],
  ['uiOverlayFlow', {}, 'Resource flow'],
  ['uiOverlayPaths', {}, 'Enemy paths'],
  ['uiOverlayTicksPerSecond', { ticks: '@ticks' }, '@ticks ticks = 1 s'],
  ['uiPanelOverlays', {}, 'Overlays'],
  ['uiPanelParty', {}, 'Party'],
  ['uiPanelPartySolo', {}, 'Party · solo'],
  ['uiPanelProblems', {}, 'Problems'],
  ['uiProblemsMore', { n: '2' }, '2 more below'],
  ['uiPanelSelected', {}, 'Selected'],
  ['uiPanelStash', {}, 'Stash'],
  ['uiPanelTools', {}, 'Tools'],
  [
    'uiPartyNext',
    { leg: '@leg', ready: '@ready', total: '@total' },
    'Next: @leg · @ready of @total ready',
  ],
  ['uiPartyReady', {}, 'Ready'],
  ['uiPartyUnready', {}, 'Unready'],
  ['uiShopNextUnknown', {}, 'Nothing is known about the next battle.'],
  ['uiShopSoldOut', {}, 'Sold'],
  ['uiStartingRun', {}, 'Starting a run.'],
  ['uiToolConduit', {}, 'Conduit · free'],
  [
    'uiToolConduitTip',
    {},
    'A conduit carries resources from a collector to a building.',
  ],
  ['uiToolErase', {}, 'Erase conduit'],
  ['uiToolRedo', {}, 'Redo'],
  ['uiToolRedoTip', {}, 'Redo (Ctrl+Shift+Z)'],
  ['uiToolReturnToStash', {}, 'Return to stash'],
  ['uiToolRotateKey', {}, 'Rotate (R)'],
  ['uiToolRotateTip', {}, 'Rotate (R)'],
  ['uiToolSelect', {}, 'Select / move'],
  ['uiToolUndo', {}, 'Undo'],
  ['uiToolUndoTip', {}, 'Undo (Ctrl+Z)'],
  [
    'battleCoresCount',
    { label: '@label', standing: '@standing', total: '@total' },
    '@labels @standing/@total',
  ],
  [
    'battleCoreStanding',
    { label: '@label', number: '@number' },
    '@label @number',
  ],
  [
    'battleCoreFallen',
    { label: '@label', number: '@number' },
    '@label @number (fallen)',
  ],
  ['battleKindGhost', {}, 'Ghost'],
  ['battleKindPve', {}, 'Stronghold threat'],
  ['battleOverloadKey', {}, 'O: Overload begins'],
  ['battleOverloadBegins', {}, 'Overload begins'],
  ['battleZoneRevealed', {}, 'Battle starts'],
  ['battleSideYour', {}, 'Your'],
  ['battleSideTheir', {}, 'Their'],
  ['battleSideEnemy', {}, 'Enemy'],
  ['battleSideStronghold', {}, 'Stronghold'],
  [
    'battleLogCoreFell',
    { who: '@who', core: '@core', number: '@number' },
    '@who @core @number fell',
  ],
  [
    'battleLogCoreDestroyed',
    { who: '@who', core: '@core' },
    '@who @core destroyed',
  ],
  [
    'battleSummaryCoresStanding',
    { core: '@core', own: '@own', foe: '@foe', fell: '@fell' },
    '@cores standing: You @own, Them @foe. @fell',
  ],
  [
    'battleSummaryCoreFell',
    { who: '@who', core: '@core', number: '@number', time: '@time' },
    '@who @core @number fell at @time.',
  ],
  [
    'battleSummaryDetail',
    {
      reason: '@reason',
      time: '@time',
      core: '@core',
      own: '@own',
      foe: '@foe',
    },
    '@reason Time @time · @core health: You @own, Them @foe.',
  ],
  [
    'battleSummaryTiebreak',
    {
      ownbuild: '@ownbuild',
      foebuild: '@foebuild',
      ownkills: '@ownkills',
      foekills: '@foekills',
    },
    'Damage dealt to buildings: You @ownbuild, Them @foebuild. Kills: You @ownkills, Them @foekills.',
  ],
  ['battleVictory', {}, 'Victory'],
  ['battleDefeat', {}, 'Defeat'],
  ['battleVsOpponent', { name: '@name' }, ' · vs. @name'],
  [
    'battleMismatch',
    { result: '@result' },
    'This battle was fought under different rules and cannot be replayed. Result: @result, ',
  ],
  ['battleNeutralZone', {}, 'Neutral zone'],
  ['battleNeutralZoneHidden', {}, 'Neutral zone (hidden)'],
  ['battleIntro', {}, 'The battle is about to begin…'],
  ['battlePanelYourSide', {}, 'Your side'],
  ['battlePanelProduction', {}, 'Production (per sec)'],
  ['battleColYou', {}, 'You'],
  ['battleColThem', {}, 'Them'],
  ['battleRowUnitsAlive', {}, 'Units alive'],
  ['battleRowUnitsLost', {}, 'Units lost'],
  ['battlePanelStrength', {}, 'Army strength'],
  ['battlePanelLog', {}, 'Battle log'],
  ['battleLogEmpty', {}, 'Nothing yet.'],
  ['battlePanelSpeed', {}, 'Speed'],
  ['battleSkip', {}, 'Skip'],
  ['battlePlay', {}, 'Play'],
  ['battlePause', {}, 'Pause'],
  ['battleWallsNone', { walls: '@walls' }, 'No @walls'],
  [
    'battleWallsStanding',
    { walls: '@walls', standing: '@standing', total: '@total' },
    '@walls: @standing / @total standing',
  ],
  ['battleRampSteps', { count: '@count' }, '▲ ramp steps taken: @count'],
  ['battlePanelSummaryChart', {}, 'Army strength over time'],
  [
    'battleSummaryDoubleFallWin',
    { core: '@core', time: '@time' },
    'Draw: both @cores fell at @time. You win the tiebreak.',
  ],
  [
    'battleSummaryDoubleFallLoss',
    { core: '@core', time: '@time' },
    'Draw: both @cores fell at @time. They win the tiebreak.',
  ],
  ['battlePanelBreachesWon', {}, 'Where they got through'],
  ['battlePanelBreaches', {}, 'Where you were breached'],
  ['battleNoBreach', {}, 'Nothing of yours was destroyed.'],
  ['battlePanelBuildings', {}, 'Your buildings'],
  ['battleColBuilding', {}, 'Building'],
  ['battleColProduced', {}, 'Produced'],
  ['battleColReceived', {}, 'Received'],
  ['battleColUnits', {}, 'Units'],
  ['battleColDamage', {}, 'Damage'],
  ['battleColUpgrades', {}, 'Upgrades'],
  ['battleColLost', {}, 'Lost'],
  ['battleCountSuffix', { count: '@count' }, ' ×@count'],
  ['battleLostOf', { lost: '@lost', count: '@count' }, '@lost of @count'],
  [
    'battleLostOfFirst',
    { lost: '@lost', count: '@count', time: '@time' },
    '@lost of @count (first @time)',
  ],
  ['battlePanelNext', {}, 'Next'],
  ['battleWatchAgain', {}, 'Watch again'],
  ['battleReady', {}, 'Ready'],
  ['battleReadyDone', {}, 'Ready ✓'],
  ['battleContinue', {}, 'Continue'],
  ['battleContinueEvent', {}, 'Continue (choose a reward)'],
  ['battleNoBuildings', {}, 'You had no buildings on the board.'],
  ['battleStrengthUnit', {}, 'Total health of all units'],
  ['choiceSubtitle', {}, 'Pick an opponent for this round'],
  ['choiceFight', {}, 'Fight'],
  ['eventSubtitle', {}, 'Choose one'],
  ['eventChoose', {}, 'Choose'],
  ['uiCameraPanel', {}, 'Camera'],
  ['uiCameraCenter', {}, 'Center'],
  ['uiCameraMyBase', {}, 'My base'],
  ['uiCameraTheirBase', {}, 'Their base'],
  ['uiCameraFitBattle', {}, 'Fit battle'],
  ['uiCameraFit', {}, 'Fit'],
  [
    'overloadStronghold',
    { at: '@at', when: '@when' },
    'At @at both Cores start losing health (Overload). Theirs falls first, at @when.',
  ],
  [
    'overloadYours',
    { at: '@at', when: '@when' },
    'At @at both Cores start losing health (Overload). Yours falls first, at @when.',
  ],
  [
    'overloadBoth',
    { at: '@at', when: '@when' },
    'At @at both Cores start losing health (Overload). Both fall at @when.',
  ],
  [
    'overloadNeither',
    { at: '@at' },
    'At @at both Cores start losing health (Overload). Neither falls before the time limit.',
  ],
  ['uiShopUses', { needs: 'Ore' }, 'Uses: Ore'],
  ['uiShopHealth', { health: '60' }, 'Health 60'],
  ['rateGetsNeeds', { gets: '0.25', needs: '0.50' }, '0.25/0.50/s'],
  ['runOverTitle', {}, 'Run over'],
  ['runOverReached', { round: '4' }, 'Reached round 4'],
  ['runOverReasonAbandoned', {}, 'You abandoned this run.'],
  [
    'runOverReasonParty',
    {},
    "Your party's last life was lost in a battle against a rival party.",
  ],
  [
    'runOverReasonSolo',
    {},
    'Your last life was lost in a battle against a rival party.',
  ],
  ['runOverPlayersOne', { count: '1' }, '1 player'],
  ['runOverPlayersMany', { count: '3' }, '3 players'],
  [
    'runOverBestFirst',
    { label: '2 players' },
    'First recorded run for 2 players',
  ],
  [
    'runOverBestNew',
    { label: '1 player', round: '3' },
    'New best for 1 player (was round 3)',
  ],
  [
    'runOverBestKept',
    { label: '1 player', round: '3' },
    'Best for 1 player: round 3',
  ],
  ['runOverNone', {}, '—'],
  ['runOverWon', {}, 'W'],
  ['runOverLost', {}, 'L'],
  ['runOverWonTip', {}, 'Won'],
  ['runOverLostTip', {}, 'Lost'],
  ['runOverPveRow', { difficulty: 'Hard', name: 'Rusher' }, 'Hard · Rusher'],
  ['runOverTally', { won: '2', lost: '1' }, '2 won · 1 lost'],
  [
    'runOverByDifficultyCounts',
    { easy: '2', medium: '0', hard: '1' },
    'easy 2 · medium 0 · hard 1',
  ],
  ['runOverPanelThisRun', {}, 'This run'],
  ['runOverStatPvp', {}, 'Rival party battles'],
  ['runOverStatGhosts', {}, 'vs. rival parties'],
  ['runOverStatBosses', {}, 'vs. the boss'],
  ['runOverStatPve', {}, 'Stronghold battles'],
  ['runOverStatByDifficulty', {}, 'by difficulty'],
  ['runOverStatLivesLost', {}, 'Lives lost'],
  ['runOverPanelFactory', {}, 'Final factory'],
  [
    'runOverFactoryCountsOne',
    { count: '1', tier: '0', stash: '2' },
    '1 building placed · 0 at tier 3 · 2 in stash',
  ],
  [
    'runOverFactoryCountsMany',
    { count: '5', tier: '2', stash: '0' },
    '5 buildings placed · 2 at tier 3 · 0 in stash',
  ],
  ['runOverPanelRounds', {}, 'Round by round'],
  ['runOverNoBattle', {}, 'No battle was fought.'],
  ['runOverColRound', {}, '#'],
  ['runOverColPve', {}, 'Stronghold'],
  ['runOverColPvp', {}, 'Rival party'],
  ['runOverNewRun', {}, 'New run'],
  ['runOverMainMenu', {}, 'Main menu'],
  ['runOverBackToMenu', {}, 'Back to menu'],
];

/** The reason_* keys are pinned code by code in texts.test.ts. */
const PINNED_ELSEWHERE = (key: string): boolean => key.startsWith('reason_');

describe('screen texts are pinned key by key', () => {
  test.each(TABLE)('%s', (key, values, expected) => {
    expect(screenText(screenTexts, key, values)).toBe(expected);
  });

  test('the table covers every such key of the file', () => {
    const inFile = Object.keys(screenTexts).filter((k) => !PINNED_ELSEWHERE(k));
    expect(TABLE.map(([k]) => k).sort()).toEqual(inFile.sort());
  });
});

describe('the controller picks One for 1 and Many otherwise', () => {
  async function returned(
    pick: 'bld_extractor' | 'bld_splitter',
  ): Promise<string> {
    const s = await buildRun();
    const team = s.run.team;
    const need = content.buildings.get('bld_barracks')?.inputs[0]?.resource;
    const node = team.map.nodes.find((n) => n.resource === need);
    if (node === undefined) throw new Error('no node');
    const ex = stashIds(team, 'bld_extractor')[0] as number;
    // The starting stash has no splitter: give the team one.
    const added = addToStash(team, content, {
      def: 'bld_splitter',
      tier: 1,
      owner: 0,
    });
    if (!added.ok) throw new Error(added.reason);
    Object.assign(team, added.state);
    const sp = added.id;
    const bk = stashIds(team, 'bld_barracks')[0] as number;
    const place = async (id: number, x: number, y: number): Promise<void> => {
      expect(await s.act({ t: 'place', id, x, y, rotation: 0 })).toEqual({
        ok: true,
      });
    };
    await place(ex, node.x, node.y);
    const spot = firstFit(
      s.run.team,
      sp,
      0,
      (c) => c.y < node.y + 3 || Math.abs(c.x - node.x) > 4,
    );
    await place(sp, spot.x, spot.y);
    const spot2 = firstFit(
      s.run.team,
      bk,
      0,
      (c) => c.y < spot.y + 3 || Math.abs(c.x - spot.x) > 4,
    );
    await place(bk, spot2.x, spot2.y);
    const link = async (
      from: { building: number; side: 'north' | 'south' },
      to: { building: number; side: 'north' | 'south' },
    ): Promise<void> => {
      const cells = proposePath(s.run.team, content, from, to, [], 0);
      expect(cells).not.toBeNull();
      expect(
        await s.act({ t: 'add', from, to, cells: cells as never }),
      ).toEqual({ ok: true });
    };
    await link(
      { building: ex, side: 'north' },
      { building: sp, side: 'south' },
    );
    await link(
      { building: sp, side: 'north' },
      { building: bk, side: 'south' },
    );
    const ctl = new BuildController();
    ctl.attach(s);
    const id = pick === 'bld_extractor' ? ex : sp;
    ctl.select({ kind: 'building', id });
    await ctl.returnSelected();
    return ctl.model.get().ui.status.text;
  }

  test('one detached conduit uses the singular text', async () => {
    const name = buildingName(content, 'bld_extractor');
    expect(await returned('bld_extractor')).toBe(
      `Returned ${name} to the stash. 1 conduit was detached.`,
    );
  });

  test('two detached conduits use the plural text', async () => {
    const name = buildingName(content, 'bld_splitter');
    expect(await returned('bld_splitter')).toBe(
      `Returned ${name} to the stash. 2 conduits were detached.`,
    );
  });
});
