/**
 * The `#sprites` route: every sprite in the atlas at 1x, 2x and 4x, units in
 * both team tints, tiles tiled, 9-slices stretched, and a mock board patch.
 * A review page for the art; it plays no part in the game.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { AppShell } from '../shell/AppShell.js';
import './sprites.css';
import {
  atlas,
  drawFrame,
  drawNine,
  drawTiled,
  loadSheets,
  spriteOf,
  type Ramp,
  type Sheets,
} from './atlas.js';
import { MOCK_COLS, MOCK_ROWS, drawMockBoard } from './mock-board.js';

// One animation loop drives every canvas on the page.
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
) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const off = register((t) => {
      ctx.clearRect(0, 0, width, height);
      draw(ctx, t);
    });
    return off;
  }, [width, height, ...deps]);
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
  const w = sp.w * props.scale * (strip ? sp.frames : 1);
  const h = sp.h * props.scale;
  const ref = useCanvasLoop(
    w,
    h,
    (ctx, t) => {
      const opts = props.ramp ? { ramp: props.ramp } : {};
      if (strip) {
        for (let f = 0; f < sp.frames; f++)
          drawFrame(ctx, props.sheets, props.name, f, f * sp.w * props.scale, 0, props.scale, opts);
      } else {
        const f = sp.fps > 0 ? Math.floor((t / 1000) * sp.fps) : 0;
        drawFrame(ctx, props.sheets, props.name, f, 0, 0, props.scale, opts);
      }
    },
    [props.sheets, props.name, props.scale, props.ramp, strip],
  );
  return (
    <canvas
      ref={ref}
      class="px"
      width={w}
      height={h}
      style={{ width: `${w}px`, height: `${h}px` }}
    />
  );
}

function SpriteCard(props: { sheets: Sheets; name: string }) {
  const sp = spriteOf(props.name);
  const strip = sp.fps === 0 && sp.frames > 1;
  const scales = strip ? [1, 2] : [1, 2, 4];
  return (
    <figure class={`sprite-card${strip && sp.frames > 6 ? ' wide' : ''}`} data-sprite={props.name}>
      <figcaption>
        <code>{props.name}</code>
        {sp.planned ? <span class="badge">planned</span> : null}
        <span class="meta">
          {sp.w}x{sp.h}
          {sp.frames > 1 ? ` x${sp.frames}` : ''}
          {sp.fps > 0 ? ` @${sp.fps}fps` : ''}
        </span>
      </figcaption>
      <div class="scales">
        {scales.map((s) => (
          <SpriteCanvas key={s} sheets={props.sheets} name={props.name} scale={s} strip={strip} />
        ))}
      </div>
    </figure>
  );
}

function namesOf(category: string, filter?: (n: string) => boolean): string[] {
  return Object.keys(atlas.sprites).filter(
    (n) => atlas.sprites[n]?.category === category && (filter ? filter(n) : true),
  );
}

function UnitRow(props: { sheets: Sheets; id: string }) {
  const sides: { label: string; suffix: string; ramp?: Ramp }[] = [
    { label: 'neutral', suffix: '' },
    { label: 'side A', suffix: '@a' },
    { label: 'side B', suffix: '@b' },
    { label: 'neutral, tinted A at draw time', suffix: '', ramp: atlas.tint.teamA },
    { label: 'neutral, tinted B at draw time', suffix: '', ramp: atlas.tint.teamB },
  ];
  const anims = ['', '.walk', '.attack'];
  const planned = atlas.planned.includes(props.id);
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

function TiledCanvas(props: { sheets: Sheets; name: string }) {
  const sp = spriteOf(props.name);
  const scale = 2;
  const w = sp.w * 6 * scale;
  const h = sp.h * 4 * scale;
  const ref = useCanvasLoop(
    w,
    h,
    (ctx) => {
      drawTiled(ctx, props.sheets, props.name, 6, 4, scale);
    },
    [props.sheets, props.name],
  );
  return (
    <figure class="sprite-card" data-tiled={props.name}>
      <figcaption>
        <code>{props.name}</code>
        <span class="meta">tiled 6x4</span>
      </figcaption>
      <canvas ref={ref} class="px" width={w} height={h} style={{ width: `${w}px`, height: `${h}px` }} />
    </figure>
  );
}

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
        drawNine(ctx, props.sheets, props.name, x, 0, sw * scale, sh * scale, scale);
        x += sw * scale + 12;
      }
    },
    [props.sheets, props.name],
  );
  return (
    <figure class="sprite-card wide" data-nine={props.name}>
      <figcaption>
        <code>{props.name}</code>
        <span class="meta">9-slice {JSON.stringify(spriteOf(props.name).nineSlice)} at four sizes, 2x</span>
      </figcaption>
      <canvas ref={ref} class="px" width={w} height={h} style={{ width: `${w}px`, height: `${h}px` }} />
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
  );
  return (
    <canvas
      ref={ref}
      class="px mock-board"
      width={w}
      height={h}
      style={{ width: `${w}px`, height: `${h}px` }}
    />
  );
}

function Section(props: { title: string; note?: string; children: preact.ComponentChildren }) {
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
  const unitIds = [...new Set(namesOf('unit').map((n) => atlas.sprites[n]?.id ?? n))];
  const total = Object.keys(atlas.sprites).length;
  return (
    <div class="sprites-page">
      <p class="note">
        {total} sprites on {Object.keys(atlas.sheets).length} sheets. Nearest-neighbour scaling. Sprites listed as
        planned are placeholders for content that does not exist yet.
      </p>
      <Section title="Mock board patch" note="12x8 cells at 3x and 5x: ground, neutral zone, lake and cliff autotiles, nodes, buildings, conduits with items (tinted per resource), units of both sides, a flyer with shadow, effects.">
        <div class="board-row">
          <MockBoard sheets={sheets} scale={5} />
          <MockBoard sheets={sheets} scale={3} />
        </div>
      </Section>
      <Section title="Units" note="Each unit: neutral, pre-tinted side A (faces north, gold plume) and side B (faces south, two bone prongs), and the neutral sprite recoloured at draw time.">
        {unitIds.map((id) => (
          <UnitRow key={id} sheets={sheets} id={id} />
        ))}
      </Section>
      <Section title="Tiles, tiled 6x4">
        <div class="sprite-grid">
          {['ground_1', 'ground_2', 'ground_3', 'neutral_1', 'neutral_2', 'ter_lake', 'ui_panel', 'ui_bg'].map((n) => (
            <TiledCanvas key={n} sheets={sheets} name={n} />
          ))}
        </div>
      </Section>
      <Section title="9-slices">
        <div class="sprite-grid">
          {['ui_button_normal', 'ui_button_hover', 'ui_button_disabled', 'ui_card'].map((n) => (
            <NineSliceCanvas key={n} sheets={sheets} name={n} />
          ))}
        </div>
      </Section>
      <Section title="Terrain and resource nodes">
        <Grid sheets={sheets} names={namesOf('terrain')} />
        <Grid sheets={sheets} names={namesOf('node')} />
      </Section>
      <Section title="Buildings" note="Tier pips are an overlay drawn on the building tile.">
        <Grid sheets={sheets} names={namesOf('building')} />
      </Section>
      <Section title="Conduits" note="Neutral grey flow; swap the tint ramp per resource. Shown neutral, then tinted with each resource ramp.">
        <Grid sheets={sheets} names={namesOf('conduit')} />
        <div class="sprite-grid">
          {Object.keys(atlas.tint.resources).map((res) => (
            <figure key={res} class="sprite-card" data-tint={res}>
              <figcaption>
                <code>{res}</code>
              </figcaption>
              <div class="scales">
                {['conduit_straight', 'conduit_corner', 'conduit_t', 'conduit_cross', 'conduit_end', 'conduit_item'].map((n) => (
                  <SpriteCanvas key={n} sheets={sheets} name={n} scale={3} ramp={atlas.tint.resources[res] ?? []} />
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
        <Grid sheets={sheets} names={namesOf('ui', (n) => !n.startsWith('ui_panel') && n !== 'ui_bg')} />
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
        data-ready={sheets !== null && sheets.failed.length === 0 ? 'true' : 'false'}
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
