/**
 * How a putt LOOKS, built on top of the result the sim already decided. Nothing here changes
 * where the disc ends up or whether it went in: resolvePutt (and the score checker, which
 * replays it) owns that. This only turns the end of the flight into a believable moment at
 * the basket: the disc meets the front chains, they give, and it drops into the tray; or it
 * rattles out, or clangs off the tray and falls back.
 *
 * Coordinates are putt space (u right, v forward, h above the lie's ground), as in sim/putt.
 */
import type { Config } from '../config';
import { G, clamp, lerp } from '../sim/math';
import { idealArrivalSpeed, type PuttPoint, type PuttResult, type PuttSetup } from '../sim/putt';

/** Basket shape, ft above basket ground. The tray rim sits where the sim's catch zone starts. */
export const BASKET = {
  poleR: 0.07,
  trayR: 1.1,
  trayRim: 2.2,
  trayFloor: 1.55,
  chainTop: 4.4,
  chainTopR: 0.85,
  chainBottom: 2.5,
  chainBottomR: 0.18,
  bandLo: 4.4,
  bandHi: 4.62,
  bandR: 0.9,
  capTop: 4.78,
  /** Disc radius, ft (an 8.3 in putter). */
  discR: 0.35,
} as const;

/** Radius of the outer chain ring at height h (the chains taper from the band to the collar). */
export function chainRadiusAt(h: number): number {
  const f = clamp((h - BASKET.chainBottom) / (BASKET.chainTop - BASKET.chainBottom), 0, 1);
  return lerp(BASKET.chainBottomR, BASKET.chainTopR, f);
}

export type HitKind = 'chains' | 'spit' | 'tray' | 'pole' | 'graze';

export interface PuttHit {
  /** Time on the anim clock. */
  t: number;
  kind: HitKind;
  /** Where it struck, relative to the basket (u sideways, h above basket ground). */
  u: number;
  h: number;
  /** 0.3 (a brush) .. 1.6 (a rocket). Drives how far the chains swing. */
  force: number;
}

/** A frame of the disc. `tilt` 0 = flying flat, 1 = standing on edge. */
export interface AnimPoint extends PuttPoint {
  tilt?: number;
}

export interface PuttAnim {
  path: AnimPoint[];
  end: number;
  hit: PuttHit | null;
}

const groundAt = (v: number, s: PuttSetup) => (s.distance > 0 ? (s.rise * v) / s.distance : 0);

/** Point on the physics path where it first reaches depth v (interpolated), or null. */
function crossAt(path: PuttPoint[], v: number): PuttPoint | null {
  if (path[0].v >= v) return null;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (b.v >= v) {
      const f = (v - a.v) / Math.max(1e-9, b.v - a.v);
      return { u: lerp(a.u, b.u, f), v, h: lerp(a.h, b.h, f), t: lerp(a.t, b.t, f) };
    }
  }
  return null;
}

export function animatePutt(res: PuttResult, setup: PuttSetup, cfg: Config): PuttAnim {
  const D = setup.distance;
  const rise = setup.rise;
  const at = res.atBasket;
  const plain = (hit: PuttHit | null = null): PuttAnim => ({ path: res.path, end: res.path[res.path.length - 1].t, hit });

  if (!at) return plain();
  if (res.outcome === 'over' || res.outcome === 'wide') {
    // A near miss still brushes the chains or band on its way past.
    const au = Math.abs(at.u);
    const near = au < BASKET.chainTopR + 0.45 && at.h > BASKET.chainBottom - 0.2 && at.h < BASKET.capTop + 0.35;
    const p = near ? crossAt(res.path, D - 0.05) : null;
    return plain(p ? { t: p.t, kind: 'graze', u: at.u, h: at.h, force: 0.35 } : null);
  }

  const kind: HitKind =
    res.outcome === 'chains' ? 'chains' : res.outcome === 'spit' ? 'spit' : res.outcome === 'cage' && at.h >= BASKET.trayFloor - 0.15 ? 'tray' : 'pole';
  const au = Math.abs(at.u);
  // How far in front of the pole the disc's leading edge meets something.
  let depth: number;
  if (kind === 'chains' || kind === 'spit') {
    const rc = chainRadiusAt(at.h);
    depth = Math.sqrt(Math.max(0, rc * rc - au * au)) + BASKET.discR * 0.5;
  } else if (kind === 'tray') {
    depth = Math.sqrt(Math.max(0, BASKET.trayR ** 2 - Math.min(au, BASKET.trayR - 0.05) ** 2)) + BASKET.discR;
  } else {
    depth = BASKET.poleR + BASKET.discR;
  }
  depth = clamp(depth, 0.2, D - 0.6);
  const p0 = crossAt(res.path, D - depth) ?? res.path[res.path.length - 1];
  const path: AnimPoint[] = res.path.filter((q) => q.t < p0.t);
  path.push({ ...p0 });

  const ideal = idealArrivalSpeed(D, rise, cfg);
  const force = clamp(at.speed / ideal, 0.5, 1.6);
  const hb0 = p0.h - rise; // impact height above basket ground
  let t = p0.t;
  const put = (u: number, v: number, hb: number, dt: number, tilt = 0) => {
    t += dt;
    path.push({ u, v, h: hb + rise, t, tilt });
  };
  const hit: PuttHit = { t: p0.t, kind, u: p0.u, h: hb0, force: kind === 'spit' ? force * 1.2 : kind === 'chains' ? force : 0.8 };

  if (kind === 'chains') {
    // The front chains give and swallow the disc's speed...
    const pushV = Math.min(D - 0.15, p0.v + 0.22 + 0.22 * force);
    const u1 = p0.u * 0.7;
    const h1 = hb0 - 0.12;
    put(u1, pushV, h1, 0.05 + 0.04 * force, 0.1);
    // ...it hangs for a beat, then slides down through them into the tray.
    const restU = clamp(p0.u * 0.45, -0.4, 0.4);
    const restV = D - 0.5;
    const floor = BASKET.trayFloor + 0.2;
    const fall = 0.3 + 0.07 * Math.max(0, h1 - BASKET.chainBottom);
    put(u1, pushV, h1 - 0.04, 0.06, 0.15);
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      const s = i / steps;
      const e = 1 - (1 - s) * (1 - s); // sideways settles early
      put(lerp(u1, restU, e), lerp(pushV, restV, e), lerp(h1 - 0.04, floor, s * s), fall / steps, 0.15 + 0.3 * s + 0.08 * Math.sin(s * 9));
    }
    // A small rattle on the tray floor, then it sits.
    put(restU, restV, floor + 0.09, 0.06, 0.55);
    put(restU, restV, floor, 0.06, 0.42);
    put(restU, restV, floor + 0.025, 0.05, 0.47);
    put(restU, restV, floor, 0.05, 0.45);
    return { path, end: t, hit };
  }

  const rest = res.rest;
  const gRest = groundAt(rest.v, setup) - rise; // rest ground, basket-relative
  const side = p0.u >= 0 ? 1 : -1;
  let u1: number;
  let v1: number;
  let h1: number;
  if (kind === 'spit') {
    const blow = rest.v > D;
    // Into the chains, which grab and then fling it.
    put(p0.u * 0.9, p0.v + (blow ? 0.35 : 0.12), hb0 - 0.04, 0.05, 0.1);
    u1 = blow ? p0.u * 0.4 + side * 0.4 : side * (chainRadiusAt(hb0) + BASKET.discR + 0.15);
    v1 = blow ? D + BASKET.chainTopR + 0.2 : D - 0.15;
    h1 = hb0 - 0.3;
    put(u1, v1, h1, 0.11, 0.35);
  } else {
    // Clang: it pops back off the tray or pole.
    u1 = p0.u * 1.15;
    v1 = p0.v - 0.35;
    h1 = hb0 + 0.12;
    put(u1, v1, h1, 0.08, 0.3);
  }
  // Drop to the grass, landing a little short of the rest spot, one small hop, then rest.
  const landU = lerp(u1, rest.u, 0.8);
  const landV = lerp(v1, rest.v, 0.8);
  const gLand = groundAt(landV, setup) - rise;
  const fallT = clamp(Math.sqrt((2 * Math.max(0.2, h1 - gLand)) / G), 0.18, 0.55);
  const steps = 7;
  for (let i = 1; i <= steps; i++) {
    const s = i / steps;
    put(lerp(u1, landU, s), lerp(v1, landV, s), lerp(h1, gLand, s * s), fallT / steps, 0.35 + 0.3 * s);
  }
  const midV = (landV + rest.v) / 2;
  put((landU + rest.u) / 2, midV, groundAt(midV, setup) - rise + 0.12, 0.07, 0.3);
  put(rest.u, rest.v, gRest, 0.08, 0);
  return { path, end: t, hit };
}

/** Disc position at time t (holds the last frame after the end). */
export function sampleAnim(path: AnimPoint[], t: number): AnimPoint {
  if (t <= path[0].t) return path[0];
  for (let i = 1; i < path.length; i++) {
    if (path[i].t >= t) {
      const a = path[i - 1];
      const b = path[i];
      const f = (t - a.t) / Math.max(1e-6, b.t - a.t);
      return { u: lerp(a.u, b.u, f), v: lerp(a.v, b.v, f), h: lerp(a.h, b.h, f), t, tilt: lerp(a.tilt ?? 0, b.tilt ?? 0, f) };
    }
  }
  return path[path.length - 1];
}
