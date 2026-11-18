/**
 * A first-time hint (issue #419): a short card at the top of the info rail.
 * It never blocks play: it is not a dialog, sits in the rail and not in the
 * run bar or over the board, and is gone once dismissed. It also counts as
 * seen when the player moves on without dismissing it, like a phase tip.
 */
import { useContext, useEffect } from 'preact/hooks';
import { screenText, screenTexts } from '../build/texts.js';
import { markHintSeen, type HintId } from './hint-store.js';
import { HintContext } from './triggers.js';

const t = (key: string): string => screenText(screenTexts, key);

const TEXT_KEY: Record<HintId, string> = {
  pact: 'hintPact',
  caravan: 'hintCaravan',
  vein: 'hintVein',
  boss: 'hintBoss',
  refineryPlaced: 'hintRefineryPlaced',
  bonuses: 'hintBonuses',
  plotFull: 'hintPlotFull',
};

function Card(props: { id: HintId }) {
  const { id } = props;
  useEffect(
    () => () => {
      markHintSeen(id);
    },
    [id],
  );
  return (
    <section class="phase-box hint-card" data-field="hint" data-hint={id}>
      <span class="phase-box-title">{t('hintTitle')}</span>
      <p>{t(TEXT_KEY[id])}</p>
      <button
        type="button"
        class="text-link"
        data-action="dismiss-hint-card"
        onClick={() => {
          markHintSeen(id);
        }}
      >
        {t('uiPhaseGotIt')}
      </button>
    </section>
  );
}

/** The hint due now, or nothing. */
export function HintCard() {
  const id = useContext(HintContext);
  return id === null ? null : <Card key={id} id={id} />;
}
