/**
 * The specialists of a team as a short list: the PvP panel (a ghost's
 * players, MM-11a) and the Run over screen (RS-13d). Nothing when the team has
 * none, as in a save or ghost from before specialists.
 */
import { screenText, screenTexts } from '../build/texts.js';
import { specialistLines } from './view-model.js';

export function SpecialistLines(props: {
  specialists: readonly (string | null)[] | undefined;
  players?: readonly (string | undefined)[];
  field: string;
}) {
  const lines = specialistLines(props.specialists, props.players);
  if (lines.length === 0) return null;
  return (
    <ul class="specialist-lines" data-field={props.field}>
      {lines.map((l, i) => (
        <li key={i}>{l}</li>
      ))}
    </ul>
  );
}

/** The opponent's specialists in the battle info; nothing when it has none. */
export function OpponentSpecialists(props: {
  specialists: readonly (string | null)[] | undefined;
}) {
  if (specialistLines(props.specialists).length === 0) return null;
  return (
    <section
      class="rail-section opponent-specialists"
      data-field="opp-specialists"
    >
      <h3>{screenText(screenTexts, 'specialistListTitle')}</h3>
      <SpecialistLines
        specialists={props.specialists}
        field="opp-specialist-list"
      />
    </section>
  );
}
