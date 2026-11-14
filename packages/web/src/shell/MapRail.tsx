/**
 * The map rail: a narrow vertical strip directly left of the board, with the
 * same controls in the same order in every phase. A control that does not
 * apply in a phase is dimmed, never removed, so nothing jumps around.
 *
 * Order: zoom in, zoom out, fit | resource flow, enemy paths, test run |
 * centre, my base, their base. The test run is only on in Build.
 */
import type { ComponentChildren } from 'preact';
import type { CameraController } from '../board/controller.js';
import { screenText, screenTexts } from '../build/texts.js';

const t = (key: string): string => screenText(screenTexts, key);

/** A toggle that the phase offers; absent means dimmed. */
export interface RailToggle {
  readonly on: boolean;
  readonly onToggle: () => void;
  /** The tooltip and accessible name. */
  readonly label: string;
}

export interface MapRailProps {
  /** The board's camera; none dims the zoom, fit and base buttons. */
  readonly camera?: CameraController | null | undefined;
  /** Centre the camera on the enemy base (battle); none dims the button. */
  readonly onEnemyBase?: (() => void) | undefined;
  readonly flow?: RailToggle | undefined;
  readonly paths?: RailToggle | undefined;
  /** The test run: only Build offers it. */
  readonly testRun?: RailToggle | undefined;
}

function Icon(props: { children: ComponentChildren }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {props.children}
    </svg>
  );
}

function RailButton(props: {
  label: string;
  /** Why it is dimmed, when it is. */
  dimmedHint: string;
  enabled: boolean;
  pressed?: boolean | undefined;
  onClick: () => void;
  attrs: Record<string, string>;
  children: ComponentChildren;
}) {
  return (
    <button
      type="button"
      class={`rail-btn${props.pressed === true ? ' active' : ''}`}
      aria-label={props.label}
      aria-pressed={props.pressed}
      title={
        props.enabled ? props.label : `${props.label}. ${props.dimmedHint}`
      }
      disabled={!props.enabled}
      onClick={props.onClick}
      {...props.attrs}
    >
      {props.children}
    </button>
  );
}

export function MapRail(props: MapRailProps) {
  const c = props.camera ?? null;
  const cam = c !== null;
  const notNow = t('uiMapNotNow');
  const toggle = (
    key: 'flow' | 'paths' | 'dry',
    spec: RailToggle | undefined,
    fallbackLabel: string,
    hint: string,
    icon: ComponentChildren,
  ) => (
    <RailButton
      label={spec?.label ?? fallbackLabel}
      dimmedHint={hint}
      enabled={spec !== undefined}
      pressed={spec === undefined ? undefined : spec.on}
      onClick={() => {
        spec?.onToggle();
      }}
      attrs={{ 'data-overlay': key }}
    >
      {icon}
    </RailButton>
  );
  return (
    <nav class="frame-rail" aria-label={t('uiMapRail')}>
      <RailButton
        label={t('uiMapZoomIn')}
        dimmedHint={notNow}
        enabled={cam}
        onClick={() => {
          c?.zoomCentre(1.25);
        }}
        attrs={{ 'data-camera': 'zoom-in' }}
      >
        <Icon>
          <path d="M12 5v14M5 12h14" />
        </Icon>
      </RailButton>
      <RailButton
        label={t('uiMapZoomOut')}
        dimmedHint={notNow}
        enabled={cam}
        onClick={() => {
          c?.zoomCentre(0.8);
        }}
        attrs={{ 'data-camera': 'zoom-out' }}
      >
        <Icon>
          <path d="M5 12h14" />
        </Icon>
      </RailButton>
      <RailButton
        label={t('uiCameraFit')}
        dimmedHint={notNow}
        enabled={cam}
        onClick={() => {
          c?.preset('fit');
        }}
        attrs={{ 'data-camera': 'fit', title: t('uiMapFitTip') }}
      >
        <Icon>
          <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
        </Icon>
      </RailButton>
      <hr class="rail-sep" />
      {toggle(
        'flow',
        props.flow,
        t('uiOverlayFlow'),
        notNow,
        <Icon>
          <path d="M3 12h14M13 6l6 6-6 6" />
        </Icon>,
      )}
      {toggle(
        'paths',
        props.paths,
        t('uiOverlayPaths'),
        notNow,
        <Icon>
          <path d="M6 3v6c0 4 12 4 12 8v4" stroke-dasharray="3 3" />
        </Icon>,
      )}
      {toggle(
        'dry',
        props.testRun,
        t('uiOverlayDry').replace(' {secs} s', ''),
        t('uiMapTestRunOnlyBuild'),
        <Icon>
          <path d="M7 4l13 8-13 8z" fill="currentColor" />
        </Icon>,
      )}
      <hr class="rail-sep" />
      <RailButton
        label={t('uiCameraCenter')}
        dimmedHint={notNow}
        enabled={cam}
        onClick={() => {
          c?.preset('center');
        }}
        attrs={{ 'data-camera': 'center' }}
      >
        <Icon>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
        </Icon>
      </RailButton>
      <RailButton
        label={t('uiCameraMyBase')}
        dimmedHint={notNow}
        enabled={cam}
        onClick={() => {
          c?.preset('base');
        }}
        attrs={{ 'data-camera': 'base' }}
      >
        <Icon>
          <path d="M4 11l8-7 8 7M6 10v10h12V10" />
        </Icon>
      </RailButton>
      <RailButton
        label={t('uiCameraTheirBase')}
        dimmedHint={notNow}
        enabled={props.onEnemyBase !== undefined}
        onClick={() => {
          props.onEnemyBase?.();
        }}
        attrs={{ 'data-camera': 'enemy-base' }}
      >
        <Icon>
          <path d="M6 21V4M6 4h12l-3 4 3 4H6" />
        </Icon>
      </RailButton>
    </nav>
  );
}
