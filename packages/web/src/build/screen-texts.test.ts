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
  [
    'battleGenericAttacker',
    { core: 'Core' },
    "A tie on Core health, on damage dealt to the enemy's buildings and on enemy units killed; the attacker (the party) wins.",
  ],
  [
    'battleGenericBuildingDamage',
    { core: 'Core' },
    "A tie on Core health (both Cores destroyed in the same tick with equal overkill damage, or equal Cores standing and equal shares of total health at the time limit); the side that dealt more damage to the enemy's buildings wins.",
  ],
  [
    'battleGenericCoreDestroyed',
    { core: 'Core' },
    "One side's last Core was destroyed; the other side wins.",
  ],
  [
    'battleGenericKills',
    { core: 'Core' },
    "A tie on Core health and on damage dealt to the enemy's buildings; the side that killed more enemy units wins.",
  ],
  [
    'battleGenericOverkill',
    { core: 'Core' },
    'Both sides lost their last Core in the same tick; the side whose Cores took less overkill damage wins.',
  ],
  [
    'battleGenericTimeLimit',
    { core: 'Core' },
    'Time ran out; the side with more Cores standing wins, then the side with the larger share of its total Core health left.',
  ],
  [
    'battleTieAttackerDouble',
    { core: 'Core' },
    "Both sides lost their last Core in the same tick with equal overkill damage, equal damage to the enemy's buildings and equal kills; the attacker (the party) wins.",
  ],
  [
    'battleTieAttackerTime',
    { core: 'Core' },
    "Time ran out with equal Cores standing and equal shares of total Core health, equal damage to the enemy's buildings and equal kills; the attacker (the party) wins.",
  ],
  [
    'battleTieBuildingDamageDouble',
    { core: 'Core' },
    "Both sides lost their last Core in the same tick with equal overkill damage; the side that dealt more damage to the enemy's buildings wins.",
  ],
  [
    'battleTieBuildingDamageTime',
    { core: 'Core' },
    "Time ran out with equal Cores standing and equal shares of total Core health; the side that dealt more damage to the enemy's buildings wins.",
  ],
  [
    'battleTieKillsDouble',
    { core: 'Core' },
    "Both sides lost their last Core in the same tick with equal overkill damage and equal damage to the enemy's buildings; the side that killed more enemy units wins.",
  ],
  [
    'battleTieKillsTime',
    { core: 'Core' },
    "Time ran out with equal Cores standing and equal shares of total Core health and equal damage to the enemy's buildings; the side that killed more enemy units wins.",
  ],
  [
    'battleTieOverkillTime',
    { core: 'Core' },
    'Time ran out with equal Cores standing and equal shares of total Core health; the side whose Cores took less overkill damage wins.',
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
    'Time ran out with equal Cores standing. The side with the larger share of its total Core health left wins: yours 40 / 50, theirs 30 / 60.',
  ],
  [
    'battleTimeMoreCores',
    { core: 'Core', own: '2', foe: '1' },
    'Time ran out. The side with more Cores standing wins: yours 2, theirs 1.',
  ],
  ['eventChosenDone', {}, 'has chosen'],
  ['eventChosenPending', {}, 'choosing…'],
  [
    'eventWaiting',
    { names: 'Ann, Bo' },
    'Waiting for other players: Ann, Bo. You can still change your choice.',
  ],
  [
    'problemFreeNodesMany',
    { name: 'Mill', count: '3', kinds: 'Ore, Gas' },
    'Mill in stash: 3 free nodes (Ore, Gas).',
  ],
  [
    'problemFreeNodesOne',
    { name: 'Mill', count: '3', kinds: 'Ore, Gas' },
    'Mill in stash: 3 free node (Ore, Gas).',
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
    'Mill is connected but stalled for 97% of the dry run: its output backs up unused.',
  ],
  [
    'problemStarved',
    { name: 'Mill', resource: 'Ore' },
    'Mill receives no Ore in the dry run.',
  ],
  [
    'problemStashMany',
    { count: '3' },
    '3 buildings in the stash could be placed.',
  ],
  [
    'problemStashOne',
    { count: '3' },
    '3 building in the stash could be placed.',
  ],
  ['rateOnBoard', { rate: '0.40' }, '0.40/s'],
  ['readyLock', {}, 'Ready — press Unready to make changes.'],
  ['linkActive', {}, 'carrying'],
  ['linkIdle', {}, 'idle'],
  [
    'inspectorStalled',
    { percent: '97' },
    'Backs up: stalled for 97% of the dry run, so output goes unused',
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
  [
    'sealedHint',
    {},
    'Its units cannot reach the front — open a path or add a gate.',
  ],
  [
    'statusBorderHalf',
    {},
    'Border half added: it is not connected until your neighbour draws theirs.',
  ],
  ['statusBuildingWord', {}, 'building'],
  ['statusCancelled', {}, 'Cancelled.'],
  [
    'statusChooseCore',
    {},
    'Choose where the Core goes. It cannot be moved afterwards.',
  ],
  ['statusClickHint', {}, 'Click a cell to place it. R rotates. Esc cancels.'],
  ['statusConduitAddedMany', { count: '3' }, 'Conduit added (3 cells).'],
  ['statusConduitAddedOne', { count: '3' }, 'Conduit added (3 cell).'],
  ['statusConduitDrag', {}, 'Drag or click toward an input side. Esc cancels.'],
  ['statusConduitErased', {}, 'Conduit erased.'],
  ['statusCoreFixed', {}, 'The Core cannot be moved or stashed.'],
  ['statusCoreNoInput', {}, 'The Core has no input side.'],
  ['statusCoreNoOutput', {}, 'The Core has no output side.'],
  ['statusCorePlaced', {}, 'Core placed. Build your factory from the stash.'],
  ['statusDropHint', {}, 'Drop on the board. R rotates. Esc cancels.'],
  [
    'statusEveryoneReady',
    { before: 'Build', after: 'Battle' },
    'Everyone is ready: the run moves from Build to Battle.',
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
  ['statusReadyWaiting', {}, 'Ready. Waiting for the others.'],
  [
    'statusReceiving',
    {},
    'Receiving from your neighbour: click an input side of a building. Esc cancels.',
  ],
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
    'Conduit: click a building, then its output side, then click toward an input side.',
  ],
  ['statusToolErase', {}, 'Erase conduit: click a conduit.'],
  [
    'statusToolSelect',
    {},
    'Select / move: click to select, drag a building to move it.',
  ],
  ['statusTwoBuildings', {}, 'A conduit goes between two different buildings.'],
  [
    'statusUndoRefused',
    { cause: 'Because.', history: 'History cleared.' },
    'Undo refused: Because. History cleared.',
  ],
  ['statusUndone', {}, 'Undone.'],

  ['collects', { rate: '@rate' }, 'Collects @rate / s'],
  ['coreLabel', { name: '@name' }, "@name's Core"],
  ['inspectorCollects', { rate: '@rate' }, '@rate / s'],
  ['inspectorNeeds', { rate: '@rate' }, '@rate / s at top speed'],
  ['inspectorSupplied', { gets: '@gets' }, ' · supplied (gets @gets / s)'],
  ['inspectorTopSpeed', { speed: '@speed', unit: '@unit' }, '@speed @unit / s'],
  [
    'inspectorUnderSupplied',
    { gets: '@gets' },
    ' · UNDER-SUPPLIED: gets @gets / s',
  ],
  ['linkJoined', { name: '@name', verb: '@verb' }, 'Linked with @name (@verb)'],
  [
    'linkOpen',
    { verb: '@verb' },
    'Not connected: waiting for your neighbour (@verb)',
  ],
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
    'needsTopSpeed',
    { rate: '@rate', speed: '@speed', unit: '@unit' },
    'Needs @rate / s at top speed (@speed @unit / s)',
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
  ['reasonAtCell', { text: '@text', x: '@x', y: '@y' }, '@text At (@x, @y).'],
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
    'Your next opponent could not be chosen yet: @cause It is tried again on your next action.',
  ],
  ['shotsWord', {}, 'shots'],
  ['stepsWord', {}, 'steps'],
  ['tableSupplied', {}, 'supplied'],
  ['tableUnderSupplied', {}, 'UNDER-SUPPLIED'],
  ['unitsWord', {}, 'units'],

  ['uiInspectorInput', {}, 'Input'],
  ['uiInspectorReceiving', {}, 'Receiving'],
  [
    'uiInspectorReceivingEstimate',
    { resource: 'Ore', rate: '1.5' },
    'Ore 1.5 / sec (estimate)',
  ],
  ['uiInspectorReceivingNothing', {}, 'nothing: no conduit on this input'],
  ['uiInspectorMines', {}, 'Mines'],
  ['uiInspectorMinesRate', { resource: 'Ore', rate: '2' }, 'Ore 2 / sec'],
  ['uiInspectorMinesLost', { rate: '0.5' }, ', 0.5 / sec lost (no conduit)'],
  ['uiInspectorBackedUp', {}, 'Backed up'],
  ['uiInspectorProduces', {}, 'Produces'],
  ['uiInspectorFires', {}, 'Fires'],
  ['uiInspectorSteps', {}, 'Steps'],
  [
    'uiInspectorDerived',
    {
      rate: '6',
      things: 'units',
      cost: '2',
      thing: 'unit',
      limit: ', at most 9',
    },
    '6 units / min (estimate; costs 2 per unit, at most 9)',
  ],
  ['uiInspectorDerivedAtMost', { max: '9' }, ', at most 9'],
  ['uiUnitWord', {}, 'unit'],
  ['uiShotWord', {}, 'shot'],
  ['uiStepWord', {}, 'step'],
  ['uiStashEmpty', {}, 'Empty. Everything you own is on the board.'],
  ['uiInspectorHint', {}, 'Click a building or a conduit to inspect it.'],
  ['uiInspectorCoreFixed', {}, 'The Core cannot be moved.'],
  ['uiInspectorCarriesUnknown', {}, 'Not determined yet'],
  ['uiInspectorSealed', { hint: 'Hint.' }, 'Walled in. Hint.'],
  ['uiDryRunRegion', {}, 'Dry run'],
  ['uiDryRunTitle', { ticks: '600', secs: '10' }, 'Dry run · 600 ticks (10 s)'],
  ['uiDryRunClose', {}, 'Close dry run'],
  ['uiDryRunSource', {}, 'Source'],
  ['uiDryRunResource', {}, 'Resource'],
  ['uiDryRunProduced', {}, 'Produced'],
  ['uiDryRunLost', {}, 'Lost'],
  ['uiDryRunRate', {}, 'Rate / s'],
  ['uiDryRunNoSources', {}, 'No sources placed.'],
  ['uiDryRunConsumer', {}, 'Consumer'],
  ['uiDryRunDelivered', {}, 'Delivered'],
  ['uiDryRunPerSec', {}, 'Per sec'],
  ['uiDryRunNeed', {}, 'Need / s (all inputs)'],
  ['uiDryRunSupply', {}, 'Supply (all inputs)'],
  ['uiDryRunNoConsumers', {}, 'No consumers placed.'],
  ['uiLinksTitle', {}, 'Border links'],
  [
    'uiLinksEmpty',
    {},
    'No border links yet. Draw a conduit to a border cell of your area.',
  ],
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
  [
    'uiShopNoSuchOffer',
    {},
    'That offer is gone (already bought or re-rolled).',
  ],
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
  [
    'uiCoreClick',
    { count: '@count' },
    'Click a green-dotted cell in your own area to place the Core (its lowest-left cell). Your starting kit then appears in the stash. @count legal positions.',
  ],
  [
    'uiCoreEveryone',
    {},
    'Every player places their own Core in their own area. Choosing a position confirms it.',
  ],
  ['uiCoreTitle', {}, 'Core placement'],
  [
    'uiInspectorMeta',
    { kind: '@kind', tier: '@tier', owner: '@owner' },
    '@kind · tier @tier · bought by @owner',
  ],
  ['uiLblBorderLink', {}, 'Border link'],
  ['uiLblCarries', {}, 'Carries'],
  ['uiLblCollects', {}, 'Collects'],
  ['uiLblConduits', {}, 'Conduits'],
  ['uiLblErase', {}, 'Erase'],
  ['uiLblHealth', {}, 'Health'],
  ['uiLblLength', {}, 'Length'],
  ['uiLblNeeds', {}, 'Needs'],
  ['uiLblTopSpeed', {}, 'Top speed'],
  ['uiNoProblems', {}, '✓ No problems'],
  ['uiOverlayDry', { secs: '@secs' }, 'Dry run @secss'],
  ['uiOverlayDryTicks', {}, 'Dry run ticks'],
  ['uiOverlayFlow', {}, 'Resource flow'],
  ['uiOverlayPaths', {}, 'Enemy paths'],
  ['uiOverlayTicksPerSecond', { ticks: '@ticks' }, '@ticks ticks = 1 s'],
  ['uiPanelOverlays', {}, 'Overlays'],
  ['uiPanelParty', {}, 'Party'],
  ['uiPanelPartySolo', {}, 'Party · solo'],
  ['uiPanelProblems', {}, 'Problems'],
  ['uiPanelSelected', {}, 'Selected'],
  ['uiPanelStash', {}, 'Stash · drag onto the board'],
  ['uiPanelTools', {}, 'Tools'],
  [
    'uiPartyNext',
    { leg: '@leg', ready: '@ready', total: '@total' },
    'Next: @leg · @ready of @total ready',
  ],
  ['uiPartyReady', {}, 'Ready'],
  ['uiPartyUnready', {}, 'Unready'],
  ['uiShopNextUnknown', {}, 'Nothing is known about the next battle.'],
  ['uiShopReadyHint', {}, 'Ready when you are done shopping and building.'],
  ['uiShopSoldOut', {}, 'Sold out. Re-roll for new offers.'],
  ['uiStartingRun', {}, 'Starting a run.'],
  ['uiToolConduit', {}, 'Conduit · free'],
  ['uiToolErase', {}, 'Erase conduit'],
  ['uiToolRedo', {}, 'Redo'],
  ['uiToolRedoTip', {}, 'Redo (Ctrl+Shift+Z)'],
  ['uiToolReturnToStash', {}, 'Return to stash'],
  ['uiToolRotate', {}, 'Rotate'],
  ['uiToolRotateKey', {}, 'Rotate (R)'],
  [
    'uiToolRotateTip',
    {},
    "Rotate (R). Rotating detaches the building's conduits.",
  ],
  ['uiToolSelect', {}, 'Select / move'],
  ['uiToolToStash', {}, 'To stash'],
  ['uiToolUndo', {}, 'Undo'],
  ['uiToolUndoTip', {}, 'Undo (Ctrl+Z). Layout changes only.'],
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
  ['battleKindPve', {}, 'PvE threat'],
  ['battleOverloadKey', {}, 'O: Overload begins'],
  ['battleOverloadBegins', {}, 'Overload begins'],
  ['battleZoneRevealed', {}, 'Neutral zone revealed'],
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
    '@cores standing: yours @own, theirs @foe. @fell',
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
    '@reason Battle time @time. Your @core @own, theirs @foe.',
  ],
  [
    'battleSummaryTiebreak',
    {
      ownbuild: '@ownbuild',
      foebuild: '@foebuild',
      ownkills: '@ownkills',
      foekills: '@foekills',
    },
    'Damage to buildings: yours @ownbuild, theirs @foebuild. Units killed: yours @ownkills, theirs @foekills.',
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
  [
    'battleNeutralZoneHidden',
    {},
    'Neutral zone (hidden until the battle begins)',
  ],
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
  ['battleReadyNote', {}, 'Ready continues the run.'],
  ['battleReadyYou', {}, 'You are ready.'],
  ['uiCameraPanel', {}, 'Camera'],
  ['uiCameraCenter', {}, 'Center'],
  ['uiCameraMyBase', {}, 'My base'],
  ['uiCameraTheirBase', {}, 'Their base'],
  ['uiCameraFitBattle', {}, 'Fit battle'],
  ['uiCameraFit', {}, 'Fit'],
  ['uiCameraHint', {}, 'Drag to pan · scroll to zoom.'],
  [
    'overloadStronghold',
    { at: '@at', when: '@when' },
    "Overload at @at would destroy the stronghold's Core first at @when — outlasting it wins.",
  ],
  [
    'overloadYours',
    { at: '@at', when: '@when' },
    'Overload at @at would destroy your Core first at @when — break the stronghold before then.',
  ],
  [
    'overloadBoth',
    { at: '@at', when: '@when' },
    'Overload at @at would destroy both Cores at @when — win before then, or the tiebreak decides.',
  ],
  [
    'overloadNeither',
    { at: '@at' },
    'Overload at @at would not destroy either Core before the time limit — the battle can run to the limit.',
  ],
  ['uiShopNeeds', { needs: 'Ore' }, 'Needs: Ore'],
  ['rateGetsNeeds', { gets: '0.25', needs: '0.50' }, '0.25/0.50/s'],
  ['runOverTitle', {}, 'Run over'],
  ['runOverReached', { round: '4' }, 'Reached round 4'],
  ['runOverReasonAbandoned', {}, 'You abandoned this run.'],
  [
    'runOverReasonParty',
    {},
    "Your party's last life was lost in a PvP battle.",
  ],
  ['runOverReasonSolo', {}, 'Your last life was lost in a PvP battle.'],
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
  ['runOverWon', {}, 'won'],
  ['runOverLost', {}, 'lost'],
  ['runOverPveRow', { difficulty: 'Hard', name: 'Rusher' }, 'Hard · Rusher'],
  [
    'runOverGhostBundled',
    { label: 'Bundled 1' },
    'Ghost · Bundled 1 (bundled)',
  ],
  ['runOverGhost', { label: 'Kai' }, 'Ghost · Kai'],
  ['runOverTally', { won: '2', lost: '1' }, '2 won · 1 lost'],
  [
    'runOverByDifficultyCounts',
    { easy: '2', medium: '0', hard: '1' },
    'easy 2 · medium 0 · hard 1',
  ],
  ['runOverPanelThisRun', {}, 'This run'],
  ['runOverStatPvp', {}, 'PvP battles'],
  ['runOverStatGhosts', {}, 'vs. ghosts'],
  ['runOverStatBosses', {}, 'vs. bosses'],
  ['runOverStatPve', {}, 'PvE battles'],
  ['runOverStatByDifficulty', {}, 'by difficulty'],
  ['runOverStatLivesLost', {}, 'Lives lost'],
  ['runOverStatVersion', {}, 'Version'],
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
  ['runOverColPve', {}, 'PvE'],
  ['runOverColPvp', {}, 'PvP opponent'],
  ['runOverNewRun', {}, 'New run'],
  ['runOverMainMenu', {}, 'Main menu'],
  [
    'runOverNote',
    {},
    'The run leaves your saved runs. Its depth is kept in your records. Nothing else carries over to the next run.',
  ],
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
