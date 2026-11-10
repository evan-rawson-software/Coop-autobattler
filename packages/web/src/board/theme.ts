/** Read the board colours from the page's CSS custom properties. */

import type { Theme } from './render.js';

const KIND_VARS = [
  'source',
  'route',
  'unit_producer',
  'defense',
  'economy',
  'core',
] as const;

export function readTheme(el: Element): Theme {
  const cs = getComputedStyle(el);
  const v = (name: string): string =>
    cs.getPropertyValue(name).trim() || '#f0f';
  const kinds: Record<string, string> = {};
  for (const k of KIND_VARS) kinds[k] = v(`--kind-${k.replace('_', '-')}`);
  return {
    boardBg: v('--board-bg'),
    gridLine: v('--board-grid'),
    features: [v('--feature-0'), v('--feature-1'), v('--feature-2')],
    kinds,
    wall: v('--board-wall'),
    core: v('--board-core'),
    coreInk: v('--board-core-ink'),
    owners: [v('--owner-0'), v('--owner-1'), v('--owner-2'), v('--owner-3')],
    ink: v('--ink'),
    inkMuted: v('--ink-muted'),
    front: v('--board-front'),
    neutralFill: v('--board-neutral'),
    neutralLine: v('--board-neutral-line'),
    hover: v('--hover'),
    select: v('--select'),
    conduitUnknown: v('--conduit-unknown'),
    outline: v('--board-outline'),
  };
}
