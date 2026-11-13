/**
 * The Overload line of a PvE battle: what the decay does to the two Cores
 * (docs/rules-reference.md, "Overload"). The decay is the same flat amount per
 * beat for both Cores, so the smaller Core falls first. Pure; the rules answer
 * in core (`overloadOutcome`), this only words them.
 */
import {
  mulPct,
  modifierPercent,
  overloadOutcome,
  type BuildingConfig,
  type SimConfig,
  type TeamState,
} from '@game/core';
import { clock } from '../battle/derive.js';
import { screenText, screenTexts } from '../build/texts.js';

/** The party Core's maximum health: its tier, raised by the team's modifiers. */
export function partyCoreMax(
  team: TeamState,
  buildings: Pick<BuildingConfig, 'list'>,
): number {
  const core = buildings.list().find((b) => b.kind === 'core');
  const base = core?.tiers[0]?.health ?? 0;
  const pct = modifierPercent(team, 'core_health_percent');
  return pct > 0 ? mulPct(base, 100 + pct) : base;
}

/** Plain words for which Core Overload destroys first, and when. */
export function overloadLine(
  sim: SimConfig,
  partyMax: number | readonly number[],
  strongholdMax: number | readonly number[],
): string {
  const at = clock(sim.overloadStartTick, sim.ticksPerSecond);
  const out = overloadOutcome(
    sim,
    typeof partyMax === 'number' ? [partyMax] : partyMax,
    typeof strongholdMax === 'number' ? [strongholdMax] : strongholdMax,
  );
  const when = out.tick === null ? '' : clock(out.tick, sim.ticksPerSecond);
  const key =
    out.first === 'b'
      ? 'overloadStronghold'
      : out.first === 'a'
        ? 'overloadYours'
        : out.first === 'both'
          ? 'overloadBoth'
          : 'overloadNeither';
  return screenText(screenTexts, key, { at, when });
}
