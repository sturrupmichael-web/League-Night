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

  // Per-column / per-row lookups (the camera never rotates, so a cell index is col + row).
  private colI = new Int32Array(0);
  private rowJ = new Int32Array(0);
  private stripeRow = new Uint8Array(0);
  private checkRow = new Uint8Array(0);
  private checkCol = new Uint8Array(0);
  private last = { x: NaN, y: NaN, zoom: NaN, ax: NaN, ay: NaN, shimmer: -1 };

  draw(ctx: CanvasRenderingContext2D, cam: Camera, time: number) {
    const { img } = this;
    const W = img.width;
    const H = img.height;
    const shimmer = Math.floor(time * 3);
    const L = this.last;
    // Nothing moved since the last frame: the image is still good.
    if (L.x === cam.x && L.y === cam.y && L.zoom === cam.zoom && L.ax === cam.ax && L.ay === cam.ay && L.shimmer === shimmer) {
      ctx.putImageData(img, 0, 0);
      return;
    }
    Object.assign(L, { x: cam.x, y: cam.y, zoom: cam.zoom, ax: cam.ax, ay: cam.ay, shimmer });
    const d = img.data;
    const inv = 1 / cam.zoom;
    if (this.colI.length !== W + 1) {
      this.colI = new Int32Array(W + 1);
      this.checkCol = new Uint8Array(W + 1);
      this.rowJ = new Int32Array(H + 1);
      this.stripeRow = new Uint8Array(H + 1);
      this.checkRow = new Uint8Array(H + 1);
    }
    const { colI, rowJ, gw, gh, surf, height } = this;
    // colI[sx] = cell column of pixel sx (or -1); rowJ[r] = cell row of pixel row r-1 (rowJ[0] = the row above the screen).
    for (let sx = 0; sx <= W; sx++) {
      const wx = cam.x + (sx + 0.5 - cam.ax) * inv;
      const i = Math.floor((wx - this.x0) / this.cell);
      colI[sx] = i < 0 || i >= gw ? -1 : i;
      this.checkCol[sx] = Math.floor(wx / 10) & 1;
    }
    for (let r = 0; r <= H; r++) {
      const wy = cam.y - (r - 1 + 0.5 - cam.ay) * inv;
      const j = Math.floor((wy - this.y0) / this.cell);
      rowJ[r] = j < 0 || j >= gh ? -1 : j * gw;
      this.stripeRow[r] = Math.floor(wy / 20) & 1;
      this.checkRow[r] = Math.floor(wy / 10) & 1;
    }
    for (let sy = 0; sy < H; sy++) {
      const row = rowJ[sy + 1];
      const rowUp = rowJ[sy];
      const stripe = this.stripeRow[sy + 1];
      const checkR = this.checkRow[sy + 1];
      let o = sy * W * 4;
      for (let sx = 0; sx < W; sx++, o += 4) {
        const ci = colI[sx];
        const k = row < 0 || ci < 0 ? -1 : row + ci;
        const s = k < 0 ? 5 : surf[k];
        let c: [number, number, number];
        switch (s) {
          case 0: // fairway: mowing stripes every 20 ft
            c = stripe ? C.fairA : C.fairB;
            break;
          case 1: // rough: dithered tufts
            c = (sx * 7 + sy * 13) % 11 === 0 ? C.roughDot : C.rough;
            break;
          case 2: // green: checker mow
            c = (checkR + this.checkCol[sx]) & 1 ? C.green : C.greenB;
            break;
          case 3:
            c = (sx * 5 + sy * 3) % 7 === 0 ? C.sandDot : C.sand;
            break;
          case 4: // water: moving ripple lines
            c = (sy + shimmer + ((sx >> 3) & 1) * 2) % 6 === 0 && sx % 5 < 3 ? C.waterLight : C.water;
            break;
          default: // OB: hatched so it reads without colour
            c = ((sx + sy) & 3) === 0 ? C.obHatch : C.ob;
        }
        let r = c[0];
        let g = c[1];
        let b = c[2];
        if (k >= 0) {
          const ku = rowUp < 0 ? -1 : rowUp + ci;
          if (s !== 4 && ku >= 0) {
            // Contour every 2 ft of elevation, and a light hillshade.
            const h0 = height[k];
            const h1 = height[ku];
            const f = Math.floor(h0 / 2) !== Math.floor(h1 / 2) ? 0.86 : 1 + (h1 - h0) * 0.6;
            r *= f;
            g *= f;
            b *= f;
          }
          // Boundary lines between OB and play.
          const cr = colI[sx + 1];
          const sr = cr < 0 ? 5 : surf[row + cr];
          const sd = ku < 0 ? 5 : surf[ku];
          if ((s === 5) !== (sr === 5) || (s === 5) !== (sd === 5)) [r, g, b] = C.edge;
        }
        d[o] = r;
        d[o + 1] = g;
        d[o + 2] = b;
        d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
}
