/**
 * Disc flight model. Pure functions only: no rendering, no globals, no Math.random.
 *
 * World units are feet. x/y is the top-down map (y = down-range), z is altitude.
 * The model is tuned for feel, not realism:
 *  - Launch speed comes from power. Each disc has a "rated" airspeed from its speed number.
 *  - While the disc is faster than its rated speed it banks toward its turn side (turn number);
 *    once it slows below it, it banks toward the fade side (fade number). Bank tilts lift sideways.
 *  - Underpowering a high-speed disc means it never reaches the turn phase, loses lift and fades early.
 *  - Wind changes airspeed: headwind = more lift and more turn, tailwind = flatter and longer.
 */
import type { Config } from '../config';
import { type Disc, stability } from './discs';
import { DEG, G, clamp, type PathPoint, type Vec2 } from './math';
import { gaussian, type Rng } from './rng';
import type { Terrain } from './terrain';
import { type Wind, windAt } from './wind';

export type Style = 'backhand' | 'forehand' | 'hammer';
export type Hand = 'right' | 'left';

export interface ThrowInput {
  /** Launch point on the map. */
  origin: Vec2;
  /** Aim angle in radians: 0 = +y, positive turns toward +x. */
  aim: number;
  /** 0..maxPower. Above 1.0 is the redline. */
  power: number;
  /** Release angle: -1 full hyzer, 0 flat, +1 full anhyzer. */
  release: number;
  style: Style;
  hand: Hand;
  /** Optional character power multiplier (default 1). */
  armMul?: number;
}

export interface FlightEnv {
  terrain: Terrain;
  wind: Wind;
  /** Basket position, for in-flight throw-ins. */
  basket?: Vec2;
}

export interface Landing {
  x: number;
  y: number;
  z: number;
  t: number;
  vx: number;
  vy: number;
  vz: number;
  /** Bank at touchdown in radians, + = leaning toward the turn side (anhyzer-ish). */
  bank: number;
  /** Angle of descent below horizontal, radians. */
  descent: number;
}

export interface FlightResult {
  /** Sampled every 1/60 s, starting at the release point. */
  path: PathPoint[];
  landing: Landing;
  /** True when the disc hit the chains in flight. */
  holed: boolean;
  treeHits: number;
  /** +1 if this hand/style turns toward +x relative to travel, -1 otherwise. */
  curveSign: number;
  /** Actual aim and release bank after any redline wobble. */
  launchAim: number;
  launchBank: number;
  launchSpeed: number;
  upsideDown: boolean;
}

export const SIM_DT = 1 / 120;
export const SAMPLE_EVERY = 2; // => path samples at 60 Hz

/**
 * Which way the turn side is, relative to the direction of travel (+1 = right).
 * Right-hand backhand turns right and fades left. Forehand and left hand each mirror it.
 * A hammer is gripped like a forehand, so it shares the forehand's sign.
 */
export function curveSign(hand: Hand, style: Style): number {
  const h = hand === 'right' ? 1 : -1;
  return style === 'backhand' ? h : -h;
}

/**
 * The release angle a disc "wants": overstable discs like a touch of anhyzer,
 * understable discs like hyzer. Range -1..1.
 */
export function idealRelease(d: Disc): number {
  return clamp((stability(d) - 1.5) / 2, -1, 1);
}

export function launchPitch(style: Style, cfg: Config): number {
  if (style === 'hammer') return cfg.launchPitchHammerDeg * DEG;
  if (style === 'forehand') return cfg.launchPitchForehandDeg * DEG;
  return cfg.launchPitchBackhandDeg * DEG;
}

/** Redline amount, 0 at or below power 1.0 and 1 at max power. */
export function redlineAmount(power: number, cfg: Config): number {
  return clamp((power - 1) / Math.max(1e-6, cfg.maxPower - 1), 0, 1);
}

export function simulateFlight(input: ThrowInput, disc: Disc, env: FlightEnv, rng: Rng, cfg: Config): FlightResult {
  const { terrain } = env;
  const hammer = input.style === 'hammer';
  const sign = curveSign(input.hand, input.style);
  const power = clamp(input.power, 0, cfg.maxPower);
  const red = redlineAmount(power, cfg);

  // Always draw the same number of random values so the rng stream stays aligned.
  const gAim = gaussian(rng);
  const gBank = gaussian(rng);
  const gTurn = Math.abs(gaussian(rng));

  const aim = input.aim + red * gAim * cfg.redlineAimWobbleDeg * DEG;
  let bank = clamp(input.release, -1, 1) * cfg.releaseBankDeg * DEG + red * gBank * cfg.redlineBankWobbleDeg * DEG;
  const launchBank = bank;
  const turn = disc.turn - red * gTurn * cfg.redlineExtraTurn;

  const match = hammer ? 0 : cfg.matchBonus * Math.max(0, 1 - Math.abs(input.release - idealRelease(disc)));
  const styleMul = hammer ? cfg.hammerPowerMul : input.style === 'forehand' ? cfg.forehandPowerMul : 1;
  const v0 = cfg.armSpeed * power * styleMul * (1 + match) * (input.armMul ?? 1);
  const pitch = launchPitch(input.style, cfg);

  let x = input.origin.x;
  let y = input.origin.y;
  let z = terrain.height(x, y) + cfg.releaseHeight;
  let vx = Math.sin(aim) * v0 * Math.cos(pitch);
  let vy = Math.cos(aim) * v0 * Math.cos(pitch);
  let vz = v0 * Math.sin(pitch);
  let t = 0;

  const rated = cfg.ratedSpeedBase + cfg.ratedSpeedPerSpeed * disc.speed;
  const glide = cfg.glideBase + cfg.glidePer * disc.glide;
  // Faster molds have a sharper rim: less lift per unit airspeed, so they need arm speed to stay up.
  const shape = 1 / (1 + cfg.liftSpeedPenalty * (disc.speed - 1));
  const dragK = cfg.drag * (1 - (cfg.dragSpeedRelief * (disc.speed - 1)) / 13);
  const maxBank = cfg.maxBankDeg * DEG;
  let liftMul = hammer ? cfg.hammerLift : 1;
  let treeHits = 0;
  let holed = false;

  const path: PathPoint[] = [{ x, y, z, t }];
  let step = 0;
  let landing: Landing | null = null;

  while (!landing) {
    const w = windAt(env.wind, t, cfg.gustAmp, cfg.windScale);
    const ax = vx - w.x;
    const ay = vy - w.y;
    const uh = Math.hypot(ax, ay) || 1e-6;
    const ua = Math.hypot(uh, vz);
    // Lift and spin phase use a blend of air speed and ground speed. Pure airspeed makes any
    // tailwind a knock-down; the blend keeps "headwind = more turn and lift, tailwind = flatter
    // and longer", which reads better in a game.
    const ug = Math.hypot(Math.hypot(vx, vy), vz);
    const ul = ug + (ua - ug) * cfg.windLiftFactor;
    const s = ul / rated;

    // Bank dynamics: turn while fast, fade while slow.
    if (hammer) {
      bank += cfg.hammerRollDeg * DEG * SIM_DT;
    } else {
      const turnTerm = cfg.turnRate * -turn * Math.min(cfg.turnCap, Math.max(0, s - cfg.turnThreshold));
      const fadeTerm = cfg.fadeRate * (disc.fade + cfg.baseStability) * Math.max(0, cfg.fadeThreshold - s);
      bank += (turnTerm - fadeTerm) * SIM_DT;
    }
    bank = clamp(bank, -maxBank, maxBank);

    const lift = cfg.lift * glide * shape * ul * ul * Math.pow(Math.min(1, s), cfg.underpowerLiftExp) * liftMul;
    // Right-hand perpendicular of horizontal air velocity, flipped by curve sign.
    const rx = (ay / uh) * sign;
    const ry = (-ax / uh) * sign;
    const side = lift * Math.sin(bank) * cfg.lateralK;

    const accX = -dragK * ua * ax + side * rx;
    const accY = -dragK * ua * ay + side * ry;
    const accZ = -G - dragK * ua * vz + lift * Math.cos(bank);

    vx += accX * SIM_DT;
    vy += accY * SIM_DT;
    vz += accZ * SIM_DT;
    const px = x;
    const py = y;
    const pz = z;
    x += vx * SIM_DT;
    y += vy * SIM_DT;
    z += vz * SIM_DT;
    t += SIM_DT;
    step++;

    // In-flight basket hit (throw-in / ace).
    if (env.basket) {
      const b = env.basket;
      const d = segmentPointDistance(px, py, x, y, b.x, b.y);
      const hz = z - terrain.height(b.x, b.y);
      if (d.dist < cfg.basketRadius && hz > cfg.basketCatchLow && hz < cfg.basketCatchHigh) {
        holed = true;
        x = b.x;
        y = b.y;
        z = terrain.height(b.x, b.y) + cfg.basketCatchLow;
        landing = { x, y, z, t, vx: 0, vy: 0, vz: 0, bank: 0, descent: Math.PI / 2 };
        path.push({ x, y, z, t });
        break;
      }
    }

    // Trees: circles that knock the disc down.
    for (const tree of terrain.trees) {
      const dx = x - tree.x;
      const dy = y - tree.y;
      const d = Math.hypot(dx, dy);
      const top = terrain.height(tree.x, tree.y) + (tree.h ?? cfg.treeHeight);
      if (d < tree.r && z < top) {
        const nx = d > 1e-6 ? dx / d : -vx / (Math.hypot(vx, vy) || 1);
        const ny = d > 1e-6 ? dy / d : -vy / (Math.hypot(vx, vy) || 1);
        const dot = vx * nx + vy * ny;
        const keep = cfg.treeRestitution * (0.6 + 0.4 * rng());
        vx = (vx - 2 * Math.min(0, dot) * nx) * keep;
        vy = (vy - 2 * Math.min(0, dot) * ny) * keep;
        vz = Math.min(vz, 0) * 0.5;
        x = tree.x + nx * (tree.r + 0.05);
        y = tree.y + ny * (tree.r + 0.05);
        liftMul *= cfg.treeLiftKill;
        treeHits++;
      }
    }

    const ground = terrain.height(x, y);
    if (z <= ground || t >= cfg.maxFlightTime) {
      // Interpolate back to the exact touchdown point.
      const g0 = terrain.height(px, py);
      const above0 = pz - g0;
      const above1 = z - ground;
      const f = above0 - above1 > 1e-9 ? clamp(above0 / (above0 - above1), 0, 1) : 1;
      x = px + (x - px) * f;
      y = py + (y - py) * f;
      t = t - SIM_DT * (1 - f);
      z = terrain.height(x, y);
      const vh = Math.hypot(vx, vy);
      landing = { x, y, z, t, vx, vy, vz, bank, descent: Math.atan2(Math.max(0, -vz), vh) };
      path.push({ x, y, z, t });
      break;
    }

    if (step % SAMPLE_EVERY === 0) path.push({ x, y, z, t });
  }

  return {
    path,
    landing,
    holed,
    treeHits,
    curveSign: sign,
    launchAim: aim,
    launchBank,
    launchSpeed: v0,
    upsideDown: hammer,
  };
}

function segmentPointDistance(ax: number, ay: number, bx: number, by: number, px: number, py: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const u = len2 > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1) : 0;
  const cx = ax + dx * u;
  const cy = ay + dy * u;
  return { dist: Math.hypot(px - cx, py - cy), u };
}
