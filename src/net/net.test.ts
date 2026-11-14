import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../config';
import courseJson from '../content/courses/lantern-park.json';
import discsJson from '../content/discs.json';
import { chaserById, chaserConfig } from '../game/chasers';
import { holeWind } from '../game/conditions';
import { type CourseJson, parseCourse } from '../game/hole';
import { applyThrow, isHoleOver, newHole } from '../game/rules';
import { PuttProjector } from '../render/puttView';
import type { Disc } from '../sim/discs';
import { angleFromDir, dist } from '../sim/math';
import { idealPuttPower, resolvePutt } from '../sim/putt';
import { makeRng, mixSeed } from '../sim/rng';
import { makeTerrain } from '../sim/terrain';
import { simulateThrow } from '../sim/throw';
import { windAt } from '../sim/wind';
import { LocalBackend } from './local';
import { canPlay, holeScores, matchResult } from './rules';
import type { MatchSettings, ThrowPayload } from './types';
import { matchHoleSeed, verifyHole } from './verify';

const kv = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const meta = (name: string) => ({ name, chaserId: 'mae', hand: 'right' as const });
const settings = (playAhead = false): MatchSettings => ({ courseId: 'lantern-park', length: 3, playAhead, pacing: 'throw' });
const done = (strokes: number): ThrowPayload => ({ kind: 'done', n: strokes, strokes });

describe('friend matches (local backend)', () => {
  function pair() {
    const shared = kv();
    const rand = makeRng(12345);
    return { host: new LocalBackend(shared, kv(), rand), guest: new LocalBackend(shared, kv(), rand) };
  }

  it('hosts with a 6-character code and joins by code', async () => {
    const { host, guest } = pair();
    const m = await host.createMatch(settings(), meta('A'), 42);
    expect(m.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(m.status).toBe('waiting');
    await expect(host.joinMatch(m.code, meta('A'))).rejects.toThrow(/OWN MATCH/);
    const j = await guest.joinMatch(m.code.toLowerCase(), meta('B'));
    expect(j.status).toBe('active');
    expect((await guest.listMatches()).map((x) => x.id)).toEqual([m.id]);
  });

  it('enforces strictly increasing sequence numbers and holes in order', async () => {
    const { host, guest } = pair();
    const m = await host.createMatch(settings(true), meta('A'), 1);
    await guest.joinMatch(m.code, meta('B'));
    await expect(host.postThrow(m.id, 0, 2, done(3))).rejects.toThrow(/SEQ/);
    await expect(host.postThrow(m.id, 1, 1, done(3))).rejects.toThrow(/HOLE/);
    await host.postThrow(m.id, 0, 1, done(3));
    await host.postThrow(m.id, 0, 1, done(3)); // retry of the same row is fine
    const b = await host.getMatch(m.id);
    expect(holeScores(b.throws, b.match.host)).toEqual([3]);
  });

  it('without play-ahead you can be at most one hole ahead', async () => {
    const { host, guest } = pair();
    const m = await host.createMatch(settings(false), meta('A'), 1);
    await guest.joinMatch(m.code, meta('B'));
    const hid = await host.me();
    await host.postThrow(m.id, 0, 1, done(3));
    let b = await host.getMatch(m.id);
    expect(canPlay(b.match, b.throws, hid).ok).toBe(false);
    await expect(host.postThrow(m.id, 1, 2, done(3))).rejects.toThrow(/WAIT/);
    await guest.postThrow(m.id, 0, 1, done(4));
    b = await host.getMatch(m.id);
    expect(canPlay(b.match, b.throws, hid).ok).toBe(true);
  });

  it('finishes when both cards are in, and concede ends it for both', async () => {
    const { host, guest } = pair();
    const m = await host.createMatch({ ...settings(true), length: 3 }, meta('A'), 1);
    await guest.joinMatch(m.code, meta('B'));
    for (let h = 0; h < 3; h++) {
      await host.postThrow(m.id, h, h + 1, done(3));
      await guest.postThrow(m.id, h, h + 1, done(4));
    }
    const b = await guest.getMatch(m.id);
    expect(b.match.status).toBe('done');
    const res = matchResult(b.match, b.throws);
    expect(res.winner).toBe(b.match.host);
    expect(res.totals[b.match.host]).toBe(9);

    const m2 = await guest.rematch(m.id, meta('B'), 7);
    expect(m2.status).toBe('active');
    await host.concede(m2.id);
    const b2 = await guest.getMatch(m2.id);
    expect(b2.match.status).toBe('conceded');
    expect(matchResult(b2.match, b2.throws).winner).toBe(await guest.me());
    await expect(guest.postThrow(m2.id, 0, 1, done(3))).rejects.toThrow(/NOT ACTIVE/);
  });

  it('keeps chat short', async () => {
    const { host, guest } = pair();
    const m = await host.createMatch(settings(), meta('A'), 1);
    await guest.joinMatch(m.code, meta('B'));
    await guest.sendMessage(m.id, 'x'.repeat(200));
    const b = await host.getMatch(m.id);
    expect(b.messages[0].body).toHaveLength(60);
  });
});

describe('throw verification', () => {
  const course = parseCourse(courseJson as CourseJson);
  const discs = discsJson as Disc[];
  const cfg = chaserConfig({ ...DEFAULT_CONFIG }, chaserById('dez'));

  /** Play a hole the way HoleScene does and record payloads. */
  function playHole(idx: number, matchSeed: number): ThrowPayload[] {
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

  it('accepts an honest hole', () => {
    for (const idx of [0, 3, 8]) {
      const hole = course.holes[idx];
      const v = verifyHole(playHole(idx, 777), hole, makeTerrain(hole.terrain), 777, idx, cfg);
      expect(v.issues).toEqual([]);
    }
  });

  it('catches an edited lie, an edited score and a swapped seed', () => {
    const hole = course.holes[1];
    const terrain = makeTerrain(hole.terrain);
    const honest = playHole(1, 99);
    const lie = structuredClone(honest);
    lie[0].lie = { x: hole.basket.x, y: hole.basket.y - 3 };
    expect(verifyHole(lie, hole, terrain, 99, 1, cfg).ok).toBe(false);
    const score = structuredClone(honest);
    score[score.length - 1].strokes = 1;
    expect(verifyHole(score, hole, terrain, 99, 1, cfg).issues.join()).toMatch(/card says 1/);
    expect(verifyHole(honest, hole, terrain, 100, 1, cfg).ok).toBe(false);
  });
});

describe('friend hole conversions', () => {
  it('turns uploaded throws back into a rival hole and a log', async () => {
    const { toAiHole, toLog, toPayload } = await import('../friends');
    const hole = { tee: { x: 0, y: 0 }, basket: { x: 0, y: 100 } } as never;
    const p1 = toPayload({ kind: 'throw', n: 1, discId: 'd', discType: 'driver', fromFt: 100, toFt: 20, distanceFt: 80, penalty: 1, made: false, surface: 'water' }, { x: 0, y: 80 });
    const p2 = toPayload({ kind: 'gimme', n: 2, discId: 'd', discType: 'putter', fromFt: 20, toFt: 0, distanceFt: 20, penalty: 0, made: true, surface: 'green' }, { x: 0, y: 100 });
    const ai = toAiHole([p1, p2, { kind: 'done', n: 3, strokes: 3 }], hole);
    expect(ai.strokes).toBe(3);
    expect(ai.throws.map((t) => t.toFt)).toEqual([20, 0]);
    expect(toLog(p1).penalty).toBe(1);
  });
});
