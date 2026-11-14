import { describe, expect, it } from 'vitest';
import { type Camera, horizonY, screenToWorld, worldToScreen } from './field';

const cam: Camera = { x: 100, y: 200, zoom: 0.55, ax: 90, ay: 200, pitch: (52 * Math.PI) / 180, dist: 150 };

describe('perspective camera', () => {
  it('puts the focus at the anchor with scale 1', () => {
    const p = worldToScreen(cam, 100, 200);
    expect(p.x).toBeCloseTo(90);
    expect(p.y).toBeCloseTo(200);
    expect(p.s).toBeCloseTo(1);
  });

  it('round-trips ground points', () => {
    for (const [x, y] of [[100, 200], [40, 120], [180, 450], [90, 600]]) {
      const s = worldToScreen(cam, x, y);
      const w = screenToWorld(cam, s.x, s.y);
      expect(w.x).toBeCloseTo(x, 6);
      expect(w.y).toBeCloseTo(y, 6);
    }
  });

  it('shrinks far things and stays below the horizon', () => {
    const near = worldToScreen(cam, 100, 150);
    const far = worldToScreen(cam, 100, 600);
    expect(far.s).toBeLessThan(near.s);
    expect(far.y).toBeLessThan(near.y);
    expect(far.y).toBeGreaterThan(horizonY(cam));
  });

  it('draws height upward on screen', () => {
    const g = worldToScreen(cam, 120, 260);
    const a = worldToScreen(cam, 120, 260, 30);
    expect(a.y).toBeLessThan(g.y);
  });

  it('matches the old flat map when looking straight down', () => {
    const top: Camera = { ...cam, pitch: Math.PI / 2 };
    const p = worldToScreen(top, 110, 220);
    expect(p.x).toBeCloseTo(90 + 10 * 0.55);
    expect(p.y).toBeCloseTo(200 - 20 * 0.55);
  });
});
