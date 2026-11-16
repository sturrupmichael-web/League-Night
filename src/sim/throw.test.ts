import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../config';
import discs from '../content/discs.json';
import type { Disc } from './discs';
import type { ThrowInput } from './flight';
import { flatTerrain } from './terrain';
import { simulateThrow } from './throw';

// The aim preview runs simulateThrow with seed 1 and the redline wobble zeroed. These pin down
// that this is the same carry the real throw gets, whatever its seed.
describe('aim preview matches the real throw', () => {
  const env = { terrain: flatTerrain(), wind: { mph: 12, dir: 1.1, gust: 0.4, phase: 0.3 } };
  const input = (power: number): ThrowInput => ({ origin: { x: 0, y: 0 }, aim: 0.2, power, release: 0.3, style: 'backhand', hand: 'right' });

  it('gives the exact carry below the redline, for every disc', () => {
    for (const d of discs as Disc[]) {
      for (const p of [0.4, 0.75, 1]) {
        const preview = simulateThrow(input(p), d, env, 1, DEFAULT_CONFIG).carry;
        for (const seed of [7, 1234, 99999]) expect(simulateThrow(input(p), d, env, seed, DEFAULT_CONFIG).carry).toBeCloseTo(preview, 6);
      }
    }
  });

  it('a redline preview sits inside the spread of real redline throws', () => {
    const cfg = { ...DEFAULT_CONFIG, redlineAimWobbleDeg: 0, redlineBankWobbleDeg: 0, redlineExtraTurn: 0 };
    const d = (discs as Disc[]).find((x) => x.type === 'distance')!;
    const preview = simulateThrow(input(DEFAULT_CONFIG.maxPower), d, env, 1, cfg).carry;
    const real = Array.from({ length: 40 }, (_, i) => simulateThrow(input(DEFAULT_CONFIG.maxPower), d, env, i + 2, DEFAULT_CONFIG).carry);
    expect(preview).toBeGreaterThan(Math.min(...real));
    expect(preview).toBeLessThan(Math.max(...real));
    expect(preview).toBeGreaterThan(simulateThrow(input(1), d, env, 1, DEFAULT_CONFIG).carry);
  });
});
