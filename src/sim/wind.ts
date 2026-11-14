import { MPH_TO_FTPS, type Vec2 } from './math';
import type { Rng } from './rng';

export interface Wind {
  /** Steady wind speed. */
  mph: number;
  /** Direction the wind blows TOWARD, as an aim angle (0 = down-range, +y). */
  dir: number;
  /** 0 = steady, 1 = strong gusts. */
  gust: number;
  /** Gust phase so two throws in the same wind don't feel identical. */
  phase: number;
}

export type WindLabel = 'CALM' | 'BREEZY' | 'GUSTY';

export const CALM: Wind = { mph: 0, dir: 0, gust: 0, phase: 0 };

export function windLabel(w: Wind): WindLabel {
  if (w.mph < 3) return 'CALM';
  if (w.mph < 10) return 'BREEZY';
  return 'GUSTY';
}

/** Roll a wind from a range in mph. Stronger winds are gustier. */
export function rollWind(rng: Rng, range: [number, number]): Wind {
  const mph = Math.round(range[0] + rng() * (range[1] - range[0]));
  return {
    mph,
    dir: rng() * Math.PI * 2,
    gust: Math.min(1, Math.max(0, (mph - 6) / 10)),
    phase: rng() * Math.PI * 2,
  };
}

/** Wind velocity in ft/s at time t of a flight. */
export function windAt(w: Wind, t: number, gustAmp: number, scale: number): Vec2 {
  if (w.mph <= 0) return { x: 0, y: 0 };
  const g = 1 + w.gust * gustAmp * Math.sin(t * 2.3 + w.phase) * Math.sin(t * 0.9 + w.phase * 0.5);
  const s = w.mph * MPH_TO_FTPS * g * scale;
  return { x: Math.sin(w.dir) * s, y: Math.cos(w.dir) * s };
}
