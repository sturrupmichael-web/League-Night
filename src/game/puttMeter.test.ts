import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../config';
import { meterAim, meterFill, meterPower, meterRelease, meterTop, meterZoneShare } from './puttMeter';
import { puttPowerWindow, resolvePutt } from '../sim/putt';
import { makeRng } from '../sim/rng';

const cfg = { ...DEFAULT_CONFIG };

describe('putt meter', () => {
  it('climbs to the top, falls back, and climbs again', () => {
    const r = cfg.puttMeterRiseS;
    expect(meterFill(0, cfg)).toBe(0);
    expect(meterFill(r / 2, cfg)).toBeCloseTo(0.5);
    expect(meterFill(r, cfg)).toBeCloseTo(1);
    expect(meterFill(r * 1.5, cfg)).toBeCloseTo(0.5);
    expect(meterFill(r * 2.25, cfg)).toBeCloseTo(0.25);
  });

  it('puts every putt in range on the bar, with room either side of the window', () => {
    for (const d of [15, 25, 40, 55, 70]) {
      const top = meterTop(d, 0, cfg);
      const w = puttPowerWindow(d, 0, cfg);
      expect(w.high).toBeLessThan(top);
      expect(w.low).toBeGreaterThan(0);
    }
  });

  it('gives short putts a roomier window than long ones', () => {
    const share = (d: number) => {
      const w = puttPowerWindow(d, 0, cfg);
      return (w.high - w.low) / meterTop(d, 0, cfg);
    };
    expect(share(15)).toBeGreaterThan(share(30));
    expect(share(30)).toBeGreaterThan(share(60));
  });

  it('sizes the blue zone by distance: wide by the basket, a sliver at the edge of range', () => {
    const share = (d: number) => {
      const w = puttPowerWindow(d, 0, cfg);
      return (w.high - w.low) / meterTop(d, 0, cfg);
    };
    expect(share(12)).toBeCloseTo(meterZoneShare(12, cfg), 3);
    expect(meterZoneShare(10, cfg)).toBeCloseTo(cfg.puttMeterZoneNear);
    expect(share(70)).toBeCloseTo(cfg.puttMeterZoneFar, 3);
    expect(share(50)).toBeLessThan(0.06);
  });

  it('lets go into a putt read, or calls it off for a tap or a slide down', () => {
    const top = meterTop(30, 0, cfg);
    expect(meterRelease(0.05, 0, 0, top, cfg)).toEqual({ cancel: true, reason: 'tap' });
    expect(meterRelease(0.5, 0, cfg.puttMeterCancelPx + 5, top, cfg)).toEqual({ cancel: true, reason: 'slid-down' });
    const r = meterRelease(0.5, 20, 0, top, cfg);
    expect(r.cancel).toBe(false);
    if (!r.cancel) {
      expect(r.power).toBeCloseTo(meterPower(0.5, top, cfg));
      expect(r.aim).toBeGreaterThan(0);
      expect(r.bend).toBe(0);
    }
    expect(meterAim(-20, cfg)).toBeLessThan(0);
  });

  it('a straight 25 ft putt released in the window finds the chains', () => {
    const d = 25;
    const top = meterTop(d, 0, cfg);
    const w = puttPowerWindow(d, 0, cfg);
    const held = (w.ideal / top) * cfg.puttMeterRiseS;
    const r = meterRelease(held, 0, 0, top, cfg);
    if (r.cancel) throw new Error('cancelled');
    const res = resolvePutt(r, { distance: d, rise: 0 }, makeRng(3), cfg);
    expect(res.made).toBe(true);
  });
});
