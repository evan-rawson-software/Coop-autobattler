/** The small tooltip the board shows next to the thing under the pointer. */

import type { HoverInfo } from './hover-info.js';

/** How long the pointer rests on one thing before the tooltip shows. */
export const HOVER_DELAY_MS = 300;

export interface Tip {
  readonly info: HoverInfo;
  /** Pointer position inside the board element, in CSS pixels. */
  readonly x: number;
  readonly y: number;
}

const OFFSET = 14;
const MAX_W = 260;
const EST_H = 90;

function swatchColor(info: HoverInfo): string {
  switch (info.tone) {
    case 'resource':
      return info.color ?? 'var(--conduit-unknown)';
    case 'terrain':
      return 'var(--feature-0)';
    case 'front':
      return 'var(--board-front)';
    case 'core':
      return 'var(--board-core)';
    case 'building':
    case 'unit':
      return `var(--owner-${String(Math.min(3, info.owner ?? 0))})`;
  }
}

export function BoardTooltip(props: {
  tip: Tip;
  width: number;
  height: number;
}) {
  const { tip, width, height } = props;
  const left =
    tip.x + OFFSET + MAX_W > width
      ? Math.max(4, tip.x - OFFSET - MAX_W)
      : tip.x + OFFSET;
  const top =
    tip.y + OFFSET + EST_H > height
      ? Math.max(4, tip.y - OFFSET - EST_H)
      : tip.y + OFFSET;
  return (
    <div
      class="board-tip"
      role="tooltip"
      data-testid="board-tip"
      data-tone={tip.info.tone}
      style={{ left: `${String(left)}px`, top: `${String(top)}px` }}
    >
      <div class="board-tip-title">
        <span
          class="board-tip-dot"
          style={{ background: swatchColor(tip.info) }}
        />
        <strong>{tip.info.title}</strong>
      </div>
      {tip.info.lines.map((l) => (
        <p key={l}>{l}</p>
      ))}
    </div>
  );
}
