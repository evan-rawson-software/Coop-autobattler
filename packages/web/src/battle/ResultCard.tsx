/**
 * The battle result card (issue #304): Victory or Defeat with the life
 * outcome, one sentence on why, the "try this next round" box after a defeat,
 * and three stat tiles. It sits over the dimmed final board; the detailed
 * stats stay in the info rail behind "See the full breakdown".
 */

import { useMemo } from 'preact/hooks';
import type { WebContent } from '../content.js';
import { screenText, screenTexts } from '../build/texts.js';
import { clock, coreNameOf, type Moment } from './derive.js';
import { reasonText } from './panels.js';
import type { Playback } from './playback.js';
import { explainResult, lifeChip, resultFacts } from './result-why.js';
import type { OpponentInfo } from './types.js';

const t = (key: string, values: Record<string, string> = {}): string =>
  screenText(screenTexts, key, values);

export interface ResultCardProps {
  readonly pb: Playback;
  readonly content: WebContent;
  readonly opponent: OpponentInfo;
  readonly moments: readonly Moment[];
  readonly rewardText: string;
  readonly won: boolean;
  readonly tps: number;
}

export function ResultCard(props: ResultCardProps) {
  const { pb, content, moments, won, tps } = props;
  const rec = pb.record;
  const [own, foe] = rec.summary.sides;
  const coreName = coreNameOf(content);
  const why = useMemo(() => {
    const doubleFall =
      own.coresStanding === 0 &&
      foe.coresStanding === 0 &&
      rec.result.reason.startsWith('tiebreak_');
    const facts = resultFacts(rec, content, moments, tps);
    const fallback = doubleFall
      ? t(won ? 'battleSummaryDoubleFallWin' : 'battleSummaryDoubleFallLoss', {
          core: coreName,
          time: facts.ownFell ?? clock(rec.result.endTick, tps),
        })
      : reasonText(rec.result.reason, coreName, [own, foe]);
    const out = explainResult(facts, won, fallback);
    return doubleFall ? { ...out, cause: fallback } : out;
  }, [rec, content, moments, tps, won, own, foe, coreName]);
  const chip = lifeChip(props.opponent.kind !== 'pve', won, props.rewardText);
  return (
    <section
      class={`result-card ${won ? 'won' : 'lost'}`}
      id="result-banner"
      aria-label={t('battleResultLabel')}
    >
      <div class="result-head">
        <h2 class="result-word" data-field="result-word">
          {t(won ? 'battleVictory' : 'battleDefeat')}
        </h2>
        <span class={`life-chip${chip.lost ? ' life-lost' : ''}`}>
          {chip.text}
        </span>
      </div>
      <p class="result-cause" data-field="cause">
        {why.cause}
      </p>
      {why.tip === null ? null : (
        <div class="result-tip" data-field="tip">
          <strong>{t('battleTipTitle')}</strong>
          <span>{why.tip}</span>
        </div>
      )}
      <p class="result-reward" data-field="reward">
        {props.rewardText}
      </p>
      <div class="result-tiles">
        <div class="stat-tile">
          <span class="tile-label">
            {t('battleYourCore', { core: coreName })}
          </span>
          <strong data-field="final-core-own">
            {own.coreHealth} / {own.coreMaxHealth}
          </strong>
        </div>
        <div class="stat-tile">
          <span class="tile-label">
            {t('battleTheirCore', { core: coreName })}
          </span>
          <strong data-field="final-core-foe">
            {foe.coreHealth} / {foe.coreMaxHealth}
          </strong>
        </div>
        <div class="stat-tile">
          <span class="tile-label">{t('battleStatTime')}</span>
          <strong data-field="end-time">
            {clock(rec.result.endTick, tps)}
          </strong>
        </div>
      </div>
    </section>
  );
}
