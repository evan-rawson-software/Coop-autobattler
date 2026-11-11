/**
 * A building's maximum health: the single definition shared by the battle
 * simulation (the health a building starts with, the breach cost of covering
 * it) and the Build screen's enemy-path preview. See
 * docs/rules-reference.md, "Content bounds" and "Breach".
 */

import type { ArenaBuilding, ArenaContent } from './arena.js';
import { addInt, divFloor, mulPct } from './int.js';
import { assertWithin, MAX_HEALTH } from './limits.js';
import { modifierPercent, type ModifierEffectKind } from './modifiers.js';
import type { TeamState } from './team-state.js';

/**
 * The tier's health (the Core is tier 1), or `coreHealthOverride` for the Core
 * when the side options give one, raised by the team's modifiers: for the Core
 * `core_health_percent`, for any other building `building_health_percent`
 * matching its defense type or kind. Rounded down. Throws a RangeError when
 * the result exceeds MAX_HEALTH, when the percent sum is too large to scale
 * the health exactly, or when an override is out of range, so a bad
 * combination fails at battle setup, never mid-battle.
 */
export function maxHealthOf(
  team: TeamState | undefined,
  b: ArenaBuilding,
  content: ArenaContent,
  coreHealthOverride?: number,
): number {
  const def = content.buildings.get(b.def);
  const placed = team?.buildings.find((p) => p.id === b.id);
  const tier = b.kind === 'core' ? 0 : (placed?.tier ?? 1) - 1;
  let hp = def?.tiers[tier]?.health ?? 0;
  if (b.kind === 'core' && coreHealthOverride !== undefined) {
    // Checked: the Core health stays within the content bound.
    assertWithin(coreHealthOverride, 1, MAX_HEALTH, 'Side option coreHealth');
    hp = coreHealthOverride;
  }
  if (team !== undefined) {
    const kind: ModifierEffectKind =
      b.kind === 'core' ? 'core_health_percent' : 'building_health_percent';
    const pct =
      b.kind === 'core'
        ? modifierPercent(team, kind)
        : modifierPercent(team, kind, b.defenseType ?? b.kind);
    if (pct > 0) {
      // Largest percent sum for which hp * (100 + pct) stays a safe integer.
      const room =
        hp === 0
          ? Number.MAX_SAFE_INTEGER
          : divFloor(Number.MAX_SAFE_INTEGER, hp);
      if (pct > room - 100) {
        throw new RangeError(
          `Modifier ${kind}: the percent sum ${String(pct)} is too large for building ${b.def} (id ${String(b.id)}) with health ${String(hp)}; health times (100 + percent) must stay within ${String(Number.MAX_SAFE_INTEGER)}.`,
        );
      }
      hp = mulPct(hp, addInt(100, pct));
    }
  }
  if (hp > MAX_HEALTH) {
    throw new RangeError(
      `Building ${b.def} (id ${String(b.id)}): maximum health ${String(hp)} with modifiers exceeds the maximum ${String(MAX_HEALTH)}.`,
    );
  }
  return hp;
}
