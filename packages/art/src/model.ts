/** The shape of a sprite definition and the helpers the sprite files share. */

import { Pix, rng, wrap } from './pix.js';

export type SheetName = 'terrain' | 'buildings' | 'units' | 'effects' | 'ui';

export type Category =
  'terrain' | 'building' | 'unit' | 'conduit' | 'node' | 'effect' | 'ui';

export interface SpriteDef {
  /** Unique name; content ids are used verbatim where a sprite stands for one. */
  readonly name: string;
  readonly sheet: SheetName;
  readonly category: Category;
  /** Frames, all the same size, laid out horizontally in the sheet. */
  readonly frames: readonly Pix[];
  readonly fps: number;
  /** Pixel position inside one frame that should sit on the object's centre. */
  readonly anchor: readonly [number, number];
  /** Content id this sprite stands for, when it does. */
  readonly id?: string;
  /** Planned content that does not exist yet. */
  readonly planned?: boolean;
  /** `[left, top, right, bottom]` margins of a 9-slice. */
  readonly nineSlice?: readonly [number, number, number, number];
  /** True when the sprite uses the tint ramp (palette keys X, x, Z). */
  readonly tintable?: boolean;
  /** Free text shown in the preview and written to the atlas. */
  readonly note?: string;
}

export function sprite(
  def: Omit<SpriteDef, 'fps' | 'anchor' | 'frames'> & {
    frames: readonly Pix[] | Pix;
    fps?: number;
    anchor?: readonly [number, number];
  },
): SpriteDef {
  const frames = Array.isArray(def.frames)
    ? (def.frames as readonly Pix[])
    : [def.frames as Pix];
  const first = frames[0];
  if (!first) throw new Error(`sprite ${def.name} has no frames`);
  for (const f of frames)
    if (f.w !== first.w || f.h !== first.h)
      throw new Error(`sprite ${def.name}: frames differ in size`);
  return {
    ...def,
    frames,
    fps: def.fps ?? 0,
    anchor: def.anchor ?? [first.w / 2, first.h / 2],
  };
}

/** Set a pixel with wrap-around, for seamless textures. */
export function wset(p: Pix, x: number, y: number, key: string): void {
  p.set(wrap(x, p.w), wrap(y, p.h), key);
}

export { rng };
