/**
 * View model of the specialist pick (wireframe 5b, RS-13) and the places that
 * name specialists afterwards: the run bar, the PvP panel of a ghost and the
 * Run over screen. Pure: it reads the run state and the presentation text.
 */
import type { TeamState } from '@game/core';
import type { RunState } from '@game/session';
import { screenText, screenTexts, playerName } from '../build/texts.js';
import { content } from '../content.js';
import { specialistEffectLine } from '../run/display-text.js';

/** The display name of a specialist ID; the ID itself when it has no text. */
export function specialistName(id: string): string {
  return content.presentation.specialist(id)?.name ?? id;
}

/** One card of the pick: the roster entry with its texts and who chose it. */
export interface SpecialistCard {
  readonly id: string;
  readonly name: string;
  /** "Family: Logistics". */
  readonly family: string;
  readonly bonus: string;
  /** The signature building's name and footprint. */
  readonly signature: string;
  /** What the signature building does. */
  readonly description: string;
  /** The names of the players who picked it, in player order. */
  readonly pickedBy: readonly string[];
  /** The acting player has it picked. */
  readonly mine: boolean;
}

/** The names of the party, in player order. */
function names(run: Pick<RunState, 'players'>): string[] {
  return run.players.map((p) => p.name);
}

/** The cards of the whole roster, in file order (RS-13: nothing is locked). */
export function specialistCards(
  run: Pick<RunState, 'players' | 'team'>,
  acting: number,
): SpecialistCard[] {
  const picks = run.team.specialists ?? [];
  const who = names(run);
  return content.specialists.ids().map((id) => {
    const text = content.presentation.specialist(id);
    return {
      id,
      name: text?.name ?? id,
      family: screenText(screenTexts, 'specialistFamily', {
        family: text?.family ?? '',
      }),
      bonus: text?.bonus ?? '',
      signature: text?.signature ?? '',
      description: text?.description ?? '',
      pickedBy: run.players.flatMap((_, i) =>
        picks[i] === id ? [playerName(screenTexts, who, i)] : [],
      ),
      mine: picks[acting] === id,
    };
  });
}

export type PickStatus = 'choosing' | 'not_ready' | 'locked';

/** One row of the party panel: who has what and whether it is locked. */
export interface PartyPickRow {
  readonly player: number;
  readonly name: string;
  /** The specialist's display name, or the "no pick yet" text. */
  readonly pick: string;
  readonly picked: boolean;
  readonly status: PickStatus;
  readonly statusText: string;
}

export function partyPicks(
  run: Pick<RunState, 'players' | 'team' | 'perPlayer'>,
): PartyPickRow[] {
  const picks = run.team.specialists ?? [];
  const who = names(run);
  return run.players.map((_, i) => {
    const id = picks[i] ?? null;
    const ready = run.perPlayer[i]?.ready === true;
    const status: PickStatus =
      id === null ? 'choosing' : ready ? 'locked' : 'not_ready';
    return {
      player: i,
      name: playerName(screenTexts, who, i),
      pick:
        id === null
          ? screenText(screenTexts, 'specialistNoneYet')
          : specialistName(id),
      picked: id !== null,
      status,
      statusText: screenText(
        screenTexts,
        status === 'choosing'
          ? 'specialistStatusChoosing'
          : status === 'locked'
            ? 'specialistStatusLocked'
            : 'specialistStatusNotReady',
      ),
    };
  });
}

/** What the run bar shows of a specialist: the name, and the full words as its title. */
export interface BarSpecialist {
  readonly name: string;
  /** "Specialist: Flowmancer", for the tooltip and the accessible name. */
  readonly title: string;
  /** "Specialist bonus: Flowmancer", the heading of the bonus lines. */
  readonly bonusTitle: string;
  /** What the family bonus does, one line per effect (CB-51a). */
  readonly bonusLines: readonly string[];
}

/** The specialist of a player for the run bar, or null before the pick. */
export function barSpecialist(
  team: Pick<TeamState, 'specialists'>,
  acting: number,
): BarSpecialist | null {
  const id = team.specialists?.[acting] ?? null;
  if (id === null) return null;
  const name = specialistName(id);
  return {
    name,
    title: screenText(screenTexts, 'specialistBar', { name }),
    bonusTitle: screenText(screenTexts, 'uiBonusesSpecialist', { name }),
    bonusLines: (content.specialists.get(id)?.effects ?? []).map(
      specialistEffectLine,
    ),
  };
}

/**
 * "Ann: Flowmancer" for each player who has a specialist, in player order.
 * `players` gives the real names (a ghost has none: "Player 1" and so on). An
 * empty list for a team without specialists (a save from before them).
 */
export function specialistLines(
  specialists: readonly (string | null)[] | undefined,
  players: readonly (string | undefined)[] = [],
): string[] {
  return (specialists ?? []).flatMap((id, i) =>
    id === null
      ? []
      : [
          screenText(screenTexts, 'specialistLine', {
            player: playerName(screenTexts, players, i),
            specialist: specialistName(id),
          }),
        ],
  );
}
