/**
 * Behind-the-disc putting view. A simple pinhole projection: the eye sits above the lie,
 * looking at the basket. Ground grid lines follow the terrain so slope is visible.
 */
import type { Vec2 } from '../sim/math';
import type { PuttPoint } from '../sim/putt';
import type { Terrain } from '../sim/terrain';
import { PAL } from './palette';
import { fillCircle } from './sprites';

export const HORIZON_Y = 104;
const EYE = 5; // ft
const FOCAL = 140; // px
const CX = 90;

export class PuttProjector {
  readonly f: Vec2;
  readonly r: Vec2;
  readonly base: number;
  readonly distance: number;
  readonly rise: number;

  constructor(
    readonly terrain: Terrain,
    readonly lie: Vec2,
    readonly basket: Vec2,
  ) {
    const dx = basket.x - lie.x;
    const dy = basket.y - lie.y;
    this.distance = Math.hypot(dx, dy) || 1;
    this.f = { x: dx / this.distance, y: dy / this.distance };
    // Right of the putting line, matching the flight model's convention.
    this.r = { x: this.f.y, y: -this.f.x };
    this.base = terrain.height(lie.x, lie.y);
    this.rise = terrain.height(basket.x, basket.y) - this.base;
  }

  /** Putt space (u right, v forward, h above the lie's ground) to world. */
  toWorld(u: number, v: number): Vec2 {
    return { x: this.lie.x + this.r.x * u + this.f.x * v, y: this.lie.y + this.r.y * u + this.f.y * v };
  }

  groundH(u: number, v: number): number {
    const w = this.toWorld(u, v);
    return this.terrain.height(w.x, w.y) - this.base;
  }

  project(u: number, v: number, h: number): { x: number; y: number; s: number } | null {
    if (v < 0.5) return null;
    const s = FOCAL / v;
    return { x: CX + u * s, y: HORIZON_Y + (EYE - h) * s, s };
  }

  /** Crosswind component (ft/s, + = toward the right of the line) from a world wind vector. */
  crosswind(w: Vec2): number {
    return w.x * this.r.x + w.y * this.r.y;
  }
}

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    ctx.fillRect(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), 1, 1);
  }
}

export function drawPuttScene(
  ctx: CanvasRenderingContext2D,
  p: PuttProjector,
  opts: { bottom: number; time: number; disc?: PuttPoint | null; discColor: string; flash: number; showHandDisc: boolean },
) {
  // Sky: dusk bands.
  const bands = [PAL.night1, PAL.night2, PAL.night3, PAL.dusk, PAL.haze];
  const bh = Math.ceil(HORIZON_Y / bands.length);
  bands.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(0, i * bh, 180, bh);
  });
  // Distant tree line.
  ctx.fillStyle = PAL.pine;
  for (let x = 0; x < 180; x++) {
    const h = 6 + Math.round(3 * Math.sin(x * 0.37) + 2 * Math.sin(x * 1.3 + 1) + Math.sin(x * 2.9));
    ctx.fillRect(x, HORIZON_Y - h, 1, h);
  }
  // Ground.
  ctx.fillStyle = PAL.grass;
  ctx.fillRect(0, HORIZON_Y, 180, opts.bottom - HORIZON_Y);

  // Grid: constant-v rows and constant-u columns, lifted by terrain height.
  const far = p.distance + 25;
  ctx.fillStyle = PAL.grassLight;
  for (let v = 3; v <= far; v += v < 20 ? 3 : 6) {
    let prev: { x: number; y: number } | null = null;
    for (let u = -40; u <= 40; u += 4) {
      const q = p.project(u, v, p.groundH(u, v));
      if (q && prev) line(ctx, prev.x, prev.y, q.x, q.y);
      prev = q;
    }
  }
  ctx.fillStyle = 'rgba(59,106,69,0.8)';
  for (let u = -24; u <= 24; u += 6) {
    let prev: { x: number; y: number } | null = null;
    for (let v = 2; v <= far; v += 2) {
      const q = p.project(u, v, p.groundH(u, v));
      if (q && prev) line(ctx, prev.x, prev.y, q.x, q.y);
      prev = q;
    }
  }

  // Trees and basket, far to near.
  const things: { v: number; draw: () => void }[] = [];
  for (const t of p.terrain.trees) {
    const du = (t.x - p.lie.x) * p.r.x + (t.y - p.lie.y) * p.r.y;
    const dv = (t.x - p.lie.x) * p.f.x + (t.y - p.lie.y) * p.f.y;
    if (dv < 2) continue;
    const gh = p.terrain.height(t.x, t.y) - p.base;
    const foot = p.project(du, dv, gh);
    if (!foot || foot.x < -60 || foot.x > 240) continue;
    things.push({
      v: dv,
      draw: () => {
        const s = foot.s;
        ctx.fillStyle = PAL.night2;
        ctx.fillRect(Math.round(foot.x - s * 0.6), Math.round(foot.y - s * 9), Math.max(1, Math.round(s * 1.2)), Math.round(s * 9));
        fillCircle(ctx, foot.x, foot.y - s * 14, t.r * s * 0.9, PAL.pine);
        fillCircle(ctx, foot.x - t.r * s * 0.25, foot.y - s * 15, t.r * s * 0.55, PAL.pineLight);
      },
    });
  }
  things.push({ v: p.distance, draw: () => drawBasket3d(ctx, p, opts.flash) });

  const disc = opts.disc;
  if (disc) {
    things.push({
      v: disc.v,
      draw: () => {
        const sh = p.project(disc.u, disc.v, p.groundH(disc.u, disc.v));
        const d = p.project(disc.u, disc.v, disc.h);
        if (!sh || !d) return;
        const w = Math.max(2, Math.round(d.s * 0.7));
        ctx.fillStyle = 'rgba(10,8,14,0.5)';
        ctx.fillRect(Math.round(sh.x - w / 2), Math.round(sh.y), w, Math.max(1, Math.round(w / 3)));
        ctx.fillStyle = PAL.night0;
        ctx.fillRect(Math.round(d.x - w / 2) - 1, Math.round(d.y) - 1, w + 2, Math.max(2, Math.round(w / 3)) + 2);
        ctx.fillStyle = opts.discColor;
        ctx.fillRect(Math.round(d.x - w / 2), Math.round(d.y), w, Math.max(1, Math.round(w / 3)));
      },
    });
  }
  things.sort((a, b) => b.v - a.v).forEach((t) => t.draw());

  // The disc in your hand.
  if (opts.showHandDisc) {
    const y = opts.bottom - 26 + Math.round(Math.sin(opts.time * 3));
    ctx.fillStyle = PAL.night0;
    ctx.fillRect(CX - 15, y - 1, 30, 10);
    ctx.fillStyle = opts.discColor;
    ctx.fillRect(CX - 14, y, 28, 8);
    ctx.fillStyle = PAL.white;
    ctx.fillRect(CX - 12, y + 1, 10, 1);
    ctx.fillStyle = 'rgba(13,11,19,0.35)';
    ctx.fillRect(CX - 14, y + 6, 28, 2);
  }
}

function drawBasket3d(ctx: CanvasRenderingContext2D, p: PuttProjector, flash: number) {
  const v = p.distance;
  const h0 = p.rise;
  const at = (u: number, h: number) => p.project(u, v, h0 + h)!;
  const rect = (u0: number, u1: number, hLo: number, hHi: number, color: string) => {
    const a = at(u0, hHi);
    const b = at(u1, hLo);
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(a.x), Math.round(a.y), Math.max(1, Math.round(b.x - a.x)), Math.max(1, Math.round(b.y - a.y)));
  };
  const s = at(0, 0).s;
  // Shadow.
  const g = at(0, 0);
  ctx.fillStyle = 'rgba(10,8,14,0.45)';
  ctx.fillRect(Math.round(g.x - s * 1.2), Math.round(g.y), Math.max(2, Math.round(s * 2.4)), Math.max(1, Math.round(s * 0.3)));
  rect(-0.06, 0.06, 0, 4.6, PAL.steel); // pole
  rect(-1.1, 1.1, 2.0, 2.6, PAL.steel); // tray
  rect(-1.1, 1.1, 2.55, 2.65, PAL.inkDim);
  // Chains: vertical strands.
  ctx.fillStyle = flash > 0 ? PAL.white : PAL.inkDim;
  const n = Math.max(3, Math.min(9, Math.round(s * 1.5)));
  for (let i = 0; i < n; i++) {
    const u = -0.85 + (1.7 * i) / (n - 1);
    const a = at(u, 4.4);
    const b = at(u * 0.4, 2.6);
    line(ctx, a.x, a.y, b.x, b.y);
  }
  rect(-1.0, 1.0, 4.4, 4.75, PAL.amber); // top band
}
