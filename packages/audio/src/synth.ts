/**
 * An sfxr-style synthesiser. A pure function of the recipe: samples are
 * computed in double precision and rounded to 16-bit integers. No clock and
 * no Math.random; noise comes from the recipe's seed (mulberry32).
 */

import { SAMPLE_RATE, type Recipe } from './model.js';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The coefficient of a one-pole filter with cut-off `hz`. */
function onePole(hz: number, rate: number): number {
  const x = (2 * Math.PI * hz) / rate;
  return x / (1 + x);
}

/** Number of samples a recipe makes. */
export function sampleCount(r: Recipe, rate = SAMPLE_RATE): number {
  return Math.round(((r.attackMs + r.holdMs + r.decayMs) * rate) / 1000);
}

/** The 16-bit samples of one sound. */
export function synthesize(r: Recipe, rate = SAMPLE_RATE): Int16Array {
  const n = sampleCount(r, rate);
  const out = new Int16Array(n);
  const rng = mulberry32(r.seed);
  const attack = (r.attackMs * rate) / 1000;
  const hold = (r.holdMs * rate) / 1000;
  const decay = (r.decayMs * rate) / 1000;
  const duty = r.duty ?? 0.5;
  const slide = r.slide ?? 0;
  const lp = r.lowpass === undefined ? 1 : onePole(r.lowpass, rate);
  const hp = r.highpass === undefined ? 0 : onePole(r.highpass, rate);
  let phase = 0;
  let noise = rng() * 2 - 1;
  let lpState = 0;
  let hpState = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    let f = r.freq * Math.pow(2, slide * t);
    if (r.minFreq !== undefined && slide < 0 && f < r.minFreq) f = r.minFreq;
    if (r.arpeggio) {
      const k = Math.floor((t * 1000) / r.arpeggio.stepMs);
      const step = r.arpeggio.steps[k % r.arpeggio.steps.length] ?? 0;
      f *= Math.pow(2, step / 12);
    }
    if (r.vibrato)
      f *= Math.pow(
        2,
        (r.vibrato.depth * Math.sin(2 * Math.PI * r.vibrato.rateHz * t)) / 12,
      );
    phase += f / rate;
    if (phase >= 1) {
      phase -= Math.floor(phase);
      noise = rng() * 2 - 1;
    }
    let v: number;
    switch (r.wave) {
      case 'sine':
        v = Math.sin(2 * Math.PI * phase);
        break;
      case 'triangle':
        v = 4 * Math.abs(phase - 0.5) - 1;
        break;
      case 'square':
        v = phase < duty ? 1 : -1;
        break;
      case 'saw':
        v = 2 * phase - 1;
        break;
      case 'noise':
        v = noise;
        break;
    }
    // Volume envelope: linear attack, hold, then a soft quadratic decay.
    let e: number;
    if (i < attack) e = i / attack;
    else if (i < attack + hold) e = 1;
    else {
      const x = (i - attack - hold) / decay;
      e = x >= 1 ? 0 : (1 - x) * (1 - x);
    }
    v *= e;
    lpState += lp * (v - lpState);
    v = lpState;
    if (r.highpass !== undefined) {
      hpState += hp * (v - hpState);
      v -= hpState;
    }
    const s = Math.round(v * r.gain * 32767);
    out[i] = s > 32767 ? 32767 : s < -32768 ? -32768 : s;
  }
  return out;
}
