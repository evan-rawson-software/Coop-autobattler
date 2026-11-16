// Prints one real save record (JSON) for the browser smoke: a party of two in
// the event step of round 3 whose picked event is a Blueprint, at its
// follow-up, nothing chosen yet. The state before the event is made by
// the real bot; the offer is forced (Blueprint is only one of the events the
// step may draw) and voted for through the real rules, so the follow-up and
// the team are exactly what the game would hold. Generated at smoke time so
// it never goes stale on a format change.
//
// Run from the repository root: pnpm exec tsx packages/web/scripts/smoke-blueprint-seed.mjs
import {
  applyIntent,
  buildSaveRecord,
  createGameDeps,
  playBotRun,
  validateRunState,
} from '@game/session';
import { loadSimContext } from '../../tools/src/sim/context.ts';

const ctx = loadSimContext();
const deps = createGameDeps(
  ctx.content,
  {
    mapgen: ctx.mapgen,
    economy: ctx.economy,
    events: ctx.events,
    threats: ctx.threats,
    sim: ctx.sim,
  },
  { ghosts: { ownerId: 'smoke-bot', ownerLabel: 'Smoke bot' } },
);
const createArgs = {
  runId: 'smoke-blueprint',
  runVersion: '1.0',
  seed: 3,
  players: ['You', 'Player 2'],
  host: 0,
};
// Two rounds played: the bot stops at the first step of round 3 (PvE choice).
const { state } = playBotRun(deps, createArgs, {
  strategy: 'rush',
  seed: 3,
  rerollCost: ctx.economy.rerollCost,
  maxRounds: 2,
});
if (state.round !== 3 || state.step !== 'pve_choice') {
  throw new Error(
    `smoke blueprint seed: wanted round 3 at pve_choice, got round ${String(state.round)} ${state.step}`,
  );
}
// The event step of round 3 with a forced Blueprint, then every player votes.
let s = {
  ...state,
  step: 'event_choice',
  votes: { topic: 'event', choices: state.players.map(() => null) },
  upcomingPve: null,
  // Enough gold to buy the held building and re-roll (the bot may be poor).
  perPlayer: state.perPlayer.map((p) => ({ ...p, gold: Math.max(p.gold, 40) })),
  pending: {
    options: [
      {
        id: 'evt_blueprint',
        event: 'evt_blueprint',
        type: 'blueprint',
        blueprints: [
          ['bld_refinery_ab', 'bld_spire', 'bld_crossover'],
          ['bld_golem_forge', 'bld_refinery_bc', 'bld_wall_i'],
        ],
      },
      { id: 'evt_windfall', event: 'evt_windfall', type: 'windfall', gold: 4 },
    ],
  },
};
for (let p = 0; p < s.players.length; p++) {
  const r = applyIntent(s, p, { type: 'vote', choice: 'evt_blueprint' }, deps);
  if (!r.ok) throw new Error(`smoke blueprint seed: vote refused: ${r.reason}`);
  s = r.state;
}
if (s.step !== 'event_resolve') {
  throw new Error(`smoke blueprint seed: wanted event_resolve, got ${s.step}`);
}
const valid = validateRunState(JSON.parse(JSON.stringify(s)), deps);
if (!valid.ok) {
  throw new Error(
    `smoke blueprint seed: invalid state: ${valid.errors.join('; ')}`,
  );
}
process.stdout.write(
  JSON.stringify(buildSaveRecord(createArgs, s, '1.0.0', Date.now())),
);
