/**
 * The frame every in-run screen shares (issue #299). One board, with four
 * zones attached to its edges, in the same places in every phase:
 *
 *   top bar      full width, above everything
 *   map rail     narrow and vertical, directly left of the board
 *   board        takes all the space that is left
 *   action tray  directly below the board, the same width; the primary
 *                button is always at its right end
 *   info rail    directly right of the board, as tall as board plus tray
 *
 * Screens fill the zones; they never move a control to another zone. A zone
 * with nothing to say in a phase stays, and its controls are dimmed.
 *
 * Keyboard, the same in every phase: Space presses the primary button. The
 * other keys (1-9, R, C, Esc ...) belong to the phase and arrive through
 * `onKey`, so there is one key listener for the whole frame.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { StorageNotes } from '../run/StorageNotes.js';
import { screenText, screenTexts } from '../build/texts.js';
import { MapRail, type MapRailProps } from './MapRail.js';
import { TopBar, type TabDef } from './AppShell.js';
import { PhaseInfoTop } from './PhaseStepper.js';
import './frame.css';

const t = (key: string): string => screenText(screenTexts, key);

/** The one button that moves the run on. */
export interface PrimarySpec {
  readonly label: ComponentChildren;
  readonly onPress: () => void;
  readonly id?: string;
  readonly disabled?: boolean;
  readonly title?: string | undefined;
  /** Extra class, e.g. `on` for a pressed Ready. */
  readonly class?: string;
  /** Extra attributes, e.g. `data-action`. */
  readonly attrs?: Readonly<Record<string, string>>;
}

export interface GameFrameProps {
  /** The phase, for styling and tests: `core`, `build`, `shop` ... */
  readonly phase: string;
  readonly title: string;
  readonly tabs?: readonly TabDef[] | undefined;
  readonly activeTab?: string | undefined;
  readonly onTab?: ((id: string) => void) | undefined;
  /** Right side of the top bar, before the run bar. */
  readonly status?: ComponentChildren;
  /** The map rail's controls; none means all of them are dimmed. */
  readonly rail?: MapRailProps | undefined;
  /** The board zone. */
  readonly board: ComponentChildren;
  /** The action tray, left of the primary button. */
  readonly tray?: ComponentChildren;
  /** The primary button; null keeps the place with a dimmed button. */
  readonly primary: PrimarySpec | null;
  /** The info rail. */
  readonly info?: ComponentChildren;
  /**
   * The phase's other keys. Called for every key press that is not Space and
   * not typed into a field (Escape also reaches it from a field). Return true
   * when the key was used.
   */
  readonly onKey?: ((e: KeyboardEvent) => boolean) | undefined;
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  const tag = el?.tagName ?? '';
  return (
    tag === 'INPUT' ||
    tag === 'SELECT' ||
    tag === 'TEXTAREA' ||
    el?.isContentEditable === true
  );
}

/** A key cap: `Space`, `R`, `1`. */
export function Kbd(props: { children: ComponentChildren; class?: string }) {
  return <kbd class={`kbd ${props.class ?? ''}`}>{props.children}</kbd>;
}

/** The key hints line, the same everywhere the tools show. */
export function KeyHints() {
  return (
    <p class="key-hints" data-field="key-hints">
      <span class="key-hints-label">{t('uiKeyHintLabel')}</span>
      <span>
        <Kbd>1</Kbd>–<Kbd>9</Kbd> {t('uiKeySlots')}
      </span>
      <span>
        <Kbd>R</Kbd> {t('uiKeyRotate')}
      </span>
      <span>
        <Kbd>C</Kbd> {t('uiKeyConduit')}
      </span>
      <span>
        <Kbd>Esc</Kbd> {t('uiKeyCancel')}
      </span>
    </p>
  );
}

export function PrimaryButton(props: { spec: PrimarySpec | null }) {
  const spec = props.spec;
  const disabled = spec === null || spec.disabled === true;
  return (
    <button
      type="button"
      id={spec?.id ?? 'primary-button'}
      class={`primary primary-button${spec?.class === undefined ? '' : ` ${spec.class}`}`}
      data-zone="primary"
      disabled={disabled}
      title={spec?.title}
      onClick={() => {
        spec?.onPress();
      }}
      {...(spec?.attrs ?? {})}
    >
      <span class="primary-label">{spec?.label ?? ''}</span>
      <Kbd class="primary-key">{t('uiKeySpace')}</Kbd>
    </button>
  );
}

export function GameFrame(props: GameFrameProps) {
  const latest = useRef(props);
  latest.current = props;

  // One key listener for the frame. Space is the primary button; the phase
  // handles the rest.
  useEffect(() => {
    const onDown = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.altKey) return;
      const p = latest.current;
      if (e.key === ' ' || e.code === 'Space') {
        if (isTyping(e.target) || e.ctrlKey || e.metaKey) return;
        // Not the focused button's own press: the primary button is pressed.
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat && p.primary !== null && p.primary.disabled !== true) {
          p.primary.onPress();
        }
        return;
      }
      if (isTyping(e.target) && e.key !== 'Escape') return;
      if (p.onKey?.(e) === true) e.preventDefault();
    };
    // A button's own Space press happens on key up: keep it from firing.
    const onUp = (e: KeyboardEvent): void => {
      if ((e.key === ' ' || e.code === 'Space') && !isTyping(e.target)) {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    return () => {
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup', onUp, true);
    };
  }, []);

  return (
    <div class="app game-frame" data-phase={props.phase}>
      <TopBar
        title={props.title}
        tabs={props.tabs}
        activeTab={props.activeTab}
        onTab={props.onTab}
        status={props.status}
      />
      <StorageNotes />
      <div class="frame-main">
        <MapRail {...(props.rail ?? {})} />
        <main class="frame-board" aria-label={t('uiBoardLabel')}>
          {props.board}
        </main>
        <aside class="frame-info" aria-label={t('uiInfoLabel')}>
          <PhaseInfoTop />
          {props.info}
        </aside>
        <div class="frame-tray" role="group" aria-label="Actions">
          <div class="tray-content">
            {props.tray ?? <p class="tray-empty">{t('uiTrayNothing')}</p>}
          </div>
          <PrimaryButton spec={props.primary} />
        </div>
      </div>
      <footer class="build-id" id="build-id">
        Build {__BUILD_COMMIT__} · {__BUILD_DATE__}
      </footer>
    </div>
  );
}
