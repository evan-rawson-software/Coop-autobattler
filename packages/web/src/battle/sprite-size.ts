/**
 * How big a unit sprite is drawn on the battle canvas. Small units would turn
 * into a few unreadable pixels, so a sprite never draws below 16 CSS px.
 */

/** Smallest on-screen side of a drawn unit sprite, in CSS px. */
export const MIN_SPRITE_PX = 16;

/**
 * Half the side of the box a unit sprite is drawn in. `radiusPx` is the unit's
 * body radius on screen; a sprite turned by an odd number of octants is
 * shrunk by sqrt(1/2) to stay inside the circle, and the floor applies after
 * that shrink. Above the floor the size is the radius itself.
 */
export function spriteHalf(radiusPx: number, diagonal: boolean): number {
  const h = diagonal ? radiusPx * Math.SQRT1_2 : radiusPx;
  return Math.max(h, MIN_SPRITE_PX / 2);
}

/**
 * How far above its centre a unit sprite can reach beyond `radiusPx` because
 * of the floor (0 when the floor never enlarges it). Health bars sit above
 * this. The worst case is the floored box turned by an octant.
 */
export function spriteReach(radiusPx: number): number {
  return radiusPx * Math.SQRT1_2 < MIN_SPRITE_PX / 2
    ? (MIN_SPRITE_PX / 2) * Math.SQRT2
    : 0;
}
