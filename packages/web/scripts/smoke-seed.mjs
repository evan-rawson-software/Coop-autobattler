// Prints one real save record (JSON) for the browser smoke: a party of two,
// played by the rush bot with the real rules up to the PvE choice of round 7,
// alive. The bundled ghosts stop at PvP round 6, so the browser itself reads
// an empty bucket when it selects that round's opponent. The bot met the boss
// in its own earlier PvP rounds (no ghost candidates are given to it).
// Generated at smoke time so it never goes stale on a format change.
//
// Run from the repository root: pnpm exec tsx packages/web/scripts/smoke-seed.mjs
import { buildSaveRecord, createGameDeps, playBotRun } from '@game/session';
import { loadSimContext } from '../../tools/src/sim/context.ts';

// Optional arguments: strategy, seed, party size, run id. The defaults give the
// party that beats the boss (`rush 2 2`); `siege 10 2` gives one that loses to
// it (both found by playing the bot on, nothing edited; the seeds changed when
// the Brood boss joined the draw from round 3, issue #398, and `siege 4 2`
// became `siege 10 2` when Market day joined the event pool, issue #410, and
// `siege 12 2` when Drill did, issue #411, and `siege 10 2` again when the
// Pact did, issue #413; searched over seeds 1 to 30, the first that is alive at
// 5 lives in round 7 and loses 1 life to the boss).
const [
  STRATEGY = 'rush',
  SEED_ARG = '2',
  PARTY_ARG = '2',
  RUN_ID = 'smoke-no-ghost-boss',
] = process.argv.slice(2);
const SEED = Number(SEED_ARG);
const PLAYERS = ['You', 'Player 2'].slice(0, Number(PARTY_ARG));
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
  runId: RUN_ID,
  runVersion: '1.0',
  seed: SEED,
  players: PLAYERS,
  host: 0,
};
// The bot stops once the round counter passes 6: the first step of round 7.
const { state } = playBotRun(deps, createArgs, {
  strategy: STRATEGY,
  seed: SEED,
  rerollCost: ctx.economy.rerollCost,
  maxRounds: 6,
});
if (state.round < 7 || state.lives <= 0 || state.step !== 'pve_choice') {
  throw new Error(
    `smoke seed: wanted round >= 7, alive, at pve_choice; got round ${String(state.round)}, lives ${String(state.lives)}, step ${state.step}`,
  );
}
process.stdout.write(
  JSON.stringify(buildSaveRecord(createArgs, state, '1.0.0', Date.now())),
);
