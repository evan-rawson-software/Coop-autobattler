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
  ['readyLock', {}, 'Ready — press Unready to make changes.'],
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
];

const OWNED =
  /^(status|battle|sealed|readyLock|problemNothing|problemNoConduit|problemStarved|problemFreeNodes|problemStash|eventWaiting)/;

describe('screen texts are pinned key by key', () => {
  test.each(TABLE)('%s', (key, values, expected) => {
    expect(screenText(screenTexts, key, values)).toBe(expected);
  });

  test('the table covers every such key of the file', () => {
    const inFile = Object.keys(screenTexts).filter((k) => OWNED.test(k));
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
