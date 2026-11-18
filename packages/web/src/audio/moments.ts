/**
 * Which cue a run moment plays (#449, docs/specs/08-audio.md, the interface,
 * build, shop and run tables). The mapping is pure: it reads the intent that
 * was sent, the answer of the run controller and the run before it, and
 * names cues. `soundForDispatch` is the one thin call the session makes; it
 * only plays, never reads back, and never throws, so audio cannot affect
 * the run.
 *
 * Sounds play on the result, not on the click: a refused intent plays an
 * error cue, an accepted one the cue of its moment. Reloading a saved run
 * dispatches nothing, so nothing from the past is played.
 */
import type { DispatchResult, Intent, RunState } from '@game/session';
import { playCue } from './index.js';

const BOARD_INTENTS: ReadonlySet<string> = new Set([
  'place_building',
  'move_building',
  'add_conduit',
]);

/** Cues for an accepted intent, in the order they should start. */
function acceptedCues(
  intent: Intent,
  result: Extract<DispatchResult, { ok: true }>,
  before: RunState,
): string[] {
  const fx = result.effects;
  const has = (type: string): boolean => fx.some((e) => e.type === type);
  const modifiersGained =
    (result.state.team.modifiers?.length ?? 0) >
    (before.team.modifiers?.length ?? 0);
  const cues: string[] = [];
  switch (intent.type) {
    case 'place_building':
    case 'place_core':
      cues.push('build.place');
      break;
    case 'move_building': {
      const was = before.team.buildings.find((b) => b.id === intent['id']);
      const sameSpot =
        was !== undefined && was.x === intent['x'] && was.y === intent['y'];
      cues.push(sameSpot ? 'build.rotate' : 'build.move');
      break;
    }
    case 'return_building':
      cues.push('build.stash');
      break;
    case 'add_conduit':
      cues.push('build.conduit_draw');
      break;
    case 'erase_conduit':
      cues.push('build.conduit_erase');
      break;
    case 'set_building_resource':
    case 'pick_specialist':
      cues.push('ui.click');
      break;
    case 'buy':
      cues.push('shop.buy');
      break;
    case 'sell':
      cues.push('shop.sell');
      break;
    case 'reroll':
      cues.push('shop.reroll');
      break;
    case 'vote':
      cues.push(has('vote_resolved') ? 'run.vote_resolved' : 'run.vote_cast');
      break;
    case 'event_choose':
      // The most specific moment wins: a modifier gained is the event's news.
      if (!modifiersGained) cues.push('run.event_chosen');
      break;
    case 'unready':
      cues.push('ui.toggle');
      break;
    case 'ready':
      if (has('run_over')) break; // The run-over screen has its own cue.
      if (has('round_started')) cues.push('run.round_start');
      else if (has('step_changed')) cues.push('run.all_ready');
      else cues.push('run.ready');
      break;
    default:
      break;
  }
  if (modifiersGained) cues.push('run.modifier_gained');
  return cues;
}

/** Cues for a refused intent. */
function refusedCues(
  intent: Intent,
  result: Extract<DispatchResult, { ok: false }>,
): string[] {
  // Nothing was attempted by the player, or nothing is wrong.
  if (result.reason === 'stale' || result.reason === 'already_ready') return [];
  if (result.reason === 'not_enough_gold') return ['shop.no_gold'];
  if (BOARD_INTENTS.has(intent.type)) return ['build.illegal'];
  return ['ui.error'];
}

/** The cues one dispatched intent plays, for its result. Pure. */
export function cuesForDispatch(
  intent: Intent,
  result: DispatchResult,
  before: RunState,
): string[] {
  return result.ok
    ? acceptedCues(intent, result, before)
    : refusedCues(intent, result);
}

/** Notes a dispatch that ended the run, so its screen may announce it. */
const endedHere = new Set<string>();

/**
 * Plays the cues of a finished dispatch. The only call the session makes;
 * `play` is injectable for tests.
 */
export function soundForDispatch(
  intent: Intent,
  result: DispatchResult,
  before: RunState,
  play: (cue: string) => unknown = playCue,
): void {
  try {
    if (result.ok && result.effects.some((e) => e.type === 'run_over'))
      endedHere.add(result.state.runId);
    for (const cue of cuesForDispatch(intent, result, before)) play(cue);
  } catch {
    // Audio never affects the run.
  }
}

/**
 * True once, when this page saw the run end (not on a reload or a reopened
 * summary): the run-over screen plays its cue then.
 */
export function takeRunEnded(runId: string): boolean {
  return endedHere.delete(runId);
}

/** The cue of the run-over screen opening. */
export function runOverCue(isNewBest: boolean): string {
  return isNewBest ? 'run.new_best' : 'run.over';
}

const announced = new Set<string>();

/**
 * Plays `cue` once for `key` per page load (a life lost shown again by
 * "Watch again" is not announced twice).
 */
export function playOnce(
  key: string,
  cue: string,
  play: (cue: string) => unknown = playCue,
): void {
  if (announced.has(key)) return;
  announced.add(key);
  try {
    play(cue);
  } catch {
    // Audio never affects the run.
  }
}
