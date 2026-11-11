/**
 * The Battle screen (W2-8): plays a battle back from its event log. The party
 * gives no input; the screen decides nothing. `BattleView` takes a battle
 * description and the run flow wires it up later (#25); `BattleSampleScreen`
 * is the `#battle` route with a picker of sample battles.
 */

import { hashJson } from '@game/core';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { BoardView, type OverlayContext } from '../board/BoardView.js';
import { CameraController } from '../board/controller.js';
import {
  buildScene,
  enemyCoreCentre,
  type NeutralView,
} from '../board/scene.js';
import { content } from '../content.js';
import { registerDebug } from '../debug-hook.js';
import { AppShell } from '../shell/AppShell.js';
import './battle.css';
import {
  deriveMoments,
  geometryOf,
  clock,
  sideStats,
  type Moment,
} from './derive.js';
import { drawBattleOverlay, makeDrawIndex, type DrawIndex } from './draw.js';
import { BattleSummaryView, LeftPanels, RightPanels } from './panels.js';
import {
  Playback,
  simulateRecord,
  type BattleRecord,
  type PlaybackSpeed,
} from './playback.js';
import {
  buildSample,
  formatSampleHash,
  opponentOptions,
  parseSampleHash,
  sampleReward,
  type SampleSelection,
} from './samples.js';
import { battleConfig } from './setup.js';
import type { BattleViewProps } from './types.js';
import { REFERENCE_BOARDS } from '@game/core';

/** How long the zone stays hidden before playback begins, in milliseconds. */
export const INTRO_MS = 1200;

type Phase = 'playing' | 'summary';

interface Prep {
  readonly record: BattleRecord;
  readonly pb: Playback;
  readonly moments: readonly Moment[];
  readonly index: DrawIndex;
  readonly geo: ReturnType<typeof geometryOf>;
  readonly enemyCentre: { x: number; y: number } | null;
}

function prepare(props: BattleViewProps): Prep | string {
  const made = simulateRecord(props.battle, content, battleConfig);
  if (!made.ok) return made.error.message;
  const record = made.record;
  const pb = new Playback(props.battle, content, battleConfig, record);
  if ((props.initialTick ?? 0) > 0) pb.seekTo(props.initialTick ?? 0);
  const coreDef = content.buildings.list().find((d) => d.kind === 'core');
  const coreName =
    (coreDef && content.presentation.get(coreDef.id)?.name) ?? 'Core';
  const foeWord = props.opponent.kind === 'ghost' ? 'Enemy' : 'Stronghold';
  const moments = deriveMoments(record, content, {
    side: ['Your', foeWord],
    coreName,
    zoneRevealed: 'Neutral zone revealed',
    overload: 'Overload begins',
  });
  const init = buildScene(
    record.initialTeams[0],
    record.initialTeams[1],
    record.zone.depth,
    content,
  );
  const index = makeDrawIndex(init, {
    own: 'YOUR BOARD',
    enemy: props.opponent.kind === 'ghost' ? 'ENEMY BOARD' : 'STRONGHOLD',
  });
  return {
    record,
    pb,
    moments,
    index,
    geo: geometryOf(record),
    enemyCentre: enemyCoreCentre(init),
  };
}

export function BattleView(props: BattleViewProps) {
  const [prep, setPrep] = useState<Prep | string | null>(null);

  // Simulate after the first paint, so the page shows "preparing" first.
  useEffect(() => {
    setPrep(null);
    let cancelled = false;
    let timer = 0;
    const raf = requestAnimationFrame(() => {
      timer = window.setTimeout(() => {
        if (cancelled) return;
        try {
          setPrep(prepare(props));
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
    // The battle is fixed for the life of one view; callers re-key to change it.
  }, [props.battle]);

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
  const { pb, record, moments, index, geo } = prep;
  const tps = battleConfig.sim.ticksPerSecond;
  const [phase, setPhase] = useState<Phase>(
    pb.finished ? 'summary' : 'playing',
  );
  const [, setFrame] = useState(0);
  const [ready, setReady] = useState(false);
  const camera = useMemo(() => {
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

  // Debug hook for the smoke script.
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
        unitsAlive: () => pb.sim.units.length,
        simMs: () => record.simMs,
        ready: () => latest.current.ready,
      },
    });
  }, [pb, record]);

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
  const onReady = (): void => {
    setReady(true);
    props.onReady();
  };
  const onFocus = (m: Moment): void => {
    if (m.focus !== null) camera.focusAt(m.focus);
  };

  const foeWord = opponent.kind === 'ghost' ? 'Enemy' : 'Stronghold';
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
          rewardText={props.reward(record.result)}
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
          tps={tps}
        />
      }
      right={
        <RightPanels
          pb={pb}
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
    [sel.player, sel.opponent, sel.seed, nonce],
  );
  const options = useMemo(() => opponentOptions(), []);
  const [seedText, setSeedText] = useState(String(sel.seed));
  const initialTick = useRef(sel.tick);

  // Follow the hash when it is changed by hand.
  useEffect(() => {
    const onHash = (): void => {
      if (!window.location.hash.startsWith('#battle')) return;
      const next = readSelection();
      setSel((cur) => {
        if (
          next.player === cur.player &&
          next.opponent === cur.opponent &&
          next.seed === cur.seed
        ) {
          return cur;
        }
        setNonce((n) => n + 1);
        return next;
      });
      initialTick.current = next.tick;
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
    const next = { ...sel, ...patch, tick: 0 };
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
      key={`${sel.player}|${sel.opponent}|${String(sel.seed)}|${String(nonce)}`}
      battle={sample.battle}
      opponent={sample.opponent}
      title={sample.title}
      reward={sampleReward}
      initialTick={initialTick.current}
      onTick={(t) => {
        write({ ...sel, tick: t });
      }}
      onReady={() => {
        setReadyCount((n) => n + 1);
      }}
      topBarExtra={picker}
    />
  );
}
