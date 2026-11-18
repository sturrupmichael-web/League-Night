import { describe, expect, it } from 'vitest';
import { PUTT_PHYSICS } from '../sim/putt';
import { DEFAULT_CONFIG } from '../config';
import courseJson from '../content/courses/lantern-park.json';
import discsJson from '../content/discs.json';
import { chaserById, chaserConfig } from '../game/chasers';
import { type CourseJson, parseCourse } from '../game/hole';
import type { Disc } from '../sim/discs';
import { makeRng } from '../sim/rng';
import { makeTerrain } from '../sim/terrain';
import { LocalBackend } from './local';
import { canPlay, holeScores, matchResult } from './rules';
import type { MatchSettings, ThrowPayload } from './types';
import { playHonestHole } from './honestPlayer';
import { verifyHole } from './verify';

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

  const playHole = (idx: number, matchSeed: number) => playHonestHole(course, idx, matchSeed, cfg, discs);

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

  it('replays each putt with the physics it was played with, and refuses unknown physics', () => {
    // Find a hole whose honest play includes a putt.
    for (const idx of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
      const hole = course.holes[idx];
      const terrain = makeTerrain(hole.terrain);
      const honest = playHole(idx, 4242);
      const putts = honest.filter((p) => p.kind === 'putt');
      if (!putts.length) continue;
      expect(putts.every((p) => p.replay?.t === 'putt' && p.replay.pv === PUTT_PHYSICS)).toBe(true);
      const unknown = structuredClone(honest);
      for (const p of unknown) if (p.replay?.t === 'putt') p.replay.pv = 99;
      expect(verifyHole(unknown, hole, terrain, 4242, idx, cfg).issues.join()).toMatch(/unknown putting physics/);
      return;
    }
    throw new Error('no putts found');
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
