/**
 * Border links for the scripted bot (issue #140, PP-4, CP-30).
 *
 * Where one player has a spare collector and the neighbour holds a consumer
 * that its own collectors cannot feed, the two draw the halves of a link at
 * an agreed border spot. Planning runs the pure core rules on a copy of the
 * team, so every intent returned was already checked; the bot then sends
 * each one as the player who owns it. The spot is the nearest free border
 * cell to the sender's collector, which makes the choice deterministic.
 */
import {
  addConduit,
  occupancy,
  sealedProducers,
  type Cell,
  type Content,
  type Rng,
  type TeamState,
} from '@game/core';
import {
  MIN_COVERAGE_PERCENT,
  boxOf,
  collectorSupply,
  consumerNeed,
  coveragePercent,
  defOf,
  freeCells,
  freeNodes,
  makeEnv,
  nearby,
  outsideCell,
  route,
  shuffle,
  sideLength,
  sizeOf,
  withPlace,
  type Env,
  type LayoutStyle,
  type Plan,
} from './bot-layout.js';
import type { BoardIntent } from './types.js';

/** A board intent and the player who sends it. */
export interface PlayerIntent {
  readonly player: number;
  readonly intent: BoardIntent;
}

/** Sending half: from the placed source to the nearest free border cell. */
function withSendingHalf(
  env: Env,
  plan: Plan,
  sourceId: number,
  border: number,
  borderX: number,
): { plan: Plan; y: number } | null {
  const t = plan.team;
  const s = t.buildings.find((b) => b.id === sourceId);
  if (s === undefined) return null;
  const outSide = occupancy(t, env.content).absoluteSides(s).outputs[0];
  if (outSide === undefined) return null;
  const sb = boxOf(env, s);
  const start = outsideCell(s, sb.w, sb.h, outSide, 0);
  const free = freeCells(env, t);
  const targets: Cell[] = [];
  for (let y = 0; y < t.map.height; y++) {
    if (free(borderX, y)) targets.push({ x: borderX, y });
  }
  const path = route(t, free, start, targets);
  const end = path?.[path.length - 1];
  if (path === null || end === undefined) return null;
  const from = { building: s.id, side: outSide };
  const to = { border, y: end.y };
  const r = addConduit(t, env.content, {
    actor: env.player,
    from,
    to,
    cells: path,
  });
  if (!r.ok) return null;
  return {
    plan: {
      team: r.state,
      out: [...plan.out, { type: 'add_conduit', from, to, cells: path }],
    },
    y: end.y,
  };
}

/** Place the consumer near the border cell and draw the receiving half. */
function withReceivingHalf(
  env: Env,
  plan: Plan,
  consumerId: number,
  border: number,
  borderX: number,
  y: number,
): Plan | null {
  const item = plan.team.stash.find((b) => b.id === consumerId);
  if (item === undefined) return null;
  const size = sizeOf(env, item.def);
  for (const pos of nearby(env, { x: borderX, y }, size.w)) {
    const placed = withPlace(env, plan, consumerId, pos.x, pos.y);
    if (placed === null) continue;
    const t = placed.team;
    const c = t.buildings.find((b) => b.id === consumerId);
    if (c === undefined) continue;
    const input = occupancy(t, env.content).absoluteSides(c).inputs[0];
    if (input === undefined) continue;
    const cb = boxOf(env, c);
    const targets: Cell[] = [];
    for (let i = 0; i < sideLength(input.side, cb.w, cb.h); i++) {
      targets.push(outsideCell(c, cb.w, cb.h, input.side, i));
    }
    const path = route(t, freeCells(env, t), { x: borderX, y }, targets);
    if (path === null) continue;
    const from = { border, y };
    const to = { building: c.id, side: input.side };
    const r = addConduit(t, env.content, {
      actor: env.player,
      from,
      to,
      cells: path,
    });
    if (!r.ok) continue;
    return {
      team: r.state,
      out: [...placed.out, { type: 'add_conduit', from, to, cells: path }],
    };
  }
  return null;
}

function planOneLink(
  team: TeamState,
  content: Content,
  plotWidth: number,
  style: LayoutStyle,
  rng: Rng,
  border: number,
  sender: number,
  receiver: number,
): { team: TeamState; steps: PlayerIntent[] } | null {
  const se = makeEnv(team, sender, content, plotWidth, style, rng);
  const re = makeEnv(team, receiver, content, plotWidth, style, rng);
  const source = team.stash.find(
    (x) => x.owner === sender && defOf(se, x.def)?.kind === 'source',
  );
  if (source === undefined) return null;
  const supply = collectorSupply(content, source.def, source.tier);
  const needy = team.stash
    .filter((x) => {
      const d = defOf(re, x.def);
      return (
        x.owner === receiver &&
        d !== undefined &&
        d.kind !== 'route' &&
        d.kind !== 'source' &&
        d.inputs.length > 0 &&
        // Left in the stash by the layout: its own collectors did not
        // reach it. The sender's spare collector can feed it.
        coveragePercent(supply, consumerNeed(content, x.def, x.tier)) >=
          MIN_COVERAGE_PERCENT
      );
    })
    .sort((a, b) => b.tier - a.tier || a.id - b.id);
  // The border column of each plot at this border.
  const sx = sender === border ? se.x1 - 1 : se.x0;
  const rx = sender === border ? re.x0 : re.x1 - 1;
  for (const consumer of needy) {
    const resource = defOf(re, consumer.def)?.inputs[0]?.resource;
    if (resource === undefined) continue;
    const nodes = shuffle(freeNodes(se, team, resource), rng)
      .sort((a, c) => Math.abs(a.x - sx) - Math.abs(c.x - sx))
      .slice(0, 6);
    for (const node of nodes) {
      const placed = withPlace(
        se,
        { team, out: [] },
        source.id,
        node.x,
        node.y,
      );
      if (placed === null) continue;
      const half = withSendingHalf(se, placed, source.id, border, sx);
      if (half === null) continue;
      const sent = half.plan.out.length;
      const full = withReceivingHalf(
        re,
        half.plan,
        consumer.id,
        border,
        rx,
        half.y,
      );
      if (full === null) continue;
      if (sealedProducers(full.team, content).length > se.baselineSealed) {
        continue;
      }
      return {
        team: full.team,
        steps: full.out.map((intent, i) => ({
          player: i < sent ? sender : receiver,
          intent,
        })),
      };
    }
  }
  return null;
}

/**
 * Plan at most one border link per border: the sender has a spare collector
 * in its stash, the receiver an unplaced consumer its own collectors cannot
 * feed but the sender's can. The neighbour with more spare collectors sends
 * (ties: the lower player). The sender puts the collector on a node of the
 * resource and draws a sending half to a border spot; the receiver places the
 * consumer near the spot and draws the receiving half. A link that does not
 * fit completely is not returned.
 */
export function planLinks(
  team: TeamState,
  content: Content,
  plotWidth: number,
  style: LayoutStyle,
  rng: Rng,
): PlayerIntent[] {
  const out: PlayerIntent[] = [];
  let cur = team;
  for (let b = 0; b + 1 < team.map.partySize; b++) {
    const spare = (p: number): number =>
      cur.stash.filter(
        (x) => x.owner === p && content.buildings.get(x.def)?.kind === 'source',
      ).length;
    const first = spare(b + 1) > spare(b) ? b + 1 : b;
    for (const sender of [first, first === b ? b + 1 : b]) {
      const receiver = sender === b ? b + 1 : b;
      const done = planOneLink(
        cur,
        content,
        plotWidth,
        style,
        rng,
        b,
        sender,
        receiver,
      );
      if (done !== null) {
        cur = done.team;
        out.push(...done.steps);
        break;
      }
    }
  }
  return out;
}
