/**
 * Behind-the-disc putting view. A simple pinhole projection: the eye sits above the lie,
 * looking at the basket. Ground grid lines follow the terrain so slope is visible.
 */
import type { Vec2 } from '../sim/math';
import { type AnimPoint, BASKET, chainRadiusAt, type PuttHit } from './puttAnim';
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

export interface PuttSceneOpts {
  bottom: number;
  time: number;
  disc?: AnimPoint | null;
  discColor: string;
  flash: number;
  showHandDisc: boolean;
  /** What the disc struck, and how long ago (s), so the chains can swing. */
  hit?: PuttHit | null;
  hitAge?: number;
}

export function drawPuttScene(
  ctx: CanvasRenderingContext2D,
  p: PuttProjector,
  opts: PuttSceneOpts,
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
  const disc = opts.disc ?? null;
  const slot = disc ? discSlot(p, disc) : null;
  things.push({ v: p.distance, draw: () => drawBasket3d(ctx, p, opts, slot) });
  if (disc && (slot === 'front' || slot === 'behind')) {
    things.push({ v: slot === 'front' ? Math.min(disc.v, p.distance - 0.01) : Math.max(disc.v, p.distance + 0.01), draw: () => drawFlyingDisc(ctx, p, disc, opts.discColor, true) });
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


type Pt = { x: number; y: number };
type Slot = 'behind' | 'back' | 'mid' | 'tray' | 'front';

/** Where the disc sits relative to the basket's layers, so it can be drawn inside it. */
function discSlot(p: PuttProjector, d: AnimPoint): Slot {
  const hb = d.h - p.rise;
  const dv = d.v - p.distance;
  const r = Math.hypot(d.u, dv);
  const out: Slot = dv > 0 ? 'behind' : 'front';
  if (r > BASKET.trayR + 0.45 || hb > BASKET.capTop + 0.3) return out;
  if (hb >= BASKET.trayFloor - 0.1 && hb < BASKET.trayRim + 0.2 && r < BASKET.trayR) return dv > 0.05 ? 'back' : 'tray';
  if (hb > BASKET.chainBottom - 0.25 && r < chainRadiusAt(hb) + 0.12) return 'mid';
  return out;
}

/** Fill a convex outline, one row at a time (keeps hard pixel edges). */
function fillConvex(ctx: CanvasRenderingContext2D, pts: Pt[], color: string) {
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const q of pts) {
    y0 = Math.min(y0, q.y);
    y1 = Math.max(y1, q.y);
  }
  ctx.fillStyle = color;
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
    const yc = y + 0.5;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if ((a.y <= yc && b.y > yc) || (b.y <= yc && a.y > yc)) {
        const x = a.x + ((yc - a.y) / (b.y - a.y)) * (b.x - a.x);
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
    }
    if (hi >= lo) ctx.fillRect(Math.round(lo), y, Math.max(1, Math.round(hi) - Math.round(lo)), 1);
  }
  if (y1 - y0 < 1 && pts.length) {
    // Edge-on: a single row.
    let lo = Infinity;
    let hi = -Infinity;
    for (const q of pts) {
      lo = Math.min(lo, q.x);
      hi = Math.max(hi, q.x);
    }
    ctx.fillRect(Math.round(lo), Math.round(y0), Math.max(1, Math.round(hi - lo)), 1);
  }
}

/** Interpolated y of an arc (points sorted by x) at column x. */
function arcY(arc: Pt[], x: number): number {
  if (x <= arc[0].x) return arc[0].y;
  for (let i = 1; i < arc.length; i++) {
    if (arc[i].x >= x) {
      const a = arc[i - 1];
      const b = arc[i];
      return a.y + ((x - a.x) / Math.max(1e-6, b.x - a.x)) * (b.y - a.y);
    }
  }
  return arc[arc.length - 1].y;
}

/** Fill the band between two front-facing arcs (top above bottom), column by column. */
function fillBetween(ctx: CanvasRenderingContext2D, top: Pt[], bot: Pt[], color: string) {
  ctx.fillStyle = color;
  const x0 = Math.round(Math.min(top[0].x, bot[0].x));
  const x1 = Math.round(Math.max(top[top.length - 1].x, bot[bot.length - 1].x));
  for (let x = x0; x <= x1; x++) {
    const a = Math.round(arcY(top, x + 0.5));
    const b = Math.round(arcY(bot, x + 0.5));
    if (b >= a) ctx.fillRect(x, a, 1, b - a + 1);
  }
}

function plotArc(ctx: CanvasRenderingContext2D, arc: Pt[], color: string) {
  ctx.fillStyle = color;
  for (let i = 1; i < arc.length; i++) line(ctx, arc[i - 1].x, arc[i - 1].y, arc[i].x, arc[i].y);
}

/** A chain strand: alternating link colours so it reads as chain, not wire. */
function chainLine(ctx: CanvasRenderingContext2D, pts: Pt[], c1: string, c2: string) {
  let k = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const n = Math.max(1, Math.round(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y))));
    for (let j = i === 1 ? 0 : 1; j <= n; j++, k++) {
      ctx.fillStyle = (k >> 1) % 2 ? c2 : c1;
      ctx.fillRect(Math.round(a.x + ((b.x - a.x) * j) / n), Math.round(a.y + ((b.y - a.y) * j) / n), 1, 1);
    }
  }
}

function drawBasket3d(ctx: CanvasRenderingContext2D, p: PuttProjector, o: PuttSceneOpts, slot: Slot | null) {
  const D = p.distance;
  const P = (u: number, dv: number, h: number) => p.project(u, D + dv, p.rise + h)!;
  const s = P(0, 0, 0).s;
  const B = BASKET;
  const ring = (r: number, h: number, a0: number, a1: number, n = 24): Pt[] => {
    const out: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      out.push(P(r * Math.cos(a), r * Math.sin(a), h));
    }
    return out;
  };
  // Front arcs run left to right (angle pi..2pi, the near side); back arcs run left to right too (pi..0).
  const front = (r: number, h: number) => ring(r, h, Math.PI, Math.PI * 2);
  const back = (r: number, h: number) => ring(r, h, Math.PI, 0);
  const full = (r: number, h: number) => ring(r, h, 0, Math.PI * 2, 32);
  const vRect = (h0: number, h1: number, r: number, color: string) => {
    const a = P(0, 0, h1);
    const b = P(0, 0, h0);
    const w = Math.max(1, Math.round(2 * r * s));
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(a.x - w / 2), Math.round(a.y), w, Math.max(1, Math.round(b.y - a.y)));
  };
  const pole = (h0: number, h1: number) => {
    vRect(h0, h1, B.poleR, PAL.steel);
    if (s > 9) vRect(h0, h1, B.poleR * 0.35, PAL.white);
  };
  const discHere = (want: Slot) => {
    if (o.disc && slot === want) drawFlyingDisc(ctx, p, o.disc, o.discColor, false);
  };

  // Ground shadow and the pole's foot.
  fillConvex(ctx, full(B.trayR * 0.9, 0), 'rgba(10,8,14,0.4)');
  pole(0, B.trayFloor);

  // Tray: the dark inside, the floor pan, and the wire wall seen across the opening.
  const floorR = B.trayR - 0.08;
  fillConvex(ctx, full(B.trayR, B.trayRim), PAL.night2);
  fillConvex(ctx, full(floorR, B.trayFloor), PAL.night3);
  fillBetween(ctx, front(B.trayR, B.trayRim), front(floorR, B.trayFloor), PAL.night2);
  // Far wall's wires, seen through the opening.
  const nBars = Math.max(5, Math.min(16, Math.round(s * 1.1)));
  ctx.fillStyle = PAL.dusk;
  for (let i = 1; i < nBars; i++) {
    const a = Math.PI - (Math.PI * i) / nBars;
    const top = P(B.trayR * Math.cos(a), B.trayR * Math.sin(a), B.trayRim);
    const bot = P(floorR * Math.cos(a), floorR * Math.sin(a), B.trayFloor);
    line(ctx, top.x, top.y, bot.x, bot.y);
  }
  plotArc(ctx, back(B.trayR, B.trayRim), PAL.haze);
  discHere('back');

  // Chains: an outer and an inner ring of strands, hanging from the band to the collar.
  const strands: { a: number; rTop: number; rBot: number; hTop: number; inner: boolean }[] = [];
  const nOuter = s < 4 ? 8 : s < 8 ? 12 : 16;
  for (let i = 0; i < nOuter; i++) strands.push({ a: ((i + 0.5) / nOuter) * Math.PI * 2, rTop: B.chainTopR, rBot: B.chainBottomR, hTop: B.chainTop, inner: false });
  if (s >= 5) {
    const nInner = nOuter / 2;
    for (let i = 0; i < nInner; i++) strands.push({ a: (i / nInner) * Math.PI * 2, rTop: B.chainTopR * 0.55, rBot: B.chainBottomR * 0.8, hTop: B.chainTop - 0.08, inner: true });
  }
  const hit = o.hit;
  const age = o.hitAge ?? -1;
  const swing = hit && age >= 0 ? hit.force * Math.exp(-age * 2.6) : 0;
  const strandPts = (st: (typeof strands)[number], idx: number): Pt[] => {
    const cu = Math.cos(st.a);
    const sv = Math.sin(st.a);
    // How hard this strand was struck: the ones nearest the impact, on the near side, swing most.
    let w = 0;
    if (swing > 0.01 && hit) {
      const du = st.rTop * cu - hit.u;
      w = Math.exp(-(du * du) / 0.3) * (sv < 0 ? 1 : st.inner ? 0.7 : 0.45);
    }
    const out: Pt[] = [];
    const n = 7;
    for (let j = 0; j <= n; j++) {
      const f = j / n;
      const h = lerpN(st.hTop, B.chainBottom, f);
      // Chains bow outward a little as they hang.
      const r = lerpN(st.rTop, st.rBot, f) + 0.07 * Math.sin(Math.PI * f) * (st.inner ? 0.5 : 1);
      let u = r * cu + 0.012 * Math.sin(o.time * 1.7 + idx * 1.3) * Math.sin(Math.PI * f);
      let dv = r * sv;
      if (w > 0 && hit) {
        // Pushed back (away from the putter) around the impact height, then swinging back and forth.
        const prof = Math.sin(Math.PI * f) * Math.exp(-((h - hit.h) ** 2) / 1.2);
        const sw = swing * w * prof * Math.cos(age * 12);
        dv += 0.45 * sw;
        u += 0.15 * sw * Math.sign(r * cu - hit.u || 1);
      }
      out.push(P(u, dv, h));
    }
    return out;
  };
  const glint = o.flash > 0;
  const backFirst = strands.map((st, i) => ({ st, i })).sort((a, b) => Math.sin(b.st.a) - Math.sin(a.st.a));
  for (const { st, i } of backFirst) {
    // The inner ring sits behind a disc caught in the outer chains, so all of it goes first.
    if (Math.sin(st.a) < 0 && !st.inner) continue;
    const near = Math.sin(st.a) < 0;
    chainLine(ctx, strandPts(st, i), near ? PAL.inkDim : st.inner ? PAL.dusk : PAL.haze, near ? PAL.haze : PAL.dusk);
  }

  // Band (inside face) and the pole through the middle.
  fillConvex(ctx, full(B.bandR, B.bandHi), PAL.sandDark);
  fillConvex(ctx, full(B.bandR - 0.06, B.bandHi), PAL.night3);
  pole(B.trayFloor, B.capTop - 0.05);
  // Collar where the chains gather.
  fillConvex(ctx, full(B.chainBottomR + 0.04, B.chainBottom + 0.04), PAL.inkDim);
  discHere('mid');

  for (const { st, i } of backFirst) {
    if (Math.sin(st.a) >= 0 || st.inner) continue;
    const lit = glint && (i + Math.floor(o.flash * 18)) % 3 === 0;
    chainLine(ctx, strandPts(st, i), lit ? PAL.white : PAL.steel, PAL.inkDim);
  }
  discHere('tray');

  // Tray front: wire bars with gaps (a disc inside shows through), solid rim and bottom lip.
  const rimF = front(B.trayR, B.trayRim);
  const floorF = front(floorR, B.trayFloor);
  ctx.fillStyle = PAL.steel;
  for (let i = 0; i <= nBars; i++) {
    const a = Math.PI + (Math.PI * i) / nBars;
    const top = P(B.trayR * Math.cos(a), B.trayR * Math.sin(a), B.trayRim);
    const bot = P(floorR * Math.cos(a), floorR * Math.sin(a), B.trayFloor);
    line(ctx, top.x, top.y, bot.x, bot.y);
  }
  const lip = front(floorR, B.trayFloor + 0.1);
  fillBetween(ctx, lip, floorF, PAL.haze);
  const rimLo = front(B.trayR, B.trayRim - 0.1);
  fillBetween(ctx, rimF, rimLo, PAL.steel);
  plotArc(ctx, rimF, PAL.white);

  // Band front (the bright painted ring) and the cap.
  fillBetween(ctx, front(B.bandR, B.bandHi), front(B.bandR, B.bandLo), PAL.amber);
  plotArc(ctx, front(B.bandR, B.bandHi), PAL.ink);
  plotArc(ctx, back(B.bandR, B.bandHi), PAL.amber);
  const cap = P(0, 0, B.capTop);
  const cw = Math.max(2, Math.round(0.36 * s));
  ctx.fillStyle = PAL.steel;
  ctx.fillRect(Math.round(cap.x - cw / 2), Math.round(cap.y), cw, Math.max(1, Math.round(0.12 * s)));
  discHere('front');
}

const lerpN = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The disc as a small ellipse: seen from above in flight, tipping up as it tumbles through the
 * chains or leans in the tray.
 */
function drawFlyingDisc(ctx: CanvasRenderingContext2D, p: PuttProjector, d: AnimPoint, color: string, shadow: boolean) {
  const c = p.project(d.u, d.v, d.h);
  if (!c) return;
  const w = Math.max(2, 2 * BASKET.discR * c.s);
  const view = Math.max(0.12, (EYE - d.h) / Math.max(1, d.v)); // how much of the top we see
  const ratio = Math.min(0.62, view + (d.tilt ?? 0) * 0.7);
  const hgt = Math.max(1, w * ratio);
  if (shadow) {
    const sh = p.project(d.u, d.v, p.groundH(d.u, d.v));
    if (sh && sh.y > c.y + 1) {
      ctx.fillStyle = 'rgba(10,8,14,0.5)';
      const sw = Math.max(2, Math.round(w * 0.9));
      ctx.fillRect(Math.round(sh.x - sw / 2), Math.round(sh.y), sw, Math.max(1, Math.round(sw / 4)));
    }
  }
  const ell = (rx: number, ry: number, color: string) => {
    ctx.fillStyle = color;
    const n = Math.max(1, Math.round(ry * 2));
    for (let i = 0; i < n; i++) {
      const yy = -ry + (i + 0.5) * ((2 * ry) / n);
      const half = rx * Math.sqrt(Math.max(0, 1 - (yy / ry) ** 2));
      ctx.fillRect(Math.round(c.x - half), Math.round(c.y + yy), Math.max(1, Math.round(half * 2)), 1);
    }
  };
  ell(w / 2 + 1, hgt / 2 + 1, PAL.night0);
  ell(w / 2, hgt / 2, color);
  if (w >= 5) {
    ctx.fillStyle = PAL.white;
    ctx.fillRect(Math.round(c.x - w / 4), Math.round(c.y - hgt / 2), Math.max(1, Math.round(w / 4)), 1);
  }
}
