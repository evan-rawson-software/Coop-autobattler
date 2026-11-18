import { describe, expect, test, vi } from 'vitest';
import { listLegalCorePositions } from '@game/core';
import { content } from '../content.js';
import { BuildSession } from '../build/session.js';
import {
  cuesForDispatch,
  playOnce,
  runOverCue,
  soundForDispatch,
  takeRunEnded,
} from './moments.js';
import {
  cueForChange,
  cueForPress,
  installUiSounds,
  noteIntentSent,
} from './ui-sounds.js';
import { loadAudio } from '@game/audio';
import { rawAudio } from '@game/content';

const played = vi.hoisted(() => [] as string[]);
vi.mock('./index.js', () => ({
  playCue: (id: string) => {
    played.push(id);
    return true;
  },
}));

/** A session whose cues are recorded (a spy on `playCue`). */
async function solo(): Promise<BuildSession> {
  const s = await BuildSession.start(7);
  const pos = listLegalCorePositions(
    s.run.team.map,
    content,
    content.mapgen,
    0,
  )[0];
  if (pos === undefined) throw new Error('no spot');
  played.length = 0;
  await s.dispatch({ type: 'place_core', x: pos.x, y: pos.y });
  return s;
}

async function take(f: () => Promise<unknown>): Promise<string[]> {
  played.length = 0;
  await f();
  return [...played];
}

describe('every cue the web code names exists in the table', () => {
  test('cue IDs', () => {
    const r = loadAudio(rawAudio);
    if (!r.ok) throw new Error('audio.json');
    const names = [
      'build.place',
      'build.rotate',
      'build.move',
      'build.stash',
      'build.conduit_draw',
      'build.conduit_erase',
      'build.illegal',
      'shop.buy',
      'shop.sell',
      'shop.reroll',
      'shop.no_gold',
      'run.ready',
      'run.all_ready',
      'run.vote_cast',
      'run.vote_resolved',
      'run.event_chosen',
      'run.modifier_gained',
      'run.life_lost',
      'run.round_start',
      'run.over',
      'run.new_best',
      'ui.click',
      'ui.confirm',
      'ui.error',
      'ui.toggle',
    ];
    for (const n of names) expect(r.config.cues[n], n).toBeDefined();
  });
});

describe('build and shop intents', () => {
  test('placing the Core, then Ready, plays place and the step cue', async () => {
    const s = await BuildSession.start(7);
    const pos = listLegalCorePositions(
      s.run.team.map,
      content,
      content.mapgen,
      0,
    )[0];
    if (pos === undefined) throw new Error('no spot');
    expect(
      await take(() => s.dispatch({ type: 'place_core', x: pos.x, y: pos.y })),
    ).toEqual(['build.place']);
    const ready = await take(() => s.dispatch({ type: 'ready' }));
    expect(ready).toHaveLength(1);
    expect(['run.all_ready', 'run.round_start']).toContain(ready[0]);
  });

  test('place, rotate in place, move, stash and a refused placement', async () => {
    const s = await solo();
    await s.dispatch({ type: 'ready' });
    const item = s.run.team.stash[0];
    if (item === undefined) throw new Error('no stash');
    const at = (x: number, y: number, rotation = 0) => ({
      type: 'place_building' as const,
      id: item.id,
      x,
      y,
      rotation,
    });
    let spot: { x: number; y: number } | null = null;
    for (let y = 0; y < 12 && spot === null; y++)
      for (let x = 0; x < 12 && spot === null; x++) {
        const r = await s.dispatch(at(x, y));
        if (r.ok) spot = { x, y };
      }
    if (spot === null) throw new Error('could not place');
    expect(
      await take(() =>
        s.dispatch({
          type: 'move_building',
          id: item.id,
          x: spot.x,
          y: spot.y,
          rotation: 180,
        }),
      ),
    ).toEqual(['build.rotate']);
    expect(
      await take(() => s.dispatch({ type: 'return_building', id: item.id })),
    ).toEqual(['build.stash']);
    // A second building on top of the Core is refused.
    const core = s.run.team.cores.find((c) => c !== null);
    if (core === undefined) throw new Error('no core');
    expect(await take(() => s.dispatch(at(core.x, core.y)))).toEqual([
      'build.illegal',
    ]);
  });

  test('a refused buy for lack of gold, and a refused sell', async () => {
    const s = await solo();
    await s.dispatch({ type: 'ready' });
    const out = await take(() => s.dispatch({ type: 'sell', id: 9999 }));
    expect(out).toEqual(['ui.error']);
  });
});

describe('the pure mapping', () => {
  const fake = (_type: string, effects: object[] = [], extra = {}) => ({
    result: {
      ok: true as const,
      state: { team: { modifiers: [] }, runId: 'r' },
      effects,
      ...extra,
    },
  });
  const before = { team: { modifiers: [], buildings: [] } } as never;

  test('shop intents', () => {
    for (const [type, cue] of [
      ['buy', 'shop.buy'],
      ['sell', 'shop.sell'],
      ['reroll', 'shop.reroll'],
    ] as const)
      expect(
        cuesForDispatch({ type }, fake(type).result as never, before),
      ).toEqual([cue]);
    expect(
      cuesForDispatch(
        { type: 'buy', slot: 0 },
        { ok: false, reason: 'not_enough_gold' },
        before,
      ),
    ).toEqual(['shop.no_gold']);
    expect(
      cuesForDispatch(
        { type: 'reroll' },
        { ok: false, reason: 'not_enough_gold' },
        before,
      ),
    ).toEqual(['shop.no_gold']);
    expect(
      cuesForDispatch(
        { type: 'buy', slot: 0 },
        { ok: false, reason: 'no_such_offer' },
        before,
      ),
    ).toEqual(['ui.error']);
    expect(
      cuesForDispatch(
        { type: 'buy', slot: 0 },
        { ok: false, reason: 'stale' },
        before,
      ),
    ).toEqual([]);
  });

  test('conduits', () => {
    const add = { type: 'add_conduit' };
    expect(cuesForDispatch(add, fake('add').result as never, before)).toEqual([
      'build.conduit_draw',
    ]);
    expect(
      cuesForDispatch(
        { type: 'erase_conduit', id: 1 },
        fake('x').result as never,
        before,
      ),
    ).toEqual(['build.conduit_erase']);
    expect(
      cuesForDispatch(add, { ok: false, reason: 'blocked' }, before),
    ).toEqual(['build.illegal']);
  });

  test('ready, unready, everyone ready, a new round, the end of the run', () => {
    const r = (fx: object[]) => fake('ready', fx).result as never;
    expect(
      cuesForDispatch(
        { type: 'ready' },
        r([{ type: 'ready_changed' }]),
        before,
      ),
    ).toEqual(['run.ready']);
    expect(cuesForDispatch({ type: 'unready' }, r([]), before)).toEqual([
      'ui.toggle',
    ]);
    expect(
      cuesForDispatch({ type: 'ready' }, r([{ type: 'step_changed' }]), before),
    ).toEqual(['run.all_ready']);
    expect(
      cuesForDispatch(
        { type: 'ready' },
        r([{ type: 'step_changed' }, { type: 'round_started' }]),
        before,
      ),
    ).toEqual(['run.round_start']);
    expect(
      cuesForDispatch(
        { type: 'ready' },
        r([{ type: 'step_changed' }, { type: 'run_over' }]),
        before,
      ),
    ).toEqual([]);
  });

  test('votes, events and modifiers', () => {
    const r = (fx: object[], mods = 0) =>
      ({
        ok: true,
        state: { team: { modifiers: new Array(mods).fill({}) }, runId: 'r' },
        effects: fx,
      }) as never;
    expect(
      cuesForDispatch(
        { type: 'vote', choice: 'a' },
        r([{ type: 'vote_changed' }]),
        before,
      ),
    ).toEqual(['run.vote_cast']);
    expect(
      cuesForDispatch(
        { type: 'vote', choice: 'a' },
        r([{ type: 'vote_changed' }, { type: 'vote_resolved' }]),
        before,
      ),
    ).toEqual(['run.vote_resolved']);
    expect(
      cuesForDispatch({ type: 'event_choose', choice: 'a' }, r([]), before),
    ).toEqual(['run.event_chosen']);
    expect(
      cuesForDispatch({ type: 'event_choose', choice: 'a' }, r([], 1), before),
    ).toEqual(['run.modifier_gained']);
  });

  test('the sound call never throws and the run-over cue is once per page', () => {
    const play = vi.fn(() => {
      throw new Error('boom');
    });
    expect(() => {
      soundForDispatch(
        { type: 'buy' },
        { ok: false, reason: 'x' },
        before,
        play,
      );
    }).not.toThrow();
    const ended = fake('ready', [{ type: 'run_over' }]).result as never;
    soundForDispatch({ type: 'ready' }, ended, before, () => undefined);
    expect(takeRunEnded('r')).toBe(true);
    expect(takeRunEnded('r')).toBe(false);
    expect(runOverCue(true)).toBe('run.new_best');
    expect(runOverCue(false)).toBe('run.over');
    const spy = vi.fn();
    playOnce('k', 'run.life_lost', spy);
    playOnce('k', 'run.life_lost', spy);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('shared interface sounds', () => {
  const el = (over: Record<string, unknown>, selector = ''): Element =>
    ({
      disabled: false,
      closest: (sel: string) =>
        sel.startsWith('button') ? el(over, selector) : null,
      getAttribute: () => null,
      matches: (sel: string) => selector !== '' && sel.includes(selector),
      ...over,
    }) as unknown as Element;

  test('a press, a start button, a disabled button and a switch', () => {
    expect(cueForPress(el({}))).toBe('ui.click');
    expect(cueForPress(el({}, '#new-run-button'))).toBe('ui.confirm');
    expect(cueForPress(el({ disabled: true }))).toBeNull();
    expect(cueForPress(null)).toBeNull();
    expect(cueForChange({ tagName: 'INPUT', type: 'checkbox' } as never)).toBe(
      'ui.toggle',
    );
    expect(
      cueForChange({ tagName: 'INPUT', type: 'range' } as never),
    ).toBeNull();
  });

  test('a press that sent an intent plays nothing here', () => {
    const handlers = new Map<string, ((e: Event) => void)[]>();
    const doc = {
      addEventListener: (t: string, f: (e: Event) => void, cap?: boolean) => {
        const k = `${t}${cap === true ? ':c' : ''}`;
        handlers.set(k, [...(handlers.get(k) ?? []), f]);
      },
      removeEventListener: () => undefined,
    } as unknown as Document;
    const play = vi.fn();
    installUiSounds(doc, play);
    const click = (intent: boolean): void => {
      const ev = { target: el({}) } as unknown as Event;
      handlers.get('click:c')?.forEach((f) => {
        f(ev);
      });
      if (intent) noteIntentSent();
      handlers.get('click')?.forEach((f) => {
        f(ev);
      });
    };
    click(false);
    expect(play).toHaveBeenCalledTimes(1);
    click(true);
    expect(play).toHaveBeenCalledTimes(1);
  });
});
