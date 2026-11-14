/**
 * Re-simulate a friend's hole from their recorded inputs and the match seed, and check every
 * claimed result. Editing an outcome (a lie, a made putt, a score) shows up as a mismatch.
 */
import type { Config } from '../config';
import discsJson from '../content/discs.json';
import { holeWind } from '../game/conditions';
import type { HoleDef } from '../game/hole';
import { applyThrow, isHoleOver, newHole } from '../game/rules';
import { PuttProjector } from '../render/puttView';
import type { Disc } from '../sim/discs';
import { dist, type Vec2 } from '../sim/math';
import { resolvePutt } from '../sim/putt';
import { makeRng, mixSeed } from '../sim/rng';
import type { Terrain } from '../sim/terrain';
import { simulateThrow } from '../sim/throw';
import { windAt } from '../sim/wind';
import type { ThrowPayload } from './types';

const DISCS = discsJson as Disc[];
const TOL = 0.75; // ft

export interface Verdict {
  ok: boolean;
  issues: string[];
  strokes: number;
}

/** The seed a hole is played with: the same derivation as a round (see App.playHole). */
export const matchHoleSeed = (matchSeed: number, holeIdx: number) => mixSeed(matchSeed, holeIdx);

const near = (a: Vec2 | undefined, b: Vec2) => !!a && Math.hypot(a.x - b.x, a.y - b.y) <= TOL;

/**
 * `seedSlack` is how many throw seeds may be skipped: a mulligan rewinds a throw but its seed
 * is spent, so the next throw uses the following one. Friend matches have no mulligans (0).
 */
export function verifyHole(payloads: ThrowPayload[], hole: HoleDef, terrain: Terrain, matchSeed: number, holeIdx: number, cfg: Config, seedSlack = 0): Verdict {
  const issues: string[] = [];
  const holeSeed = matchHoleSeed(matchSeed, holeIdx);
  const wind = holeWind(holeSeed, hole);
  let state = newHole(hole.par, hole.tee);
  let throwNo = 0;
  let slack = seedSlack;
  const seedFor = (claimed: number) => {
    throwNo++;
    // Skip ahead over seeds spent on rewound throws, if the claim matches a later one.
    for (let k = 0; k <= slack; k++) {
      if (mixSeed(holeSeed, hole.id * 1000 + throwNo + k) === claimed) {
        throwNo += k;
        slack -= k;
        break;
      }
    }
    return mixSeed(holeSeed, hole.id * 1000 + throwNo);
  };
  for (const p of payloads) {
    const n = state.throws + 1;
    if (p.kind === 'done') {
      if (p.strokes !== state.strokes) issues.push(`card says ${p.strokes}, throws add up to ${state.strokes}`);
      continue;
    }
    const from = state.lie;
    let lie: Vec2;
    let penalty = 0;
    let made = false;
    if (p.kind === 'gimme') {
      if (dist(from, hole.basket) > cfg.gimmeFt + 0.01) issues.push(`throw ${n}: gimme from too far`);
      lie = { ...hole.basket };
      made = true;
    } else if (p.kind === 'throw' && p.replay?.t === 'throw') {
      const seed = seedFor(p.replay.seed);
      if (p.replay.seed !== seed) issues.push(`throw ${n}: wrong seed`);
      if (!near(p.replay.input.origin, from)) issues.push(`throw ${n}: thrown from the wrong spot`);
      const disc = DISCS.find((d) => d.id === p.discId) ?? DISCS[0];
      const input = { ...p.replay.input, origin: { ...from } };
      const r = simulateThrow(input, disc, { terrain, wind, basket: hole.basket }, seed, cfg);
      made = r.ground.kind === 'holed';
      penalty = r.ground.penalty;
      lie = made ? { ...hole.basket } : r.ground.lie;
    } else if (p.kind === 'putt' && p.replay?.t === 'putt') {
      const seed = seedFor(p.replay.seed);
      if (p.replay.seed !== seed) issues.push(`throw ${n}: wrong seed`);
      if (!near(p.replay.lie, from)) issues.push(`throw ${n}: putted from the wrong spot`);
      const proj = new PuttProjector(terrain, from, hole.basket);
      const w = windAt(wind, 0, 0, cfg.windScale);
      const res = resolvePutt(p.replay.read, { distance: proj.distance, rise: proj.rise, crosswind: proj.crosswind(w) }, makeRng(seed), cfg);
      const restW = proj.toWorld(res.rest.u, res.rest.v);
      const surf = terrain.surface(restW.x, restW.y);
      made = res.made;
      penalty = !res.made && (surf === 'water' || surf === 'ob') ? 1 : 0;
      lie = res.made ? { ...hole.basket } : penalty ? { ...from } : restW;
    } else {
      issues.push(`throw ${n}: no replay data`);
      continue;
    }
    if (p.lie && !near(p.lie, lie)) issues.push(`throw ${n}: claimed lie does not match the replay`);
    if (isHoleOver(state)) issues.push(`throw ${n}: thrown after the hole was over`);
    if ((p.penalty ?? 0) !== penalty) issues.push(`throw ${n}: penalty does not match`);
    if (!!p.made !== made) issues.push(`throw ${n}: ${made ? 'was a make' : 'was not a make'}`);
    state = applyThrow(state, cfg, { penalty, holed: made, lie });
  }
  return { ok: issues.length === 0, issues, strokes: state.strokes };
}
