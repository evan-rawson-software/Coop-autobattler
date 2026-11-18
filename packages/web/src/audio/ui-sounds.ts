/**
 * The shared interface sounds (#449): one pair of delegated listeners for the
 * whole page, instead of a call per button. A press on a button or tab plays
 * `ui.click`, a checkbox change plays `ui.toggle`, and the start buttons of
 * the menu play `ui.confirm`. A press that sent an intent to the run plays
 * nothing here: the result of the intent has its own cue (moments.ts).
 */

let intents = 0;

/** Called by the session each time it sends an intent. */
export function noteIntentSent(): void {
  intents += 1;
}

const PRESSABLE = 'button, [role="tab"], [role="button"], summary';
/** Buttons that move on: Start, Resume, the tutorial (AU: `ui.confirm`). */
const CONFIRM =
  '#new-run-button, #continue-button, #tutorial-button, [data-action="resume"], [data-sound="confirm"]';

/** The cue for a press on `target`, or null for none. Pure. */
export function cueForPress(target: Element | null): string | null {
  const el = target?.closest(PRESSABLE) ?? null;
  if (el === null) return null;
  if (
    (el as HTMLButtonElement).disabled ||
    el.getAttribute('aria-disabled') === 'true' ||
    el.closest('[data-sound="none"]') !== null
  )
    return null;
  return el.matches(CONFIRM) ? 'ui.confirm' : 'ui.click';
}

/** The cue for a change event: a checkbox switch, else none. Pure. */
export function cueForChange(target: Element | null): string | null {
  const input = target as HTMLInputElement | null;
  return input !== null &&
    input.tagName === 'INPUT' &&
    (input.type === 'checkbox' || input.type === 'radio')
    ? 'ui.toggle'
    : null;
}

/** Wires the listeners; returns a function that removes them. */
export function installUiSounds(
  doc: Document,
  play: (cue: string) => unknown,
): () => void {
  let seen = 0;
  const onStart = (): void => {
    seen = intents;
  };
  const onClick = (e: Event): void => {
    if (seen !== intents) return;
    const cue = cueForPress(e.target as Element | null);
    if (cue !== null) play(cue);
  };
  const onChange = (e: Event): void => {
    const cue = cueForChange(e.target as Element | null);
    if (cue !== null) play(cue);
  };
  doc.addEventListener('click', onStart, true);
  doc.addEventListener('click', onClick);
  doc.addEventListener('change', onChange);
  return () => {
    doc.removeEventListener('click', onStart, true);
    doc.removeEventListener('click', onClick);
    doc.removeEventListener('change', onChange);
  };
}
