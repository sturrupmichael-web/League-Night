import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG as cfg } from '../config';
import { basketChancesV2, describeMiss, idealPuttPower, previewPutt, puttPowerWindow, readSwipe, resolvePutt, type SwipePoint, type SwipeRead } from './putt';
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

describe('putting aids', () => {
  it('the power window brackets the ideal power and widens nothing past 1.3', () => {
    for (const d of [12, 25, 40, 60]) {
      const w = puttPowerWindow(d, 0, cfg);
      expect(w.low).toBeLessThan(w.ideal);
      expect(w.ideal).toBeLessThan(w.high);
      expect(w.high).toBeLessThanOrEqual(1.3);
    }
    // Uphill needs more.
    expect(puttPowerWindow(30, 2, cfg).ideal).toBeGreaterThan(puttPowerWindow(30, 0, cfg).ideal);
  });

  it('powers at the edges of the window make a straight putt (inside the wobble-free range)', () => {
    const w = puttPowerWindow(20, 0, cfg);
    expect(putt(straight(w.low + 0.005), 20).outcome).not.toBe('cage');
    expect(putt(straight(w.high - 0.005), 20).outcome).not.toBe('over');
    expect(putt(straight(w.low - 0.03), 20).made).toBe(false);
    expect(putt(straight(w.high + 0.03), 20).made).toBe(false);
  });

  it('the preview is the putt without wobble, and the same every time', () => {
    const r: Read = { ...straight(idealPuttPower(45, 0, cfg)), aim: 0.02, bend: 0.3 };
    const a = previewPutt(r, { distance: 45, rise: 0 }, cfg);
    const b = previewPutt(r, { distance: 45, rise: 0 }, cfg);
    expect(a.path).toEqual(b.path);
    // Up close there is no wobble, so the preview is exactly the real putt.
    const close: Read = { ...straight(idealPuttPower(15, 0, cfg)), aim: 0.01 };
    expect(previewPutt(close, { distance: 15, rise: 0 }, cfg).path).toEqual(putt(close, 15, 0, 99).path);
  });

  it('a live read does not cancel a paused finger', () => {
    const paused = swipe(80, 200, { tail: [{ x: 90, y: 200, t: 400 }] });
    expect(readSwipe(paused, cfg).cancel).toBe(true);
    expect(readSwipe(paused, cfg, true).cancel).toBe(false);
  });

  it('describes misses in plain words', () => {
    const setup = { distance: 30, rise: 0 };
    const w = puttPowerWindow(30, 0, cfg);
    const short = putt(straight(w.ideal * 0.5), 30);
    expect(describeMiss(short, setup, cfg)?.kind).toMatch(/short|low/);
    const high = putt(straight(w.high + 0.15), 30);
    expect(describeMiss(high, setup, cfg)?.kind).toBe('high');
    const left = resolvePutt({ ...straight(w.ideal), aim: -0.15 }, setup, makeRng(1), cfg);
    const m = describeMiss(left, setup, cfg);
    expect(m?.kind).toBe('left');
    expect(m!.ft).toBeGreaterThanOrEqual(1);
    expect(describeMiss(putt(straight(w.ideal), 12), { distance: 12, rise: 0 }, cfg)).toBeNull();
  });
});

describe('putting physics v2 at the basket', () => {
  const mid = (cfg.basketCatchLow + cfg.basketCatchHigh) / 2;
  it('a well-weighted putt dead centre is always in', () => {
    expect(basketChancesV2(0, mid, 1, cfg).inChance).toBe(1);
    expect(basketChancesV2(0.2, mid, 1.05, cfg).inChance).toBe(1);
  });
  it('the outer chains spit more, and more when it is faster', () => {
    const edge = basketChancesV2(0.8, mid, 1, cfg).inChance;
    expect(edge).toBeLessThan(0.95);
    expect(basketChancesV2(0.8, mid, 1.2, cfg).inChance).toBeLessThan(edge);
    expect(basketChancesV2(0.8, mid, 0.85, cfg).inChance).toBeGreaterThan(edge);
  });
  it('high in the chains is riskier than the middle', () => {
    expect(basketChancesV2(0.5, cfg.basketCatchHigh - 0.05, 1, cfg).inChance).toBeLessThan(basketChancesV2(0.5, mid, 1, cfg).inChance);
  });
  it('a rocket can push through dead centre', () => {
    expect(basketChancesV2(0, mid, 1.6, cfg).inChance).toBeLessThan(1);
  });
  it('near misses: the outer chains can grab one, the rim can pop one in, the band mostly bounces', () => {
    expect(basketChancesV2(cfg.chainHalfWidth + 0.05, mid, 0.95, cfg)).toMatchObject({ zone: 'edge' });
    expect(basketChancesV2(cfg.chainHalfWidth + 0.05, mid, 0.95, cfg).inChance).toBeGreaterThan(0);
    expect(basketChancesV2(0.1, cfg.basketCatchLow - 0.05, 0.95, cfg).inChance).toBeGreaterThan(0.2);
    const band = basketChancesV2(0.2, cfg.basketCatchHigh + 0.1, 0.95, cfg);
    expect(band.zone).toBe('band');
    expect(band.inChance).toBeLessThan(0.25);
  });
  it('band hits and rim-ins come up in play, and finish where a disc can be', () => {
    const seen = new Set<string>();
    const d = 25;
    const w = puttPowerWindow(d, 0, cfg);
    for (let k = 0; k < 400; k++) {
      const power = w.low * 0.9 + ((w.high * 1.1 - w.low * 0.9) * k) / 400;
      const r = resolvePutt({ ...straight(power), aim: ((k % 7) - 3) * 0.004 }, { distance: d, rise: 0 }, makeRng(k), cfg);
      seen.add(r.outcome);
      if (r.outcome === 'band') expect(Math.abs(r.rest.v - d)).toBeLessThan(4);
      if (r.outcome === 'rim') expect(r.made).toBe(true);
    }
    expect(seen.has('band')).toBe(true);
    expect(seen.has('rim')).toBe(true);
  });
});

describe('wind on putts', () => {
  const r = (d: number): Read => straight(idealPuttPower(d, 0, cfg));
  const drift = (d: number, pv: number) => resolvePutt(r(d), { distance: d, rise: 0, crosswind: 10 * 5280 / 3600 }, () => 0.5, cfg, pv).atBasket!.u;
  it('v3 blows a 10 mph, 25 ft putt out of the chains; v2 barely moves it', () => {
    expect(Math.abs(drift(25, 2))).toBeLessThan(cfg.chainHalfWidth / 2);
    expect(drift(25, 3)).toBeGreaterThan(cfg.chainHalfWidth);
  });
  it('drift grows with distance', () => {
    expect(drift(50, 3)).toBeGreaterThan(drift(25, 3) * 1.5);
  });
});

