/**
 * The Battle screen (W2-8): plays a battle back from its event log. The party
 * gives no input; the screen decides nothing. `BattleView` takes a battle
 * description and the run flow wires it up later (#25); `BattleSampleScreen`
 * is the `#battle` route with a picker of sample battles.
 */

import { hashJson, type TeamState } from '@game/core';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { BoardView, type OverlayContext } from '../board/BoardView.js';
import { DEFAULT_ZOOM } from '../board/camera.js';
import { CameraController } from '../board/controller.js';
import {
  buildScene,
  enemyCoreCentre,
  type NeutralView,
  type Scene,
} from '../board/scene.js';
import { content, type WebContent } from '../content.js';
import {
  DEBUG_HOOK,
  type DebugScene,
  type DebugSceneSide,
  registerDebug,
  unregisterDebug,
} from '../debug-hook.js';
import { AppShell } from '../shell/AppShell.js';
import './battle.css';
import {
  coreNameOf,
  deriveMoments,
  geometryOf,
  clock,
  sideStats,
  type Moment,
} from './derive.js';
import { drawBattleOverlay, makeDrawIndex } from './draw.js';
import { BattleSummaryView, LeftPanels, RightPanels } from './panels.js';
import {
  Playback,
  replayMatches,
  simulateRecord,
  type BattleRecord,
  type PlaybackSpeed,
} from './playback.js';
import {
  buildSample,
  formatSampleHash,
  opponentOptions,
  parseSampleHash,
  type SampleSelection,
} from './samples.js';
import { overloadLine } from '../choice/overload.js';
import { createReadyGate } from './ready-gate.js';
import { battleConfig } from './setup.js';
import type { BattleDescription, BattleViewProps } from './types.js';
import { REFERENCE_BOARDS } from '@game/core';

/** How long the zone stays hidden before playback begins, in milliseconds. */
export const INTRO_MS = 1200;

type Phase = 'playing' | 'summary';

/** Animation frame intervals while playing, for the smoke script's perf check. */
const frameTimes: number[] = [];

interface Prep {
  readonly record: BattleRecord;
  readonly pb: Playback;
  readonly geo: ReturnType<typeof geometryOf>;
  /** The scene at tick 0, for what the draw index and the camera need. */
  readonly init: Scene;
  readonly enemyCentre: { x: number; y: number } | null;
}

const MISMATCH = Symbol('replay mismatch');

/**
 * Simulate a battle and set up its playback. Depends on the battle (and the
 * tick to resume at) alone; everything that depends on who the opponent is
 * is derived in `BattleStage`, so a changed opponent needs no re-simulation.
 */
function prepare(
  battle: BattleDescription,
  initialTick: number,
  storedHash: string | undefined,
): Prep | string | typeof MISMATCH {
  const made = simulateRecord(battle, content, battleConfig);
  if (!made.ok) return made.error.message;
  const record = made.record;
  if (storedHash !== undefined && !replayMatches(record, storedHash)) {
    return MISMATCH;
  }
  const pb = new Playback(battle, content, battleConfig, record);
  if (initialTick > 0) pb.seekTo(initialTick);
  const init = buildScene(
    record.initialTeams[0],
    record.initialTeams[1],
    record.zone.depth,
    content,
  );
  return {
    record,
    pb,
    geo: geometryOf(record),
    init,
    enemyCentre: enemyCoreCentre(init),
  };
}

/**
 * What the debug hook reports of the visual state: per side, the building
 * kinds and the conduits' count (to check which board a scene shows).
 */
function sceneSummary(
  teams: readonly [TeamState, TeamState],
  c: WebContent,
): DebugScene {
  const side = (t: TeamState): DebugSceneSide => {
    const kinds: Record<string, number> = {};
    for (const b of t.buildings) {
      const def = c.buildings.get(b.def);
      const key = def === undefined ? b.def : `${def.kind}:${def.id}`;
      kinds[key] = (kinds[key] ?? 0) + 1;
    }
    return {
      buildings: t.buildings.length,
      conduits: t.conduits.length,
      kinds,
    };
  };
  return [side(teams[0]), side(teams[1])];
}

export function BattleView(props: BattleViewProps) {
  const [prep, setPrep] = useState<Prep | string | typeof MISMATCH | null>(
    null,
  );
  // `initialTick` is read once per battle, when the simulation is set up.
  const initialTick = useRef(props.initialTick ?? 0);
  initialTick.current = props.initialTick ?? 0;
  const latestStored = useRef(props.stored);
  latestStored.current = props.stored;

  // Simulate after the first paint, so the page shows "preparing" first.
  useEffect(() => {
    setPrep(null);
    let cancelled = false;
    let timer = 0;
    const raf = requestAnimationFrame(() => {
      timer = window.setTimeout(() => {
        if (cancelled) return;
        try {
          setPrep(
            prepare(
              props.battle,
              initialTick.current,
              latestStored.current?.eventLogHash,
            ),
          );
        } catch (e) {
          setPrep(e instanceof Error ? e.message : String(e));
        }
      }, 0);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
    // A new battle (a new description) is simulated afresh; nothing else is.
  }, [props.battle]);

  if (prep === MISMATCH) {
    const stored = props.stored;
    const won = stored?.won === true;
    return (
      <AppShell title={props.title} status={props.topBarExtra}>
        <div class="battle-preparing" id="battle-mismatch" role="status">
          <h2 class="result-title">
            <span data-field="result-word">{won ? 'Victory' : 'Defeat'}</span>
            {' · vs. '}
            {props.opponent.name}
          </h2>
          <p data-field="mismatch">
            This battle was fought under different rules and cannot be replayed.
            Result: {won ? 'Victory' : 'Defeat'},{' '}
            <span data-field="reward">{props.reward(won)}</span>
          </p>
          <button
            type="button"
            class="primary"
            onClick={() => {
              void props.onReady();
            }}
          >
            Ready
          </button>
        </div>
      </AppShell>
    );
  }
  if (prep === null || typeof prep === 'string') {
    return (
      <AppShell title={props.title} status={props.topBarExtra}>
        <div class="battle-preparing" id="battle-preparing" role="status">
          {prep === null ? 'Preparing the battle…' : `Cannot play: ${prep}`}
        </div>
      </AppShell>
    );
  }
  return <BattleStage {...props} prep={prep} />;
}

function BattleStage(props: BattleViewProps & { prep: Prep }) {
  const { prep, opponent } = props;
  const { pb, record, geo, init } = prep;
  const foeKind = opponent.kind;
  // The run state's outcome when there is one; the simulation's otherwise.
  const won = props.stored?.won ?? record.result.winner === 0;
  const foeWord = foeKind === 'ghost' ? 'Enemy' : 'Stronghold';
  const moments = useMemo(
    () =>
      deriveMoments(record, content, {
        side: ['Your', foeWord],
        coreName: coreNameOf(content),
        zoneRevealed: 'Neutral zone revealed',
        overload: 'Overload begins',
      }),
    [record, foeWord],
  );
  const index = useMemo(
    () =>
      makeDrawIndex(init, {
        own: 'YOUR BOARD',
        enemy: foeKind === 'ghost' ? 'ENEMY BOARD' : 'STRONGHOLD',
      }),
    [init, foeKind],
  );
  const tps = battleConfig.sim.ticksPerSecond;
  const [phase, setPhase] = useState<Phase>(
    pb.finished ? 'summary' : 'playing',
  );
  const [, setFrame] = useState(0);
  const [ready, setReady] = useState(false);
  const camera = useMemo(() => {
    // Starts at the centre of the map (the neutral zone); "Fit battle" is a
    // preset. A resize re-centres until the user pans or zooms.
    const c = new CameraController();
    c.startZoom = DEFAULT_ZOOM;
    c.refitOnResize = true;
    return c;
  }, []);
  const latest = useRef({ phase, ready, props });
  latest.current = { phase, ready, props };
  const force = (): void => {
    setFrame((n) => n + 1);
  };

  // Debug hook for the smoke script (removed again on unmount).
  useEffect(() => {
    registerDebug({
      battle: {
        phase: () => latest.current.phase,
        tick: () => pb.tick,
        endTick: () => pb.endTick,
        speed: () => pb.speed,
        paused: () => pb.paused,
        revealed: () => pb.revealed,
        result: () => ({
          winner: record.result.winner,
          reason: record.result.reason,
          endTick: record.result.endTick,
        }),
        coreHealth: () => [
          record.summary.sides[0].coreHealth,
          record.summary.sides[1].coreHealth,
        ],
        stateHash: () => hashJson(pb.sim),
        eventLogHash: () => hashJson(record.eventLog),
        storedEventLogHash: () =>
          latest.current.props.stored?.eventLogHash ?? null,
        unitsAlive: () => pb.sim.units.length,
        simMs: () => record.simMs,
        ready: () => latest.current.ready,
        scene: () => sceneSummary(pb.sim.teams, content),
        geometry: () => ({ width: geo.width, height: geo.height }),
        frameTimes: (reset) => {
          const out = frameTimes.slice();
          if (reset) frameTimes.length = 0;
          return out;
        },
        setSpeed: (s) => {
          pb.setSpeed(s);
          force();
        },
      },
    });
    return () => {
      unregisterDebug('battle');
    };
  }, [pb, record, geo]);

  // The intro: the zone stays hidden for a moment, then the battle begins.
  useEffect(() => {
    if (phase !== 'playing' || pb.started) return;
    const t = window.setTimeout(() => {
      pb.start();
      force();
    }, INTRO_MS);
    return () => {
      window.clearTimeout(t);
    };
  }, [phase, pb]);

  // The playback loop.
  useEffect(() => {
    if (phase !== 'playing') return;
    let raf = 0;
    let last = performance.now();
    let lastUi = 0;
    let lastSave = 0;
    const frame = (t: number): void => {
      const dt = t - last;
      last = t;
      if (DEBUG_HOOK && pb.started) {
        frameTimes.push(dt);
        if (frameTimes.length > 4000) frameTimes.shift();
      }
      pb.advance(dt);
      if (pb.finished) {
        latest.current.props.onTick?.(pb.tick);
        setPhase('summary');
        return;
      }
      if (t - lastUi >= 100) {
        lastUi = t;
        force();
      }
      if (t - lastSave >= 500 && pb.started) {
        lastSave = t;
        latest.current.props.onTick?.(pb.tick);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [phase, pb]);

  const drawData = useRef({ pb, geo, index, content });
  drawData.current = { pb, geo, index, content };
  const drawOverlay = useRef(
    (ctx: CanvasRenderingContext2D, o: OverlayContext) => {
      drawBattleOverlay(ctx, o, drawData.current);
    },
  );

  const revealed = pb.revealed;
  const neutral: NeutralView = useMemo(
    () => ({ features: record.zone.features, hidden: !revealed }),
    [record, revealed],
  );

  const onSpeed = (s: PlaybackSpeed): void => {
    pb.setSpeed(s);
    force();
  };
  const onPause = (): void => {
    pb.setPaused(!pb.paused);
    props.onTick?.(pb.tick);
    force();
  };
  const onSkip = (): void => {
    pb.skip();
    props.onTick?.(pb.tick);
    setPhase('summary');
  };
  const onWatchAgain = (): void => {
    pb.restart();
    props.onTick?.(0);
    setPhase('playing');
  };
  const gate = useRef<(() => void) | null>(null);
  gate.current ??= createReadyGate(
    () => latest.current.props.onReady(),
    setReady,
  );
  const onReady = (): void => {
    gate.current?.();
  };
  const onFocus = (m: Moment): void => {
    if (m.focus !== null) camera.focusAt(m.focus);
  };

  const timeText = clock(pb.tick, tps);
  const status = (
    <span class="battle-status">
      {props.topBarExtra}
      <span data-field="vs">vs. {opponent.name}</span>
      <span data-field="battle-time">Battle time {timeText}</span>
    </span>
  );

  if (phase === 'summary') {
    return (
      <AppShell title={`${props.title} · Summary`} status={status}>
        <BattleSummaryView
          pb={pb}
          content={content}
          opponent={opponent}
          title={props.title}
          moments={moments}
          rewardText={props.reward(won)}
          won={won}
          tps={tps}
          ready={ready}
          onWatchAgain={onWatchAgain}
          onReady={onReady}
        />
      </AppShell>
    );
  }

  const mine = sideStats(pb, content, 0, tps);
  const theirs = sideStats(pb, content, 1, tps);
  const overloadNote =
    foeKind === 'ghost'
      ? null
      : overloadLine(battleConfig.sim, record.coreMax[0], record.coreMax[1]);
  const overloadTick = moments.find((m) => m.kind === 'overload')?.tick ?? null;

  return (
    <AppShell
      title={props.title}
      status={status}
      left={
        <LeftPanels
          pb={pb}
          mine={mine}
          theirs={theirs}
          content={content}
          foeName={opponent.name}
          overloadTick={overloadTick}
          overloadNote={overloadNote}
          tps={tps}
        />
      }
      right={
        <RightPanels
          pb={pb}
          content={content}
          opponent={opponent}
          foeWord={foeWord}
          theirs={theirs}
          moments={moments}
          tps={tps}
          revealed={revealed}
          onSpeed={onSpeed}
          onPause={onPause}
          onSkip={onSkip}
          onFocus={onFocus}
          controller={camera}
          onEnemyBase={() => {
            if (prep.enemyCentre !== null) camera.focusAt(prep.enemyCentre);
          }}
        />
      }
    >
      <BoardView
        content={content}
        own={pb.sim.teams[0]}
        enemy={pb.sim.teams[1]}
        neutralHeight={record.zone.depth}
        neutral={neutral}
        neutralLabel={
          revealed
            ? 'Neutral zone'
            : 'Neutral zone (hidden until the battle begins)'
        }
        controller={camera}
        resetKey={record}
        drawOverlay={drawOverlay.current}
        animate
      />
      {!revealed ? (
        <div class="intro-banner" id="intro-banner" role="status">
          The battle is about to begin…
        </div>
      ) : null}
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// The `#battle` route

function readSelection(): SampleSelection {
  return parseSampleHash(window.location.hash);
}

export function BattleSampleScreen() {
  const [sel, setSel] = useState<SampleSelection>(readSelection);
  const [nonce, setNonce] = useState(0);
  const [readyCount, setReadyCount] = useState(0);
  // The tick changes while playing; the battle does not.
  const sample = useMemo(
    () => buildSample({ ...sel, tick: 0 }),
    [sel.player, sel.opponent, sel.seed, sel.threatSeed, nonce],
  );
  const options = useMemo(() => opponentOptions(), []);
  const [seedText, setSeedText] = useState(String(sel.seed));
  const initialTick = useRef(sel.tick);

  // The route state follows the hash when it is edited by hand (the screen's
  // own updates use `replaceState`, which does not fire `hashchange`). Any
  // change, the tick included, starts the battle over from what the hash says.
  useEffect(() => {
    const onHash = (): void => {
      if (!window.location.hash.startsWith('#battle')) return;
      const next = readSelection();
      initialTick.current = next.tick;
      setSel(next);
      setSeedText(String(next.seed));
      setReadyCount(0);
      setNonce((n) => n + 1);
    };
    window.addEventListener('hashchange', onHash);
    return () => {
      window.removeEventListener('hashchange', onHash);
    };
  }, []);

  const write = (next: SampleSelection): void => {
    history.replaceState(null, '', formatSampleHash(next));
  };

  const change = (patch: Partial<SampleSelection>): void => {
    // Picking something else drops a hand-typed threat seed.
    const next = { ...sel, ...patch, threatSeed: undefined, tick: 0 };
    initialTick.current = 0;
    setNonce((n) => n + 1);
    setSel(next);
    setReadyCount(0);
    write(next);
  };

  const picker = (
    <span class="dev-strip" id="battle-picker">
      <label>
        Your board{' '}
        <select
          id="pick-board"
          value={sel.player}
          onChange={(e) => {
            change({
              player: e.currentTarget.value as SampleSelection['player'],
            });
          }}
        >
          {REFERENCE_BOARDS.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </label>
      <label>
        Opponent{' '}
        <select
          id="pick-opponent"
          value={sel.opponent}
          onChange={(e) => {
            change({ opponent: e.currentTarget.value });
          }}
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Seed{' '}
        <input
          type="number"
          id="pick-seed"
          min="0"
          max="4294967295"
          value={seedText}
          onInput={(e) => {
            setSeedText(e.currentTarget.value);
          }}
          onChange={() => {
            const n = Math.floor(Number(seedText));
            if (Number.isFinite(n) && n >= 0 && n <= 0xffffffff) {
              change({ seed: n });
            }
          }}
        />
      </label>
      {readyCount > 0 ? (
        <span class="muted" id="sample-ready">
          Ready (sample route: nothing follows)
        </span>
      ) : null}
    </span>
  );

  return (
    <BattleView
      key={`${sel.player}|${sel.opponent}|${String(sel.seed)}|${String(sel.threatSeed)}|${String(nonce)}`}
      battle={sample.battle}
      opponent={sample.opponent}
      title={sample.title}
      reward={sample.reward}
      initialTick={initialTick.current}
      onTick={(t) => {
        write({ ...sel, tick: t });
      }}
      onReady={() => {
        setReadyCount((n) => n + 1);
        return Promise.resolve(true);
      }}
      topBarExtra={picker}
    />
  );
}
