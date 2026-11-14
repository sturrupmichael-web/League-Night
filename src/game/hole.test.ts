import { describe, expect, it } from 'vitest';
import { COURSES } from '../content/courses';
import { PRACTICE_HOLE } from '../content/practiceField';
import { makeTerrain } from '../sim/terrain';
import { type HoleJson, parseHole } from './hole';

const base: HoleJson = {
  id: 9,
  name: 'TEST',
  par: 3,
  lengthFt: 200,
  tee: [0, 0],
  basket: [0, 200],
  bounds: [[-50, -20], [50, -20], [50, 240], [-50, 240]],
};

describe('hole loader', () => {
  it('loads the bundled courses', () => {
    for (const c of COURSES) {
    expect(c.holes.length).toBe(18);
    expect(c.par).toBe(c.holes.reduce((a, h) => a + h.par, 0));
    for (const h of c.holes) {
      const t = makeTerrain(h.terrain);
      expect(t.surface(h.tee.x, h.tee.y), `${h.name} tee`).not.toMatch(/water|ob/);
      expect(t.surface(h.basket.x, h.basket.y), `${h.name} basket`).not.toMatch(/water|ob/);
      for (const tr of h.terrain.trees) {
        expect(Math.hypot(tr.x - h.tee.x, tr.y - h.tee.y), `${h.name} tree on tee`).toBeGreaterThan(tr.r + 10);
        expect(Math.hypot(tr.x - h.basket.x, tr.y - h.basket.y), `${h.name} tree on basket`).toBeGreaterThan(tr.r + 8);
      }
      expect(Math.abs(h.lengthFt - Math.hypot(h.basket.x - h.tee.x, h.basket.y - h.tee.y))).toBeLessThan(h.lengthFt * 0.5);
    }
    }
  });

  it('loads the practice field', () => {
    expect(PRACTICE_HOLE.markers.length).toBeGreaterThan(0);
  });

  it('builds surfaces with later layers on top', () => {
    const h = parseHole({
      ...base,
      fairway: [[[-20, -20], [20, -20], [20, 240], [-20, 240]]],
      water: [[[-10, 90], [10, 90], [10, 110], [-10, 110]]],
    });
    const t = makeTerrain(h.terrain);
    expect(t.surface(0, 50)).toBe('fairway');
    expect(t.surface(0, 100)).toBe('water');
    expect(t.surface(40, 50)).toBe('rough');
    expect(t.surface(60, 50)).toBe('ob');
  });

  it('samples the heightmap', () => {
    const h = parseHole({ ...base, heightmap: { cellFt: 100, w: 2, h: 2, originX: -50, originY: 0, data: [0, 0, 10, 10] } });
    const t = makeTerrain(h.terrain);
    expect(t.height(0, 0)).toBeCloseTo(0);
    expect(t.height(0, 50)).toBeCloseTo(5);
    expect(t.height(0, 100)).toBeCloseTo(10);
  });

  it('rejects broken holes with a useful message', () => {
    expect(() => parseHole({ ...base, par: 9 })).toThrow(/par/);
    expect(() => parseHole({ ...base, tee: [999, 0] })).toThrow(/tee is outside/);
    expect(() => parseHole({ ...base, water: [[[0, 0], [1, 1]]] })).toThrow(/water\[0\]/);
    expect(() => parseHole({ ...base, heightmap: { cellFt: 10, w: 2, h: 2, data: [1, 2, 3] } })).toThrow(/heightmap/);
    expect(() => parseHole({ ...base, trees: [{ x: 0, y: 0, r: 0 }] })).toThrow(/trees\[0\]/);
  });
});
