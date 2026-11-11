/** Building and conduit sprites. Top-down, light from the top-left. */

import { loadBuildings, type BuildingInfo } from '../content.js';
import { Pix, bevelShape, roundRect } from '../pix.js';
import { sprite, type SpriteDef } from '../model.js';

type Ramp = readonly [string, string, string];

/** Plate colours per building kind, [dark, mid, light]. */
const KIND_RAMP: Readonly<Record<string, Ramp>> = {
  source: ['0', 't', 'T'],
  route: ['0', '1', '2'],
  unit_producer: ['R', 'm', 'M'],
  defense: ['0', '2', '4'],
  economy: ['0', 's', 'S'],
  core: ['1', '3', '5'],
};

function plate(
  p: Pix,
  x: number,
  y: number,
  w: number,
  h: number,
  ramp: Ramp,
): void {
  bevelShape(p, roundRect(x, y, w, h, 1), ramp);
}

function arrow(
  p: Pix,
  cx: number,
  cy: number,
  dir: 'n' | 'e' | 's' | 'w',
  key: string,
): void {
  // A 3-deep triangle, 6 wide at its base, centred on (cx, cy) = middle of the base row.
  const rows = [
    [0, 1],
    [-1, 2],
    [-2, 3],
  ] as const;
  for (const [i, [from, to]] of rows.entries()) {
    for (let k = from; k <= to; k++) {
      // Along the arrow axis i steps back from the tip; across it k.
      const along = i;
      const across = k;
      const [x, y] =
        dir === 'n'
          ? [cx + across, cy + along]
          : dir === 's'
            ? [cx + across, cy - along]
            : dir === 'w'
              ? [cx + along, cy + across]
              : [cx - along, cy + across];
      p.set(x, y, key);
    }
  }
}

/** A two-pixel-wide channel from (x0, y0) to (x1, y1): `key` lit, `dark` shaded. */
function channel(
  p: Pix,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  key: string,
  dark: string,
): void {
  const steep = Math.abs(y1 - y0) >= Math.abs(x1 - x0);
  p.line(
    x0 + (steep ? 1 : 0),
    y0 + (steep ? 0 : 1),
    x1 + (steep ? 1 : 0),
    y1 + (steep ? 0 : 1),
    dark,
  );
  p.line(x0, y0, x1, y1, key);
}

/** A flat three-pixel-wide arrowhead whose tip is at (x, y). */
const HEADS: Readonly<Record<string, readonly string[]>> = {
  n: ['.xx.', 'xxxx'],
  s: ['xxxx', '.xx.'],
  w: ['.x', 'xx', 'xx', '.x'],
  e: ['x.', 'xx', 'xx', 'x.'],
};
function head(
  p: Pix,
  dir: 'n' | 's' | 'w' | 'e',
  x: number,
  y: number,
  key: string,
): void {
  const g = (HEADS[dir] as readonly string[]).map((r) => r.replace(/x/g, key));
  p.stamp(g, x, y);
}

function routePlate(): Pix {
  const p = new Pix(16, 16);
  plate(p, 1, 1, 14, 14, KIND_RAMP['route'] as Ramp);
  return p;
}

/** One channel in at the bottom, fanning out into three at the top. */
function splitterSprite(): Pix {
  const p = routePlate();
  channel(p, 7, 14, 7, 9, 'T', 't');
  channel(p, 7, 8, 3, 4, 'y', 'O');
  channel(p, 7, 8, 7, 4, 'y', 'O');
  channel(p, 8, 8, 12, 4, 'y', 'O');
  head(p, 'n', 6, 2, 'y');
  p.stamp(['yy.', 'yyy', '.yy'], 2, 2);
  p.stamp(['.yy', 'yyy', 'yy.'], 11, 2);
  // Junction.
  p.rect(6, 8, 4, 3, 'K');
  p.rect(7, 8, 2, 2, '6');
  return p;
}

/** Three channels converging into one that leaves at the top. */
function mergerSprite(): Pix {
  const p = routePlate();
  channel(p, 7, 8, 7, 3, 'y', 'O');
  head(p, 'n', 6, 2, 'y');
  channel(p, 3, 12, 7, 9, 'T', 't');
  channel(p, 7, 14, 7, 9, 'T', 't');
  channel(p, 12, 12, 8, 9, 'T', 't');
  // Inward heads on the three feeders.
  p.stamp(['.TT', 'TTT', 'TT.'], 5, 8);
  p.stamp(['TT.', 'TTT', '.TT'], 9, 8);
  head(p, 'n', 6, 11, 'T');
  p.rect(6, 6, 4, 3, 'K');
  p.rect(7, 6, 2, 2, '6');
  return p;
}

/** Two channels crossing: the vertical one rides a bridge over the horizontal one. */
function crossoverSprite(): Pix {
  const p = routePlate();
  // Horizontal channel passes underneath.
  channel(p, 2, 7, 13, 7, 'T', 't');
  head(p, 'e', 11, 5, 'T');
  // Bridge: a raised violet deck with its own outline and a cast shadow.
  p.rect(5, 4, 8, 11, 'a');
  p.rect(4, 3, 8, 11, 'K');
  p.rect(5, 4, 6, 9, 's');
  p.rect(5, 4, 1, 9, 'S');
  p.rect(5, 4, 6, 1, 'S');
  p.rect(10, 5, 1, 8, '0');
  // The vertical channel rides the deck and carries on to the edges.
  channel(p, 7, 14, 7, 2, 'y', 'O');
  head(p, 'n', 6, 2, 'y');
  return p;
}

function extractorSprite(): Pix {
  const p = new Pix(16, 16);
  plate(p, 1, 1, 14, 14, KIND_RAMP['source'] as Ramp);
  p.ellipse(8, 9.5, 4.5, 4.5, 'K');
  p.ellipse(8, 9.5, 3.5, 3.5, '2');
  p.ellipse(8, 9.5, 2.5, 2.5, '4');
  p.rect(7, 8, 2, 3, '6');
  p.set(7, 8, '5');
  p.set(8, 10, '3');
  // Output arrow on the north edge.
  arrow(p, 7, 2, 'n', 'y');
  return p;
}

function barracksPlate(p: Pix): void {
  plate(p, 1, 1, 30, 30, KIND_RAMP['unit_producer'] as Ramp);
  for (const [x, y] of [
    [3, 3],
    [28, 3],
    [3, 28],
    [28, 28],
  ] as const)
    p.set(x, y, '4');
  // Roof panel with rafters.
  p.rect(5, 5, 22, 15, 'K');
  p.rect(6, 6, 20, 13, 'R');
  for (let x = 6; x < 26; x += 4) p.rect(x, 6, 1, 13, 'm');
  p.rect(6, 6, 20, 1, 'm');
  // Door facing south, where the input arrives.
  p.rect(11, 21, 10, 9, 'K');
  p.rect(12, 22, 8, 8, '1');
  p.rect(13, 23, 6, 7, 'K');
  p.rect(12, 22, 8, 1, '3');
  arrow(p, 15, 24, 'n', 'T');
}

function barracksSprite(): Pix {
  const p = new Pix(32, 32);
  barracksPlate(p);
  // Crossed swords.
  p.line(11, 8, 20, 17, '5');
  p.line(20, 8, 11, 17, '5');
  p.line(12, 8, 21, 17, '4');
  p.line(19, 8, 10, 17, '4');
  p.set(11, 8, '6');
  p.set(20, 8, '6');
  p.rect(10, 15, 3, 1, 'y');
  p.rect(19, 15, 3, 1, 'y');
  return p;
}

function rangeSprite(): Pix {
  const p = new Pix(32, 32);
  barracksPlate(p);
  // Archery target on the roof.
  const cx = 16;
  const cy = 12.5;
  p.ellipse(cx, cy, 7.5, 6.5, 'K');
  p.ellipse(cx, cy, 6.5, 5.5, '6');
  p.ellipse(cx, cy, 5, 4.2, 'M');
  p.ellipse(cx, cy, 3.4, 2.8, '6');
  p.ellipse(cx, cy, 2, 1.6, 'M');
  p.ellipse(cx, cy, 0.9, 0.9, 'y');
  p.line(19, 6, 16, 12, 'O');
  p.set(19, 5, '5');
  return p;
}

function hangarSprite(): Pix {
  const p = new Pix(32, 32);
  plate(p, 1, 1, 30, 30, KIND_RAMP['unit_producer'] as Ramp);
  // Landing pad with hazard corners.
  p.rect(5, 5, 22, 22, 'K');
  p.rect(6, 6, 20, 20, '1');
  p.rect(6, 6, 20, 1, '2');
  for (let i = 0; i < 6; i++) {
    p.set(6 + i, 6 + (i % 2) * 0, 'y');
    p.set(25 - i, 25, i % 2 === 0 ? 'y' : 'K');
  }
  p.ellipse(16, 16, 7.5, 7.5, 'K');
  p.ellipse(16, 16, 6.5, 6.5, '2');
  // H
  p.rect(12, 11, 2, 10, 'y');
  p.rect(18, 11, 2, 10, 'y');
  p.rect(12, 15, 8, 2, 'y');
  arrow(p, 15, 27, 'n', 'T');
  return p;
}

function wallSprite(): Pix {
  const p = new Pix(16, 16);
  plate(p, 1, 1, 14, 14, ['R', 'r', 'q']);
  for (const y of [5, 9, 13]) p.rect(2, y, 12, 1, 'R');
  for (const [x, y] of [
    [8, 2],
    [5, 6],
    [11, 6],
    [8, 10],
    [3, 10],
    [13, 10],
  ] as const)
    p.rect(x, y, 1, 3, 'R');
  p.rect(2, 2, 3, 1, 'p');
  p.rect(9, 6, 2, 1, 'p');
  p.rect(3, 11, 3, 1, 'p');
  return p;
}

function gateSprite(): Pix {
  const p = new Pix(16, 16);
  plate(p, 1, 1, 14, 14, ['R', 'o', 'O']);
  // Stone posts either side, barred timber between.
  p.rect(1, 1, 3, 14, 'K');
  p.rect(12, 1, 3, 14, 'K');
  p.rect(2, 2, 2, 12, 'r');
  p.rect(12, 2, 2, 12, 'R');
  p.rect(2, 2, 1, 12, 'q');
  for (const x of [5, 8, 10]) p.rect(x, 2, 2, 12, x === 8 ? 'o' : 'O');
  p.rect(4, 6, 8, 1, '2');
  p.rect(4, 10, 8, 1, '2');
  p.rect(7, 2, 1, 12, 'K');
  p.set(7, 8, 'y');
  return p;
}

function turretHead(): Pix {
  const p = new Pix(16, 16);
  // Barrel first (north), then the round housing over its root.
  p.rect(6, 0, 4, 9, 'K');
  p.rect(7, 1, 2, 8, '4');
  p.rect(7, 1, 1, 8, '5');
  p.rect(7, 0, 2, 2, 'M');
  p.ellipse(8, 9, 5, 5, 'K');
  p.ellipse(8, 9, 4, 4, '2');
  p.ellipse(8, 9, 3, 3, '3');
  p.ellipse(7.5, 8.5, 1.8, 1.8, '4');
  p.set(7, 8, '6');
  p.set(9, 11, '1');
  return p;
}

function turretBase(): Pix {
  const p = new Pix(16, 16);
  plate(p, 1, 1, 14, 14, KIND_RAMP['defense'] as Ramp);
  for (const [x, y] of [
    [2, 2],
    [13, 2],
    [2, 13],
    [13, 13],
  ] as const)
    p.set(x, y, '5');
  arrow(p, 7, 12, 'n', 'T');
  p.rect(5, 4, 6, 8, '1');
  return p;
}

function turretSprite(): Pix {
  const p = turretBase();
  p.blit(turretHead(), 0, 0);
  return p;
}

function gearIcon(p: Pix): void {
  const cx = 8;
  const cy = 8.5;
  p.ellipse(cx, cy, 4.8, 4.8, '5');
  for (const [dx, dy] of [
    [0, -5],
    [0, 5],
    [-5, 0],
    [5, 0],
    [-3.5, -3.5],
    [3.5, -3.5],
    [-3.5, 3.5],
    [3.5, 3.5],
  ] as const)
    p.rect(Math.round(cx + dx - 1), Math.round(cy + dy - 1), 2, 2, '5');
  p.ellipse(cx, cy, 3.6, 3.6, '4');
  p.ellipse(cx, cy, 2, 2, 'K');
  // Bolt in the hub.
  p.set(8, 7, 'y');
  p.set(7, 8, 'y');
  p.set(8, 8, 'y');
  p.set(8, 9, 'y');
}

function shieldIcon(p: Pix): void {
  for (let y = 0; y < 11; y++) {
    const half = y < 6 ? 4.5 : 4.5 - (y - 5) * 0.95;
    for (let x = 0; x < 12; x++) {
      if (Math.abs(x + 0.5 - 6) > half) continue;
      p.set(3 + x, 3 + y, x < 6 ? '5' : '4');
    }
  }
  p.rect(8, 5, 1, 8, 'y');
  p.rect(5, 7, 7, 1, 'y');
  p.outline('K');
}

function economySprite(icon: (p: Pix) => void): Pix {
  const p = new Pix(16, 16);
  plate(p, 1, 1, 14, 14, KIND_RAMP['economy'] as Ramp);
  arrow(p, 7, 12, 'n', 'T');
  const layer = new Pix(16, 16);
  icon(layer);
  layer.outline('K');
  p.blit(layer, 0, -1);
  return p;
}

function coreSprite(): Pix {
  const p = new Pix(32, 32);
  plate(p, 1, 1, 30, 30, KIND_RAMP['core'] as Ramp);
  for (const [x, y] of [
    [2, 2],
    [27, 2],
    [2, 27],
    [27, 27],
  ] as const) {
    p.rect(x, y, 3, 3, 'o');
    p.rect(x, y, 2, 2, 'y');
  }
  // Pit.
  bevelShape(p, roundRect(6, 6, 20, 20, 3), ['0', '1', '2']);
  p.rect(8, 8, 16, 16, '0');
  // Glow dither.
  for (let y = 8; y < 24; y++)
    for (let x = 8; x < 24; x++)
      if (
        (x + y) % 2 === 0 &&
        (x - 15.5) * (x - 15.5) + (y - 15.5) * (y - 15.5) < 60.84
      )
        p.set(x, y, 't');
  // Crystal.
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const dx = x + 0.5 - 16;
      const dy = y + 0.5 - 16;
      if (Math.abs(dx) / 5.5 + Math.abs(dy) / 8 > 1) continue;
      const edge = Math.abs(dx) / 5.5 + Math.abs(dy) / 8 > 0.82;
      const left = dx < 0;
      const top = dy < 0;
      p.set(x, y, edge ? 't' : left ? (top ? '6' : 'T') : top ? 'T' : 't');
    }
  p.line(16, 8, 16, 24, 'T');
  p.set(14, 12, '6');
  p.set(13, 13, '6');
  return p;
}

// ---- Conduits

type Open = { n: boolean; e: boolean; s: boolean; w: boolean };

function conduit(open: Open): Pix {
  const p = new Pix(16, 16);
  const vOpen = open.n || open.s;
  const inCasing = (x: number, y: number): boolean => {
    if (x >= 4 && x <= 11 && y >= 4 && y <= 11) return true;
    if (open.n && x >= 4 && x <= 11 && y < 4) return true;
    if (open.s && x >= 4 && x <= 11 && y > 11) return true;
    if (open.w && y >= 4 && y <= 11 && x < 4) return true;
    if (open.e && y >= 4 && y <= 11 && x > 11) return true;
    return false;
  };
  bevelShape(p, inCasing, ['2', '3', '4']);
  const inFlow = (x: number, y: number): boolean => {
    if (x >= 6 && x <= 9 && y >= 6 && y <= 9) return true;
    if (open.n && x >= 6 && x <= 9 && y < 6) return true;
    if (open.s && x >= 6 && x <= 9 && y > 9) return true;
    if (open.w && y >= 6 && y <= 9 && x < 6) return true;
    if (open.e && y >= 6 && y <= 9 && x > 9) return true;
    return false;
  };
  const colRule = ['x', 'Z', 'x', 'X'];
  const rowRule = ['Z', 'x', 'x', 'X'];
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if (!inFlow(x, y)) continue;
      const inV = x >= 6 && x <= 9;
      const inH = y >= 6 && y <= 9;
      const horizontal = inH && (!inV || (!vOpen && (open.w || open.e)));
      p.set(
        x,
        y,
        horizontal ? (rowRule[y - 6] as string) : (colRule[x - 6] as string),
      );
    }
  // Rivets on the casing.
  return p;
}

function itemDot(): Pix {
  const p = new Pix(16, 16);
  p.ellipse(8, 8, 3.2, 3.2, 'K');
  p.ellipse(8, 8, 2.4, 2.4, 'x');
  p.set(7, 7, 'Z');
  p.set(8, 9, 'X');
  p.set(9, 9, 'X');
  return p;
}

function tierPips(): Pix[] {
  return [1, 2, 3].map((n) => {
    const p = new Pix(16, 16);
    const total = n * 3 + (n - 1);
    const x0 = Math.floor((16 - total) / 2);
    const layer = new Pix(16, 16);
    for (let i = 0; i < n; i++) {
      layer.rect(x0 + i * 4, 12, 3, 3, 'y');
      layer.rect(x0 + i * 4 + 1, 13, 2, 2, 'O');
      layer.set(x0 + i * 4, 12, '6');
    }
    layer.outline('K');
    p.blit(layer, 0, 0);
    return p;
  });
}

/**
 * Tier trim, an overlay for a whole building: corner brackets just inside the
 * plate outline. Tier 2 is silver, tier 3 gold (thicker, with studs), so the
 * tier shows at 1x without reading the pips.
 */
function tierTrim(size: number, tier: 2 | 3): Pix {
  const p = new Pix(size, size);
  const len = size === 16 ? 5 : 9;
  const lo = 2;
  const hi = size - 3;
  const key = tier === 2 ? '5' : 'y';
  const edge = tier === 2 ? '3' : 'O';
  for (const [cx, cy, sx, sy] of [
    [lo, lo, 1, 1],
    [hi, lo, -1, 1],
    [lo, hi, 1, -1],
    [hi, hi, -1, -1],
  ] as const) {
    for (let k = 0; k < len; k++) {
      p.set(cx + sx * k, cy, key);
      p.set(cx, cy + sy * k, key);
    }
    if (tier === 3) {
      for (let k = 1; k < len - 1; k++) {
        p.set(cx + sx * k, cy + sy, edge);
        p.set(cx + sx, cy + sy * k, edge);
      }
      p.set(cx + sx, cy + sy, '6');
    } else p.set(cx, cy, '6');
  }
  return p;
}

const MAKERS: Readonly<Record<string, () => Pix>> = {
  bld_extractor: extractorSprite,
  bld_splitter: splitterSprite,
  bld_merger: mergerSprite,
  bld_crossover: crossoverSprite,
  bld_barracks: barracksSprite,
  bld_wall: wallSprite,
  bld_gate: gateSprite,
  bld_turret: turretSprite,
  bld_overclocker: () => economySprite(gearIcon),
  bld_armory: () => economySprite(shieldIcon),
  bld_core: coreSprite,
  bld_range: rangeSprite,
  bld_hangar: hangarSprite,
};

/** Buildings that have art ahead of their content; planned until content adds them. */
const PLANNED: Readonly<Record<string, string>> = {
  bld_range: 'Planned: produces ranged ground units. 2x2 tiles.',
  bld_hangar: 'Planned: produces flying units. 2x2 tiles.',
};

export function buildingSprites(
  content: readonly BuildingInfo[] = loadBuildings(),
): SpriteDef[] {
  const out: SpriteDef[] = [];
  const add = (d: Parameters<typeof sprite>[0]): void => {
    out.push(sprite(d));
  };
  for (const b of content) {
    const make = MAKERS[b.id];
    if (!make) continue; // The coverage test names the missing one.
    const frame = make();
    if (frame.w !== b.width * 16 || frame.h !== b.height * 16)
      throw new Error(`${b.id}: sprite size does not match footprint`);
    add({
      name: b.id,
      id: b.id,
      sheet: 'buildings',
      category: 'building',
      frames: frame,
      anchor: [frame.w / 2, frame.h / 2],
      note: `${String(b.width)}x${String(b.height)} tiles.`,
    });
  }
  add({
    name: 'bld_turret_base',
    sheet: 'buildings',
    category: 'building',
    frames: turretBase(),
    note: 'Turret without its head, for drawing a rotating head on top.',
  });
  add({
    name: 'bld_turret_head',
    sheet: 'buildings',
    category: 'building',
    frames: turretHead(),
    anchor: [8, 9],
    note: 'Turret head with the barrel pointing north; rotate about the anchor.',
  });
  // Art that exists before its content does: planned only while the content
  // list lacks the id, so adding the building to content cannot duplicate it.
  const inContent = new Set(content.map((b) => b.id));
  for (const [id, note] of Object.entries(PLANNED)) {
    const make = MAKERS[id];
    if (!make || inContent.has(id)) continue;
    add({
      name: id,
      id,
      sheet: 'buildings',
      category: 'building',
      planned: true,
      frames: make(),
      note,
    });
  }
  add({
    name: 'tier_pips',
    sheet: 'buildings',
    category: 'building',
    frames: tierPips(),
    note: 'Overlay on a building tile: frame 0..2 = tier 1..3 (1 to 3 gold pips at the bottom edge). Place on the bottom-left tile of the footprint.',
  });
  for (const size of [16, 32] as const) {
    const t = size / 16;
    add({
      name: `tier_trim_${String(t)}x${String(t)}`,
      sheet: 'buildings',
      category: 'building',
      frames: [tierTrim(size, 2), tierTrim(size, 3)],
      note: `Overlay for a ${String(t)}x${String(t)} building: frame 0 = tier 2 (silver corner brackets), frame 1 = tier 3 (gold). Tier 1 has none. Draw over the building, then tier_pips.`,
    });
  }
  const c = (name: string, open: Open, note: string): void => {
    add({
      name,
      sheet: 'tiles',
      category: 'conduit',
      frames: conduit(open),
      tintable: true,
      note,
    });
  };
  c(
    'conduit_straight',
    { n: true, e: false, s: true, w: false },
    'Open north and south; rotate for east-west.',
  );
  c(
    'conduit_corner',
    { n: true, e: true, s: false, w: false },
    'Open north and east; rotate for the other corners.',
  );
  c(
    'conduit_t',
    { n: false, e: true, s: true, w: true },
    'Open east, south and west.',
  );
  c(
    'conduit_cross',
    { n: true, e: true, s: true, w: true },
    'Open on all four sides.',
  );
  c(
    'conduit_end',
    { n: false, e: false, s: true, w: false },
    'Open south, capped north.',
  );
  add({
    name: 'conduit_item',
    sheet: 'tiles',
    category: 'conduit',
    frames: itemDot(),
    tintable: true,
    note: 'An item travelling on a conduit; tint with the resource colour.',
  });
  return out;
}
