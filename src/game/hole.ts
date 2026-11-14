/**
 * Hole and course data. Holes are authored as JSON (see src/content/courses/) and validated here,
 * so a bad hole fails loudly at load time instead of half-working in game.
 */
import type { Vec2 } from '../sim/math';
import type { Heightmap, Polygon, Region, Surface, TerrainSpec, Tree } from '../sim/terrain';

export interface HoleJson {
  id: number;
  name: string;
  par: number;
  lengthFt: number;
  tee: [number, number];
  basket: [number, number];
  bounds: [number, number][];
  fairway?: [number, number][][];
  green?: [number, number][][];
  rough?: [number, number][][];
  sand?: [number, number][][];
  water?: [number, number][][];
  ob?: [number, number][][];
  trees?: Tree[];
  heightmap?: Heightmap;
  windRange?: [number, number];
  note?: string;
  /** Distance markers to draw (ft from the tee). Used by the practice field. */
  markers?: number[];
}

export interface CourseJson {
  id: string;
  name: string;
  holes: HoleJson[];
}

export interface HoleDef {
  id: number;
  name: string;
  par: number;
  lengthFt: number;
  tee: Vec2;
  basket: Vec2;
  windRange: [number, number];
  note: string;
  markers: number[];
  terrain: TerrainSpec;
  /** Bounding box of the playable area (bounds polygon). */
  box: { x0: number; y0: number; x1: number; y1: number };
}

export interface CourseDef {
  id: string;
  name: string;
  holes: HoleDef[];
  par: number;
}

/** Layer order: later layers win where they overlap. */
const LAYERS: Surface[] = ['fairway', 'rough', 'green', 'sand', 'water', 'ob'];

const isPoint = (p: unknown): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && isFinite(n));
const isPoly = (p: unknown): p is Polygon => Array.isArray(p) && p.length >= 3 && p.every(isPoint);

export function parseHole(j: HoleJson): HoleDef {
  const where = `hole ${j?.id ?? '?'}`;
  const fail = (msg: string): never => {
    throw new Error(`${where}: ${msg}`);
  };
  if (typeof j.id !== 'number') fail('id must be a number');
  if (!j.name) fail('missing name');
  if (!(j.par >= 2 && j.par <= 6)) fail('par must be 2–6');
  if (!isPoint(j.tee)) fail('tee must be [x, y]');
  if (!isPoint(j.basket)) fail('basket must be [x, y]');
  if (!isPoly(j.bounds)) fail('bounds must be a polygon');

  const regions: Region[] = [];
  for (const layer of LAYERS) {
    const polys = (j as unknown as Record<string, unknown>)[layer];
    if (polys === undefined) continue;
    if (!Array.isArray(polys)) fail(`${layer} must be a list of polygons`);
    (polys as unknown[]).forEach((p, i) => {
      if (!isPoly(p)) fail(`${layer}[${i}] is not a polygon`);
      regions.push({ surface: layer, poly: p as Polygon });
    });
  }

  const trees = j.trees ?? [];
  trees.forEach((t, i) => {
    if (![t.x, t.y, t.r].every((n) => typeof n === 'number' && isFinite(n)) || t.r <= 0) fail(`trees[${i}] needs x, y, r > 0`);
  });

  if (j.heightmap) {
    const h = j.heightmap;
    if (!(h.cellFt > 0 && h.w >= 1 && h.h >= 1)) fail('heightmap needs cellFt > 0, w and h >= 1');
    if (!Array.isArray(h.data) || h.data.length !== h.w * h.h) fail(`heightmap.data should have w*h = ${h.w * h.h} values`);
  }

  const xs = j.bounds.map((p) => p[0]);
  const ys = j.bounds.map((p) => p[1]);
  const box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };

  const terrain: TerrainSpec = {
    defaultSurface: 'rough',
    bounds: j.bounds,
    regions,
    trees,
    heightmap: j.heightmap,
  };

  const tee = { x: j.tee[0], y: j.tee[1] };
  const basket = { x: j.basket[0], y: j.basket[1] };
  const inside = (p: Vec2) => p.x >= box.x0 && p.x <= box.x1 && p.y >= box.y0 && p.y <= box.y1;
  if (!inside(tee)) fail('tee is outside bounds');
  if (!inside(basket)) fail('basket is outside bounds');

  return {
    id: j.id,
    name: j.name,
    par: j.par,
    lengthFt: j.lengthFt ?? Math.round(Math.hypot(basket.x - tee.x, basket.y - tee.y)),
    tee,
    basket,
    windRange: j.windRange ?? [0, 10],
    note: j.note ?? '',
    markers: j.markers ?? [],
    terrain,
    box,
  };
}

export function parseCourse(j: CourseJson): CourseDef {
  if (!j.id || !j.name || !Array.isArray(j.holes) || j.holes.length === 0) throw new Error('course needs id, name and at least one hole');
  const holes = j.holes.map(parseHole);
  return { id: j.id, name: j.name, holes, par: holes.reduce((a, h) => a + h.par, 0) };
}
