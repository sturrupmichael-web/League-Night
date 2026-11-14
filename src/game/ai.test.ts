import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../config';
import courseJson from '../content/courses/lantern-park.json';
import discsJson from '../content/discs.json';
import type { Disc } from '../sim/discs';
import { makeTerrain } from '../sim/terrain';
import { playAiHole, puttMakeChance } from './ai';
import { holeWind } from './conditions';
import { type CourseJson, parseCourse } from './hole';

const cfg = DEFAULT_CONFIG;
const course = parseCourse(courseJson as CourseJson);
const discs = discsJson as Disc[];

function playCourse(skill: number, seed: number) {
  let total = 0;
  course.holes.forEach((hole, i) => {
    const env = { hole, terrain: makeTerrain(hole.terrain), wind: holeWind(seed + i, hole) };
    total += playAiHole(env, { skill, hand: 'right' }, discs, seed * 100 + i, cfg).strokes;
  });
  return total;
}

describe('AI rivals', () => {
  it('is deterministic for a seed', () => {
    const hole = course.holes[1];
    const env = { hole, terrain: makeTerrain(hole.terrain), wind: holeWind(3, hole) };
    const a = playAiHole(env, { skill: 0.6, hand: 'right' }, discs, 42, cfg);
    const b = playAiHole(env, { skill: 0.6, hand: 'left' }, discs, 42, cfg);
    const a2 = playAiHole(env, { skill: 0.6, hand: 'right' }, discs, 42, cfg);
    expect(a2).toEqual(a);
    expect(b.throws.length).toBeGreaterThan(0);
  });

  it('putts better with skill and always makes gimmes', () => {
    expect(puttMakeChance(5, 0, cfg)).toBe(1);
    expect(puttMakeChance(25, 0.9, cfg)).toBeGreaterThan(puttMakeChance(25, 0.2, cfg));
    expect(puttMakeChance(60, 0.9, cfg)).toBeLessThan(0.5);
  });

  it('scores sensibly: good players beat weak ones over a few rounds', () => {
    const t0 = performance.now();
    let good = 0;
    let weak = 0;
    for (let s = 1; s <= 3; s++) {
      good += playCourse(0.9, s);
      weak += playCourse(0.2, s);
    }
    const ms = performance.now() - t0;
    const par = course.par * 3;
    console.log(`AI 3 rounds: good ${good - par >= 0 ? '+' : ''}${good - par}, weak +${weak - par}, ${Math.round(ms)} ms for 54 holes`);
    expect(good).toBeLessThan(weak);
    expect(good / 3).toBeLessThan(course.par + 6);
    expect(weak / 3).toBeLessThan(course.par + 25);
  });
});
