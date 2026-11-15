import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG as cfg } from '../config';
import { makeRng } from '../sim/rng';
import { resolvePutt, type PuttSetup } from '../sim/putt';
import { animatePutt, BASKET } from './puttAnim';

describe('putt animation', () => {
  it('never changes the result: misses finish where the sim says, makes finish sitting in the tray', () => {
    let makes = 0;
    let misses = 0;
    for (let i = 0; i < 400; i++) {
      const rng = makeRng(1000 + i);
      const setup: PuttSetup = { distance: 9 + rng() * 55, rise: (rng() - 0.5) * 4, crosswind: (rng() - 0.5) * 10 };
      const read = { cancel: false as const, power: 0.2 + rng() * 1.0, aim: (rng() - 0.5) * 0.12, bend: (rng() - 0.5) * 0.6, snap: 0, releaseSpeed: 500 };
      const res = resolvePutt(read, setup, makeRng(i), cfg);
      const anim = animatePutt(res, setup, cfg);
      // Time only moves forward.
      for (let k = 1; k < anim.path.length; k++) expect(anim.path[k].t).toBeGreaterThanOrEqual(anim.path[k - 1].t);
      const last = anim.path[anim.path.length - 1];
      if (res.made) {
        makes++;
        expect(anim.hit?.kind).toBe('chains');
        // In the tray: inside the rim, resting on the floor, never below it.
        expect(Math.hypot(last.u, last.v - setup.distance)).toBeLessThan(BASKET.trayR - BASKET.discR + 0.05);
        const hb = last.h - setup.rise;
        expect(hb).toBeGreaterThanOrEqual(BASKET.trayFloor);
        expect(hb).toBeLessThan(BASKET.trayRim);
        for (const q of anim.path) if (q.t > anim.hit!.t) expect(q.h - setup.rise).toBeGreaterThanOrEqual(BASKET.trayFloor);
      } else {
        misses++;
        expect(last.u).toBeCloseTo(res.rest.u, 6);
        expect(last.v).toBeCloseTo(res.rest.v, 6);
      }
    }
    expect(makes).toBeGreaterThan(20);
    expect(misses).toBeGreaterThan(20);
  });
});
