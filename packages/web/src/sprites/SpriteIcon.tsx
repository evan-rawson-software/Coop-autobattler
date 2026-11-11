/**
 * A sprite as an inline image, for the interface (icons, building cards). It
 * renders nothing but an empty box of the final size until the atlas has
 * loaded, so the layout never shifts, and shows `fallback` (if any) in the
 * meantime and when loading fails.
 */

import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  frameCanvas,
  loadSprites,
  onSpritesChange,
  spriteSet,
  type Ramp,
} from './atlas.js';

const urlCache = new Map<string, string>();

/** A data URL of one frame (cached), or null when it is not available. */
export function spriteUrl(name: string, frame = 0, ramp?: Ramp): string | null {
  const set = spriteSet();
  if (!set) return null;
  const key = `${name}#${String(frame)}#${ramp?.join(',') ?? ''}`;
  const hit = urlCache.get(key);
  if (hit !== undefined) return hit;
  const c = frameCanvas(set, name, frame, ramp);
  if (!c) return null;
  const url = c.toDataURL('image/png');
  urlCache.set(key, url);
  return url;
}

/** Re-render when the sprites finish loading; starts the load. */
export function useSprites(): boolean {
  const [ready, setReady] = useState(spriteSet() !== null);
  useEffect(() => {
    setReady(spriteSet() !== null);
    void loadSprites();
    return onSpritesChange(() => {
      setReady(spriteSet() !== null);
    });
  }, []);
  return ready;
}

export function SpriteIcon(props: {
  name: string;
  frame?: number;
  /** CSS pixels per sprite pixel; ignored when `box` is set. */
  scale?: number;
  /** Fit inside a square of this many CSS pixels (overrides `scale`). */
  size?: number;
  /** Fill the parent's height instead (the parent sets the size). */
  fit?: boolean;
  class?: string;
  /** Shown while the sprite is not available. */
  fallback?: ComponentChildren;
  title?: string;
}) {
  const ready = useSprites();
  const set = ready ? spriteSet() : null;
  const sp = set?.atlas.sprites[props.name];
  const url = sp ? spriteUrl(props.name, props.frame ?? 0) : null;
  const cls = `sprite-icon ${props.class ?? ''}`.trim();
  if (!url || !sp) {
    return (
      <span
        class={`${cls} sprite-icon-empty`}
        aria-hidden="true"
        style={
          props.fit
            ? { height: '100%' }
            : {
                width: `${String(props.size ?? 16 * (props.scale ?? 2))}px`,
                height: `${String(props.size ?? 16 * (props.scale ?? 2))}px`,
              }
        }
      >
        {props.fallback}
      </span>
    );
  }
  const scale =
    props.size === undefined
      ? (props.scale ?? 2)
      : props.size / Math.max(sp.w, sp.h);
  return (
    <img
      class={cls}
      src={url}
      alt=""
      aria-hidden="true"
      draggable={false}
      style={
        props.fit
          ? { height: '100%', width: 'auto' }
          : {
              width: `${String(sp.w * scale)}px`,
              height: `${String(sp.h * scale)}px`,
            }
      }
      title={props.title}
    />
  );
}
