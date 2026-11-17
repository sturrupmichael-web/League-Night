/**
 * Hold-to-charge putt meter. Press and hold: the bar climbs to the top and falls back
 * (and keeps bouncing) at a steady pace. Let go to putt at that power. Slide sideways
 * while holding to aim, slide down to call it off.
 *
 * Pure input mapping: it produces the same `read` a swipe did (power, aim, no bend or
 * snap), so putt physics, replays and the score checker are untouched.
 */
import type { Config } from '../config';
import { clamp } from '../sim/math';
import { puttPowerWindow, type SwipeRead } from '../sim/putt';

/** Top of the bar for this putt, in putt power. Scaled to the putt so short putts get a roomy window. */
export function meterTop(distance: number, rise: number, cfg: Config): number {
  const w = puttPowerWindow(distance, rise, cfg);
  return clamp(w.ideal * cfg.puttMeterTopMul, cfg.puttMeterTopMin, cfg.puttMeterTopMax);
}

/** 0..1 bar fill after holding for `heldS` seconds: up, down, up... */
export function meterFill(heldS: number, cfg: Config): number {
  const x = Math.max(0, heldS) / Math.max(0.05, cfg.puttMeterRiseS);
  const k = x % 2;
  return k <= 1 ? k : 2 - k;
}

export function meterPower(heldS: number, top: number, cfg: Config): number {
  return meterFill(heldS, cfg) * top;
}

/** Sideways aim (radians, + = right) from how far the thumb has slid since it went down (view px). */
export function meterAim(dxPx: number, cfg: Config): number {
  return clamp(dxPx * cfg.puttMeterAimPerPx, -0.35, 0.35);
}

export type MeterRelease = { cancel: true; reason: 'tap' | 'slid-down' } | Extract<SwipeRead, { cancel: false }>;

/** What letting go does: a putt read, or a cancel for a quick tap or a slide down. */
export function meterRelease(heldS: number, dxPx: number, dyPx: number, top: number, cfg: Config): MeterRelease {
  if (dyPx > cfg.puttMeterCancelPx) return { cancel: true, reason: 'slid-down' };
  if (heldS < cfg.puttMeterMinHoldS) return { cancel: true, reason: 'tap' };
  return { cancel: false, power: meterPower(heldS, top, cfg), aim: meterAim(dxPx, cfg), bend: 0, snap: 0, releaseSpeed: 0 };
}
