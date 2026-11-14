/** Shared top-down drawing: terrain, markers, tee, trees, basket, minimap. */
import type { HoleDef } from '../game/hole';
import type { Terrain } from '../sim/terrain';
import { config } from '../config';
import { type Camera, FieldRenderer, screenToWorld, worldToScreen } from './field';
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
    let lastLabel = Infinity;
    for (const m of h.markers) {
      const l = worldToScreen(cam, h.tee.x - 50, h.tee.y + m);
      const r = worldToScreen(cam, h.tee.x + 50, h.tee.y + m);
      if (l.y < opts.top || l.y > opts.bottom || l.s < 0.3) continue;
      ctx.fillStyle = 'rgba(244,233,205,0.28)';
      const step = Math.max(2, Math.round(3 * l.s));
      for (let x = Math.round(l.x); x < r.x; x += step) ctx.fillRect(x, Math.round(l.y + ((x - l.x) / Math.max(1, r.x - l.x)) * (r.y - l.y)), 1, 1);
      // Far markers bunch up under perspective: only label ones with room.
      if (lastLabel - l.y >= 8) {
        drawTextShadow(ctx, String(m), Math.round(l.x) - 3, Math.round(l.y) - 2, PAL.inkDim, PAL.night0, 'right');
        lastLabel = l.y;
      }
    }
    const t = h.tee;
    drawTeePad(ctx, [
      worldToScreen(cam, t.x - 3, t.y + 5),
      worldToScreen(cam, t.x + 3, t.y + 5),
      worldToScreen(cam, t.x + 3, t.y - 6),
      worldToScreen(cam, t.x - 3, t.y - 6),
    ]);

    const flatten = Math.sin(cam.pitch);
    const props: { y: number; draw: () => void }[] = [];
    for (const tr of this.terrain.trees) {
      const s = worldToScreen(cam, tr.x, tr.y);
      const r = tr.r * cam.zoom * s.s;
      // Trees are drawn taller than their collision height so they read as standing.
      const top = worldToScreen(cam, tr.x, tr.y, (tr.h ?? config.treeHeight) * 1.5);
      const hPx = s.y - top.y;
      if (s.s < 0.08 || s.y < -4 || top.y > 330 || s.x < -r * 2 - 8 || s.x > 188 + r * 2) continue;
      const kind = treeKind(tr.x, tr.y);
      props.push({ y: s.y, draw: () => drawTree(ctx, s.x, s.y, r, hPx, kind, flatten) });
    }
    const b = worldToScreen(cam, h.basket.x, h.basket.y);
    const sc = cam.zoom * b.s > 1.1 ? 2 : 1;
    props.push({ y: b.y, draw: () => drawBasket(ctx, b.x, b.y, opts.flash, sc) });
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
    // Current view: a trapezoid on the ground under perspective.
    const corners = [
      screenToWorld(view, 0, 40),
      screenToWorld(view, 180, 40),
      screenToWorld(view, 180, 270),
      screenToWorld(view, 0, 270),
    ].map((p) => to(p.x, p.y));
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = 'rgba(244,233,205,0.6)';
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const c = corners[(i + 1) % 4];
      const n = Math.min(200, Math.ceil(Math.max(Math.abs(c.x - a.x), Math.abs(c.y - a.y))));
      for (let j = 0; j <= n; j++) ctx.fillRect(Math.round(a.x + ((c.x - a.x) * j) / Math.max(1, n)), Math.round(a.y + ((c.y - a.y) * j) / Math.max(1, n)), 1, 1);
    }
    ctx.restore();
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

/** Stable per-tree look: mostly pines, some round leafy trees. */
function treeKind(x: number, y: number): number {
  const h = Math.imul(Math.round(x * 7) ^ Math.imul(Math.round(y * 13), 2654435761), 1597334677) >>> 0;
  return h % 3 === 0 ? 1 : 0;
}
