import type { Config } from '../config';
import { holeWind } from '../game/conditions';
import type { CourseDef } from '../game/hole';
import { applyThrow, isHoleOver, newHole } from '../game/rules';
import { PuttProjector } from '../render/puttView';
import type { Disc } from '../sim/discs';
import { angleFromDir, dist } from '../sim/math';
import { idealPuttPower, resolvePutt } from '../sim/putt';
import { makeRng, mixSeed } from '../sim/rng';
import { makeTerrain } from '../sim/terrain';
import { simulateThrow } from '../sim/throw';
import { windAt } from '../sim/wind';
import type { ThrowPayload } from './types';
import { matchHoleSeed } from './verify';

/**
 * Plays a hole the way HoleScene does (straight at the basket, ideal putts) and records the
 * payloads. For tests of the verifiers only. `mulliganAt` spends the seed of that throw
 * number without keeping the throw, like a rewound throw in the game.
 */
export function playHonestHole(course: CourseDef, idx: number, matchSeed: number, cfg: Config, discs: Disc[], mulliganAt = 0): ThrowPayload[] {
  const hole = course.holes[idx];
  const terrain = makeTerrain(hole.terrain);
  const holeSeed = matchHoleSeed(matchSeed, idx);
  const wind = holeWind(holeSeed, hole);
  let s = newHole(hole.par, hole.tee);
  let throwNo = 0;
  const out: ThrowPayload[] = [];
  while (!isHoleOver(s)) {
    const d = dist(s.lie, hole.basket);
    if (d <= cfg.gimmeFt) {
      s = applyThrow(s, cfg, { penalty: 0, holed: true, lie: hole.basket });
      out.push({ kind: 'gimme', n: s.throws, lie: { ...hole.basket }, penalty: 0, made: true });
    } else if (d <= cfg.puttRangeFt) {
      const seed = mixSeed(holeSeed, hole.id * 1000 + ++throwNo);
      const proj = new PuttProjector(terrain, s.lie, hole.basket);
      const read = { cancel: false as const, power: idealPuttPower(proj.distance, proj.rise, cfg), aim: 0, bend: 0, snap: 0, releaseSpeed: 400 };
      const res = resolvePutt(read, { distance: proj.distance, rise: proj.rise, crosswind: proj.crosswind(windAt(wind, 0, 0, cfg.windScale)) }, makeRng(seed), cfg);
      const restW = proj.toWorld(res.rest.u, res.rest.v);
      const surf = terrain.surface(restW.x, restW.y);
      const penalty = !res.made && (surf === 'water' || surf === 'ob') ? 1 : 0;
      const lie = res.made ? { ...hole.basket } : penalty ? { ...s.lie } : restW;
      out.push({ kind: 'putt', n: s.throws + 1, replay: { t: 'putt', lie: { ...s.lie }, read, seed }, lie, penalty, made: res.made });
      s = applyThrow(s, cfg, { penalty, holed: res.made, lie });
    } else {
      if (s.throws + 1 === mulliganAt) ++throwNo;
      const seed = mixSeed(holeSeed, hole.id * 1000 + ++throwNo);
      const input = { origin: { ...s.lie }, aim: angleFromDir(hole.basket.x - s.lie.x, hole.basket.y - s.lie.y), power: Math.min(1, d / 330), release: 0, style: 'backhand' as const, hand: 'right' as const };
      const r = simulateThrow(input, discs[4], { terrain, wind, basket: hole.basket }, seed, cfg);
      const made = r.ground.kind === 'holed';
      const lie = made ? { ...hole.basket } : r.ground.lie;
      out.push({ kind: 'throw', n: s.throws + 1, discId: discs[4].id, replay: { t: 'throw', input, seed }, lie, penalty: r.ground.penalty, made });
      s = applyThrow(s, cfg, { penalty: r.ground.penalty, holed: made, lie });
    }
  }
  out.push({ kind: 'done', n: s.strokes, strokes: s.strokes, pickedUp: s.pickedUp });
  return out;
}
