/**
 * Top-down terrain renderer. The terrain is rasterised once into a coarse grid
 * (surface + height per cell), then drawn per screen pixel through the camera.
 */
import type { Surface, Terrain } from '../sim/terrain';
import { PAL } from './palette';

export interface Camera {
  /** World point shown at the anchor. */
  x: number;
  y: number;
  /** Screen pixels per foot. */
  zoom: number;
  /** Screen position of the camera point. */
  ax: number;
  ay: number;
}

export const worldToScreen = (c: Camera, x: number, y: number) => ({ x: c.ax + (x - c.x) * c.zoom, y: c.ay - (y - c.y) * c.zoom });
export const screenToWorld = (c: Camera, sx: number, sy: number) => ({ x: c.x + (sx - c.ax) / c.zoom, y: c.y - (sy - c.ay) / c.zoom });

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
    const inv = 1 / cam.zoom;
    const shimmer = Math.floor(time * 3);
    for (let sy = 0; sy < H; sy++) {
      const wy = cam.y - (sy + 0.5 - cam.ay) * inv;
      const wyUp = wy + inv;
      for (let sx = 0; sx < W; sx++) {
        const wx = cam.x + (sx + 0.5 - cam.ax) * inv;
        const k = this.cellAt(wx, wy);
        const s = k < 0 ? 5 : this.surf[k];
        let c: [number, number, number];
        switch (s) {
          case 0: // fairway: mowing stripes every 20 ft
            c = Math.floor(wy / 20) & 1 ? C.fairA : C.fairB;
            break;
          case 1: // rough: dithered tufts
            c = ((sx * 7 + sy * 13) % 11 === 0) ? C.roughDot : C.rough;
            break;
          case 2: // green: checker mow
            c = (Math.floor(wy / 10) + Math.floor(wx / 10)) & 1 ? C.green : C.greenB;
            break;
          case 3:
            c = ((sx * 5 + sy * 3) % 7 === 0) ? C.sandDot : C.sand;
            break;
          case 4: // water: moving ripple lines
            c = ((sy + shimmer + ((sx >> 3) & 1) * 2) % 6 === 0 && (sx % 5) < 3) ? C.waterLight : C.water;
            break;
          default: // OB: hatched so it reads without colour
            c = ((sx + sy) & 3) === 0 ? C.obHatch : C.ob;
        }
        let r = c[0];
        let g = c[1];
        let b = c[2];
        if (k >= 0 && s !== 4) {
          // Contour every 2 ft of elevation, and a light hillshade.
          const ku = this.cellAt(wx, wyUp);
          if (ku >= 0) {
            const h0 = this.height[k];
            const h1 = this.height[ku];
            if (Math.floor(h0 / 2) !== Math.floor(h1 / 2)) {
              r *= 0.86;
              g *= 0.86;
              b *= 0.86;
            } else {
              const shade = 1 + (h1 - h0) * 0.6;
              r *= shade;
              g *= shade;
              b *= shade;
            }
          }
        }
        // Boundary lines between OB and play, and around water.
        if (k >= 0) {
          const kr = this.cellAt(wx + inv, wy);
          const kd = this.cellAt(wx, wyUp);
          const sr = kr < 0 ? 5 : this.surf[kr];
          const sd = kd < 0 ? 5 : this.surf[kd];
          if ((s === 5) !== (sr === 5) || (s === 5) !== (sd === 5)) {
            [r, g, b] = C.edge;
          }
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
}
