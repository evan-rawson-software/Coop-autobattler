/**
 * The held run modifiers, shown the same way on every run screen: a Bonuses
 * button for the run bar with a popover, the list itself (totals, then each
 * modifier with its stacks), and the opponent's list for the battle screen.
 */
import type { TeamModifier } from '@game/core';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { screenText, screenTexts } from '../build/texts.js';
import { bonusView, type BonusLine } from './bonus-view.js';

const t = (key: string, values: Record<string, string> = {}): string =>
  screenText(screenTexts, key, values);

function Line(props: { line: BonusLine }) {
  return (
    <li class={props.line.negative ? 'bonus-negative' : undefined}>
      {props.line.text}
    </li>
  );
}

/** The acting player's specialist bonus: its heading and one line per effect. */
export interface SpecialistBonus {
  readonly bonusTitle: string;
  readonly bonusLines: readonly string[];
}

/**
 * The specialist's family bonus (CB-51a), labelled with the specialist. It is
 * the player's own, apart from the party's modifiers, which act on the whole
 * side.
 */
function SpecialistBonusSection(props: { specialist: SpecialistBonus }) {
  return (
    <section data-field="bonus-specialist">
      <h4>{props.specialist.bonusTitle}</h4>
      <ul>
        {props.specialist.bonusLines.map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Totals, then the modifiers held with ×N for stacks and their effects; with a
 * `specialist`, its bonus first.
 */
export function BonusList(props: {
  modifiers: readonly TeamModifier[] | undefined;
  specialist?: SpecialistBonus | null;
}) {
  const v = bonusView(props.modifiers);
  const specialist = props.specialist ?? null;
  if (v.count === 0 && specialist === null) return null;
  return (
    <div class="bonus-lists">
      {specialist === null ? null : (
        <SpecialistBonusSection specialist={specialist} />
      )}
      {v.totals.length === 0 ? null : (
        <section data-field="bonus-totals">
          <h4>{t('uiBonusesTotals')}</h4>
          <ul>
            {v.totals.map((l) => (
              <Line key={l.text} line={l} />
            ))}
          </ul>
        </section>
      )}
      {v.count === 0 ? null : (
        <section data-field="bonus-held">
          <h4>{t('uiBonusesHeld')}</h4>
          <ul>
            {v.held.map((h) => (
              <li key={h.id} data-bonus={h.id}>
                <strong>
                  {h.count > 1
                    ? t('uiBonusStacks', {
                        name: h.name,
                        count: String(h.count),
                      })
                    : h.name}
                </strong>
                <ul>
                  {h.lines.map((l) => (
                    <Line key={l.text} line={l} />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** The run bar item: icon and count; opens the list. Hidden when none. */
export function BonusesItem(props: {
  modifiers: readonly TeamModifier[] | undefined;
  /** The acting player's specialist bonus; it counts as one in the button. */
  specialist?: SpecialistBonus | null;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const count =
    (props.modifiers?.length ?? 0) + (props.specialist == null ? 0 : 1);
  useLayoutEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: MouseEvent): void => {
      if (root.current !== null && !root.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);
  if (count === 0) return null;
  return (
    <span class="bonus-item" data-field="bar-bonuses" ref={root}>
      <button
        type="button"
        class="bonus-button"
        data-keeps-space=""
        aria-label={t('uiBonusesCount', { count: String(count) })}
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        <span class="bar-icon bonus-glyph" aria-hidden="true">
          ✦
        </span>
        {count}
      </button>
      {open ? (
        <div class="bonus-popover" data-field="bonus-popover" role="dialog">
          <h3>{t('uiBonuses')}</h3>
          <BonusList
            modifiers={props.modifiers}
            specialist={props.specialist ?? null}
          />
        </div>
      ) : null}
    </span>
  );
}

/** The opponent's modifiers in the battle info; nothing when it has none. */
export function OpponentBonuses(props: {
  modifiers: readonly TeamModifier[] | undefined;
}) {
  if ((props.modifiers?.length ?? 0) === 0) return null;
  return (
    <section class="rail-section opponent-bonuses" data-field="opp-bonuses">
      <h3>{t('uiOpponentBonuses')}</h3>
      <BonusList modifiers={props.modifiers} />
    </section>
  );
}
