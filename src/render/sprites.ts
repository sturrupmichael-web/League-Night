/** Placeholder sprites drawn from code. Swap for an atlas in the art pass. */
import { PAL } from './palette';

export function fillCircle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.fillStyle = color;
  const R = Math.max(0.5, r);
  for (let dy = -Math.ceil(R); dy <= Math.ceil(R); dy++) {
    const half = Math.sqrt(Math.max(0, R * R - dy * dy));
    if (half <= 0) continue;
    ctx.fillRect(Math.round(cx - half), Math.round(cy + dy), Math.max(1, Math.round(half * 2)), 1);
  }
}

export function drawTree(ctx: CanvasRenderingContext2D, sx: number, sy: number, r: number) {
  fillCircle(ctx, sx + r * 0.35, sy + r * 0.35, r, 'rgba(10,8,14,0.45)');
  fillCircle(ctx, sx, sy, r, PAL.pine);
  fillCircle(ctx, sx - r * 0.25, sy - r * 0.25, r * 0.7, PAL.pineLight);
  fillCircle(ctx, sx - r * 0.4, sy - r * 0.4, Math.max(1, r * 0.25), PAL.grassLight);
}

/** Basket seen from above-ish: shadow, pole, tray, chains, band. (sx, sy) is the base. */
export function drawBasket(ctx: CanvasRenderingContext2D, sx: number, sy: number, flash = 0) {
  const x = Math.round(sx);
  const y = Math.round(sy);
  ctx.fillStyle = 'rgba(10,8,14,0.5)';
  ctx.fillRect(x - 2, y, 6, 2);
  ctx.fillStyle = PAL.steel;
  ctx.fillRect(x, y - 10, 1, 10);
  ctx.fillRect(x - 3, y - 5, 7, 2);
  ctx.fillStyle = flash > 0 ? PAL.white : PAL.inkDim;
  ctx.fillRect(x - 2, y - 9, 1, 4);
  ctx.fillRect(x + 2, y - 9, 1, 4);
  ctx.fillRect(x - 1, y - 8, 1, 3);
  ctx.fillRect(x + 1, y - 8, 1, 3);
  ctx.fillStyle = PAL.amber;
  ctx.fillRect(x - 3, y - 11, 7, 2);
}

export function drawTeePad(ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number) {
  const w = Math.max(4, Math.round(6 * zoom));
  const h = Math.max(6, Math.round(12 * zoom));
  ctx.fillStyle = PAL.haze;
  ctx.fillRect(Math.round(sx - w / 2), Math.round(sy - h / 2), w, h);
  ctx.fillStyle = PAL.dusk;
  ctx.fillRect(Math.round(sx - w / 2), Math.round(sy + h / 2), w, 1);
}

/** Disc in flight: chunky shadow on the ground, disc lifted by altitude. */
export function drawDisc(ctx: CanvasRenderingContext2D, gx: number, gy: number, altPx: number, color: string, scale = 1) {
  const x = Math.round(gx);
  const y = Math.round(gy);
  ctx.fillStyle = 'rgba(10,8,14,0.55)';
  ctx.fillRect(x - 2, y - 1, 5, 2);
  const s = Math.round(3 + Math.min(2, scale - 1) * 1);
  const dy = Math.round(y - altPx);
  ctx.fillStyle = PAL.night0;
  ctx.fillRect(x - Math.floor(s / 2) - 1, dy - 1, s + 2, 3);
  ctx.fillStyle = color;
  ctx.fillRect(x - Math.floor(s / 2), dy - 1, s, 2);
  ctx.fillStyle = PAL.white;
  ctx.fillRect(x - Math.floor(s / 2), dy - 1, 1, 1);
}

export function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string = PAL.night2, edge: string = PAL.night3) {
  ctx.fillStyle = edge;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = fill;
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
}
