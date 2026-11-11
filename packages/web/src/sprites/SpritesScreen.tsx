/**
 * The `#sprites` route: every sprite in the atlas at 1x, 2x and 4x, units in
 * both team tints, tiles tiled, 9-slices stretched, and a mock board patch.
 * A review page for the art; it plays no part in the game.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { AppShell } from '../shell/AppShell.js';
import './sprites.css';
import {
  getAtlas,
  drawFrame,
  drawNine,
  loadSheets,
  spriteOf,
  type Ramp,
  type Sheets,
} from './atlas.js';
import {
  MOCK_COLS,
  MOCK_ROWS,
  drawMockBoard,
  pickGround,
  pickNeutral,
} from './mock-board.js';

const px = (n: number): string => `${String(n)}px`;

// One animation loop drives only the canvases that animate; the rest are
// drawn once when they appear (or when their inputs change).
type Drawer = (t: number) => void;
const drawers = new Set<Drawer>();
let raf = 0;
function tick(t: number): void {
  for (const d of drawers) d(t);
  raf = requestAnimationFrame(tick);
}
function register(d: Drawer): () => void {
  drawers.add(d);
  if (drawers.size === 1) raf = requestAnimationFrame(tick);
  return () => {
    drawers.delete(d);
    if (drawers.size === 0) cancelAnimationFrame(raf);
  };
}

function useCanvasLoop(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, t: number) => void,
  deps: readonly unknown[],
  animated: boolean,
) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const paint = (t: number): void => {
      ctx.clearRect(0, 0, width, height);
      draw(ctx, t);
    };
    if (!animated) {
      paint(0);
      return;
    }
    return register(paint);
  }, [width, height, animated, ...deps]);
  return ref;
}

function SpriteCanvas(props: {
  sheets: Sheets;
  name: string;
  scale: number;
  ramp?: Ramp;
  /** Show every frame side by side instead of animating. */
  strip?: boolean;
}) {
  const sp = spriteOf(props.name);
  const strip = props.strip === true;
  const cols = strip ? (sp.columns ?? sp.frames) : 1;
  const rows = strip ? Math.ceil(sp.frames / cols) : 1;
  const w = sp.w * props.scale * cols;
  const h = sp.h * props.scale * rows;
  const ref = useCanvasLoop(
    w,
    h,
    (ctx, t) => {
      const opts = props.ramp ? { ramp: props.ramp } : {};
      if (strip) {
        for (let f = 0; f < sp.frames; f++)
          drawFrame(
            ctx,
            props.sheets,
            props.name,
            f,
            (f % cols) * sp.w * props.scale,
            Math.floor(f / cols) * sp.h * props.scale,
            props.scale,
            opts,
          );
      } else {
        const f = sp.fps > 0 ? Math.floor((t / 1000) * sp.fps) : 0;
        drawFrame(ctx, props.sheets, props.name, f, 0, 0, props.scale, opts);
      }
    },
    [props.sheets, props.name, props.scale, props.ramp, strip],
    !strip && sp.fps > 0,
  );
  return (
    <canvas
      ref={ref}
      class="px"
      width={w}
      height={h}
      style={{ width: px(w), height: px(h) }}
    />
  );
}

function SpriteCard(props: { sheets: Sheets; name: string }) {
  const sp = spriteOf(props.name);
  const strip = sp.fps === 0 && sp.frames > 1;
  const scales = strip ? [1, 2] : [1, 2, 4];
  return (
    <figure
      class={`sprite-card${strip && sp.frames > 6 ? ' wide' : ''}`}
      data-sprite={props.name}
    >
      <figcaption>
        <code>{props.name}</code>
        {sp.planned ? <span class="badge">planned</span> : null}
        <span class="meta">
          {sp.w}x{sp.h}
          {sp.frames > 1 ? ` x${String(sp.frames)}` : ''}
          {sp.fps > 0 ? ` @${String(sp.fps)}fps` : ''}
        </span>
      </figcaption>
      <div class="scales">
        {scales.map((s) => (
          <SpriteCanvas
            key={s}
            sheets={props.sheets}
            name={props.name}
            scale={s}
            strip={strip}
          />
        ))}
      </div>
    </figure>
  );
}

function namesOf(category: string, filter?: (n: string) => boolean): string[] {
  return Object.keys(getAtlas().sprites).filter(
    (n) =>
      getAtlas().sprites[n]?.category === category &&
      (filter ? filter(n) : true),
  );
}

function UnitRow(props: { sheets: Sheets; id: string }) {
  const sides: { label: string; suffix: string; ramp?: Ramp }[] = [
    { label: 'neutral', suffix: '' },
    { label: 'side A', suffix: '@a' },
    { label: 'side B', suffix: '@b' },
    {
      label: 'neutral, tinted A at draw time',
      suffix: '',
      ramp: getAtlas().tint.teamA,
    },
    {
      label: 'neutral, tinted B at draw time',
      suffix: '',
      ramp: getAtlas().tint.teamB,
    },
  ];
  const anims = ['', '.walk', '.attack'];
  const planned = getAtlas().planned.includes(props.id);
  return (
    <div class="unit-row" data-unit={props.id}>
      <h4>
        <code>{props.id}</code>
        {planned ? <span class="badge">planned</span> : null}
      </h4>
      <div class="unit-sides">
        {sides.map((s) => (
          <div key={s.label} class="unit-side">
            <span class="meta">{s.label}</span>
            <div class="scales">
              {anims.map((a) => (
                <SpriteCanvas
                  key={a}
                  sheets={props.sheets}
                  name={`${props.id}${s.suffix}${a}`}
                  scale={4}
                  {...(s.ramp ? { ramp: s.ramp } : {})}
                />
              ))}
            </div>
            <span class="meta">idle / walk / attack</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const SAMPLE_COLS = 12;
const SAMPLE_ROWS = 8;

/** A 12x8 sample of a texture; `pick` names the sprite for each cell. */
function TiledSample(props: {
  sheets: Sheets;
  label: string;
  /** Sprite used to size the cells. */
  size: string;
  pick: (x: number, y: number) => string;
}) {
  const sp = spriteOf(props.size);
  const scale = sp.w >= 64 ? 1 : sp.w >= 32 ? 1 : 2;
  const w = sp.w * SAMPLE_COLS * scale;
  const h = sp.h * SAMPLE_ROWS * scale;
  const ref = useCanvasLoop(
    w,
    h,
    (ctx) => {
      for (let y = 0; y < SAMPLE_ROWS; y++)
        for (let x = 0; x < SAMPLE_COLS; x++)
          drawFrame(
            ctx,
            props.sheets,
            props.pick(x, y),
            0,
            x * sp.w * scale,
            y * sp.h * scale,
            scale,
          );
    },
    [props.sheets, props.size, props.pick],
    false,
  );
  return (
    <figure class="sprite-card" data-tiled={props.label}>
      <figcaption>
        <code>{props.label}</code>
        <span class="meta">
          {SAMPLE_COLS}x{SAMPLE_ROWS} cells of {sp.w}x{sp.h}, {scale}x
        </span>
      </figcaption>
      <canvas
        ref={ref}
        class="px"
        width={w}
        height={h}
        style={{ width: px(w), height: px(h) }}
      />
    </figure>
  );
}

const same = (name: string) => (): string => name;

function NineSliceCanvas(props: { sheets: Sheets; name: string }) {
  const sizes: [number, number][] = [
    [36, 28],
    [72, 32],
    [120, 52],
    [64, 64],
  ];
  const scale = 2;
  const w = sizes.reduce((a, [sw]) => a + sw * scale + 12, 0);
  const h = Math.max(...sizes.map(([, sh]) => sh)) * scale;
  const ref = useCanvasLoop(
    w,
    h,
    (ctx) => {
      let x = 0;
      for (const [sw, sh] of sizes) {
        drawNine(
          ctx,
          props.sheets,
          props.name,
          x,
          0,
          sw * scale,
          sh * scale,
          scale,
        );
        x += sw * scale + 12;
      }
    },
    [props.sheets, props.name],
    false,
  );
  return (
    <figure class="sprite-card wide" data-nine={props.name}>
      <figcaption>
        <code>{props.name}</code>
        <span class="meta">
          9-slice {JSON.stringify(spriteOf(props.name).nineSlice)} at four
          sizes, 2x
        </span>
      </figcaption>
      <canvas
        ref={ref}
        class="px"
        width={w}
        height={h}
        style={{ width: px(w), height: px(h) }}
      />
    </figure>
  );
}

function MockBoard(props: { sheets: Sheets; scale: number }) {
  const w = MOCK_COLS * 16 * props.scale;
  const h = MOCK_ROWS * 16 * props.scale;
  const ref = useCanvasLoop(
    w,
    h,
    (ctx, t) => {
      drawMockBoard(ctx, props.sheets, props.scale, t);
    },
    [props.sheets, props.scale],
    true,
  );
  return (
    <canvas
      ref={ref}
      class="px mock-board"
      width={w}
      height={h}
      style={{ width: px(w), height: px(h) }}
    />
  );
}

function Section(props: {
  title: string;
  note?: string;
  children: preact.ComponentChildren;
}) {
  return (
    <section class="sprites-section">
      <h3>{props.title}</h3>
      {props.note ? <p class="note">{props.note}</p> : null}
      {props.children}
    </section>
  );
}

function Grid(props: { sheets: Sheets; names: string[] }) {
  return (
    <div class="sprite-grid">
      {props.names.map((n) => (
        <SpriteCard key={n} sheets={props.sheets} name={n} />
      ))}
    </div>
  );
}

function Preview(props: { sheets: Sheets }) {
  const { sheets } = props;
  const unitIds = [
    ...new Set(namesOf('unit').map((n) => getAtlas().sprites[n]?.id ?? n)),
  ];
  const total = Object.keys(getAtlas().sprites).length;
  return (
    <div class="sprites-page">
      <p class="note">
        {total} sprites on {Object.keys(getAtlas().sheets).length} sheets.
        Nearest-neighbour scaling. Sprites listed as planned are placeholders
        for content that does not exist yet.
      </p>
      <Section
        title="Mock board patch"
        note="12x8 cells at 5x, 2x and 1x: ground, neutral zone, lake and cliff autotiles, nodes, buildings, conduits with items (tinted per resource), units of both sides, a flyer with shadow, effects."
      >
        <div class="board-row">
          <MockBoard sheets={sheets} scale={5} />
          <MockBoard sheets={sheets} scale={2} />
          <MockBoard sheets={sheets} scale={1} />
        </div>
      </Section>
      <Section
        title="Units"
        note="Each unit: neutral, pre-tinted side A (faces north, gold plume) and side B (faces south, bone horns), and the neutral sprite recoloured at draw time."
      >
        {unitIds.map((id) => (
          <UnitRow key={id} sheets={sheets} id={id} />
        ))}
      </Section>
      <Section
        title="Tiling, 12x8 samples"
        note="Ground and neutral pick a random variant per cell, as the board does; the single-variant samples are the worst case and show any pattern the tile repeats."
      >
        <div class="sprite-grid">
          <TiledSample
            sheets={sheets}
            label="ground, 6 variants at random"
            size="ground_1"
            pick={pickGround}
          />
          <TiledSample
            sheets={sheets}
            label="neutral, 4 variants at random"
            size="neutral_1"
            pick={pickNeutral}
          />
          <TiledSample
            sheets={sheets}
            label="ground_1 alone"
            size="ground_1"
            pick={same('ground_1')}
          />
          <TiledSample
            sheets={sheets}
            label="neutral_1 alone"
            size="neutral_1"
            pick={same('neutral_1')}
          />
          <TiledSample
            sheets={sheets}
            label="ui_panel"
            size="ui_panel"
            pick={same('ui_panel')}
          />
          <TiledSample
            sheets={sheets}
            label="ui_bg"
            size="ui_bg"
            pick={same('ui_bg')}
          />
          <TiledSample
            sheets={sheets}
            label="ter_lake"
            size="ter_lake"
            pick={same('ter_lake')}
          />
        </div>
      </Section>
      <Section title="9-slices">
        <div class="sprite-grid">
          {[
            'ui_button_normal',
            'ui_button_hover',
            'ui_button_disabled',
            'ui_card',
          ].map((n) => (
            <NineSliceCanvas key={n} sheets={sheets} name={n} />
          ))}
        </div>
      </Section>
      <Section title="Terrain and resource nodes">
        <Grid sheets={sheets} names={namesOf('terrain')} />
        <Grid sheets={sheets} names={namesOf('node')} />
      </Section>
      <Section
        title="Buildings"
        note="Tier 2 and 3 add a trim overlay (silver or gold corner brackets) and pips on the building tile."
      >
        <Grid sheets={sheets} names={namesOf('building')} />
      </Section>
      <Section
        title="Conduits"
        note="Neutral grey flow; swap the tint ramp per resource. Shown neutral, then tinted with each resource ramp."
      >
        <Grid sheets={sheets} names={namesOf('conduit')} />
        <div class="sprite-grid">
          {Object.keys(getAtlas().tint.resources).map((res) => (
            <figure key={res} class="sprite-card" data-tint={res}>
              <figcaption>
                <code>{res}</code>
              </figcaption>
              <div class="scales">
                {[
                  'conduit_straight',
                  'conduit_corner',
                  'conduit_t',
                  'conduit_cross',
                  'conduit_end',
                  'conduit_item',
                ].map((n) => (
                  <SpriteCanvas
                    key={n}
                    sheets={sheets}
                    name={n}
                    scale={3}
                    ramp={getAtlas().tint.resources[res] ?? []}
                  />
                ))}
              </div>
            </figure>
          ))}
        </div>
      </Section>
      <Section title="Effects">
        <Grid sheets={sheets} names={namesOf('effect')} />
      </Section>
      <Section title="Interface">
        <Grid
          sheets={sheets}
          names={namesOf(
            'ui',
            (n) => !n.startsWith('ui_panel') && n !== 'ui_bg',
          )}
        />
      </Section>
      <Section title="All unit sprites">
        <Grid sheets={sheets} names={namesOf('unit')} />
      </Section>
    </div>
  );
}

export function SpritesScreen() {
  const [sheets, setSheets] = useState<Sheets | null>(null);
  const [backdrop, setBackdrop] = useState('dark');
  useEffect(() => {
    let live = true;
    void loadSheets().then((s) => {
      if (live) setSheets(s);
    });
    return () => {
      live = false;
    };
  }, []);
  const status =
    sheets === null ? (
      <span>Loading sprites…</span>
    ) : (
      <label>
        Backdrop{' '}
        <select
          value={backdrop}
          onChange={(e) => {
            setBackdrop(e.currentTarget.value);
          }}
        >
          <option value="dark">dark</option>
          <option value="mid">mid</option>
          <option value="light">light</option>
        </select>
      </label>
    );
  return (
    <AppShell title="Sprites" status={status}>
      <div
        class={`sprites-scroll backdrop-${backdrop}`}
        id="sprites-root"
        data-images-loaded={sheets?.loaded ?? 0}
        data-images-failed={sheets?.failed.length ?? 0}
        data-ready={
          sheets !== null && sheets.failed.length === 0 ? 'true' : 'false'
        }
      >
        {sheets === null ? null : sheets.failed.length > 0 ? (
          <p class="note">Failed to load: {sheets.failed.join(', ')}</p>
        ) : (
          <Preview sheets={sheets} />
        )}
      </div>
    </AppShell>
  );
}
