/**
 * The tutorial's coach card and its "Your first base" checklist (issue #309).
 * The card is at the top of the info rail in every phase; the checklist is
 * pinned to the bottom of the rail from step 2 on. Both only ever live in the
 * rail and never cover the board.
 */
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { useStore } from '../app-state.js';
import { screenText, screenTexts } from '../build/texts.js';
import { PhaseBox } from '../shell/PhaseStepper.js';
import { seenTipsStore } from '../shell/phase-tips.js';
import type { PhaseId } from '../shell/phase.js';
import { doneOf, positionOf, type TutorialInfo } from './context.js';
import {
  STEP_NUMBERS,
  TUTORIAL_STEP_COUNT,
  brokenStep,
  type StepNo,
} from './steps.js';
import './tutorial.css';
import {
  finishTutorial,
  skipTurretStep,
  skipTutorial,
} from './tutorial-store.js';

const t = (key: string, values: Record<string, string> = {}): string =>
  screenText(screenTexts, key, values);

/** A text where `**bold**` marks the thing to click. */
export function boldText(text: string): ComponentChildren[] {
  return text
    .split('**')
    .map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part));
}

function Progress(props: { done: readonly boolean[]; current: number | null }) {
  return (
    <ol class="tut-progress" aria-hidden="true">
      {STEP_NUMBERS.map((n) => (
        <li
          key={n}
          class={
            props.done[n - 1] === true
              ? 'done'
              : props.current === n
                ? 'current'
                : ''
          }
        />
      ))}
    </ol>
  );
}

interface Text {
  readonly head: string;
  readonly body: readonly string[];
}

function stepText(info: TutorialInfo, n: StepNo, runStep: string): Text {
  const { facts } = info;
  switch (n) {
    case 1:
      return { head: t('tutStep1Head'), body: [t('tutStep1Body')] };
    case 2:
      return {
        head: t('tutStep2Head'),
        body: [t('tutStep2Body'), t('tutHoverNote')],
      };
    case 3:
      return {
        head: t('tutStep3Head'),
        body: [t(facts.barracksPlaced ? 'tutStep3Link' : 'tutStep3Place')],
      };
    case 4:
      return {
        head: t('tutStep4Head'),
        body: [
          t('tutStep4Body'),
          ...(info.powerNear ? [t('tutStep4Power')] : []),
        ],
      };
    case 5:
      return {
        head: t('tutStep5Head'),
        body: [
          t(runStep === 'pve_choice' ? 'tutStep5Choose' : 'tutStep5Ready'),
        ],
      };
    case 6:
      return { head: t('tutStep6Head'), body: [t('tutStep6Body')] };
  }
}

export function TutorialCard(props: {
  info: TutorialInfo;
  /** The frame's phase: `result` once the battle's playback is over. */
  framePhase: string;
  phase: PhaseId;
}) {
  const { info, phase } = props;
  const [asking, setAsking] = useState(false);
  const seen = useStore(seenTipsStore);
  const battleDone = props.framePhase === 'result';
  const pos = positionOf(info, battleDone);
  if (pos.kind === 'off') return null;
  const done = doneOf(info, battleDone);
  const closing = pos.kind === 'closing';
  const n = pos.kind === 'step' ? pos.n : TUTORIAL_STEP_COUNT;
  const runId = info.runId;

  let text: Text;
  if (closing) {
    const lost = info.input.run.thisRound.pve?.won === false;
    const broken = lost
      ? brokenStep(info.facts, info.input.turretSkipped)
      : null;
    text = {
      head: t('tutClosingHead'),
      body: [
        t(
          !lost
            ? 'tutClosingBody'
            : broken === null
              ? 'tutClosingLost'
              : `tutClosingLostStep${String(broken)}`,
        ),
        ...(lost ? [t('tutClosingBody')] : []),
      ],
    };
  } else {
    text = stepText(info, n, info.input.run.step);
  }

  return (
    <section
      class="tutorial-card"
      data-field="tutorial-card"
      data-step={closing ? 'closing' : n}
    >
      <header class="tut-head">
        <span class="tut-title" data-field="tutorial-title">
          {t('tutCardTitle', {
            n: String(n),
            total: String(TUTORIAL_STEP_COUNT),
          })}
        </span>
        {asking ? null : (
          <button
            type="button"
            class="text-link"
            data-action="tutorial-skip"
            onClick={() => {
              setAsking(true);
            }}
          >
            {t('tutSkip')}
          </button>
        )}
      </header>
      <Progress done={done} current={closing ? null : n} />
      {asking ? (
        <div class="tut-confirm" role="alertdialog" data-field="skip-confirm">
          <p>{t('tutSkipAsk')}</p>
          <div class="tut-buttons">
            <button
              type="button"
              class="primary"
              data-action="tutorial-skip-yes"
              onClick={() => {
                skipTutorial(runId);
              }}
            >
              {t('tutSkipYes')}
            </button>
            <button
              type="button"
              data-action="tutorial-skip-no"
              onClick={() => {
                setAsking(false);
              }}
            >
              {t('tutSkipNo')}
            </button>
          </div>
        </div>
      ) : (
        <>
          {seen.includes(phase) ? null : <PhaseBox phase={phase} />}
          <h3 class="tut-heading" data-field="tutorial-heading">
            {text.head}
          </h3>
          {text.body.map((p) => (
            <p key={p} class="tut-body">
              {boldText(p)}
            </p>
          ))}
          {!closing && n === 4 ? (
            <button
              type="button"
              class="text-link tut-skip-step"
              data-action="tutorial-skip-step"
              onClick={() => {
                skipTurretStep(runId);
              }}
            >
              {t('tutStep4Skip')}
            </button>
          ) : null}
          {closing ? (
            <button
              type="button"
              class="tut-finish"
              data-action="tutorial-finish"
              onClick={() => {
                finishTutorial(runId);
              }}
            >
              {t('tutClosingDone')}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

/** "Your first base": all six steps, done, current or upcoming. */
export function TutorialChecklist(props: {
  info: TutorialInfo;
  framePhase: string;
}) {
  const battleDone = props.framePhase === 'result';
  const pos = positionOf(props.info, battleDone);
  if (pos.kind === 'off') return null;
  const current = pos.kind === 'step' ? pos.n : null;
  // From step 2 on; the first screen has the whole rail for the Core.
  if (current === 1) return null;
  const done = doneOf(props.info, battleDone);
  return (
    <section class="tut-checklist" data-field="tutorial-checklist">
      <h3 class="tut-list-title">{t('tutListTitle')}</h3>
      <ol>
        {STEP_NUMBERS.map((n) => {
          const state =
            done[n - 1] === true
              ? 'done'
              : current === n
                ? 'current'
                : 'upcoming';
          return (
            <li key={n} class={state} data-step={n} data-state={state}>
              <span class="tut-mark" aria-hidden="true">
                {state === 'done' ? '✓' : ''}
              </span>
              <span>{t(`tutList${String(n)}`)}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
