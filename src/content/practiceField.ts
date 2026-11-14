/**
 * The practice field: an open, gently rising park with distance markers, one basket,
 * and a little of everything to test against (pond, bunker, rough, trees, OB lines).
 */
import { parseHole } from '../game/hole';
import type { Heightmap, Polygon, Tree } from '../sim/terrain';

const BASKET = { x: 18, y: 320 };

const W = 160; // half-width in ft
const TOP = 620;
const BOTTOM = -60;

const rect = (x0: number, y0: number, x1: number, y1: number): Polygon => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const blob = (cx: number, cy: number, rx: number, ry: number, wobble: number[]): Polygon =>
  wobble.map((w, i) => {
    const a = (i / wobble.length) * Math.PI * 2;
    return [Math.round(cx + Math.cos(a) * rx * w), Math.round(cy + Math.sin(a) * ry * w)] as [number, number];
  });

function heightmap(): Heightmap {
  const cellFt = 40;
  const w = Math.ceil((2 * W) / cellFt) + 1;
  const h = Math.ceil((TOP - BOTTOM) / cellFt) + 1;
  const data: number[] = [];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = -W + i * cellFt;
      const y = BOTTOM + j * cellFt;
      // Flat out to 360 ft, then a long rise to a ridge at the back.
      let z = y > 360 ? (y - 360) * 0.07 : 0;
      // A mound off to the right of the fairway.
      z += 6 * Math.exp(-((x - 100) ** 2 + (y - 260) ** 2) / (2 * 45 ** 2));
      // The pond sits in a slight dip.
      z -= 2 * Math.exp(-((x + 95) ** 2 + (y - 235) ** 2) / (2 * 50 ** 2));
      data.push(Math.round(z * 10) / 10);
    }
  }
  return { cellFt, w, h, data, originX: -W, originY: BOTTOM };
}

const trees: Tree[] = [
  { x: -70, y: 110, r: 9 },
  { x: -88, y: 128, r: 7 },
  { x: 72, y: 70, r: 8 },
  { x: 95, y: 395, r: 10 },
  { x: 118, y: 420, r: 9 },
  { x: 80, y: 438, r: 8 },
  { x: -60, y: 470, r: 11 },
  { x: -20, y: 520, r: 8 },
  { x: 45, y: 255, r: 6 },
  { x: -130, y: 360, r: 9 },
];

export const PRACTICE_HOLE = parseHole({
  id: 0,
  name: 'PRACTICE FIELD',
  par: 3,
  lengthFt: 320,
  tee: [0, 0],
  basket: [BASKET.x, BASKET.y],
  bounds: rect(-W, BOTTOM, W, TOP),
  fairway: [[[-30, -40], [30, -40], [55, 150], [60, 330], [50, 560], [-50, 560], [-60, 330], [-55, 150]]],
  green: [blob(BASKET.x, BASKET.y, 34, 30, [1, 1.05, 0.95, 1, 1.08, 0.97, 1, 1.02])],
  water: [blob(-95, 235, 48, 38, [1, 0.9, 1.1, 1, 0.85, 1.05, 1.15, 0.95, 1, 0.9])],
  sand: [blob(82, 170, 22, 13, [1, 1.1, 0.9, 1, 1.05, 0.95])],
  trees,
  heightmap: heightmap(),
  windRange: [0, 0],
  note: 'WARM UP. NO SCORE.',
  markers: [50, 100, 150, 200, 250, 300, 350, 400, 450, 500],
});
