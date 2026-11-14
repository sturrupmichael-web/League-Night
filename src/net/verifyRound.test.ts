import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../config';
import { courseById } from '../content/courses';
import discsJson from '../content/discs.json';
import { chaserById, chaserConfig } from '../game/chasers';
import { type HoleRecord, newRound, type RoundState, type ThrowLog } from '../game/round';
import type { Disc } from '../sim/discs';
import { playHonestHole } from './honestPlayer';
import { verifyRound } from './verifyRound';

const discs = discsJson as Disc[];

/** A finished round played honestly, as the game would save it. */
function honestRound(length: 9 | 18, mulliganAt: Record<number, number> = {}, chaserId = 'dez', courseId = 'lantern-park'): RoundState {
  const course = courseById(courseId);
  const cfg = chaserConfig(DEFAULT_CONFIG, chaserById(chaserId));
  const r = newRound(course, { courseId, length, hand: 'right', chaserId }, 4242);
  const card: HoleRecord[] = r.order.map((h, i) => {
    const pays = playHonestHole(course, i, r.seed, cfg, discs, mulliganAt[i] ?? 0);
    const done = pays.pop()!;
    const throws: ThrowLog[] = pays.map((p) => ({
      kind: p.kind as ThrowLog['kind'], n: p.n, discId: p.discId ?? 'putter', discType: '', fromFt: 0, toFt: 0, distanceFt: 0,
      penalty: p.penalty ?? 0, made: !!p.made, surface: '', replay: p.replay,
    }));
    return { holeId: course.holes[h].id, par: course.holes[h].par, strokes: done.strokes!, penalties: 0, pickedUp: !!done.pickedUp, mulligans: mulliganAt[i] ? 1 : 0, throws };
  });
  return { ...r, card };
}

describe('leaderboard round check', () => {
  it('accepts an honest round and adds it up', () => {
    const r = honestRound(9);
    const v = verifyRound(r);
    expect(v.issues).toEqual([]);
    expect(v.strokes).toBe(r.card.reduce((a, h) => a + h.strokes, 0));
    expect(v.par).toBe(r.card.reduce((a, h) => a + h.par, 0));
  });

  it('accepts mulligans up to the round allowance, and no more', () => {
    expect(verifyRound(honestRound(9, { 0: 1, 4: 1 })).issues).toEqual([]);
    expect(verifyRound(honestRound(9, { 0: 1, 1: 1, 2: 1, 3: 1 })).ok).toBe(false);
  });

  it('catches a lowered hole score, an edited putt and a different seed', () => {
    const low = honestRound(9);
    low.card[2].strokes -= 1;
    expect(verifyRound(low).ok).toBe(false);

    const putt = honestRound(9);
    const h = putt.card.find((c) => c.throws.some((t) => t.kind === 'putt' && !t.made));
    if (h) {
      const t = h.throws.find((t) => t.kind === 'putt' && !t.made)!;
      t.made = true;
      expect(verifyRound(putt).ok).toBe(false);
    }

    const seed = honestRound(9);
    expect(verifyRound({ ...seed, seed: seed.seed + 1 }).ok).toBe(false);
  });

  it('refuses unfinished and 3-hole rounds, and a different chaser', () => {
    const r = honestRound(9);
    expect(verifyRound({ ...r, card: r.card.slice(0, 8) }).ok).toBe(false);
    expect(verifyRound({ ...r, settings: { ...r.settings, length: 3 }, order: r.order.slice(0, 3), card: r.card.slice(0, 3) }).ok).toBe(false);
    // Chasers change the physics, so claiming another one breaks the replay somewhere in 9 holes.
    expect(verifyRound({ ...r, settings: { ...r.settings, chaserId: 'mae' } }).ok).toBe(false);
  });
});

describe('the server copy of the checker', () => {
  it('gives the same verdicts as the game (rebuild it with npm run build:verifier)', async () => {
    // @ts-expect-error plain JS bundle, no types
    const server = await import('../../supabase/functions/ln-submit-score/verify.js');
    const good = honestRound(9, { 3: 1 });
    expect(server.verifyRound(JSON.parse(JSON.stringify(good)))).toEqual(verifyRound(good));
    const bad = honestRound(9);
    bad.card[5].strokes -= 1;
    expect(server.verifyRound(bad).ok).toBe(false);
  });
});

describe('leaderboard on the local stand-in', () => {
  it('needs a name, checks the round, ranks best rounds and refuses repeats', async () => {
    const { LocalBackend } = await import('./local');
    const store = new Map<string, string>();
    const kv = (m: Map<string, string>) => ({ getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) });
    const a = new LocalBackend(kv(store), kv(new Map()));
    const b = new LocalBackend(kv(store), kv(new Map()));
    const r = honestRound(9);
    await expect(a.submit(r)).rejects.toThrow(/NAME/);
    expect(await a.setName('  disc  dog ')).toBe('disc dog');
    await expect(b.setName('DISC DOG')).rejects.toThrow(/TAKEN/);
    await b.setName('Ace');
    const posted = await a.submit(r);
    expect(posted.rank).toBe(1);
    await expect(a.submit(r)).rejects.toThrow(/ALREADY/);
    const bad = honestRound(9);
    bad.seed += 1;
    bad.card[0].strokes -= 1;
    await expect(b.submit(bad)).rejects.toThrow(/REPLAY/);
    const key = { courseId: 'lantern-park', holes: 9 as const, since: null };
    expect((await a.board(key)).map((x) => x.name)).toEqual(['disc dog']);
    expect((await a.myBest(key))?.rank).toBe(1);
    expect(await b.myBest(key)).toBeNull();
  });
});
