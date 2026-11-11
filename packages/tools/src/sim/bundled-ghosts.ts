/**
 * `pnpm sim ghosts`: play bot runs with the ghost pool on and write the
 * snapshots taken before each PvP battle to the bundled ghost file (W3-2).
 *
 * Deterministic: the same content and rules give the same bytes. Owner ids
 * and labels name the strategy, so the pool shows them as bundled bots.
 * Every snapshot is checked with the real validation before it is written.
 */
import {
  checkGhostSnapshotShape,
  ghostBucketKey,
  validateGhostSnapshot,
  type GhostSnapshot,
} from '@game/core';
import {
  BOT_STRATEGIES,
  BUNDLED_GHOST_FORMAT,
  BUNDLED_OWNER_PREFIX,
  createGameDeps,
  ghostBucketFor,
  ghostContext,
  playBotRun,
  presentCandidates,
  type BotStrategyName,
  type BundledGhostFile,
  type Json,
  type RunDeps,
} from '@game/session';
import type { SimContext } from './context.js';

/** The game version the bundled snapshots are taken on (`major.minor`). */
export const BUNDLED_GAME_VERSION = '0.1';
/** Party sizes covered. */
export const BUNDLED_PARTY_SIZES = [1, 2, 3, 4] as const;
/** The last PvP round covered (each run is stopped after it). */
export const BUNDLED_LAST_ROUND = 6;
/** Bot seeds played per strategy and party size. */
export const BUNDLED_SEEDS = 8;
/** The most ghosts kept per bucket (version, party size, round). */
export const BUNDLED_PER_BUCKET = 4;
/** Where the web build reads the file, relative to the repository root. */
export const BUNDLED_GHOST_PATH = 'packages/web/src/run/bundled-ghosts.json';

const NAMES = ['Ann', 'Bo', 'Cy', 'Di'];

function depsFor(ctx: SimContext, strategy: BotStrategyName): RunDeps {
  return createGameDeps(
    ctx.content,
    {
      mapgen: ctx.mapgen,
      economy: ctx.economy,
      events: ctx.events,
      threats: ctx.threats,
      sim: ctx.sim,
    },
    {
      ghosts: {
        ownerId: `${BUNDLED_OWNER_PREFIX}${strategy}`,
        ownerLabel: `Bundled ${strategy} bot`,
      },
    },
  );
}

/** Check a snapshot as the selection would; the problems, or none. */
export function bundledProblems(
  raw: unknown,
  ctx: SimContext,
  deps: RunDeps,
): string[] {
  const vctx = ghostContext(deps);
  if (vctx === null) return ['ghosts are off in these deps'];
  const v = validateGhostSnapshot(raw, vctx);
  if (!v.ok) return [...v.errors];
  const shape = checkGhostSnapshotShape(
    raw,
    ctx.content,
    ctx.mapgen,
    undefined,
    vctx,
  );
  return shape.ok ? [] : [...shape.errors];
}

/** The bundled file, as the object that is written. */
export function buildBundledGhostFile(ctx: SimContext): BundledGhostFile {
  const all: GhostSnapshot[] = [];
  // Earlier runs are the pool of later ones, as in play: a bot meets a ghost
  // made by a previous bot of its bucket where one exists, else the boss.
  // (Against the boss alone no bot of a party of 3 or 4 survives round 5.)
  const pool = new Map<string, GhostSnapshot[]>();
  for (const party of BUNDLED_PARTY_SIZES) {
    for (let seed = 1; seed <= BUNDLED_SEEDS; seed++) {
      for (const strategy of BOT_STRATEGIES) {
        const deps = depsFor(ctx, strategy);
        const result = playBotRun(
          deps,
          {
            runId: `bundled-${strategy}-p${String(party)}-s${String(seed)}`,
            runVersion: BUNDLED_GAME_VERSION,
            seed,
            players: NAMES.slice(0, party),
            host: 0,
          },
          {
            strategy,
            seed,
            rerollCost: ctx.economy.rerollCost,
            maxRounds: BUNDLED_LAST_ROUND,
            candidates: (state) => {
              const vctx = ghostContext(deps);
              const rows = pool.get(ghostBucketKey(ghostBucketFor(state)));
              return vctx === null || rows === undefined
                ? []
                : (presentCandidates(rows, state, vctx) as unknown as Json);
            },
          },
        );
        if (result.rejected.length > 0) {
          throw new Error(
            `bundled ghosts: ${strategy} party ${String(party)} seed ${String(seed)} had rejected intents`,
          );
        }
        for (const snapshot of result.snapshots) {
          if (snapshot.round > BUNDLED_LAST_ROUND) continue;
          const problems = bundledProblems(snapshot, ctx, deps);
          if (problems.length > 0) {
            throw new Error(
              `bundled ghosts: invalid snapshot ${snapshot.runId} round ${String(snapshot.round)}: ${problems[0] ?? ''}`,
            );
          }
          all.push(snapshot);
          const key = ghostBucketKey(snapshot);
          const rows = pool.get(key);
          if (rows === undefined) pool.set(key, [snapshot]);
          else rows.push(snapshot);
        }
      }
    }
  }
  // A ghost's run stays excluded for the rest of a player's run, so no run
  // may supply the bucket of two rounds (of one party size): a fresh player
  // would otherwise run out of bundled ghosts after a few rounds. Rounds are
  // filled from the deepest down (few runs reach it), each taking the first
  // BUNDLED_PER_BUCKET runs not used yet, in generation order (seeds outer,
  // strategies inner, so they spread over the strategies).
  const ghosts: GhostSnapshot[] = [];
  const used = new Set<string>();
  for (const party of BUNDLED_PARTY_SIZES) {
    for (let round = BUNDLED_LAST_ROUND; round >= 1; round--) {
      let have = 0;
      for (const snapshot of all) {
        if (have >= BUNDLED_PER_BUCKET) break;
        if (snapshot.partySize !== party || snapshot.round !== round) continue;
        if (used.has(snapshot.runId)) continue;
        used.add(snapshot.runId);
        ghosts.push(snapshot);
        have++;
      }
      if (have < BUNDLED_PER_BUCKET) {
        throw new Error(
          `bundled ghosts: only ${String(have)} unused runs reach round ${String(round)} with party ${String(party)}; raise BUNDLED_SEEDS`,
        );
      }
    }
  }
  ghosts.sort(
    (a, b) =>
      a.partySize - b.partySize ||
      a.round - b.round ||
      (a.owner.id < b.owner.id ? -1 : a.owner.id > b.owner.id ? 1 : 0) ||
      (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0),
  );
  return {
    format: BUNDLED_GHOST_FORMAT,
    gameVersion: BUNDLED_GAME_VERSION,
    ghosts,
  };
}

/** The file text: compact JSON, one snapshot per line, final newline. */
export function bundledGhostText(file: BundledGhostFile): string {
  const head = `{"format":${String(file.format)},"gameVersion":${JSON.stringify(file.gameVersion)},"ghosts":[`;
  return `${head}\n${file.ghosts.map((g) => JSON.stringify(g)).join(',\n')}\n]}\n`;
}

/** Ghosts per party size (rows) and round (columns), as text. */
export function bundledSummary(file: BundledGhostFile): string {
  const counts = new Map<string, number>();
  for (const g of file.ghosts as readonly GhostSnapshot[]) {
    const k = `${String(g.partySize)}|${String(g.round)}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const rounds: number[] = [];
  for (let r = 1; r <= BUNDLED_LAST_ROUND; r++) rounds.push(r);
  const lines = [`party \\ round  ${rounds.join('  ')}`];
  for (const p of BUNDLED_PARTY_SIZES) {
    const row = rounds.map((r) =>
      String(counts.get(`${String(p)}|${String(r)}`) ?? 0),
    );
    lines.push(`${String(p)}               ${row.join('  ')}`);
  }
  return lines.join('\n');
}
