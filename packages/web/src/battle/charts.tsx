/**
 * A small hand-drawn line chart on a canvas: up to two series told apart by
 * colour and line style, a "now" line and numbered markers for notable
 * moments. Labels live in the DOM next to it (see `ChartLegend`).
 */

import { useEffect, useRef } from 'preact/hooks';
import { readTheme } from '../board/theme.js';

export interface ChartPoint {
  readonly x: number;
  readonly y: number;
}

export interface ChartSeries {
  readonly side: 0 | 1;
  readonly points: readonly ChartPoint[];
}

export interface ChartMarker {
  readonly x: number;
  /** Shown in the circle at the top of the marker line (a number or a range such as "2–3"). */
  readonly label: string;
}

export interface LineChartProps {
  readonly series: readonly ChartSeries[];
  readonly xMax: number;
  readonly yMax: number;
  /** A solid vertical line, e.g. the playback position. */
  readonly now?: number | undefined;
  readonly markers?: readonly ChartMarker[];
  readonly height: number;
  readonly ariaLabel: string;
  /** Formats the x axis end labels. */
  readonly formatX: (x: number) => string;
  readonly testId?: string;
}

const FONT = '11px ui-monospace, "SF Mono", Menlo, Consolas, monospace';

export function LineChart(props: LineChartProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef(props);
  latest.current = props;

  const draw = useRef(() => {});
  draw.current = () => {
    const cv = canvas.current;
    const el = wrap.current;
    if (!cv || !el) return;
    const p = latest.current;
    const w = Math.max(40, Math.floor(el.clientWidth));
    const h = p.height;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cv.style.width = `${String(w)}px`;
      cv.style.height = `${String(h)}px`;
    }
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const theme = readTheme(document.documentElement);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const padL = 6;
    const padR = 6;
    const padT = 16;
    const padB = 18;
    const gw = w - padL - padR;
    const gh = h - padT - padB;
    const xs = (x: number): number =>
      padL + (p.xMax <= 0 ? 0 : (x / p.xMax) * gw);
    const ys = (y: number): number =>
      padT + gh - (p.yMax <= 0 ? 0 : (y / p.yMax) * gh);

    ctx.font = FONT;
    ctx.textBaseline = 'alphabetic';
    // Baseline and end labels.
    ctx.strokeStyle = theme.gridLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, padT + gh + 0.5);
    ctx.lineTo(padL + gw, padT + gh + 0.5);
    ctx.stroke();
    ctx.fillStyle = theme.inkMuted;
    ctx.textAlign = 'left';
    ctx.fillText(p.formatX(0), padL, h - 4);
    ctx.textAlign = 'right';
    ctx.fillText(p.formatX(p.xMax), padL + gw, h - 4);

    // Markers.
    for (const m of p.markers ?? []) {
      const x = Math.round(xs(m.x)) + 0.5;
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = theme.inkMuted;
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + gh);
      ctx.stroke();
      ctx.setLineDash([]);
      // A pill that grows with its label ("2–3" is wider than "2").
      const halfW = Math.max(7.5, ctx.measureText(m.label).width / 2 + 4);
      // Kept inside the canvas near the ends; the line stays at the moment.
      const cxPill = Math.min(Math.max(x, halfW), w - halfW);
      ctx.beginPath();
      ctx.roundRect(cxPill - halfW, 0.5, halfW * 2, 15, 7.5);
      ctx.fillStyle = theme.ink;
      ctx.fill();
      ctx.fillStyle = theme.boardBg;
      ctx.textAlign = 'center';
      ctx.fillText(m.label, cxPill, 12);
    }

    // Series: colour and dash.
    for (const s of p.series) {
      if (s.points.length === 0) continue;
      ctx.beginPath();
      s.points.forEach((pt, i) => {
        if (i === 0) ctx.moveTo(xs(pt.x), ys(pt.y));
        else ctx.lineTo(xs(pt.x), ys(pt.y));
      });
      ctx.setLineDash(s.side === 0 ? [] : [7, 4]);
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = theme.owners[s.side] ?? theme.ink;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (p.now !== undefined) {
      const x = Math.round(xs(p.now)) + 0.5;
      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + gh);
      ctx.stroke();
    }
  };

  useEffect(() => {
    draw.current();
  });

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      draw.current();
    });
    ro.observe(el);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const again = (): void => {
      draw.current();
    };
    mq.addEventListener('change', again);
    return () => {
      ro.disconnect();
      mq.removeEventListener('change', again);
    };
  }, []);

  return (
    <div class="chart-wrap" ref={wrap}>
      <canvas
        ref={canvas}
        role="img"
        aria-label={props.ariaLabel}
        data-testid={props.testId}
        data-marker-labels={(props.markers ?? []).map((m) => m.label).join(',')}
      />
    </div>
  );
}

/** Names for the two lines, with a sample of each line style. */
export function ChartLegend(props: {
  readonly labels: readonly [string, string];
}) {
  return (
    <ul class="chart-legend">
      {([0, 1] as const).map((s) => (
        <li key={s}>
          <span class={`line-sample side-${String(s)}`} aria-hidden="true" />
          {props.labels[s]}
          <span class="muted">{s === 0 ? ' (solid)' : ' (dashed)'}</span>
        </li>
      ))}
    </ul>
  );
}
