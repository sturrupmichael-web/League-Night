/** Shared top-down drawing: terrain, markers, tee, trees, basket, minimap. */
import type { HoleDef } from '../game/hole';
import type { Terrain } from '../sim/terrain';
import { type Camera, FieldRenderer, worldToScreen } from './field';
import { drawTextShadow } from './font';
import { PAL } from './palette';
import { drawBasket, drawTeePad, drawTree } from './sprites';

export class HoleRenderer {
  readonly field: FieldRenderer;
  private mini: HTMLCanvasElement | null = null;
  miniRect = { x: 0, y: 0, w: 0, h: 0, scale: 1 };

  constructor(
    readonly hole: HoleDef,
    readonly terrain: Terrain,
  ) {
    const m = 60;
    const b = hole.box;
    this.field = new FieldRenderer(terrain, b.x0 - m, b.y0 - m, b.x1 + m, b.y1 + m);
  }

  drawWorld(ctx: CanvasRenderingContext2D, cam: Camera, time: number, opts: { flash: number; top: number; bottom: number }) {
    this.field.draw(ctx, cam, time);
    const h = this.hole;
    for (const m of h.markers) {
      const l = worldToScreen(cam, h.tee.x - 50, h.tee.y + m);
      const r = worldToScreen(cam, h.tee.x + 50, h.tee.y + m);
      if (l.y < opts.top || l.y > opts.bottom) continue;
      ctx.fillStyle = 'rgba(244,233,205,0.28)';
      for (let x = Math.round(l.x); x < r.x; x += 3) ctx.fillRect(x, Math.round(l.y), 1, 1);
      drawTextShadow(ctx, String(m), Math.round(l.x) - 3, Math.round(l.y) - 2, PAL.inkDim, PAL.night0, 'right');
    }
    const tee = worldToScreen(cam, h.tee.x, h.tee.y);
    drawTeePad(ctx, tee.x, tee.y, cam.zoom);

    const props: { y: number; draw: () => void }[] = [];
    for (const t of this.terrain.trees) {
      const s = worldToScreen(cam, t.x, t.y);
      const r = t.r * cam.zoom;
      if (s.y < -r - 4 || s.y > 330 + r || s.x < -r - 4 || s.x > 184 + r) continue;
      props.push({ y: s.y, draw: () => drawTree(ctx, s.x, s.y, r) });
    }
    const b = worldToScreen(cam, h.basket.x, h.basket.y);
    props.push({ y: b.y, draw: () => drawBasket(ctx, b.x, b.y, opts.flash) });
    props.sort((a, c) => a.y - c.y).forEach((p) => p.draw());
  }

  /** Minimap in the top-right corner. Returns its rect for hit-testing. */
  drawMinimap(ctx: CanvasRenderingContext2D, right: number, top: number, maxW: number, maxH: number, disc: { x: number; y: number }, view: Camera, blink: boolean) {
    const box = this.hole.box;
    const bw = box.x1 - box.x0;
    const bh = box.y1 - box.y0;
    const scale = Math.min(maxW / bw, maxH / bh);
    const w = Math.max(8, Math.round(bw * scale));
    const h = Math.max(8, Math.round(bh * scale));
    const x = right - w;
    const y = top;
    this.miniRect = { x: x - 2, y: y - 2, w: w + 4, h: h + 4, scale };
    if (!this.mini || this.mini.width !== w || this.mini.height !== h) this.mini = this.renderMini(w, h, scale);
    ctx.fillStyle = PAL.night0;
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = PAL.dusk;
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.drawImage(this.mini, x, y);
    const to = (px: number, py: number) => ({ x: x + (px - box.x0) * scale, y: y + h - (py - box.y0) * scale });
    // Current view rectangle.
    const v0 = to(view.x + (0 - view.ax) / view.zoom, view.y - (40 - view.ay) / view.zoom);
    const v1 = to(view.x + (180 - view.ax) / view.zoom, view.y - (270 - view.ay) / view.zoom);
    ctx.strokeStyle = 'rgba(244,233,205,0.6)';
    ctx.lineWidth = 1;
    const rx = Math.max(x, Math.round(v0.x)) + 0.5;
    const ry = Math.max(y, Math.round(v0.y)) + 0.5;
    const rw = Math.min(x + w, Math.round(v1.x)) - rx;
    const rh = Math.min(y + h, Math.round(v1.y)) - ry;
    if (rw > 1 && rh > 1) ctx.strokeRect(rx, ry, rw, rh);
    const t = to(this.hole.tee.x, this.hole.tee.y);
    ctx.fillStyle = PAL.haze;
    ctx.fillRect(Math.round(t.x) - 1, Math.round(t.y) - 1, 2, 2);
    const bk = to(this.hole.basket.x, this.hole.basket.y);
    ctx.fillStyle = PAL.amber;
    ctx.fillRect(Math.round(bk.x) - 1, Math.round(bk.y) - 1, 3, 3);
    if (blink) {
      const d = to(disc.x, disc.y);
      ctx.fillStyle = PAL.white;
      ctx.fillRect(Math.round(d.x) - 1, Math.round(d.y) - 1, 2, 2);
    }
  }

  private renderMini(w: number, h: number, scale: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    const img = g.createImageData(w, h);
    const box = this.hole.box;
    const col: Record<string, [number, number, number]> = {
      fairway: [59, 106, 69],
      rough: [36, 69, 47],
      green: [71, 122, 79],
      sand: [201, 168, 106],
      water: [44, 95, 134],
      ob: [58, 43, 54],
    };
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const wx = box.x0 + (i + 0.5) / scale;
        const wy = box.y0 + (h - j - 0.5) / scale;
        const c3 = col[this.terrain.surface(wx, wy)];
        const o = (j * w + i) * 4;
        img.data[o] = c3[0];
        img.data[o + 1] = c3[1];
        img.data[o + 2] = c3[2];
        img.data[o + 3] = 255;
      }
    }
    for (const t of this.terrain.trees) {
      const tx = Math.round((t.x - box.x0) * scale);
      const ty = Math.round(h - (t.y - box.y0) * scale);
      if (tx >= 0 && ty >= 0 && tx < w && ty < h) {
        const o = (ty * w + tx) * 4;
        img.data[o] = 20;
        img.data[o + 1] = 41;
        img.data[o + 2] = 31;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }
}
