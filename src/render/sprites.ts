/** Sprites drawn from code, in the League Night palette. */
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

export function fillEllipse(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, color: string) {
  ctx.fillStyle = color;
  const RY = Math.max(0.5, ry);
  for (let dy = -Math.ceil(RY); dy <= Math.ceil(RY); dy++) {
    const half = rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (RY * RY)));
    if (half <= 0) continue;
    ctx.fillRect(Math.round(cx - half), Math.round(cy + dy), Math.max(1, Math.round(half * 2)), 1);
  }
}

/** Scanline fill of a convex polygon given in screen pixels. */
export function fillPoly(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], color: string) {
  ctx.fillStyle = color;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  for (let y = Math.round(y0); y <= Math.round(y1); y++) {
    let xl = Infinity;
    let xr = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if ((y + 0.5 - a.y) * (y + 0.5 - b.y) > 0 || a.y === b.y) continue;
      const x = a.x + ((y + 0.5 - a.y) / (b.y - a.y)) * (b.x - a.x);
      xl = Math.min(xl, x);
      xr = Math.max(xr, x);
    }
    if (xr >= xl) ctx.fillRect(Math.round(xl), y, Math.max(1, Math.round(xr - xl)), 1);
  }
}

/** One cone tier of a pine: lit on the left, shaded on the right, with a dark outline. */
function pineTier(ctx: CanvasRenderingContext2D, cx: number, top: number, bottom: number, half: number) {
  const h = Math.max(1, bottom - top);
  for (let y = Math.round(top); y <= Math.round(bottom); y++) {
    const f = Math.min(1, Math.max(0, (y - top) / h));
    const w = Math.max(0.5, half * f);
    const l = Math.round(cx - w);
    const r = Math.round(cx + w);
    ctx.fillStyle = PAL.night0;
    ctx.fillRect(l - 1, y, r - l + 2, 1);
    ctx.fillStyle = PAL.pineLight;
    ctx.fillRect(l, y, Math.max(1, r - l), 1);
    const lit = Math.round((r - l) * 0.4);
    if (lit > 0) {
      ctx.fillStyle = PAL.grassLight;
      ctx.fillRect(l, y, lit, 1);
    }
    const shade = Math.round((r - l) * 0.3);
    if (shade > 0) {
      ctx.fillStyle = PAL.pine;
      ctx.fillRect(r - shade, y, shade, 1);
    }
  }
}

/**
 * A standing tree. (sx, sy) is the trunk base on screen, rPx the canopy radius in pixels,
 * hPx the tree height in pixels. `kind` 0 = pine, 1 = round leafy tree.
 */
export function drawTree(ctx: CanvasRenderingContext2D, sx: number, sy: number, rPx: number, hPx: number, kind = 0, flatten = 0.6) {
  const r = Math.max(1.5, rPx);
  const H = Math.max(hPx, r * 1.5);
  // Long evening shadow falling toward the camera's right.
  fillEllipse(ctx, sx + r * 0.7, sy + r * flatten * 0.25, r * 1.25, Math.max(1, r * flatten * 0.75), 'rgba(10,8,14,0.42)');
  const trunkW = Math.max(1, Math.round(r * 0.22));
  const trunkTop = sy - H * 0.38;
  ctx.fillStyle = PAL.night0;
  ctx.fillRect(Math.round(sx - trunkW / 2) - 1, Math.round(trunkTop), trunkW + 2, Math.round(sy - trunkTop) + 1);
  ctx.fillStyle = PAL.night3;
  ctx.fillRect(Math.round(sx - trunkW / 2), Math.round(trunkTop), trunkW, Math.round(sy - trunkTop));
  if (kind === 0) {
    const top = sy - H;
    const base = sy - H * 0.22;
    const span = base - top;
    pineTier(ctx, sx, top, top + span * 0.45, r * 0.7);
    pineTier(ctx, sx, top + span * 0.22, top + span * 0.75, r * 0.95);
    pineTier(ctx, sx, top + span * 0.45, base, r * 1.15);
  } else {
    const cy = sy - H * 0.62;
    const ry = Math.max(r * 0.85, H * 0.4);
    fillEllipse(ctx, sx, cy, r + 1, ry + 1, PAL.night0);
    fillEllipse(ctx, sx, cy, r, ry, PAL.grassDark);
    fillEllipse(ctx, sx - r * 0.2, cy - ry * 0.2, r * 0.72, ry * 0.7, PAL.rough);
    fillEllipse(ctx, sx - r * 0.38, cy - ry * 0.4, Math.max(1, r * 0.3), Math.max(1, ry * 0.28), PAL.grassLight);
  }
}

/** Basket: shadow, pole, tray, chains, lit band. (sx, sy) is the base. sc is a whole-pixel scale. */
export function drawBasket(ctx: CanvasRenderingContext2D, sx: number, sy: number, flash = 0, sc = 1, glow = true) {
  const x = Math.round(sx);
  const y = Math.round(sy);
  const R = (dx: number, dy: number, w: number, h: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(x + dx * sc, y + dy * sc, w * sc, h * sc);
  };
  if (glow) {
    fillCircle(ctx, x + 0.5 * sc, y - 10 * sc, 9 * sc, 'rgba(242,181,68,0.10)');
    fillCircle(ctx, x + 0.5 * sc, y - 10 * sc, 5 * sc, 'rgba(242,181,68,0.14)');
  }
  fillEllipse(ctx, x + 2 * sc, y, 4 * sc, 1.2 * sc, 'rgba(10,8,14,0.5)');
  R(0, -10, 1, 10, PAL.steel);
  R(-4, -5, 9, 1, PAL.night0);
  R(-3, -6, 7, 2, PAL.steel);
  R(-3, -4, 7, 1, PAL.inkDim);
  const chain = flash > 0 ? PAL.white : PAL.inkDim;
  R(-2, -9, 1, 3, chain);
  R(2, -9, 1, 3, chain);
  R(-1, -9, 1, 3, PAL.steel);
  R(1, -9, 1, 3, PAL.steel);
  R(-4, -12, 9, 3, PAL.night0);
  R(-3, -11, 7, 1, PAL.amber);
  R(-3, -10, 7, 1, '#c98a2c');
}

/** Tee pad as a projected quad with a lip. `corners` go round the pad in screen pixels. */
export function drawTeePad(ctx: CanvasRenderingContext2D, corners: { x: number; y: number }[]) {
  fillPoly(ctx, corners.map((p) => ({ x: p.x + 1, y: p.y + 1 })), PAL.night0);
  fillPoly(ctx, corners.map((p) => ({ x: p.x, y: p.y + 1 })), PAL.dusk);
  fillPoly(ctx, corners, PAL.haze);
}

/**
 * Disc: shadow on the ground at (gx, gy), disc lifted altPx above it.
 * airX moves the disc sideways from its shadow (perspective); defaults to gx.
 */
export function drawDisc(ctx: CanvasRenderingContext2D, gx: number, gy: number, altPx: number, color: string, scale = 1, airX = gx) {
  const x = Math.round(gx);
  const y = Math.round(gy);
  const shadowW = altPx > 2 ? 3 : 5;
  ctx.fillStyle = 'rgba(10,8,14,0.55)';
  ctx.fillRect(x - (shadowW >> 1), y - 1, shadowW, 2);
  const s = Math.round(3 + Math.min(2, Math.max(0, scale - 1)));
  const ax = Math.round(airX);
  const dy = Math.round(y - altPx);
  ctx.fillStyle = PAL.night0;
  ctx.fillRect(ax - Math.floor(s / 2) - 1, dy - 1, s + 2, 3);
  ctx.fillStyle = color;
  ctx.fillRect(ax - Math.floor(s / 2), dy - 1, s, 2);
  ctx.fillStyle = PAL.white;
  ctx.fillRect(ax - Math.floor(s / 2), dy - 1, 1, 1);
}

export function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string = PAL.night2, edge: string = PAL.night3) {
  ctx.fillStyle = edge;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = fill;
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
}
