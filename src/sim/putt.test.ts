import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG as cfg } from '../config';
import { idealPuttPower, readSwipe, resolvePutt, type SwipePoint, type SwipeRead } from './putt';
import { makeRng } from './rng';

/** A straight upward swipe of `len` px over `ms`, with a constant finger speed. */
function swipe(len: number, ms: number, opts: { dx?: number; bow?: number; tail?: SwipePoint[] } = {}): SwipePoint[] {
  const pts: SwipePoint[] = [];
  const n = 20;
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    pts.push({ x: 90 + (opts.dx ?? 0) * f + (opts.bow ?? 0) * Math.sin(Math.PI * f), y: 280 - len * f, t: ms * f });
  }
  return pts.concat(opts.tail ?? []);
}

type Read = Extract<SwipeRead, { cancel: false }>;
const ok = (r: SwipeRead): Read => {
  if (r.cancel) throw new Error(`cancelled: ${r.reason}`);
  return r;
};
const straight = (power: number): Read => ({ cancel: false, power, aim: 0, bend: 0, snap: 0, releaseSpeed: cfg.puttSnapRef });
const putt = (r: Read, distance: number, rise = 0, seed = 1) => resolvePutt(r, { distance, rise }, makeRng(seed), cfg);

describe('reading a swipe', () => {
  it('longer swipes mean more power', () => {
    const a = ok(readSwipe(swipe(40, 150), cfg));
    const b = ok(readSwipe(swipe(100, 150 * 2.5), cfg));
    expect(b.power).toBeGreaterThan(a.power);
  });

  it('a fast snap adds power and a lazy push removes it', () => {
    const snap = ok(readSwipe(swipe(80, 60), cfg));
    const normal = ok(readSwipe(swipe(80, 80 / (cfg.puttSnapRef / 1000)), cfg));
    const lazy = ok(readSwipe(swipe(80, 1200), cfg));
    expect(snap.power).toBeGreaterThan(normal.power);
    expect(lazy.power).toBeLessThan(normal.power);
    expect(snap.snap).toBeGreaterThan(0);
    expect(lazy.snap).toBeLessThan(0);
  });

  it('a swipe angled right aims right', () => {
    expect(ok(readSwipe(swipe(80, 180, { dx: 30 }), cfg)).aim).toBeGreaterThan(0);
    expect(ok(readSwipe(swipe(80, 180, { dx: -30 }), cfg)).aim).toBeLessThan(0);
  });

  it('a swipe that bows left bends the putt right, and vice versa', () => {
    expect(ok(readSwipe(swipe(80, 180, { bow: -12 }), cfg)).bend).toBeGreaterThan(0);
    expect(ok(readSwipe(swipe(80, 180, { bow: 12 }), cfg)).bend).toBeLessThan(0);
    expect(Math.abs(ok(readSwipe(swipe(80, 180), cfg)).bend)).toBeLessThan(0.01);
  });

  it('cancels a tiny swipe, a downward swipe, a parked thumb and a pull-back at the end', () => {
    expect(readSwipe(swipe(4, 100), cfg)).toMatchObject({ cancel: true, reason: 'short' });
    expect(readSwipe(swipe(-60, 200), cfg)).toMatchObject({ cancel: true, reason: 'backward' });
    const parked = swipe(80, 200, { tail: [{ x: 90, y: 200, t: 260 }, { x: 90, y: 200, t: 400 }] });
    expect(readSwipe(parked, cfg)).toMatchObject({ cancel: true, reason: 'parked' });
    const back = swipe(80, 200, { tail: [{ x: 90, y: 215, t: 240 }, { x: 90, y: 230, t: 280 }] });
    expect(readSwipe(back, cfg)).toMatchObject({ cancel: true, reason: 'backward' });
  });
});

describe('resolving a putt', () => {
  it('the ideal power holes out from 10 to 60 feet', () => {
    for (const d of [10, 20, 33, 45, 60]) {
      const r = putt(straight(idealPuttPower(d, 0, cfg)), d);
      expect(r.outcome, `${d} ft`).toBe('chains');
      expect(r.made).toBe(true);
    }
  });

  it('ideal power grows with distance and with an uphill basket', () => {
    expect(idealPuttPower(40, 0, cfg)).toBeGreaterThan(idealPuttPower(20, 0, cfg));
    expect(idealPuttPower(30, 3, cfg)).toBeGreaterThan(idealPuttPower(30, 0, cfg));
    expect(idealPuttPower(30, -3, cfg)).toBeLessThan(idealPuttPower(30, 0, cfg));
    expect(idealPuttPower(70, 0, cfg)).toBeGreaterThan(0.85);
    expect(idealPuttPower(70, 0, cfg)).toBeLessThan(1.15);
  });

  it('too soft comes up short, too hard sails over', () => {
    const p = idealPuttPower(30, 0, cfg);
    expect(putt(straight(p * 0.5), 30).outcome).toBe('short');
    expect(putt(straight(p * 1.6), 30).outcome).toBe('over');
  });

  it('a little soft hits the cage', () => {
    const p = idealPuttPower(25, 0, cfg);
    let found = false;
    for (let k = 0.7; k < 1; k += 0.01) if (putt(straight(p * k), 25).outcome === 'cage') found = true;
    expect(found).toBe(true);
  });

  it('a putt aimed well off line misses wide', () => {
    const r = putt({ ...straight(idealPuttPower(30, 0, cfg)), aim: 0.08 }, 30);
    expect(r.outcome).toBe('wide');
    expect(r.rest.u).toBeGreaterThan(0);
  });

  it('bend curves the putt', () => {
    const p = idealPuttPower(40, 0, cfg);
    const right = putt({ ...straight(p), bend: 1 }, 40);
    const left = putt({ ...straight(p), bend: -1 }, 40);
    expect(right.atBasket!.u).toBeGreaterThan(0.3);
    expect(left.atBasket!.u).toBeLessThan(-0.3);
    // A bend can rescue a putt aimed off line.
    const p2 = idealPuttPower(25, 0, cfg);
    const saved = putt({ ...straight(p2), aim: -0.035, bend: 0.5 }, 25);
    expect(Math.abs(saved.atBasket!.u)).toBeLessThan(Math.abs(putt({ ...straight(p2), aim: -0.035 }, 25).atBasket!.u));
  });

  it('an uphill putt at flat-ground power comes up short of the chains', () => {
    const p = idealPuttPower(30, 0, cfg);
    expect(putt(straight(p), 30, 4).made).toBe(false);
    expect(putt(straight(idealPuttPower(30, 4, cfg)), 30, 4).made).toBe(true);
  });

  it('a slammed off-centre putt can spit out, a centred firm one usually holds', () => {
    // A short putt slammed hard enough to still be in the chain window, slightly off centre.
    const d = 12;
    const p = idealPuttPower(d, 0, cfg);
    const outcomes = new Set<string>();
    for (const k of [1.2, 1.3, 1.4]) {
      for (let s = 0; s < 20; s++) outcomes.add(resolvePutt({ ...straight(p * k), aim: 0.5 / d }, { distance: d, rise: 0 }, makeRng(s), cfg).outcome);
    }
    expect(outcomes.has('spit')).toBe(true);
    expect(putt(straight(p * 1.15), d).outcome).toBe('chains');
  });

  it('is deterministic', () => {
    const r = { ...straight(0.7), aim: 0.01, bend: 0.2 };
    expect(putt(r, 50, 1, 7)).toEqual(putt(r, 50, 1, 7));
  });
});

describe('long putts carry risk', () => {
  it('a perfectly weighted putt always drops from close range but not always from 60 ft', () => {
    const rate = (d: number) => {
      let made = 0;
      for (let k = 1; k <= 200; k++) if (putt(straight(idealPuttPower(d, 0, cfg)), d, 0, k).made) made++;
      return made / 200;
    };
    expect(rate(15)).toBe(1);
    expect(rate(60)).toBeLessThan(0.8);
    expect(rate(60)).toBeGreaterThan(0.15);
  });
});
