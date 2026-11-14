/**
 * What happens after touchdown: sit, skate, roll, skip, splash, out of bounds.
 * Pure functions only, deterministic given the rng.
 */
import type { Config } from '../config';
import type { Disc } from './discs';
import type { FlightResult } from './flight';
import { DEG, G, clamp, type PathPoint, type Vec2 } from './math';
import type { Rng } from './rng';
import type { Surface, Terrain } from './terrain';

export type RestKind = 'holed' | 'sit' | 'skate' | 'roll' | 'skip' | 'tumble' | 'water' | 'ob';

export interface GroundResult {
  kind: RestKind;
  /** Where the disc physically came to rest (may be in the water or OB). */
  rest: Vec2;
  /** Where the next throw is played from (drop point after a penalty). */
  lie: Vec2;
  surface: Surface;
  penalty: number;
  /** Did it skip off water on the way? */
  skipped: boolean;
  /** Post-landing motion, continuing the flight's clock. */
  path: PathPoint[];
}

const STEP = 1 / 60;
const STOP_SPEED = 0.6;
const MAX_SLIDE_TIME = 8;

const isHazard = (s: Surface) => s === 'water' || s === 'ob';

function friction(s: Surface, cfg: Config): number {
  switch (s) {
    case 'rough':
      return cfg.frictionRough;
    case 'green':
      return cfg.frictionGreen;
    case 'sand':
      return Infinity;
    default:
      return cfg.frictionFairway;
  }
}

/**
 * Walk back along the disc's ground track and find where it last crossed out of play:
 * the water entry point, or the last in-bounds point for OB.
 */
function lastSafePoint(terrain: Terrain, path: PathPoint[], fallback: Vec2): Vec2 {
  for (let i = path.length - 1; i >= 0; i--) {
    if (!isHazard(terrain.surface(path[i].x, path[i].y))) return { x: path[i].x, y: path[i].y };
  }
  return fallback;
}

export function resolveGround(
  flight: FlightResult,
  disc: Disc,
  origin: Vec2,
  terrain: Terrain,
  rng: Rng,
  cfg: Config,
): GroundResult {
  const L = flight.landing;
  const path: PathPoint[] = [];
  const all = () => flight.path.concat(path);

  // Always consume the same random draws, in the same order, so streams stay aligned.
  const rSkip = rng();
  const rRoll = rng();
  const rTumble = rng();
  const rTumbleDir = rng();

  if (flight.holed) {
    return { kind: 'holed', rest: { x: L.x, y: L.y }, lie: { x: L.x, y: L.y }, surface: 'green', penalty: 0, skipped: false, path };
  }

  let x = L.x;
  let y = L.y;
  let vx = L.vx;
  let vy = L.vy;
  let t = L.t;
  let vh = Math.hypot(vx, vy);
  let surface = terrain.surface(x, y);
  let skipped = false;

  const penalize = (kind: 'water' | 'ob'): GroundResult => {
    const lie = lastSafePoint(terrain, all(), origin);
    return { kind, rest: { x, y }, lie, surface, penalty: 1, skipped, path };
  };

  if (surface === 'ob') return penalize('ob');

  if (surface === 'water') {
    const canSkip =
      !flight.upsideDown &&
      vh >= cfg.skipMinSpeed &&
      L.descent <= cfg.skipMaxDescentDeg * DEG &&
      Math.abs(L.bank) <= cfg.skipMaxBankDeg * DEG &&
      rSkip < cfg.skipChance;
    if (!canSkip) return penalize('water');

    // One low ballistic hop.
    skipped = true;
    const keep = cfg.skipSpeedKeep;
    vx *= keep;
    vy *= keep;
    vh *= keep;
    let vz = vh * Math.tan(cfg.skipBounceDeg * DEG);
    let z = terrain.height(x, y);
    for (let i = 0; i < 600; i++) {
      vz -= G * STEP;
      x += vx * STEP;
      y += vy * STEP;
      z += vz * STEP;
      t += STEP;
      const gz = terrain.height(x, y);
      if (z <= gz) {
        z = gz;
        path.push({ x, y, z, t });
        break;
      }
      path.push({ x, y, z, t });
    }
    surface = terrain.surface(x, y);
    if (isHazard(surface)) return penalize(surface as 'water' | 'ob');
    // Skipped discs come out low and keep sliding a little.
    vx *= 0.6;
    vy *= 0.6;
    vh *= 0.6;
  }

  // Hammers land upside down and either flop dead or tumble a short way.
  if (flight.upsideDown) {
    if (rTumble < cfg.hammerTumbleChance) {
      const a = Math.atan2(vx, vy) + (rTumbleDir - 0.5) * Math.PI * 1.2;
      const speed = Math.sqrt(2 * cfg.frictionFairway * G * cfg.hammerTumbleMax * (0.3 + 0.7 * rTumbleDir));
      return slide({ x, y, t, vx: Math.sin(a) * speed, vy: Math.cos(a) * speed, kind: 'tumble', curve: 0, rolling: false });
    }
    return { kind: 'sit', rest: { x, y }, lie: { x, y }, surface, penalty: 0, skipped, path };
  }

  if (surface === 'sand') {
    return { kind: skipped ? 'skip' : 'sit', rest: { x, y }, lie: { x, y }, surface, penalty: 0, skipped, path };
  }

  // Roller: a driver touching down on its turn-side edge at a shallow angle.
  const rollerOk =
    !skipped &&
    disc.speed >= cfg.rollerMinSpeed &&
    L.bank >= cfg.rollerMinBankDeg * DEG &&
    L.descent <= cfg.rollerMaxDescentDeg * DEG &&
    rRoll < cfg.rollerChance;
  if (rollerOk) {
    const keep = cfg.rollerSpeedKeep;
    return slide({ x, y, t, vx: vx * keep, vy: vy * keep, kind: 'roll', curve: flight.curveSign * cfg.rollerCurve, rolling: true });
  }

  // Skate vs sit: faster molds and flatter landings slide further.
  const skate = clamp((disc.speed - cfg.skateMinSpeed) / (cfg.skateFullSpeed - cfg.skateMinSpeed), 0, 1);
  const flat = Math.cos(L.descent) ** 2;
  const keep = (cfg.sitSlide + skate * cfg.skateKeep) * flat;
  const kind: RestKind = skipped ? 'skip' : 'skate';
  return slide({ x, y, t, vx: vx * keep, vy: vy * keep, kind, curve: -flight.curveSign * cfg.skateCurve * skate, rolling: false });

  function slide(s: { x: number; y: number; t: number; vx: number; vy: number; kind: RestKind; curve: number; rolling: boolean }): GroundResult {
    let { x, y, t, vx, vy } = s;
    const v0 = Math.hypot(vx, vy);
    let surf = terrain.surface(x, y);
    let moved = 0;
    for (let i = 0; i * STEP < MAX_SLIDE_TIME; i++) {
      const v = Math.hypot(vx, vy);
      if (v < STOP_SPEED) break;
      const mu = s.rolling ? cfg.rollFriction * (surf === 'rough' ? 3 : 1) : friction(surf, cfg);
      if (!isFinite(mu)) break;
      const grad = terrain.gradient(x, y);
      // Friction opposes motion; slope pulls downhill.
      let ax = (-mu * G * vx) / v - G * cfg.slopeK * grad.x;
      let ay = (-mu * G * vy) / v - G * cfg.slopeK * grad.y;
      // Gentle curve: skates hook toward the fade side, rollers lean over harder as they slow.
      const curl = s.curve * (s.rolling ? 1 - v / Math.max(v0, 1e-6) + 0.15 : 1);
      ax += curl * vy;
      ay += -curl * vx;
      const nvx = vx + ax * STEP;
      const nvy = vy + ay * STEP;
      // Friction can stop the disc but never reverse it.
      if (nvx * vx + nvy * vy <= 0 && Math.hypot(grad.x, grad.y) < mu) break;
      vx = nvx;
      vy = nvy;
      const nx = x + vx * STEP;
      const ny = y + vy * STEP;
      moved += Math.hypot(nx - x, ny - y);
      x = nx;
      y = ny;
      t += STEP;
      path.push({ x, y, z: terrain.height(x, y), t });
      surf = terrain.surface(x, y);
      if (isHazard(surf) || surf === 'sand') break;
    }
    if (surf === 'water' || surf === 'ob') {
      const lie = lastSafePoint(terrain, all(), origin);
      return { kind: surf, rest: { x, y }, lie, surface: surf, penalty: 1, skipped, path };
    }
    const kind = s.kind === 'skate' && moved < 3 ? 'sit' : s.kind;
    return { kind, rest: { x, y }, lie: { x, y }, surface: surf, penalty: 0, skipped, path };
  }
}
