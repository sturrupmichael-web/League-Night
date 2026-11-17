/**
 * Hold-to-charge putt meter. Press and hold: the bar climbs to the top and falls back
 * (and keeps bouncing) at a steady pace. Let go to putt at that power. Slide sideways
 * while holding to aim, slide down to call it off.
 *
 * The blue zone slides up and down the bar on its own clock (puttMeterZoneMove), so the
 * needle has to be let go where the zone is right now. How far the needle sits above or below
 * the zone's perfect-weight line is how much harder or softer than perfect the putt goes.
 *
 * Pure input mapping: it produces the same `read` a swipe did (power, aim, no bend or
 * snap), so putt physics, replays and the score checker are untouched.
 */
import type { Config } from '../config';
import { clamp } from '../sim/math';
import { puttPowerWindow, type SwipeRead } from '../sim/putt';

/** Share of the bar the blue zone takes for a putt this long: wide by the basket, a sliver from the edge of range. */
export function meterZoneShare(distance: number, cfg: Config): number {
  const t = clamp((distance - cfg.puttMeterNearFt) / Math.max(1, cfg.puttMeterFarFt - cfg.puttMeterNearFt), 0, 1);
  return cfg.puttMeterZoneFar + (cfg.puttMeterZoneNear - cfg.puttMeterZoneFar) * (1 - t) ** cfg.puttMeterZoneCurve;
}

/** Top of the bar for this putt, in putt power: picked so the blue zone fills meterZoneShare of it. */
export function meterTop(distance: number, rise: number, cfg: Config): number {
  const w = puttPowerWindow(distance, rise, cfg);
  return Math.max((w.high - w.low) / meterZoneShare(distance, cfg), w.high * 1.15);
}

/** 0..1 bar fill after holding for `heldS` seconds: up, down, up... */
export function meterFill(heldS: number, cfg: Config): number {
  const x = Math.max(0, heldS) / Math.max(0.05, cfg.puttMeterRiseS);
  const k = x % 2;
  return k <= 1 ? k : 2 - k;
}

export interface PowerWindow {
  low: number;
  ideal: number;
  high: number;
}

/**
 * Where the zone's perfect-weight line sits on the bar (0..1) at scene time `nowS`.
 * Still (the putt's true power) when puttMeterZoneMove is off; otherwise it glides between
 * the bottom and top of the bar, never letting the zone run off either end.
 */
export function meterZoneLine(nowS: number, top: number, win: PowerWindow, cfg: Config): number {
  const still = win.ideal / top;
  if (!cfg.puttMeterZoneMove) return still;
  const lo = (win.ideal - win.low) / top + 0.02;
  const hi = 1 - (win.high - win.ideal) / top - 0.02;
  if (hi <= lo) return still;
  const mid = (lo + hi) / 2;
  const amp = (hi - lo) / 2;
  return mid + amp * Math.sin((2 * Math.PI * nowS) / Math.max(0.2, cfg.puttMeterZonePeriodS));
}

/** Putt power for a needle at bar fill `fill` while the zone line is at `line`: perfect when they meet. */
export function powerAt(fill: number, line: number, top: number, win: PowerWindow): number {
  return Math.max(0, win.ideal + (fill - line) * top);
}

export function meterPower(heldS: number, nowS: number, top: number, win: PowerWindow, cfg: Config): number {
  return powerAt(meterFill(heldS, cfg), meterZoneLine(nowS, top, win, cfg), top, win);
}

/** Sideways aim (radians, + = right) from how far the thumb has slid since it went down (view px). */
export function meterAim(dxPx: number, cfg: Config): number {
  return clamp(dxPx * cfg.puttMeterAimPerPx, -0.35, 0.35);
}

export type MeterRelease = { cancel: true; reason: 'tap' | 'slid-down' } | Extract<SwipeRead, { cancel: false }>;

/** What letting go does: a putt read, or a cancel for a quick tap or a slide down. */
export function meterRelease(heldS: number, nowS: number, dxPx: number, dyPx: number, top: number, win: PowerWindow, cfg: Config): MeterRelease {
  if (dyPx > cfg.puttMeterCancelPx) return { cancel: true, reason: 'slid-down' };
  if (heldS < cfg.puttMeterMinHoldS) return { cancel: true, reason: 'tap' };
  return { cancel: false, power: meterPower(heldS, nowS, top, win, cfg), aim: meterAim(dxPx, cfg), bend: 0, snap: 0, releaseSpeed: 0 };
}
