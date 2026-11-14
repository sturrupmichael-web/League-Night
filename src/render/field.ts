/**
 * Top-down terrain renderer. The terrain is rasterised once into a coarse grid
 * (surface + height per cell), then drawn per screen pixel through the camera.
 */
import type { Surface, Terrain } from '../sim/terrain';
import { PAL } from './palette';

export interface Camera {
  /** World point shown at the anchor (the focus). */
  x: number;
  y: number;
  /** Screen pixels per foot at the focus. */
  zoom: number;
  /** Screen position of the focus. */
  ax: number;
  ay: number;
  /** Camera pitch below the horizon in radians: PI/2 looks straight down. */
  pitch: number;
  /** Camera distance from the focus, in screen pixels. Smaller = stronger perspective. */
  dist: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
  /** Perspective scale at this point (1 at the focus, smaller further away). */
  s: number;
}

/**
 * Pinhole projection of a world point (h = feet above the local ground) onto the screen.
 * The ground is drawn as a flat plane; slopes are shown by shading, not geometry.
 */
export function worldToScreen(c: Camera, x: number, y: number, h = 0): ScreenPoint {
  const dx = x - c.x;
  const dy = y - c.y;
  const sp = Math.sin(c.pitch);
  const cp = Math.cos(c.pitch);
  const p = c.zoom / c.dist;
  const s = 1 / Math.max(0.05, 1 + p * (dy * cp - h * sp));
  return { x: c.ax + c.zoom * dx * s, y: c.ay - c.zoom * (dy * sp + h * cp) * s, s };
}

/** Inverse of worldToScreen for the ground plane. Points above the horizon clamp to far away. */
export function screenToWorld(c: Camera, sx: number, sy: number): { x: number; y: number } {
  const sp = Math.sin(c.pitch);
  const cp = Math.cos(c.pitch);
  const p = c.zoom / c.dist;
  const Y = (c.ay - sy) / c.zoom;
  const den = Math.max(0.02, sp - Y * p * cp);
  const dy = Y / den;
  const s = 1 / (1 + p * dy * cp);
  return { x: c.x + (sx - c.ax) / (c.zoom * s), y: c.y + dy };
}

/** Screen row of the horizon (may be far above the screen). */
export function horizonY(c: Camera): number {
  const cp = Math.cos(c.pitch);
  if (cp < 1e-4) return -1e9;
  return c.ay - (c.dist * Math.sin(c.pitch)) / cp;
}

const SURF: Surface[] = ['fairway', 'rough', 'green', 'sand', 'water', 'ob'];

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

const C = {
  fairA: hex(PAL.grass),
  fairB: hex(PAL.grassLight),
  rough: hex(PAL.rough),
  roughDot: hex(PAL.grassDark),
  green: hex(PAL.mow),
  greenB: hex(PAL.grassLight),
  sand: hex(PAL.sand),
  sandDot: hex(PAL.sandDark),
  water: hex(PAL.water),
  waterLight: hex(PAL.waterLight),
  ob: hex(PAL.ob),
  obHatch: hex(PAL.night3),
  edge: hex(PAL.white),
  woods: hex(PAL.pine),
  woodsB: hex(PAL.grassDark),
  fog: hex(PAL.dusk),
  night: hex(PAL.night2),
  treeline: hex(PAL.night1),
  treelineB: hex(PAL.night3),
  star: hex(PAL.inkDim),
};

export class FieldRenderer {
  private surf: Uint8Array;
  private height: Float32Array;
  private gw: number;
  private gh: number;
  private img: ImageData;

  constructor(
    terrain: Terrain,
    private x0: number,
    private y0: number,
    x1: number,
    y1: number,
    private cell = 2,
    viewW = 180,
    viewH = 320,
  ) {
    this.gw = Math.ceil((x1 - x0) / cell);
    this.gh = Math.ceil((y1 - y0) / cell);
    this.surf = new Uint8Array(this.gw * this.gh);
    this.height = new Float32Array(this.gw * this.gh);
    for (let j = 0; j < this.gh; j++) {
      for (let i = 0; i < this.gw; i++) {
        const wx = x0 + (i + 0.5) * cell;
        const wy = y0 + (j + 0.5) * cell;
        this.surf[j * this.gw + i] = SURF.indexOf(terrain.surface(wx, wy));
        this.height[j * this.gw + i] = terrain.height(wx, wy);
      }
    }
    this.img = new ImageData(viewW, viewH);
  }

  private cellAt(wx: number, wy: number): number {
    const i = Math.floor((wx - this.x0) / this.cell);
    const j = Math.floor((wy - this.y0) / this.cell);
    if (i < 0 || j < 0 || i >= this.gw || j >= this.gh) return -1;
    return j * this.gw + i;
  }

  draw(ctx: CanvasRenderingContext2D, cam: Camera, time: number) {
    const { img } = this;
    const d = img.data;
    const W = img.width;
    const H = img.height;
    const shimmer = Math.floor(time * 3);
    const sp = Math.sin(cam.pitch);
    const cp = Math.cos(cam.pitch);
    const p = cam.zoom / cam.dist;
    const hz = horizonY(cam);
    let prevWy = Number.NaN;
    for (let sy = 0; sy < H; sy++) {
      const Y = (cam.ay - (sy + 0.5)) / cam.zoom;
      const den = sp - Y * p * cp;
      if (den <= 0.004) {
        this.skyRow(d, W, sy, hz);
        prevWy = Number.NaN;
        continue;
      }
      const dy = Y / den;
      const k = 1 / (1 + p * dy * cp);
      const inv = 1 / (cam.zoom * k);
      const wy = cam.y + dy;
      const wyUp = Number.isNaN(prevWy) ? wy + inv : prevWy;
      prevWy = wy;
      // Distance haze: far ground fades into the dusk.
      const depth = 1 / k;
      const fog = Math.min(0.75, Math.max(0, (depth - 1.15) * 0.32));
      // Near ground is a touch brighter than the focus.
      const lamp = 1 + Math.max(-0.08, Math.min(0.1, (k - 1) * 0.25));
      // Pixels per world foot here: drives texture detail so far ground does not shimmer.
      const ppf = cam.zoom * k;
      for (let sx = 0; sx < W; sx++) {
        const wx = cam.x + (sx + 0.5 - cam.ax) * inv;
        const kc = this.cellAt(wx, wy);
        const s = kc < 0 ? 6 : this.surf[kc];
        let c: [number, number, number];
        switch (s) {
          case 0: // fairway: mowing stripes every 20 ft
            c = Math.floor(wy / 20) & 1 ? C.fairA : C.fairB;
            break;
          case 1: // rough: dithered tufts, pinned to the ground so they recede with it
            c = ppf > 0.35 && hash(Math.floor(wx * 0.7), Math.floor(wy * 0.7)) % 9 === 0 ? C.roughDot : C.rough;
            break;
          case 2: // green: checker mow
            c = (Math.floor(wy / 10) + Math.floor(wx / 10)) & 1 ? C.green : C.greenB;
            break;
          case 3:
            c = ((sx * 5 + sy * 3) % 7 === 0) ? C.sandDot : C.sand;
            break;
          case 4: // water: moving ripple lines
            c = ((sy + shimmer + ((sx >> 3) & 1) * 2) % (ppf > 0.3 ? 6 : 3) === 0 && (sx % 5) < 3) ? C.waterLight : C.water;
            break;
          case 5: // OB: hatched so it reads without colour
            c = ((sx + sy) & 3) === 0 ? C.obHatch : C.ob;
            break;
          default: // beyond the map: dark woods floor
            c = hash(Math.floor(wx / 2), Math.floor(wy / 2)) % 5 === 0 ? C.woodsB : C.woods;
        }
        let r = c[0];
        let g = c[1];
        let b = c[2];
        let shade = lamp;
        if (kc >= 0 && s !== 4) {
          // Contour every 2 ft of elevation, and a hillshade lit from the far side.
          const ku = this.cellAt(wx, wyUp);
          if (ku >= 0) {
            const h0 = this.height[kc];
            const h1 = this.height[ku];
            if (Math.floor(h0 / 2) !== Math.floor(h1 / 2)) shade *= 0.84;
            else shade *= 1 + Math.max(-0.35, Math.min(0.35, ((h1 - h0) / Math.max(0.5, wyUp - wy)) * 1.6));
          }
          const kr = this.cellAt(wx + inv, wy);
          if (kr >= 0) shade *= 1 + Math.max(-0.15, Math.min(0.15, (this.height[kr] - this.height[kc]) * 0.4));
        }
        r *= shade;
        g *= shade;
        b *= shade;
        // Boundary lines between OB and play.
        if (kc >= 0) {
          const kr = this.cellAt(wx + inv, wy);
          const kd = this.cellAt(wx, wyUp);
          const sr = kr < 0 ? 5 : this.surf[kr];
          const sd = kd < 0 ? 5 : this.surf[kd];
          if ((s === 5) !== (sr === 5) || (s === 5) !== (sd === 5)) [r, g, b] = C.edge;
        }
        if (fog > 0) {
          r += (C.fog[0] - r) * fog;
          g += (C.fog[1] - g) * fog;
          b += (C.fog[2] - b) * fog;
        }
        const o = (sy * W + sx) * 4;
        d[o] = r;
        d[o + 1] = g;
        d[o + 2] = b;
        d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  /** Sky above the horizon: dusk gradient, a few stars and a ragged tree line. */
  private skyRow(d: Uint8ClampedArray, W: number, sy: number, hz: number) {
    const above = hz - sy;
    const t = Math.min(1, Math.max(0, above / 90));
    const c0 = C.fog;
    const c1 = C.night;
    for (let sx = 0; sx < W; sx++) {
      let r = c0[0] + (c1[0] - c0[0]) * t;
      let g = c0[1] + (c1[1] - c0[1]) * t;
      let b = c0[2] + (c1[2] - c0[2]) * t;
      const treeH = 5 + ((hash(sx >> 1, 7) % 5) + (hash(sx >> 3, 3) % 4)) ;
      if (above < treeH) [r, g, b] = above < treeH - 2 ? C.treeline : C.treelineB;
      else if (above > 20 && hash(sx, sy) % 97 === 0) [r, g, b] = C.star;
      const o = (sy * W + sx) * 4;
      d[o] = r;
      d[o + 1] = g;
      d[o + 2] = b;
      d[o + 3] = 255;
    }
  }
}

function hash(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
