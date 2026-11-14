/**
 * Swipe-to-putt. Two pure steps:
 *  1. readSwipe: turn a finger path into power / aim / bend (or a cancel).
 *  2. resolvePutt: fly the putt at the basket and decide chains, over, cage, spit, short or wide.
 *
 * Putt space: u = sideways (ft, + = right as seen from behind the disc), v = forward toward
 * the basket (ft), h = height above the disc's ground (ft). The basket is at (0, distance).
 */
import type { Config } from '../config';
import { DEG, G, clamp } from './math';
import type { Rng } from './rng';

export interface SwipePoint {
  /** View pixels (y grows downward). */
  x: number;
  y: number;
  /** Milliseconds. */
  t: number;
}

export type SwipeRead =
  | { cancel: true; reason: 'short' | 'backward' | 'parked' }
  | {
      cancel: false;
      power: number;
      /** Sideways aim angle in radians, + = right. */
      aim: number;
      /** -1..1, + = putt curves right. */
      bend: number;
      /** -1 (lazy push) .. +1 (fast snap). */
      snap: number;
      /** Finger speed at release, px/s. */
      releaseSpeed: number;
    };

const RELEASE_WINDOW_MS = 80;

/**
 * `live` reads a swipe that is still in progress (for the on-screen meter): a finger that
 * has paused or is easing back is not a cancel yet, so only the length/direction checks apply.
 */
export function readSwipe(points: SwipePoint[], cfg: Config, live = false): SwipeRead {
  if (points.length < 2) return { cancel: true, reason: 'short' };
  const a = points[0];
  const b = points[points.length - 1];
  const up = a.y - b.y;
  if (up < -cfg.puttMinSwipePx) return { cancel: true, reason: 'backward' };
  if (up < cfg.puttMinSwipePx) return { cancel: true, reason: 'short' };

  // Velocity over the last ~80 ms.
  let k = points.length - 2;
  while (k > 0 && b.t - points[k].t < RELEASE_WINDOW_MS) k--;
  const r0 = points[k];
  const dt = Math.max(1, b.t - r0.t) / 1000;
  const vy = (b.y - r0.y) / dt; // + = moving down the screen
  if (!live && vy > cfg.puttParkSpeed) return { cancel: true, reason: 'backward' };
  const releaseSpeed = Math.max(0, -vy);
  if (!live && releaseSpeed < cfg.puttParkSpeed) return { cancel: true, reason: 'parked' };

  const cx = b.x - a.x;
  const chord = Math.hypot(cx, up);
  const snap = clamp((releaseSpeed - cfg.puttSnapRef) / cfg.puttSnapRef, -1, 1);
  const power = clamp((chord / cfg.puttFullSwipePx) * (1 + snap * cfg.puttSnapGain), 0, 1.3);
  const aim = Math.atan2(cx, up) * cfg.puttAimGain;

  // Bow of the path away from the chord. A path that bows left finishes heading right, so it bends right.
  let bow = 0;
  for (const p of points) {
    // Signed distance from the chord, + = right of it (screen x grows right, chord points up).
    const d = ((p.x - a.x) * up - (a.y - p.y) * cx) / chord;
    if (Math.abs(d) > Math.abs(bow)) bow = d;
  }
  const bend = clamp((-bow / chord) * cfg.puttBendGain, -1, 1);

  return { cancel: false, power, aim, bend, snap, releaseSpeed };
}

export type PuttOutcome = 'chains' | 'spit' | 'over' | 'cage' | 'short' | 'wide';

export interface PuttSetup {
  /** Distance to the basket, ft. */
  distance: number;
  /** Basket ground height minus disc ground height, ft (+ = uphill putt). */
  rise: number;
  /** Crosswind, ft/s, + = blowing to the right. */
  crosswind?: number;
}

export interface PuttPoint { u: number; v: number; h: number; t: number }

export interface PuttResult {
  outcome: PuttOutcome;
  made: boolean;
  /** Height above basket ground and sideways offset when the putt reached the basket (if it did). */
  atBasket: { h: number; u: number; speed: number } | null;
  /** Where the disc ended up, in putt space. */
  rest: { u: number; v: number };
  path: PuttPoint[];
}

const DT = 1 / 120;

export function puttLaunchSpeed(power: number, cfg: Config): number {
  return cfg.puttSpeedFull * Math.sqrt(Math.max(0, power));
}

/** Power that makes a straight putt reach the basket at height `h` (ft above basket ground). */
function powerForHeight(distance: number, rise: number, h: number, cfg: Config): number {
  const th = cfg.puttLaunchDeg * DEG;
  const drop = cfg.puttReleaseHeight + distance * Math.tan(th) - (h + rise);
  if (drop <= 0) return 1.3;
  const v2 = (G * distance * distance) / (2 * Math.cos(th) ** 2 * drop);
  return Math.min(1.3, v2 / cfg.puttSpeedFull ** 2);
}

/** Power that puts a straight putt in the middle of the chains (ignores snap). */
export function idealPuttPower(distance: number, rise: number, cfg: Config): number {
  return powerForHeight(distance, rise, (cfg.basketCatchLow + cfg.basketCatchHigh) / 2, cfg);
}

/**
 * The band of power that finds the chains on a straight, wobble-free putt: `low` just clears
 * the cage, `high` just catches the top chains. The meter draws it as the "make" zone.
 */
export function puttPowerWindow(distance: number, rise: number, cfg: Config): { low: number; ideal: number; high: number } {
  return {
    low: powerForHeight(distance, rise, cfg.basketCatchLow, cfg),
    ideal: idealPuttPower(distance, rise, cfg),
    high: powerForHeight(distance, rise, cfg.basketCatchHigh, cfg),
  };
}

/** Rng that always answers 0.5: no wobble, no spit roll. Used for the aiming guide. */
const steadyRng: Rng = () => 0.5;

/** The putt as it would fly with a perfectly steady release (no wobble). For the aiming guide only. */
export function previewPutt(read: Extract<SwipeRead, { cancel: false }>, setup: PuttSetup, cfg: Config): PuttResult {
  return resolvePutt(read, setup, steadyRng, cfg);
}

export type MissKind = 'short' | 'long' | 'high' | 'low' | 'left' | 'right' | 'hard' | 'offline';

/**
 * Plain-words read of a miss: the main reason and by how much (ft, rounded up to 1).
 * Null for a make.
 */
export function describeMiss(res: PuttResult, setup: PuttSetup, cfg: Config): { kind: MissKind; ft: number } | null {
  if (res.made) return null;
  const ft = (x: number) => Math.max(1, Math.round(x));
  const at = res.atBasket;
  if (!at) return { kind: 'short', ft: ft(setup.distance - res.rest.v) };
  const au = Math.abs(at.u);
  switch (res.outcome) {
    case 'spit': {
      const ratio = at.speed / idealArrivalSpeed(setup.distance, setup.rise, cfg);
      return ratio >= cfg.spitRatio ? { kind: 'hard', ft: 0 } : { kind: 'offline', ft: 0 };
    }
    case 'over':
      return { kind: 'high', ft: ft(at.h - cfg.basketCatchHigh) };
    case 'cage':
    case 'short':
      return { kind: 'low', ft: ft(cfg.basketCatchLow - at.h) };
    default: {
      // Wide: which way, and how far outside the chains. If it also sailed high, height wins only when it's the bigger miss.
      const side = au - cfg.chainHalfWidth;
      const high = at.h - cfg.basketCatchHigh;
      if (high > side) return { kind: 'high', ft: ft(high) };
      if (at.h < cfg.basketCatchLow - 0.5 && cfg.basketCatchLow - at.h > side) return { kind: 'low', ft: ft(cfg.basketCatchLow - at.h) };
      return { kind: at.u < 0 ? 'left' : 'right', ft: ft(side) };
    }
  }
}

/** Arrival speed of a perfectly weighted straight putt. */
export function idealArrivalSpeed(distance: number, rise: number, cfg: Config): number {
  const v = puttLaunchSpeed(idealPuttPower(distance, rise, cfg), cfg);
  const target = (cfg.basketCatchLow + cfg.basketCatchHigh) / 2 + rise;
  return Math.sqrt(Math.max(1, v * v + 2 * G * (cfg.puttReleaseHeight - target)));
}

/** Ground height along the putting line: a straight ramp from the disc to the basket and beyond. */
const groundAt = (v: number, s: PuttSetup) => (s.distance > 0 ? (s.rise * v) / s.distance : 0);

export function resolvePutt(read: Extract<SwipeRead, { cancel: false }>, setup: PuttSetup, rng: Rng, cfg: Config): PuttResult {
  const spitRoll = rng();
  const spitDist = rng();
  // Release wobble: nobody is a machine. It grows with distance past the "circle", so
  // long putts are a real gamble while short ones stay about the swipe.
  const reach = Math.max(0, (setup.distance - cfg.puttWobbleFromFt) / 30);
  const aimWobble = (rng() * 2 - 1) * cfg.puttWobbleDeg * DEG * reach;
  const powerWobble = 1 + (rng() * 2 - 1) * cfg.puttPowerWobble * reach;
  const th = cfg.puttLaunchDeg * DEG;
  const speed = puttLaunchSpeed(read.power * powerWobble, cfg);
  let vf = speed * Math.cos(th);
  let vz = speed * Math.sin(th);
  let vu = vf * Math.tan(read.aim + aimWobble);
  const bendAcc = read.bend * cfg.puttBendAccel;
  const windAcc = (setup.crosswind ?? 0) * cfg.puttWindDrift;
  let u = 0;
  let v = 0;
  let h = cfg.puttReleaseHeight;
  let t = 0;
  const path: PuttPoint[] = [{ u, v, h, t }];
  const D = setup.distance;
  let atBasket: PuttResult['atBasket'] = null;
  let outcome: PuttOutcome | null = null;
  let rest = { u: 0, v: 0 };

  for (let i = 0; i < 2000; i++) {
    const pv = v;
    const ph = h;
    const pu = u;
    vz -= G * DT;
    vu += (bendAcc + windAcc) * DT;
    u += vu * DT;
    v += vf * DT;
    h += vz * DT;
    t += DT;

    if (!atBasket && pv < D && v >= D) {
      // Reached the basket plane: interpolate the crossing.
      const f = (D - pv) / Math.max(1e-9, v - pv);
      const hc = ph + (h - ph) * f - setup.rise;
      const uc = pu + (u - pu) * f;
      const sp = Math.hypot(vf, vz, vu);
      atBasket = { h: hc, u: uc, speed: sp };
      const au = Math.abs(uc);
      if (au <= cfg.chainHalfWidth && hc >= cfg.basketCatchLow && hc <= cfg.basketCatchHigh) {
        // "Too hard" is relative to a well-weighted putt from this distance.
        const ratio = sp / idealArrivalSpeed(D, setup.rise, cfg);
        const offCentre = au > cfg.centerHalfWidth;
        const spitChance = clamp((ratio - cfg.spitRatio) * 8, 0, 0.9);
        if ((ratio >= cfg.blowThroughRatio && offCentre) || (offCentre && spitRoll < spitChance)) outcome = 'spit';
        else outcome = 'chains';
      } else if (au <= cfg.cageHalfWidth && hc < cfg.basketCatchLow && hc >= cfg.cageBottom) {
        outcome = 'cage';
      } else if (au <= cfg.cageHalfWidth && hc < cfg.cageBottom) {
        outcome = 'short'; // smacked the pole low
      } else if (au <= cfg.cageHalfWidth && hc > cfg.basketCatchHigh) {
        outcome = 'over';
      } else {
        outcome = 'wide';
      }
      path.push({ u: uc, v: D, h: hc + setup.rise, t: t - DT * (1 - f) });

      if (outcome === 'chains') {
        // Drop into the tray.
        rest = { u: 0, v: D };
        path.push({ u: 0, v: D, h: setup.rise + cfg.basketCatchLow - 0.6, t: t + 0.25 });
        break;
      }
      if (outcome === 'cage' || outcome === 'short') {
        rest = { u: uc * 1.5, v: D - 1.5 };
        path.push({ u: rest.u, v: rest.v, h: groundAt(rest.v, setup), t: t + 0.35 });
        break;
      }
      if (outcome === 'spit') {
        const back = 2 + spitDist * 5;
        const side = (uc >= 0 ? 1 : -1) * (1 + spitDist * 3);
        rest = { u: side, v: D + (sp / idealArrivalSpeed(D, setup.rise, cfg) >= cfg.blowThroughRatio ? back : -back * 0.5) };
        path.push({ u: rest.u, v: rest.v, h: groundAt(rest.v, setup), t: t + 0.4 });
        break;
      }
      // 'over' and 'wide' keep flying past the basket.
    }

    const g = groundAt(v, setup);
    if (h <= g) {
      if (!outcome) outcome = 'short';
      // Putters sit: a little slide forward.
      const slide = Math.min(2, vf * 0.04);
      rest = { u, v: v + slide };
      path.push({ u, v, h: g, t });
      path.push({ u: rest.u, v: rest.v, h: groundAt(rest.v, setup), t: t + 0.2 });
      break;
    }
    if (i % 2 === 0) path.push({ u, v, h, t });
  }

  return { outcome: outcome ?? 'short', made: outcome === 'chains', atBasket, rest, path };
}
