/**
 * Every course hole must be fair: the tee and basket sit on playable ground, and the AI
 * rivals (same physics as the player) score near par on it over many tries.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG as cfg } from '../config';
import { playAiHole } from '../game/ai';
import { holeWind } from '../game/conditions';
import { type CourseJson, parseCourse } from '../game/hole';
import type { Disc } from '../sim/discs';
import { makeTerrain } from '../sim/terrain';
import discsJson from './discs.json';
import lantern from './courses/lantern-park.json';
import loon from './courses/loon-lake.json';
import mesa from './courses/red-mesa.json';

const discs = discsJson as Disc[];
export const COURSE_FILES = [lantern, loon, mesa] as unknown as CourseJson[];

for (const cj of COURSE_FILES) {
  const course = parseCourse(cj);
  describe(course.name, () => {
    it('has 18 holes with unique ids and sensible pars', () => {
      expect(course.holes).toHaveLength(18);
      expect(new Set(course.holes.map((h) => h.id)).size).toBe(18);
      expect(course.par).toBeGreaterThanOrEqual(60);
      expect(course.par).toBeLessThanOrEqual(70);
    });

    it('every tee is playable and every basket sits on a green', () => {
      for (const h of course.holes) {
        const t = makeTerrain(h.terrain);
        expect(['fairway', 'rough', 'green'], `hole ${h.id} tee`).toContain(t.surface(h.tee.x, h.tee.y));
        expect(t.surface(h.basket.x, h.basket.y), `hole ${h.id} basket`).toBe('green');
      }
    });

    it('AI rivals score near par on every hole', { timeout: 60_000 }, () => {
      const rows: string[] = [];
      for (const h of course.holes) {
        const terrain = makeTerrain(h.terrain);
        let sum = 0;
        const n = 24;
        for (let s = 0; s < n; s++) {
          const env = { hole: h, terrain, wind: holeWind(s * 31 + h.id, h) };
          sum += playAiHole(env, { skill: 0.55, hand: s % 2 ? 'left' : 'right' }, discs, s * 977 + h.id, cfg).strokes;
        }
        const avg = sum / n;
        rows.push(`${h.id}:${h.par}/${avg.toFixed(2)}`);
        expect(avg - h.par, `${course.name} hole ${h.id} ${h.name}`).toBeLessThan(1.6);
        expect(avg - h.par, `${course.name} hole ${h.id} ${h.name}`).toBeGreaterThan(-0.9);
      }
      if ((globalThis as { process?: { env: Record<string, string> } }).process?.env.COURSE_REPORT) console.log(course.name, rows.join('  '));
    });
  });
}
