/** The Ready / Unready button of the Build tab, for the frame's primary slot. */

import type { RunState } from '@game/session';
import type { PrimarySpec } from '../shell/GameFrame.js';
import { SpriteIcon } from '../sprites/SpriteIcon.js';
import type { BuildController } from './build-controller.js';
import type { Gate } from './lock.js';
import { screenText, screenTexts } from './texts.js';

export function readyPrimary(
  run: RunState,
  ctl: BuildController,
  gate: Gate | null,
  acting: number,
): PrimarySpec {
  const ready = run.perPlayer[acting]?.ready === true;
  const block = gate?.readyBlock ?? null;
  return {
    id: 'ready-button',
    label: (
      <>
        {ready ? (
          <SpriteIcon name="ui_icon_ready" scale={1} class="ready-icon" />
        ) : null}
        {screenText(screenTexts, ready ? 'uiPartyUnready' : 'uiPartyReady')}
      </>
    ),
    class: ready ? 'on' : '',
    disabled: block !== null,
    title: block ?? undefined,
    attrs: { 'data-action': 'ready' },
    onPress: () => void ctl.toggleReady(),
  };
}
