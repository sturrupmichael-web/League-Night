/**
 * AI rivals. They play with the same flight sim as the player:
 *  1. pick a disc for the distance,
 *  2. try a small fan of aims and powers in a noise-free "practice swing" and keep the best,
 *  3. throw that plan with Gaussian aim/power error scaled by skill.
 * Putting is a make-probability curve by distance and skill. Pure and seeded.
 */
import type { Config } from '../config';
import type { Disc } from '../sim/discs';
import { idealRelease, type Hand, type Style, type ThrowInput } from '../sim/flight';
import { angleFromDir, clamp, DEG, dist, type Vec2 } from '../sim/math';
import { gaussian, makeRng, mixSeed } from '../sim/rng';
import { flatTerrain, type Terrain } from '../sim/terrain';
import { simulateThrow, type ThrowResult } from '../sim/throw';
import { CALM, type Wind } from '../sim/wind';
import { applyThrow, isHoleOver, newHole } from './rules';
import type { HoleDef } from './hole';

export interface AiProfile {
  /** 0 (weekend hacker) .. 1 (league legend). */
  skill: number;
  hand: Hand;
  /** Arm multiplier, around 1. */
  arm?: number;
  /** Prefers forehand when the hole bends that way. Purely flavour for now. */
  style?: Style;
}

export interface AiThrow {
  kind: 'throw' | 'putt' | 'gimme';
  from: Vec2;
  to: Vec2;
  fromFt: number;
  toFt: number;
  penalty: number;
  made: boolean;
  /** Fairway throws: what was thrown, so the throw can be re-simulated and shown. */
  input?: ThrowInput;
  discId?: string;
  seed?: number;
}

export interface AiHole {
  strokes: number;
  penalties: number;
  pickedUp: boolean;
  throws: AiThrow[];
}

export interface AiEnv {
  hole: HoleDef;
  terrain: Terrain;
  wind: Wind;
}

/** Full-power carry in calm air on flat ground, per disc (cached per arm speed). */
const rangeCache = new Map<string, number>();
export function discRange(disc: Disc, cfg: Config, arm = 1): number {
  const key = `${disc.id}:${cfg.armSpeed}:${arm}`;
  const hit = rangeCache.get(key);
  if (hit !== undefined) return hit;
  const r = simulateThrow(
    { origin: { x: 0, y: 0 }, aim: 0, power: 1, release: idealRelease(disc), style: 'backhand', hand: 'right', armMul: arm },
    disc,
    { terrain: flatTerrain(), wind: CALM },
    1,
    cfg,
  );
  rangeCache.set(key, r.total);
  return r.total;
}

/** Flat, calm distance (where it stops) at each power step, per disc and arm: short throws lose lift, so distance is not linear in power. */
const POWER_STEPS = [0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1];
const curveCache = new Map<string, number[]>();
function distanceCurve(disc: Disc, cfg: Config, arm: number): number[] {
  const key = `${disc.id}:${cfg.armSpeed}:${arm}`;
  let c = curveCache.get(key);
  if (!c) {
    c = POWER_STEPS.map((power) =>
      simulateThrow(
        { origin: { x: 0, y: 0 }, aim: 0, power, release: idealRelease(disc) * 0.5, style: 'backhand', hand: 'right', armMul: arm },
        disc,
        { terrain: flatTerrain(), wind: CALM },
        1,
        cfg,
      ).total,
    );
    curveCache.set(key, c);
  }
  return c;
}

/** The power that sends `disc` about `ft` on flat ground in calm air. */
export function powerFor(disc: Disc, ft: number, cfg: Config, arm = 1): number {
  const c = distanceCurve(disc, cfg, arm);
  if (ft <= c[0]) return POWER_STEPS[0];
  for (let i = 1; i < c.length; i++) {
    if (ft <= c[i]) return POWER_STEPS[i - 1] + ((POWER_STEPS[i] - POWER_STEPS[i - 1]) * (ft - c[i - 1])) / Math.max(1e-6, c[i] - c[i - 1]);
  }
  return 1;
}

/** How far `disc` goes at `power` on flat ground in calm air (inverse of powerFor). */
function distanceAt(disc: Disc, power: number, cfg: Config, arm: number): number {
  const c = distanceCurve(disc, cfg, arm);
  if (power <= POWER_STEPS[0]) return c[0] * (power / POWER_STEPS[0]);
  for (let i = 1; i < c.length; i++) {
    if (power <= POWER_STEPS[i]) return c[i - 1] + ((c[i] - c[i - 1]) * (power - POWER_STEPS[i - 1])) / (POWER_STEPS[i] - POWER_STEPS[i - 1]);
  }
  return c[c.length - 1] * (power / 1);
}

/** Choose a disc for a throw of `ft`: the slowest disc that gets there, else the longest. */
export function pickDisc(discs: Disc[], ft: number, cfg: Config, arm = 1): Disc {
  const throwers = discs.filter((d) => d.type !== 'putter' || ft < 140);
  const sorted = [...throwers].sort((a, b) => discRange(a, cfg, arm) - discRange(b, cfg, arm));
  return sorted.find((d) => discRange(d, cfg, arm) * 0.92 >= ft) ?? sorted[sorted.length - 1];
}

/** Chance an AI makes a putt from `ft`. */
export function puttMakeChance(ft: number, skill: number, cfg: Config): number {
  if (ft <= cfg.gimmeFt) return 1;
  const d50 = 14 + 30 * skill;
  const k = 4 + 5 * skill;
  return clamp(1 / (1 + Math.exp((ft - d50) / k)), 0.02, 0.99);
}

const AIM_FAN = [0, -8, 8, -16, 16, -26, 26];
const POWER_FAN = [0.88, 1, 1.1];

/** Plan one fairway throw: the best of a small fan of noise-free practice swings. */
export function planThrow(env: AiEnv, from: Vec2, ai: AiProfile, discs: Disc[], cfg: Config): { input: ThrowInput; disc: Disc } {
  const basket = env.hole.basket;
  const d = dist(from, basket);
  const disc = pickDisc(discs, d, cfg, Math.min(1, ai.arm ?? 1));
  const base = angleFromDir(basket.x - from.x, basket.y - from.y);
  const p0 = clamp(powerFor(disc, d, cfg, ai.arm ?? 1), 0.25, 1);
  let best: { input: ThrowInput; cost: number } | null = null;
  for (const off of AIM_FAN) {
    for (const pm of POWER_FAN) {
      const input: ThrowInput = {
        origin: { ...from },
        aim: base + off * DEG,
        power: clamp(p0 * pm, 0.25, 1),
        release: idealRelease(disc) * 0.5,
        style: 'backhand',
        hand: ai.hand,
        armMul: ai.arm,
      };
      const r = simulateThrow(input, disc, { terrain: env.terrain, wind: env.wind, basket }, 7, cfg);
      const left = r.flight.holed ? 0 : dist(r.ground.lie, basket);
      const cost = left + r.ground.penalty * 90 + (left < d ? 0 : 200);
      if (!best || cost < best.cost) best = { input, cost };
    }
  }
  return { input: best!.input, disc };
}

/** Play a whole hole. `seed` makes it repeatable; `discs` is the bag. */
export function playAiHole(env: AiEnv, ai: AiProfile, discs: Disc[], seed: number, cfg: Config): AiHole {
  const rng = makeRng(seed);
  const basket = env.hole.basket;
  let s = newHole(env.hole.par, env.hole.tee);
  const throws: AiThrow[] = [];
  const skill = clamp(ai.skill, 0, 1);
  let n = 0;
  while (!isHoleOver(s) && n < 20) {
    n++;
    const from = { ...s.lie };
    const fromFt = dist(from, basket);
    if (fromFt <= cfg.puttRangeFt) {
      const made = rng() < puttMakeChance(fromFt, skill, cfg);
      const kind = fromFt <= cfg.gimmeFt ? 'gimme' : 'putt';
      let to: Vec2 = { ...basket };
      if (!made) {
        // A miss leaves a comebacker: closer for a strong putter.
        const left = clamp(2 + rng() * (6 + fromFt * 0.15) * (1.3 - skill), 1, fromFt * 0.6);
        const a = rng() * Math.PI * 2;
        to = { x: basket.x + Math.cos(a) * left, y: basket.y + Math.sin(a) * left };
      }
      s = applyThrow(s, cfg, { penalty: 0, holed: made, lie: to });
      throws.push({ kind, from, to, fromFt, toFt: dist(to, basket), penalty: 0, made });
      continue;
    }
    const plan = planThrow(env, from, ai, discs, cfg);
    // Spread tuned so the ladder runs from about 12 under (Rosa) to about 11 over (Lou) per 18.
    const sigAim = (3 + (1 - skill) * 18) * DEG;
    const sigPow = 0.06 + (1 - skill) * 0.24;
    const input: ThrowInput = {
      ...plan.input,
      aim: plan.input.aim + gaussian(rng) * sigAim,
      // Power error is a share of the distance, not of the power: short throws sit where distance
      // changes fast with power, so a power-share error would punish big arms far more than skill says.
      power: plan.input.power >= 1 ? clamp(plan.input.power * (1 + gaussian(rng) * sigPow), 0.2, 1.05) : clamp(powerFor(plan.disc, distanceAt(plan.disc, plan.input.power, cfg, ai.arm ?? 1) * (1 + gaussian(rng) * sigPow), cfg, ai.arm ?? 1), 0.2, 1.05),
    };
    const tseed = mixSeed(seed, n);
    const r: ThrowResult = simulateThrow(input, plan.disc, { terrain: env.terrain, wind: env.wind, basket }, tseed, cfg);
    const holed = r.ground.kind === 'holed';
    const to = holed ? { ...basket } : r.ground.lie;
    s = applyThrow(s, cfg, { penalty: r.ground.penalty, holed, lie: to });
    throws.push({ kind: 'throw', from, to, fromFt, toFt: dist(to, basket), penalty: r.ground.penalty, made: holed, input, discId: plan.disc.id, seed: tseed });
  }
  return { strokes: s.strokes, penalties: s.penalties, pickedUp: s.pickedUp, throws };
}
