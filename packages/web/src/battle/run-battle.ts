/**
 * The battle of a run, for the Battle screen: what to play back, who the
 * opponent is, and the reward line. Read from the run state at a summary step
 * (`pve_summary`, `pvp_summary`), where the result and the stored `detail` of
 * the battle just fought live.
 *
 * `replayLastBattle` is the session's own check that the stored battle can be
 * re-created for this state (the party's team is the one that fought); the
 * description handed to `BattleView` is built from the same stored detail the
 * session's resolver replays from.
 */
import {
  readPveOption,
  replayLastBattle,
  type BattleDetail,
  type Json,
  type RunDeps,
  type RunState,
} from '@game/session';
import type { StorageLike } from '../run/local-storage-store.js';
import { archetypeText, bossLabel, bossName } from '../run/display-text.js';
import type { StoredOutcome } from './cannot-show.js';
import type { BattleDescription, OpponentInfo } from './types.js';
import { count } from '../plural.js';
import { screenText, screenTexts } from '../build/texts.js';

export interface RunBattle {
  /** What to play back; the screen simulates it and checks the hash below. */
  readonly battle: BattleDescription;
  /** Whether the party won, as stored in the run state (never re-derived). */
  readonly won: boolean;
  /** The event-log hash stored when the battle was resolved. */
  readonly storedEventLogHash: string;
  readonly opponent: OpponentInfo;
  readonly title: string;
  readonly kind: 'pve' | 'pvp';
  /** The reward line, from the stored outcome. */
  readonly reward: (won: boolean) => string;
  /** The stored end reason, for the "cannot be shown" text. */
  readonly reason: string | null;
}

export type RunBattleResult =
  | { readonly ok: true; readonly value: RunBattle }
  | {
      readonly ok: false;
      readonly message: string;
      /** The result the run recorded, if there is one (the run can go on). */
      readonly outcome: StoredOutcome | null;
    };

/**
 * The result the session layer recorded for the battle just fought, read from
 * the run state alone (nothing is re-derived); null when there is none.
 */
export function storedOutcome(run: RunState): StoredOutcome | null {
  const pending = isRecord(run.pending) ? run.pending : {};
  const stored = isRecord(pending['battle']) ? pending['battle'] : null;
  if (stored === null || typeof stored['won'] !== 'boolean') return null;
  const detail = isRecord(stored['detail']) ? stored['detail'] : null;
  const summary =
    detail !== null && isRecord(detail['summary']) ? detail['summary'] : null;
  const reason = summary?.['reason'];
  return {
    won: stored['won'],
    reason: typeof reason === 'string' ? reason : null,
  };
}

function isRecord(v: unknown): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const FAILURES: Readonly<Record<string, string>> = {
  wrong_step: 'battleFailWrongStep',
  no_replay: 'battleFailNoReplay',
  no_stored_battle: 'battleFailNoStoredBattle',
  team_changed: 'battleFailTeamChanged',
};

export function failureText(reason: string): string {
  // `reason` is arbitrary text: "constructor" must not find Object.prototype's.
  const key = Object.hasOwn(FAILURES, reason) ? FAILURES[reason] : undefined;
  return key === undefined ? cannotShow(reason) : screenText(screenTexts, key);
}

function cannotShow(reason: string): string {
  return screenText(screenTexts, 'battleCannotShow', { reason });
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The line under the result: what the battle paid or cost. */
export function rewardLine(
  kind: 'pve' | 'pvp',
  won: boolean,
  deps: Pick<RunDeps, 'rules' | 'rewards'>,
  pveGold: number | null,
): string {
  const rewards = deps.rewards;
  if (kind === 'pve') {
    return won
      ? pveGold === null
        ? 'Reward paid when you continue'
        : `+${String(pveGold)} gold when you continue`
      : 'No reward, and no life lost';
  }
  const cost = deps.rules.pvpLossLifeCost;
  if (won) {
    return rewards === undefined
      ? 'Reward paid when you continue'
      : `+${String(rewards.pvpWin)} gold when you continue`;
  }
  return `−${count(cost, 'life', 'lives')}${rewards === undefined ? '' : ` · +${String(rewards.pvpLoss)} gold consolation`}`;
}

/** Never throws: any failure becomes a result that cannot be shown. */
export function describeRunBattle(
  run: RunState,
  deps: Pick<RunDeps, 'battle' | 'rules' | 'rewards'>,
): RunBattleResult {
  try {
    const r = describeStoredBattle(run, deps);
    return r.ok
      ? r
      : { ok: false, message: r.message, outcome: storedOutcome(run) };
  } catch (e) {
    return {
      ok: false,
      message: cannotShow(e instanceof Error ? e.message : String(e)),
      outcome: storedOutcome(run),
    };
  }
}

type Described =
  | { readonly ok: true; readonly value: RunBattle }
  | { readonly ok: false; readonly message: string };

function describeStoredBattle(
  run: RunState,
  deps: Pick<RunDeps, 'battle' | 'rules' | 'rewards'>,
): Described {
  const replay = replayLastBattle(run, deps);
  if (!replay.ok) {
    return {
      ok: false,
      message: failureText(replay.reason),
    };
  }
  const pending = isRecord(run.pending) ? run.pending : {};
  const stored = isRecord(pending['battle']) ? pending['battle'] : null;
  const detail =
    stored !== null && isRecord(stored['detail'])
      ? (stored['detail'] as unknown as BattleDetail)
      : null;
  if (detail === null || stored === null) {
    return { ok: false, message: failureText('no_stored_battle') };
  }
  const opp = isRecord(stored['opponent']) ? stored['opponent'] : {};
  const oppKind = opp['kind'];
  const label = typeof opp['label'] === 'string' ? opp['label'] : '';
  const kind = detail.kind;
  const round = String(run.round);

  const source = detail.source;
  let battle: BattleDescription;
  let pveGold: number | null = null;
  if (source.type === 'ghost') {
    battle = {
      kind: 'versus',
      input: { teamA: run.team, teamB: source.team, seed: detail.seed },
    };
  } else {
    let threat;
    if (source.type === 'option') {
      const option = readPveOption(pending['option'], run.players.length);
      if (option === null) {
        return {
          ok: false,
          message: 'The chosen battle option was not stored.',
        };
      }
      threat = option.threat;
      pveGold = option.reward.gold;
    } else {
      threat = source.threat;
    }
    battle = {
      kind: 'pve',
      input: { team: run.team, threat, seed: detail.seed },
    };
  }

  let opponent: OpponentInfo;
  if (oppKind === 'ghost') {
    opponent = { name: label, kind: 'ghost' };
  } else if (oppKind === 'boss') {
    opponent = {
      name: bossName(archetypeText(label).name),
      kind: 'boss',
      label: bossLabel(),
    };
  } else {
    const arch = archetypeText(label).name;
    const difficulty = isRecord(pending['option'])
      ? pending['option']['difficulty']
      : undefined;
    opponent = {
      name:
        typeof difficulty === 'string'
          ? `${arch} (${capital(difficulty)})`
          : arch,
      kind: 'pve',
      label: arch,
    };
  }

  const won = stored['won'] === true;
  return {
    ok: true,
    value: {
      battle,
      won,
      reason: storedOutcome(run)?.reason ?? null,
      storedEventLogHash: replay.storedEventLogHash,
      opponent,
      kind,
      title: `Round ${round} · ${kind === 'pve' ? 'PvE' : 'PvP'} battle`,
      // `won` passed in is the stored outcome (see BattleViewProps.stored).
      reward: (w) => rewardLine(kind, w, deps, pveGold),
    },
  };
}

// ---------------------------------------------------------------------------
// Playback position, so a reload resumes mid-battle

const TICK_PREFIX = 'coop:tick:';

/** The key of the playback position of the battle that ended the last action. */
export function tickKey(run: RunState): string {
  return `${TICK_PREFIX}${run.runId}:${String(run.actionCounter)}`;
}

function tickStorage(given?: StorageLike): StorageLike | null {
  if (given !== undefined) return given;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readTick(key: string, storage?: StorageLike): number {
  try {
    const n = Number(tickStorage(storage)?.getItem(key) ?? 0);
    return Number.isInteger(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function writeTick(
  key: string,
  tick: number,
  storage?: StorageLike,
): void {
  try {
    const s = tickStorage(storage);
    if (s === null) return;
    if (tick > 0) s.setItem(key, String(tick));
    else s.removeItem(key);
  } catch {
    // Playback position is a convenience; losing it only restarts the replay.
  }
}

/** Forget the playback position of one battle (the player moved past it). */
export function clearTick(key: string, storage?: StorageLike): void {
  writeTick(key, 0, storage);
}

/** Forget every playback position of a run (it is over or removed). */
export function clearRunTicks(runId: string, storage?: StorageLike): void {
  try {
    const s = tickStorage(storage);
    if (s === null) return;
    const prefix = `${TICK_PREFIX}${runId}:`;
    const doomed: string[] = [];
    for (let i = 0; i < s.length; i += 1) {
      const k = s.key(i);
      if (k !== null && k.startsWith(prefix)) doomed.push(k);
    }
    for (const k of doomed) s.removeItem(k);
  } catch {
    // Nothing to clean when storage is unavailable.
  }
}
