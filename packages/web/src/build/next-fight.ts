/**
 * The "Next fight" lines of the Build info rail (issue #301): who is next and
 * what is at stake, in one or two short lines. Pure; the words come from the
 * presentation file.
 */

import type { RunDeps, RunState } from '@game/session';
import type { BossInfo } from '../run/boss-text.js';
import { nextBattleView, type NextBattleView } from '../shop/view-model.js';
import { screenText, screenTexts, type ScreenTexts } from './texts.js';

export interface NextFight {
  /** "Rival party", "Boss battle next", "Stronghold". */
  readonly title: string;
  /** The stakes, e.g. "Win +8 gold · Lose −1 life". */
  readonly stakes: string;
  /** A boss's name, mechanic and counter advice; null for anyone else. */
  readonly boss: BossInfo | null;
}

export function nextFightOf(
  v: NextBattleView | null,
  texts: ScreenTexts = screenTexts,
): NextFight | null {
  if (v === null) return null;
  if (v.kind === 'pve' || v.pvp === null) {
    return {
      title: v.title,
      stakes: screenText(texts, 'uiNextFightChoose', {
        n: String(v.options.length),
      }),
      boss: null,
    };
  }
  const p = v.pvp;
  const win =
    p.winGold === null
      ? screenText(texts, 'uiNextFightWinAny')
      : screenText(texts, 'uiNextFightWin', { gold: String(p.winGold) });
  const lose =
    p.lifeCost === 1
      ? screenText(texts, 'uiNextFightLoseOne')
      : screenText(texts, 'uiNextFightLoseMany', {
          lives: String(p.lifeCost),
        });
  return { title: v.title, stakes: `${win} · ${lose}`, boss: v.bossInfo };
}

export function nextFight(
  run: RunState,
  deps: Pick<RunDeps, 'rules' | 'rewards'>,
): NextFight | null {
  return nextFightOf(nextBattleView(run, deps));
}
