import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../config';
import discsJson from '../content/discs.json';
import type { Disc } from './discs';
import type { FlightResult } from './flight';
import { resolveGround } from './ground';
import { DEG, dist, type PathPoint } from './math';
import { makeRng } from './rng';
import { flatTerrain, makeTerrain, type Polygon, type Surface } from './terrain';
import { simulateThrow } from './throw';
import { CALM } from './wind';

const cfg = DEFAULT_CONFIG;
const discs = discsJson as Disc[];
const byId = (id: string) => discs.find((d) => d.id === id)!;
const putter = byId('tap-in');
const driver = byId('overtime');

const rect = (x0: number, y0: number, x1: number, y1: number): Polygon => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const withRegion = (surface: Surface, poly: Polygon) => makeTerrain({ defaultSurface: 'fairway', regions: [{ surface, poly }], trees: [] });

/** A hand-built straight flight down +y that touches down at (0, y) with the given motion. */
function fakeFlight(o: { y: number; speed: number; descentDeg: number; bankDeg?: number; curveSign?: number; upsideDown?: boolean }): FlightResult {
  const path: PathPoint[] = [];
  for (let k = 0; k <= 20; k++) path.push({ x: 0, y: (o.y * k) / 20, z: 5 * (1 - k / 20), t: k * 0.1 });
  const d = o.descentDeg * DEG;
  return {
    path,
    landing: { x: 0, y: o.y, z: 0, t: 2, vx: 0, vy: o.speed, vz: -o.speed * Math.tan(d), bank: (o.bankDeg ?? 0) * DEG, descent: d },
    holed: false,
    treeHits: 0,
    treeHitTimes: [],
    curveSign: o.curveSign ?? 1,
    launchAim: 0,
    launchBank: 0,
    launchSpeed: 90,
    upsideDown: o.upsideDown ?? false,
  };
}

const origin = { x: 0, y: 0 };
const slideLen = (r: ReturnType<typeof resolveGround>, y: number) => dist(r.rest, { x: 0, y });

describe('ground: sit and skate', () => {
  it('a putter sits close to where it lands', () => {
    const r = resolveGround(fakeFlight({ y: 200, speed: 50, descentDeg: 20 }), putter, origin, flatTerrain(), makeRng(1), cfg);
    expect(r.kind).toBe('sit');
    expect(slideLen(r, 200)).toBeLessThan(3);
    expect(r.penalty).toBe(0);
  });

  it('a driver skates well past its landing spot', () => {
    const r = resolveGround(fakeFlight({ y: 200, speed: 50, descentDeg: 10 }), driver, origin, flatTerrain(), makeRng(1), { ...cfg, rollerChance: 0 });
    expect(r.kind).toBe('skate');
    expect(slideLen(r, 200)).toBeGreaterThan(10);
  });

  it('a steep landing skates less than a flat one', () => {
    const c = { ...cfg, rollerChance: 0 };
    const flat = resolveGround(fakeFlight({ y: 200, speed: 50, descentDeg: 5 }), driver, origin, flatTerrain(), makeRng(1), c);
    const steep = resolveGround(fakeFlight({ y: 200, speed: 50, descentDeg: 45 }), driver, origin, flatTerrain(), makeRng(1), c);
    expect(slideLen(steep, 200)).toBeLessThan(slideLen(flat, 200));
  });

  it('a right-hand backhand skate hooks toward the fade side (left)', () => {
    const r = resolveGround(fakeFlight({ y: 200, speed: 60, descentDeg: 5 }), driver, origin, flatTerrain(), makeRng(1), { ...cfg, rollerChance: 0 });
    expect(r.rest.x).toBeLessThan(0);
  });

  it('sand stops a skate dead', () => {
    const terrain = withRegion('sand', rect(-20, 190, 20, 260));
    const r = resolveGround(fakeFlight({ y: 200, speed: 60, descentDeg: 5 }), driver, origin, terrain, makeRng(1), { ...cfg, rollerChance: 0 });
    expect(r.surface).toBe('sand');
    expect(slideLen(r, 200)).toBeLessThan(0.01);
  });

  it('rough shortens a skate', () => {
    const c = { ...cfg, rollerChance: 0 };
    const fair = resolveGround(fakeFlight({ y: 200, speed: 60, descentDeg: 5 }), driver, origin, flatTerrain(), makeRng(1), c);
    const rough = resolveGround(fakeFlight({ y: 200, speed: 60, descentDeg: 5 }), driver, origin, withRegion('rough', rect(-50, 150, 50, 400)), makeRng(1), c);
    expect(slideLen(rough, 200)).toBeLessThan(slideLen(fair, 200));
  });
});

describe('ground: rollers', () => {
  it('a driver landing on its turn-side edge can roll, further than a skate', () => {
    const c = { ...cfg, rollerChance: 1 };
    const r = resolveGround(fakeFlight({ y: 200, speed: 50, descentDeg: 10, bankDeg: 50 }), driver, origin, flatTerrain(), makeRng(1), c);
    expect(r.kind).toBe('roll');
    const skate = resolveGround(fakeFlight({ y: 200, speed: 50, descentDeg: 10 }), driver, origin, flatTerrain(), makeRng(1), c);
    expect(slideLen(r, 200)).toBeGreaterThan(slideLen(skate, 200));
  });

  it('putters do not roll', () => {
    const r = resolveGround(fakeFlight({ y: 200, speed: 50, descentDeg: 10, bankDeg: 50 }), putter, origin, flatTerrain(), makeRng(1), { ...cfg, rollerChance: 1 });
    expect(r.kind).not.toBe('roll');
  });
});

describe('ground: water and out of bounds', () => {
  const pond = withRegion('water', rect(-50, 180, 50, 230));

  it('a steep landing in water costs a stroke and drops at the entry point', () => {
    const r = resolveGround(fakeFlight({ y: 200, speed: 40, descentDeg: 40 }), putter, origin, pond, makeRng(1), cfg);
    expect(r.kind).toBe('water');
    expect(r.penalty).toBe(1);
    expect(pond.surface(r.lie.x, r.lie.y)).toBe('fairway');
    expect(r.lie.y).toBeLessThan(180);
    expect(r.lie.y).toBeGreaterThan(160);
  });

  it('a low, fast, flat disc skips once and can make it across', () => {
    const r = resolveGround(fakeFlight({ y: 200, speed: 70, descentDeg: 5 }), driver, origin, pond, makeRng(1), { ...cfg, skipChance: 1, rollerChance: 0 });
    expect(r.skipped).toBe(true);
    expect(r.penalty).toBe(0);
    expect(r.rest.y).toBeGreaterThan(230);
    expect(r.kind).toBe('skip');
  });

  it('a skip that comes down in the water again is still wet', () => {
    const wide = withRegion('water', rect(-50, 180, 50, 600));
    const r = resolveGround(fakeFlight({ y: 200, speed: 70, descentDeg: 5 }), driver, origin, wide, makeRng(1), { ...cfg, skipChance: 1 });
    expect(r.skipped).toBe(true);
    expect(r.kind).toBe('water');
    expect(r.lie.y).toBeLessThan(180);
  });

  it('landing out of bounds costs a stroke and drops at the last in-bounds point', () => {
    const terrain = makeTerrain({ defaultSurface: 'fairway', bounds: rect(-100, -20, 100, 150), regions: [], trees: [] });
    const r = resolveGround(fakeFlight({ y: 200, speed: 40, descentDeg: 30 }), putter, origin, terrain, makeRng(1), cfg);
    expect(r.kind).toBe('ob');
    expect(r.penalty).toBe(1);
    expect(terrain.surface(r.lie.x, r.lie.y)).toBe('fairway');
    expect(r.lie.y).toBeLessThanOrEqual(150);
  });

  it('skating into the water is a penalty too', () => {
    const terrain = withRegion('water', rect(-50, 205, 50, 260));
    const r = resolveGround(fakeFlight({ y: 200, speed: 70, descentDeg: 3 }), driver, origin, terrain, makeRng(1), { ...cfg, rollerChance: 0 });
    expect(r.kind).toBe('water');
    expect(r.lie.y).toBeLessThan(205);
  });
});

describe('ground: slopes and hammers', () => {
  it('a skate runs further downhill than uphill', () => {
    const slope = (rise: number) =>
      makeTerrain({ defaultSurface: 'fairway', regions: [], trees: [], heightmap: { cellFt: 400, w: 2, h: 2, originX: -200, originY: 0, data: [0, 0, rise, rise] } });
    const c = { ...cfg, rollerChance: 0 };
    const up = resolveGround(fakeFlight({ y: 200, speed: 50, descentDeg: 5 }), driver, origin, slope(60), makeRng(1), c);
    const down = resolveGround(fakeFlight({ y: 200, speed: 50, descentDeg: 5 }), driver, origin, slope(-60), makeRng(1), c);
    expect(slideLen(down, 200)).toBeGreaterThan(slideLen(up, 200));
  });

  it('a hammer either flops or tumbles a short way', () => {
    for (let s = 0; s < 10; s++) {
      const r = resolveGround(fakeFlight({ y: 150, speed: 30, descentDeg: 60, upsideDown: true }), putter, origin, flatTerrain(), makeRng(s), cfg);
      expect(['sit', 'tumble']).toContain(r.kind);
      expect(slideLen(r, 150)).toBeLessThan(cfg.hammerTumbleMax + 1);
    }
  });
});

describe('full throw', () => {
  it('is deterministic for a seed', () => {
    const terrain = withRegion('water', rect(-60, 150, 60, 220));
    const i = { origin, aim: 0.05, power: 1.1, release: 0.3, style: 'backhand' as const, hand: 'right' as const };
    const a = simulateThrow(i, driver, { terrain, wind: CALM }, 99, cfg);
    const b = simulateThrow(i, driver, { terrain, wind: CALM }, 99, cfg);
    expect(b.path).toEqual(a.path);
    expect(b.ground).toEqual(a.ground);
  });

  it('reports carry and total', () => {
    const r = simulateThrow({ origin, aim: 0, power: 1, release: 0, style: 'backhand', hand: 'right' }, driver, { terrain: flatTerrain(), wind: CALM }, 1, { ...cfg, rollerChance: 0 });
    expect(r.carry).toBeGreaterThan(250);
    expect(r.total).toBeGreaterThan(r.carry);
  });
});
