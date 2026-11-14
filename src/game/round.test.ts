import { describe, expect, it } from 'vitest';
import courseJson from '../content/courses/lantern-park.json';
import { defaultSave, loadSave, migrate, SAVE_KEY, writeSave } from '../core/save';
import { type CourseJson, parseCourse } from './hole';
import { cardTotals, currentHoleIndex, type HoleRecord, holeOrder, isRoundOver, newRound, recordHole, roundToPar, type ThrowLog } from './round';
import { computeStats, formatPct } from './stats';

const course = parseCourse(courseJson as CourseJson);
const log = (o: Partial<ThrowLog>): ThrowLog => ({ kind: 'throw', n: 1, discId: 'carpool', discType: 'fairway', fromFt: 300, toFt: 50, distanceFt: 250, penalty: 0, made: false, surface: 'fairway', ...o });
const rec = (par: number, strokes: number, o: Partial<HoleRecord> = {}): HoleRecord => ({ holeId: 1, par, strokes, penalties: 0, pickedUp: false, mulligans: 0, throws: [], ...o });

describe('round', () => {
  it('orders holes for 3, 9 and 18', () => {
    expect(holeOrder(9, 3)).toEqual([0, 1, 2]);
    expect(holeOrder(9, 9)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(holeOrder(9, 18)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('records holes, spends mulligans and ends', () => {
    let r = newRound(course, { courseId: course.id, length: 3, hand: 'right' }, 1, 0);
    expect(r.mulligansLeft).toBe(3);
    r = recordHole(r, rec(3, 2, { mulligans: 1 }));
    r = recordHole(r, rec(4, 5));
    expect(currentHoleIndex(r)).toBe(2);
    expect(r.mulligansLeft).toBe(2);
    expect(roundToPar(r)).toBe(0);
    expect(isRoundOver(r)).toBe(false);
    r = recordHole(r, rec(3, 3));
    expect(isRoundOver(r)).toBe(true);
    expect(recordHole(r, rec(3, 3)).card.length).toBe(3);
    expect(cardTotals(r.card)).toEqual({ strokes: 10, par: 10, toPar: 0 });
  });
});

describe('stats', () => {
  it('counts fairways, circle putting, drives and best hole', () => {
    const card: HoleRecord[] = [
      rec(4, 3, {
        throws: [
          log({ n: 1, distanceFt: 300, surface: 'fairway' }),
          log({ n: 2, kind: 'putt', fromFt: 50, made: false }),
          log({ n: 3, kind: 'gimme', fromFt: 3, made: true }),
        ],
      }),
      rec(4, 6, {
        penalties: 1,
        throws: [log({ n: 1, distanceFt: 280, surface: 'water', penalty: 1 }), log({ n: 2, distanceFt: 200, surface: 'rough' }), log({ n: 3, kind: 'putt', fromFt: 20, made: true })],
      }),
      rec(3, 3, { throws: [log({ n: 1, distanceFt: 220, surface: 'rough' }), log({ n: 2, kind: 'putt', fromFt: 40, made: true })] }),
    ];
    const s = computeStats(card);
    expect(s.fairwayChances).toBe(2);
    expect(s.fairwaysHit).toBe(1);
    expect([s.c1Made, s.c1Tries]).toEqual([2, 2]);
    expect([s.c2Made, s.c2Tries]).toEqual([1, 2]);
    expect(s.avgDriveFt).toBe(260); // penalty drive left out
    expect(s.longestThrowFt).toBe(300);
    expect(s.longestPuttFt).toBe(40);
    expect(s.bestHole).toEqual({ index: 0, toPar: -1 });
    expect(s.birdiesOrBetter).toBe(1);
    expect(s.penalties).toBe(1);
    expect(formatPct(1, 2)).toBe('50% (1/2)');
    expect(formatPct(0, 0)).toBe('-');
  });
});

describe('save', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };

  it('round-trips a save', () => {
    const s = mem();
    const d = defaultSave();
    d.round = newRound(course, { courseId: course.id, length: 9, hand: 'left' }, 42, 0);
    d.round = recordHole(d.round, rec(3, 3));
    expect(writeSave(d, s)).toBe(true);
    expect(loadSave(s)).toEqual(d);
  });

  it('survives junk, missing storage and future versions', () => {
    const s = mem();
    s.m.set(SAVE_KEY, '{not json');
    expect(loadSave(s)).toEqual(defaultSave());
    expect(loadSave(null)).toEqual(defaultSave());
    expect(migrate({ v: 99 })).toEqual(defaultSave());
    expect(migrate({ v: 1, settings: { sfx: false } }).settings).toEqual({ sfx: false, hints: true, hand: 'right', music: true, motion: 'auto' });
    expect(migrate({ v: 1, round: { nonsense: true } }).round).toBeNull();
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadSave(throwing)).toEqual(defaultSave());
    expect(writeSave(defaultSave(), throwing)).toBe(false);
  });
});
