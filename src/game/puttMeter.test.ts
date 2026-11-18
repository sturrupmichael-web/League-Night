import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../config';
import { meterAim, meterFill, meterPower, meterRelease, meterTop, meterZoneLine, meterZoneShare, powerAt } from './puttMeter';
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
    const win = puttPowerWindow(30, 0, cfg);
    expect(meterRelease(0.05, 0, 0, 0, top, win, cfg)).toEqual({ cancel: true, reason: 'tap' });
    expect(meterRelease(0.5, 0, 0, cfg.puttMeterCancelPx + 5, top, win, cfg)).toEqual({ cancel: true, reason: 'slid-down' });
    const r = meterRelease(0.5, 1.3, 20, 0, top, win, cfg);
    expect(r.cancel).toBe(false);
    if (!r.cancel) {
      expect(r.power).toBeCloseTo(meterPower(0.5, 1.3, top, win, cfg));
      expect(r.aim).toBeGreaterThan(0);
      expect(r.bend).toBe(0);
    }
    expect(meterAim(-20, cfg)).toBeLessThan(0);
  });

  it('a straight 25 ft putt let go with the needle on the moving zone line finds the chains', () => {
    const d = 25;
    const top = meterTop(d, 0, cfg);
    const w = puttPowerWindow(d, 0, cfg);
    // Zone line at some moment; hold until the needle meets it on the way up.
    const now = 0.9;
    const line = meterZoneLine(now, top, w, cfg);
    const held = line * cfg.puttMeterRiseS;
    const r = meterRelease(held, now, 0, 0, top, w, cfg);
    if (r.cancel) throw new Error('cancelled');
    expect(r.power).toBeCloseTo(w.ideal);
    const res = resolvePutt(r, { distance: d, rise: 0 }, makeRng(3), cfg);
    expect(res.made).toBe(true);
  });

  it('moves the zone along the bar and keeps it on the bar', () => {
    const top = meterTop(40, 0, cfg);
    const w = puttPowerWindow(40, 0, cfg);
    const lines = Array.from({ length: 50 }, (_, i) => meterZoneLine(i * 0.1, top, w, cfg));
    expect(Math.max(...lines) - Math.min(...lines)).toBeGreaterThan(0.5);
    for (const l of lines) {
      expect(l - (w.ideal - w.low) / top).toBeGreaterThanOrEqual(0);
      expect(l + (w.high - w.ideal) / top).toBeLessThanOrEqual(1);
    }
    expect(meterZoneLine(1, top, w, { ...cfg, puttMeterZoneMove: 0 })).toBeCloseTo(w.ideal / top);
  });

  it('a needle above the zone putts hard, below it soft', () => {
    const top = meterTop(30, 0, cfg);
    const w = puttPowerWindow(30, 0, cfg);
    expect(powerAt(0.6, 0.4, top, w)).toBeGreaterThan(w.high);
    expect(powerAt(0.3, 0.4, top, w)).toBeLessThan(w.low);
  });
});
