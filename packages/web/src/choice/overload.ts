/**
 * The Overload line of a PvE battle: what the decay does to the two Cores
 * (docs/rules-reference.md, "Overload"). The decay is the same flat amount per
 * beat for both Cores, so the smaller Core falls first. Pure; the rules answer
 * in core (`overloadOutcome`), this only words them.
 */
import { overloadOutcome, type SimConfig } from '@game/core';
import { clock } from '../battle/derive.js';
import { screenText, screenTexts } from '../build/texts.js';

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
