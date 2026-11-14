/**
 * The phase stepper in the top bar, the first-visit phase box and the "Next
 * phase" line (issue #300). All three read the run's place in the round from
 * `PhaseContext`; screens do not pass anything.
 */
import { useContext } from 'preact/hooks';
import { useStore } from '../app-state.js';
import { screenText, screenTexts } from '../build/texts.js';
import {
  PhaseContext,
  battleNumber,
  stepperItems,
  type PhaseId,
} from './phase.js';
import { markTipSeen, seenTipsStore } from './phase-tips.js';
import { TutorialContext } from '../tutorial/context.js';
import { TutorialCard } from '../tutorial/TutorialCard.js';

const t = (key: string, values: Record<string, string> = {}): string =>
  screenText(screenTexts, key, values);

const CAP: Record<PhaseId, string> = {
  setup: 'Setup',
  build: 'Build',
  fight: 'Fight',
  reward: 'Reward',
};

export const phaseName = (id: PhaseId): string => t(`uiPhase${CAP[id]}`);
export const phaseText = (id: PhaseId): string => t(`uiPhaseDesc${CAP[id]}`);

/** `Set up › Build › Fight › Reward`; the current step is a filled pill. */
export function PhaseStepper() {
  const info = useContext(PhaseContext);
  if (info === null) return null;
  const items = stepperItems(info.round, info.phase);
  return (
    <nav
      class="phase-stepper"
      aria-label={t('uiPhaseNavLabel')}
      data-field="stepper"
    >
      <ol>
        {items.map((it, i) => (
          <li
            key={it.id}
            class={`phase-step ${it.state}`}
            data-phase={it.id}
            data-state={it.state}
          >
            {i > 0 ? (
              <span class="phase-sep" aria-hidden="true">
                ›
              </span>
            ) : null}
            <span
              class="phase-step-name"
              tabIndex={0}
              aria-current={it.state === 'current' ? 'step' : undefined}
            >
              {phaseName(it.id)}
              {it.state === 'done' ? ' ✓' : ''}
              {it.id === 'fight' && it.state === 'current' ? (
                <span class="phase-battle" data-field="battle-number">
                  {t('uiPhaseBattleOf', { n: String(battleNumber(info.leg)) })}
                </span>
              ) : null}
              <span class="phase-pop" role="tooltip">
                {phaseText(it.id)}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** The first-visit box of a phase: what the phase is, and "Got it". */
export function PhaseBox(props: { phase: PhaseId }) {
  const { phase } = props;
  return (
    <section class="phase-box" data-field="phase-tip" data-phase={phase}>
      <span class="phase-box-title">
        {t('uiPhaseNewTitle', { phase: phaseName(phase) })}
      </span>
      <p>{phaseText(phase)}</p>
      <button
        type="button"
        class="text-link"
        data-action="dismiss-tip"
        onClick={() => {
          markTipSeen(phase);
        }}
      >
        {t('uiPhaseGotIt')}
      </button>
    </section>
  );
}

/**
 * The top of the info rail: the tutorial's coach card in a tutorial run (it
 * holds the phase box itself), else the first-visit box; and on a result the
 * next phase.
 */
export function PhaseInfoTop(props: { framePhase?: string }) {
  const info = useContext(PhaseContext);
  const tutorial = useContext(TutorialContext);
  const seen = useStore(seenTipsStore);
  if (info === null) return null;
  const showTip = !seen.includes(info.phase);
  return (
    <>
      {tutorial !== null ? (
        <TutorialCard
          info={tutorial}
          framePhase={props.framePhase ?? ''}
          phase={info.phase}
        />
      ) : showTip ? (
        <PhaseBox phase={info.phase} />
      ) : null}
      {info.next === null ? null : (
        <p class="phase-next" data-field="next-phase">
          {t('uiPhaseNext', { phase: phaseName(info.next) })}
        </p>
      )}
    </>
  );
}
