/**
 * Sample battles for the `#battle` route, until the run flow supplies real
 * ones. A selection (the party's board, the opponent, the seed and the tick)
 * lives in the URL hash so a reload resumes the same battle.
 *
 * Hash form: `#battle?p=<board>&o=<opponent>&s=<seed>&t=<tick>`, with an
 * optional `ts=<seed>` for the generated threat when it differs from the
 * battle seed (the golden PvE battles use two seeds).
 */

import {
  REFERENCE_BOARDS,
  buildReferenceBoard,
  generateMap,
  generateThreat,
  type ReferenceBoardName,
  type ThreatType,
} from '@game/core';
import { content } from '../content.js';
import { buildSampleTeam } from '../sample-team.js';
import { archetypeText, bossLabel } from '../run/display-text.js';
import { threatsConfig } from './setup.js';
import type { BattleDescription, OpponentInfo } from './types.js';

export interface SampleSelection {
  readonly player: ReferenceBoardName;
  /** An `OpponentOption` ID. */
  readonly opponent: string;
  readonly seed: number;
  /** Seed of the generated PvE threat; the battle seed when absent. */
  readonly threatSeed?: number | undefined;
  /** Tick to resume at; 0 starts from the beginning. */
  readonly tick: number;
}

export interface OpponentOption {
  readonly id: string;
  readonly label: string;
}

const PVE_ROUNDS: readonly number[] = [1, 3, 9];

/** Every opponent the picker offers: ghosts of the reference boards, then threats. */
export function opponentOptions(): readonly OpponentOption[] {
  const out: OpponentOption[] = REFERENCE_BOARDS.map((b) => ({
    id: `ghost:${b}`,
    label: `Ghost of the "${b}" board`,
  }));
  for (const a of threatsConfig.archetypes) {
    const type: ThreatType = a.bossOnly ? 'boss' : 'medium';
    for (const round of PVE_ROUNDS) {
      out.push({
        id: `pve:${a.id}:${String(round)}:${type}`,
        label: `${archetypeText(a.id).name} (${type}), round ${String(round)}`,
      });
    }
  }
  out.push({ id: STRESS_ID, label: 'Stress test: hundreds of units' });
  return out;
}

/** The unit the stress test's waves are made of: the first one of the content. */
function stressUnit(): string {
  const first = content.units.list()[0];
  if (first === undefined) throw new Error('The content has no units.');
  return first.id;
}

/** Two copies of the party's board, with scripted waves of units. */
export const STRESS_ID = 'stress';

export const DEFAULT_SELECTION: SampleSelection = {
  player: 'rush',
  opponent: 'pve:arch_rusher:1:medium',
  seed: 1,
  tick: 0,
};

const isBoard = (v: string | null): v is ReferenceBoardName =>
  REFERENCE_BOARDS.some((b) => b === v);

/** Read a selection from a URL hash; anything missing or unknown is default. */
export function parseSampleHash(hash: string): SampleSelection {
  const q = hash.indexOf('?');
  const params = new URLSearchParams(q < 0 ? '' : hash.slice(q + 1));
  const p = params.get('p');
  const o = params.get('o');
  const known = opponentOptions().some((x) => x.id === o);
  const num = (key: string, fallback: number): number => {
    const n = Number(params.get(key));
    return params.has(key) && Number.isInteger(n) && n >= 0 && n <= 0xffffffff
      ? n
      : fallback;
  };
  const threatSeed = params.has('ts') ? num('ts', -1) : -1;
  return {
    player: isBoard(p) ? p : DEFAULT_SELECTION.player,
    opponent: known && o !== null ? o : DEFAULT_SELECTION.opponent,
    seed: num('s', DEFAULT_SELECTION.seed),
    ...(threatSeed >= 0 ? { threatSeed } : {}),
    tick: num('t', 0),
  };
}

export function formatSampleHash(sel: SampleSelection): string {
  const params = new URLSearchParams({
    p: sel.player,
    o: sel.opponent,
    s: String(sel.seed),
  });
  if (sel.threatSeed !== undefined) params.set('ts', String(sel.threatSeed));
  if (sel.tick > 0) params.set('t', String(sel.tick));
  return `#battle?${params.toString()}`;
}

export interface Sample {
  readonly battle: BattleDescription;
  readonly opponent: OpponentInfo;
  readonly title: string;
  /** The reward / cost line of the summary for this kind of battle. */
  readonly reward: (won: boolean) => string;
}

/** Build the battle a selection names. Deterministic in the selection. */
export function buildSample(sel: SampleSelection): Sample {
  const team = buildReferenceBoard(sel.player, content, content.mapgen);
  const [kind, a, b, c] = sel.opponent.split(':');
  if (kind === 'pve' && a !== undefined && b !== undefined && c !== undefined) {
    const round = Number(b);
    const threat = generateThreat(
      {
        seed: sel.threatSeed ?? sel.seed,
        round,
        type: c as ThreatType,
        partySize: team.map.partySize,
        archetype: a,
      },
      content,
      { threats: threatsConfig, mapgen: content.mapgen },
    );
    const boss = c === 'boss';
    return {
      battle: { kind: 'pve', input: { team, threat, seed: sel.seed } },
      opponent: {
        name: `${archetypeText(a).name} threat, round ${String(round)}`,
        kind: boss ? 'boss' : 'pve',
        label: boss ? bossLabel() : archetypeText(a).name,
      },
      title: `Round ${String(round)} · Stronghold battle`,
      reward: (w) => sampleReward('pve', w),
    };
  }
  if (kind === STRESS_ID) {
    // Both sides get the same four-plot (96 cells wide) board, a steady
    // stream of units and sturdy Cores. Units are circles that push each
    // other apart softly, so a crowd flows through the corridors and the
    // front line is wide: several hundred units meet in the middle on four
    // plots.
    const wide = buildSampleTeam(
      generateMap(sel.seed, 4, content, content.mapgen),
      content,
      sel.seed,
    );
    const waves = Array.from({ length: 12 }, (_, i) => ({
      tick: 20 + i * 40,
      unit: stressUnit(),
      count: 40,
    }));
    const options = {
      scheduledWaves: waves,
      coreHealths: [5000, 5000, 5000, 5000],
    };
    return {
      battle: {
        kind: 'versus',
        input: {
          teamA: wide,
          teamB: wide,
          seed: sel.seed,
          sideOptions: [options, options],
        },
      },
      opponent: { name: 'stress test', kind: 'ghost' },
      title: 'Sample · stress test',
      reward: (w) => sampleReward('versus', w),
    };
  }
  const ghostBoard = isBoard(a ?? null) ? (a as ReferenceBoardName) : 'rush';
  const teamB = buildReferenceBoard(ghostBoard, content, content.mapgen);
  return {
    battle: {
      kind: 'versus',
      input: { teamA: team, teamB, seed: sel.seed },
    },
    opponent: {
      name: `ghost of the "${ghostBoard}" board`,
      kind: 'ghost',
    },
    title: 'Sample · Rival party battle',
    reward: (w) => sampleReward('versus', w),
  };
}

/**
 * Placeholder reward text for the sample route, by what was fought: a won
 * battle pays gold; a lost PvE battle costs nothing and pays nothing; a lost
 * PvP battle costs a life and pays consolation gold (wireframe 8).
 */
export function sampleReward(
  kind: BattleDescription['kind'],
  won: boolean,
): string {
  if (won) return '+3 gold';
  return kind === 'pve' ? 'No reward' : '-1 life · +1 gold';
}
