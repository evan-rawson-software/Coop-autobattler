/**
 * The points of interest on the battle canvas (CB-8c to CB-8g): the marker
 * with its buff icon, the capture ring, the tint of the holder and the heal
 * radius. Drawn under the units from the visual state of the playback.
 */

import type { OverlayContext } from '../board/BoardView.js';
import { frameCanvas, spriteSet } from '../sprites/atlas.js';
import type { BattleDrawData } from './draw.js';
import { pointsNow, type PointNow } from './points.js';

const FONT = '600 {s}px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
/** The ring's track and the capture range: light, so they read on the dark ground and the light board. */
const TRACK = '#dfe6ea';
/** How often a contested ring flips between the two sides' colours, per second. */
const FLICKER_HZ = 3;

/** The sprite of a buff kind. */
function buffIcon(p: PointNow): string {
  return p.buff?.kind === 'heal' ? 'ui_point_heal' : 'ui_point_strength';
}

export function drawPoints(
  ctx: CanvasRenderingContext2D,
  o: OverlayContext,
  d: BattleDrawData,
  clock: number,
): void {
  const points = pointsNow(d.pb.sim);
  if (points.length === 0) return;
  const { camera: cam, viewport: vp, theme } = o;
  const z = cam.zoom;
  const ox = vp.w / 2 - cam.cx * z;
  const oy = vp.h / 2 - cam.cy * z;
  const set = spriteSet();
  const colorOf = (side: number): string =>
    side === 0
      ? (theme.owners[0] ?? theme.ink)
      : side === 1
        ? (theme.owners[1] ?? theme.ink)
        : theme.guard;
  const ramps =
    set === null ? null : [set.atlas.tint.teamA, set.atlas.tint.teamB];
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  for (const p of points) {
    const sx = ox + p.x * z;
    const sy = oy + (d.geo.height - p.y) * z;
    const held = p.controller === 0 || p.controller === 1;
    const holder = colorOf(p.controller);

    // The capture range, faint, so the player sees where units must stand.
    ctx.strokeStyle = TRACK;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.arc(sx, sy, p.captureRadius * z, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // A healing point shows its radius while a side holds it.
    if (held && p.buff?.kind === 'heal') {
      const r = p.buff.healRadiusCells * z;
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = holder;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = holder;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // A controlled point is tinted in its holder's colour.
    if (held) {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = holder;
      ctx.beginPath();
      ctx.arc(sx, sy, z * 0.95, 0, Math.PI * 2);
      ctx.fill();
    }

    // The capture ring: a track, then the progress in the capturing side's
    // colour. A contested point flickers between both sides' colours.
    const ringR = z * 1.15;
    const ringW = Math.max(2.5, z * 0.16);
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = theme.outline;
    ctx.lineWidth = ringW + 2;
    ctx.beginPath();
    ctx.arc(sx, sy, ringR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = TRACK;
    ctx.lineWidth = ringW;
    ctx.stroke();
    if (p.status === 'contested') {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = colorOf(Math.floor(clock * FLICKER_HZ) % 2);
      ctx.setLineDash([ringW * 1.6, ringW * 1.2]);
      ctx.beginPath();
      ctx.arc(sx, sy, ringR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (p.progressSide >= 0 && p.progress > 0) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = colorOf(p.progressSide);
      ctx.beginPath();
      ctx.arc(
        sx,
        sy,
        ringR,
        -Math.PI / 2,
        -Math.PI / 2 + p.progress * Math.PI * 2,
      );
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // The marker: a diamond in the holder's colour (grey while nobody holds
    // it), with the buff icon above it.
    const size = Math.max(14, z * 1.3);
    const ramp = ramps === null || !held ? undefined : ramps[p.controller];
    const marker =
      set === null ? null : frameCanvas(set, 'ui_point_marker', 0, ramp);
    if (marker !== null) {
      ctx.drawImage(marker, sx - size / 2, sy - size / 2, size, size);
    } else {
      ctx.fillStyle = held ? holder : theme.inkMuted;
      ctx.strokeStyle = theme.outline;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx, sy - size / 2);
      ctx.lineTo(sx + size / 2, sy);
      ctx.lineTo(sx, sy + size / 2);
      ctx.lineTo(sx - size / 2, sy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    const icon = set === null ? null : frameCanvas(set, buffIcon(p), 0);
    const iconSize = Math.max(12, z * 0.95);
    if (icon !== null) {
      ctx.drawImage(
        icon,
        sx - iconSize / 2,
        sy - ringR - iconSize * 0.9,
        iconSize,
        iconSize,
      );
    }

    // The number the side panel uses.
    if (z >= 8) {
      ctx.font = FONT.replace('{s}', String(Math.max(10, Math.round(z * 0.7))));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = theme.ink;
      ctx.strokeStyle = theme.boardBg;
      ctx.lineWidth = 3;
      ctx.strokeText(String(p.number), sx, sy + ringR + 1);
      ctx.fillText(String(p.number), sx, sy + ringR + 1);
    }
  }
  ctx.restore();
}
