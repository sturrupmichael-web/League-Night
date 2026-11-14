import type { Vec2 } from './math';

export type Surface = 'fairway' | 'rough' | 'green' | 'sand' | 'water' | 'ob';
export type Polygon = [number, number][];

export interface Tree { x: number; y: number; r: number; h?: number }

/** Coarse height grid in feet, bilinearly sampled. Cell (0,0) sits at (originX, originY). */
export interface Heightmap {
  cellFt: number;
  w: number;
  h: number;
  data: number[];
  originX?: number;
  originY?: number;
}

export interface Region { surface: Surface; poly: Polygon }

export interface TerrainSpec {
  defaultSurface: Surface;
  /** Anything outside this polygon is out of bounds. */
  bounds?: Polygon;
  /** Later regions win where they overlap. */
  regions: Region[];
  trees: Tree[];
  heightmap?: Heightmap;
}

export interface Terrain {
  height(x: number, y: number): number;
  gradient(x: number, y: number): Vec2;
  surface(x: number, y: number): Surface;
  trees: Tree[];
  spec: TerrainSpec;
}

export function pointInPolygon(x: number, y: number, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function sampleHeightmap(hm: Heightmap, x: number, y: number): number {
  const gx = (x - (hm.originX ?? 0)) / hm.cellFt;
  const gy = (y - (hm.originY ?? 0)) / hm.cellFt;
  const cx = Math.min(Math.max(gx, 0), hm.w - 1);
  const cy = Math.min(Math.max(gy, 0), hm.h - 1);
  const x0 = Math.min(Math.floor(cx), hm.w - 2 < 0 ? 0 : hm.w - 2);
  const y0 = Math.min(Math.floor(cy), hm.h - 2 < 0 ? 0 : hm.h - 2);
  const x1 = Math.min(x0 + 1, hm.w - 1);
  const y1 = Math.min(y0 + 1, hm.h - 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const at = (ix: number, iy: number) => hm.data[iy * hm.w + ix];
  const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx;
  const bot = at(x0, y1) * (1 - fx) + at(x1, y1) * fx;
  return top * (1 - fy) + bot * fy;
}

export function makeTerrain(spec: TerrainSpec): Terrain {
  const hm = spec.heightmap;
  const height = hm ? (x: number, y: number) => sampleHeightmap(hm, x, y) : () => 0;
  return {
    spec,
    trees: spec.trees,
    height,
    gradient(x, y) {
      const e = 1;
      return {
        x: (height(x + e, y) - height(x - e, y)) / (2 * e),
        y: (height(x, y + e) - height(x, y - e)) / (2 * e),
      };
    },
    surface(x, y) {
      if (spec.bounds && !pointInPolygon(x, y, spec.bounds)) return 'ob';
      for (let i = spec.regions.length - 1; i >= 0; i--) {
        if (pointInPolygon(x, y, spec.regions[i].poly)) return spec.regions[i].surface;
      }
      return spec.defaultSurface;
    },
  };
}

/** Flat, featureless terrain. Handy for tests. */
export function flatTerrain(): Terrain {
  return makeTerrain({ defaultSurface: 'fairway', regions: [], trees: [] });
}
