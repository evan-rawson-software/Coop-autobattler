/**
 * The Battle screen (W2-8): plays a battle back from its event log. The party
 * gives no input; the screen decides nothing. `BattleView` takes a battle
 * description and the run flow wires it up later (#25); `BattleSampleScreen`
 * is the `#battle` route with a picker of sample battles.
 */

import { hashJson, type TeamState } from '@game/core';
import { Component, type ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { BoardView, type OverlayContext } from '../board/BoardView.js';
import { CameraController } from '../board/controller.js';
import { describeUnitAt } from './unit-hover.js';
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
import { GameFrame } from '../shell/GameFrame.js';
import './battle.css';
import {
  coreNameOf,
  deriveMoments,
  geometryOf,
  clock,
  sideStats,
  type Moment,
} from './derive.js';
import { coreMaxima } from './derive.js';
import { drawBattleOverlay, linkMap, makeDrawIndex } from './draw.js';
import {
  BattleSummaryView,
  BattleRail,
  PlaybackTray,
  StatsDrawer,
} from './panels.js';
import {
  Playback,
  replayMatches,
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
import { screenText, screenTexts } from '../build/texts.js';
import { overloadLine } from '../choice/overload.js';
import { simClient, type RecordOutcome } from '../sim-worker/client.js';
import { CannotShow } from './CannotShow.js';
import { readFailPlayback } from './cannot-show.js';
import { createReadyGate } from './ready-gate.js';
import { battleConfig } from './setup.js';
import type { BattleDescription, BattleViewProps } from './types.js';
import { REFERENCE_BOARDS } from '@game/core';

const t = (key: string, values: Record<string, string> = {}): string =>
  screenText(screenTexts, key, values);

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

/** Main-thread time of the last `prepare` (measurement only). */
let prepareMs = 0;

const MISMATCH = Symbol('replay mismatch');

/**
 * Simulate a battle and set up its playback. Depends on the battle (and the
 * tick to resume at) alone; everything that depends on who the opponent is
 * is derived in `BattleStage`, so a changed opponent needs no re-simulation.
 */
function prepare(
  battle: BattleDescription,
  made: RecordOutcome,
  initialTick: number,
  storedHash: string | undefined,
): Prep | string | typeof MISMATCH {
  if (!made.ok) return made.message;
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
  // The mismatch panel's Ready goes through the same gate as the summary's.
  const [mismatchReady, setMismatchReady] = useState(false);
  const latestProps = useRef(props);
  latestProps.current = props;
  const mismatchGate = useRef<(() => void) | null>(null);
  mismatchGate.current ??= createReadyGate(
    () => latestProps.current.onReady(),
    setMismatchReady,
  );

  // The simulation runs in a worker (or, without one, on the main thread
  // after a macrotask), so the page paints "preparing" first and stays
  // responsive. A new battle cancels the old request, and a result that
  // arrives for a request that was cancelled is never shown.
  useEffect(() => {
    setPrep(null);
    // Debug builds only: the playback fails on purpose (smoke check).
    if (DEBUG_HOOK && readFailPlayback()) {
      setPrep('Playback failure forced by the debug option.');
      return;
    }
    let cancelled = false;
    const handle = simClient.simulate(props.battle);
    handle.promise.then(
      (made) => {
        if (cancelled) return;
        try {
          const t0 = performance.now();
          const next = prepare(
            props.battle,
            made,
            initialTick.current,
            latestStored.current?.eventLogHash,
          );
          prepareMs = performance.now() - t0;
          setPrep(next);
        } catch (e) {
          setPrep(e instanceof Error ? e.message : String(e));
        }
      },
      (e: unknown) => {
        if (cancelled) return;
        setPrep(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      cancelled = true;
      handle.cancel();
      // Swallowed: a cancelled request rejects on purpose.
      handle.promise.catch(() => undefined);
    };
    // A new battle (a new description) is simulated afresh; nothing else is.
  }, [props.battle]);

  if (prep === MISMATCH) {
    const stored = props.stored;
    const won = stored?.won === true;
    return (
      <GameFrame
        phase="result"
        title={props.title}
        status={props.topBarExtra}
        primary={{
          id: 'battle-ready',
          label: mismatchReady
            ? t('battleReadyDone')
            : (props.continueText ?? t('battleContinue')),
          disabled: mismatchReady,
          onPress: () => {
            mismatchGate.current?.();
          },
        }}
        board={
          <div class="battle-preparing" id="battle-mismatch" role="status">
            <div>
              <h2 class="result-title">
                <span data-field="result-word">
                  {t(won ? 'battleVictory' : 'battleDefeat')}
                </span>
                {t('battleVsOpponent', { name: props.opponent.name })}
              </h2>
              <p data-field="mismatch">
                {t('battleMismatch', {
                  result: t(won ? 'battleVictory' : 'battleDefeat'),
                })}
                <span data-field="reward">{props.reward(won)}</span>
              </p>
            </div>
          </div>
        }
      />
    );
  }
  if (typeof prep === 'string') {
    return <CannotShowScreen {...props} message={prep} />;
  }
  if (prep === null) {
    return (
      <GameFrame
        phase="battle"
        title={props.title}
        status={props.topBarExtra}
        primary={null}
        board={
          <div class="battle-preparing" id="battle-preparing" role="status">
            Preparing the battle…
          </div>
        }
      />
    );
  }
  return (
    <PlaybackBoundary
      fallback={(message) => <CannotShowScreen {...props} message={message} />}
    >
      <BattleStage {...props} prep={prep} />
    </PlaybackBoundary>
  );
}

/**
 * A battle that cannot be displayed: the recorded outcome as text and a
 * Continue that advances the run as after a watched battle.
 */
function CannotShowScreen(props: BattleViewProps & { message: string }) {
  const stored = props.stored;
  return (
    <CannotShow
      title={props.title}
      status={props.topBarExtra}
      message={props.message}
      outcome={
        stored === undefined
          ? null
          : { won: stored.won, reason: stored.reason ?? null }
      }
      rewardText={stored === undefined ? undefined : props.reward(stored.won)}
      onContinue={props.onReady}
    />
  );
}

/** Catches a failure while drawing the battle and shows the fallback. */
class PlaybackBoundary extends Component<
  {
    fallback: (message: string) => ComponentChildren;
    children: ComponentChildren;
  },
  { error: string | null }
> {
  override state = { error: null as string | null };
  override componentDidCatch(e: unknown): void {
    this.setState({ error: e instanceof Error ? e.message : String(e) });
  }
  override render() {
    return this.state.error === null
      ? this.props.children
      : this.props.fallback(this.state.error);
  }
}

function BattleStage(props: BattleViewProps & { prep: Prep }) {
  const { prep, opponent } = props;
  const { pb, record, geo, init } = prep;
  const foeKind = opponent.kind;
  // The run state's outcome when there is one; the simulation's otherwise.
  const won = props.stored?.won ?? record.result.winner === 0;
  const foeWord = t(
    foeKind === 'ghost' ? 'battleSideEnemy' : 'battleSideStronghold',
  );
  const moments = useMemo(
    () =>
      deriveMoments(record, content, {
        side: [t('battleSideYour'), foeWord],
        coreName: coreNameOf(content),
        zoneRevealed: t('battleZoneRevealed'),
        overload: t('battleOverloadBegins'),
      }),
    [record, foeWord],
  );
  const index = useMemo(
    () =>
      makeDrawIndex(
        init,
        {
          own: t('battleBoardYou'),
          enemy: t('battleBoardThem', { name: opponent.name }),
        },
        [
          linkMap(record.initialTeams[0], content),
          linkMap(record.initialTeams[1], content),
        ],
      ),
    [init, opponent.name, record],
  );
  const tps = battleConfig.sim.ticksPerSecond;
  const [phase, setPhase] = useState<Phase>(
    pb.finished ? 'summary' : 'playing',
  );
  const [replay, setReplay] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [, setFrame] = useState(0);
  const [readyLocal, setReady] = useState(false);
  const ready = props.ready ?? readyLocal;
  const camera = useMemo(() => {
    // Starts at Fit, so the whole map (both boards) is in view; a resize
    // refits until the user pans or zooms.
    const c = new CameraController();
    c.resetPreset = 'fit';
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
        simInfo: () => ({
          usesWorker: simClient.usesWorker,
          ranOnMainThread: simClient.lastRanOnMainThread,
          roundTripMs: simClient.lastRoundTripMs,
          prepareMs,
        }),
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
        setReplay(false);
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
    setReplay(false);
    setPhase('summary');
  };
  const onWatchAgain = (): void => {
    pb.restart();
    setReplay(true);
    props.onTick?.(0);
    setPhase('playing');
  };
  // One gate per acting player: another player's Ready is a new press.
  const gate = useRef<{
    readonly acting: number | undefined;
    readonly press: () => void;
  } | null>(null);
  if (gate.current === null || gate.current.acting !== props.acting) {
    gate.current = {
      acting: props.acting,
      press: createReadyGate(() => latest.current.props.onReady(), setReady),
    };
  }
  const onReady = (): void => {
    gate.current?.press();
  };
  const onFocus = (m: Moment): void => {
    if (m.focus !== null) camera.focusAt(m.focus);
  };

  const timeText = clock(pb.tick, tps);
  const status = (
    <span class="battle-status">
      {props.topBarExtra}
      {replay ? (
        <span class="replay-label" data-field="replay">
          {t('battleReplay')}
        </span>
      ) : null}
      <span data-field="vs">vs. {opponent.name}</span>
      {phase === 'summary' ? (
        <span data-field="battle-time">Battle time {timeText}</span>
      ) : null}
    </span>
  );

  const board = (
    <>
      <BoardView
        content={content}
        own={pb.sim.teams[0]}
        enemy={pb.sim.teams[1]}
        basePlayer={props.acting}
        neutralHeight={record.zone.depth}
        neutral={neutral}
        neutralLabel={t(
          revealed ? 'battleNeutralZone' : 'battleNeutralZoneHidden',
        )}
        controller={camera}
        controls={false}
        resetKey={record}
        drawOverlay={drawOverlay.current}
        describeAt={(v) => describeUnitAt(pb, geo, content, v)}
        animate={phase === 'playing'}
      />
      {phase === 'playing' && !revealed ? (
        <div class="intro-banner" id="intro-banner" role="status">
          {t('battleIntro')}
        </div>
      ) : null}
    </>
  );
  const rail = {
    camera,
    onEnemyBase: () => {
      if (prep.enemyCentre !== null) camera.focusAt(prep.enemyCentre);
    },
  };

  if (phase === 'summary') {
    return (
      <GameFrame
        phase="result"
        title={`${props.title} · Summary`}
        status={status}
        rail={rail}
        board={board}
        tray={
          <button type="button" id="watch-again" onClick={onWatchAgain}>
            {t('battleWatchAgain')}
          </button>
        }
        primary={{
          id: 'battle-ready',
          label: ready
            ? t('battleReadyDone')
            : (props.continueText ?? t('battleContinue')),
          disabled: ready,
          onPress: onReady,
        }}
        info={
          <BattleSummaryView
            pb={pb}
            content={content}
            opponent={opponent}
            title={props.title}
            moments={moments}
            rewardText={props.reward(won)}
            won={won}
            tps={tps}
          />
        }
      />
    );
  }

  const mine = sideStats(pb, content, 0, tps);
  const theirs = sideStats(pb, content, 1, tps);
  const overloadNote =
    foeKind === 'ghost'
      ? null
      : overloadLine(
          battleConfig.sim,
          coreMaxima(record, 0),
          coreMaxima(record, 1),
        );
  const overloadTick = battleConfig.sim.overloadStartTick;

  return (
    <GameFrame
      phase="battle"
      title={props.title}
      status={status}
      rail={rail}
      board={board}
      tray={
        <PlaybackTray
          pb={pb}
          overloadTick={overloadTick}
          tps={tps}
          onSpeed={onSpeed}
          onPause={onPause}
        />
      }
      primary={{
        id: 'skip',
        label: t(replay ? 'battleBackToResults' : 'battleSkip'),
        onPress: onSkip,
      }}
      info={
        <BattleRail
          pb={pb}
          mine={mine}
          theirs={theirs}
          content={content}
          moments={moments}
          overloadTick={overloadTick}
          tps={tps}
          revealed={revealed}
          statsOpen={statsOpen}
          onToggleStats={() => {
            setStatsOpen((o) => !o);
          }}
          drawer={
            <StatsDrawer
              pb={pb}
              mine={mine}
              theirs={theirs}
              content={content}
              foeName={opponent.name}
              moments={moments}
              overloadTick={overloadTick}
              overloadNote={overloadNote}
              tps={tps}
              revealed={revealed}
              onFocus={onFocus}
            />
          }
        />
      }
    />
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
