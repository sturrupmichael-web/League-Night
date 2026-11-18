// Builds course JSON from short hole designs: a fairway line from tee to basket, plus water,
// sand, OB, hills and trees described along that line. Deterministic (seeded), so running it
// again gives the same holes. Lantern Park's front nine was drawn by hand and is kept as is.
//
//   node scripts/make-courses.mjs
import fs from 'node:fs';

const OUT = new URL('../src/content/courses/', import.meta.url);

// ---------- helpers ----------
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r1 = (n) => Math.round(n * 10) / 10;

/** A polyline with lookups by fraction of its length. */
function line(pts) {
  const segs = [];
  let L = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const l = Math.hypot(bx - ax, by - ay);
    segs.push({ ax, ay, bx, by, l, s: L });
    L += l;
  }
  const at = (t) => {
    // Past either end, keep going along the end segment (for sand behind a green, etc.).
    if (t > 1 || t < 0) {
      const e = at(t > 1 ? 1 : 0);
      const k = (t > 1 ? t - 1 : t) * L;
      return { ...e, x: e.x + e.tx * k, y: e.y + e.ty * k };
    }
    const d = t * L;
    const s = segs.find((g) => d <= g.s + g.l) ?? segs[segs.length - 1];
    const f = s.l ? (d - s.s) / s.l : 0;
    const tx = (s.bx - s.ax) / s.l;
    const ty = (s.by - s.ay) / s.l;
    // Left-hand normal (facing down the fairway).
    return { x: s.ax + (s.bx - s.ax) * f, y: s.ay + (s.by - s.ay) * f, tx, ty, nx: -ty, ny: tx };
  };
  const distTo = (x, y) => {
    let best = Infinity;
    for (const g of segs) {
      const vx = g.bx - g.ax;
      const vy = g.by - g.ay;
      const f = Math.max(0, Math.min(1, ((x - g.ax) * vx + (y - g.ay) * vy) / (g.l * g.l)));
      best = Math.min(best, Math.hypot(x - g.ax - vx * f, y - g.ay - vy * f));
    }
    return best;
  };
  return { L, at, distTo };
}

function blob(cx, cy, r, rand, n = 14, wob = 0.18, sx = 1, sy = 1) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + (rand() * 2 - 1) * wob;
    out.push([r1(cx + Math.cos(a) * r * k * sx), r1(cy + Math.sin(a) * r * k * sy)]);
  }
  return out;
}

function inPoly(x, y, poly) {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}

// ---------- one hole ----------
/**
 * d = {
 *   id, name, par, note, wind: [lo, hi], seed,
 *   path: [[x, y], ...]            tee first, basket last
 *   width: 44 | [w0, w1]            fairway width (ft), optionally tapering
 *   cross: [{ t, depth, surface }]  a band of water/sand across the line at fraction t
 *   ponds: [{ t, side, off, r, surface, sx, sy }]  side: +1 left, -1 right
 *   sides: [{ side, off, from, to, surface }]       everything beyond `off` on that side
 *   sand: [{ t, side, off, r }]
 *   hills: [[t, side, off, r, h]]   gaussian bumps placed along the line
 *   slope: ft of rise per 100 ft toward the basket
 *   roll: amplitude of gentle undulation (ft)
 *   trees: { density, rMin, rMax, margin }  scattered off the fairway
 *   gates: [[t, side, off, r]]      trees placed on purpose
 *   green: 24                       green radius
 * }
 */
function makeHole(d, theme) {
  const rand = rng(d.seed ?? d.id * 7919 + theme.key.length * 31);
  const P = line(d.path);
  const tee = d.path[0];
  const basket = d.path[d.path.length - 1];
  const w = (t) => (Array.isArray(d.width) ? d.width[0] + (d.width[1] - d.width[0]) * t : d.width ?? 44);

  // Bounds: the line's box plus a margin.
  const xs = d.path.map((p) => p[0]);
  const ys = d.path.map((p) => p[1]);
  const m = d.margin ?? 100;
  const x0 = Math.floor((Math.min(...xs) - m) / 10) * 10;
  const x1 = Math.ceil((Math.max(...xs) + m) / 10) * 10;
  const y0 = Math.min(...ys) - 50;
  const y1 = Math.ceil((Math.max(...ys) + 70) / 10) * 10;
  const bounds = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

  // Fairway: offset both sides of the line, starting a little behind the tee.
  const left = [];
  const right = [];
  const N = Math.max(8, Math.round(P.L / 15));
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const p = P.at(t);
    const hw = w(t) / 2 * (1 + (rand() * 2 - 1) * 0.08);
    const back = i === 0 ? 20 : 0;
    left.push([r1(p.x + p.nx * hw - p.tx * back), r1(p.y + p.ny * hw - p.ty * back)]);
    right.push([r1(p.x - p.nx * hw - p.tx * back), r1(p.y - p.ny * hw - p.ty * back)]);
  }
  const fairway = [[...left, ...right.reverse()]];

  const green = [blob(basket[0], basket[1], d.green ?? 24, rand, 12, 0.1)];
  const water = [];
  const sand = [];
  const ob = [];
  const add = (surface, poly) => (surface === 'sand' ? sand : surface === 'ob' ? ob : water).push(poly);

  for (const c of d.cross ?? []) {
    const p = P.at(c.t);
    const half = (c.depth ?? 30) / 2;
    const span = 900;
    const poly = [];
    const n = 10;
    for (let i = 0; i <= n; i++) {
      const s = -span + (2 * span * i) / n;
      const k = half * (1 + (rand() * 2 - 1) * 0.25);
      poly.push([r1(p.x + p.nx * s + p.tx * k), r1(p.y + p.ny * s + p.ty * k)]);
    }
    for (let i = n; i >= 0; i--) {
      const s = -span + (2 * span * i) / n;
      const k = half * (1 + (rand() * 2 - 1) * 0.25);
      poly.push([r1(p.x + p.nx * s - p.tx * k), r1(p.y + p.ny * s - p.ty * k)]);
    }
    add(c.surface ?? 'water', poly);
  }
  for (const s of d.sides ?? []) {
    const poly = [];
    const from = s.from ?? -0.15;
    const to = s.to ?? 1.15;
    const n = 14;
    const near = [];
    for (let i = 0; i <= n; i++) {
      const t = from + ((to - from) * i) / n;
      const p = P.at(t);
      // Extend past the ends of the line so the edge runs off the map.
      const ext = t < 0 ? t * P.L : t > 1 ? (t - 1) * P.L : 0;
      const off = s.off * (1 + (rand() * 2 - 1) * 0.06);
      near.push([r1(p.x + p.tx * ext + p.nx * off * s.side), r1(p.y + p.ty * ext + p.ny * off * s.side)]);
    }
    for (const q of near) poly.push(q);
    for (let i = n; i >= 0; i--) {
      const t = from + ((to - from) * i) / n;
      const p = P.at(t);
      const ext = t < 0 ? t * P.L : t > 1 ? (t - 1) * P.L : 0;
      poly.push([r1(p.x + p.tx * ext + p.nx * 1200 * s.side), r1(p.y + p.ty * ext + p.ny * 1200 * s.side)]);
    }
    add(s.surface ?? 'ob', poly);
  }
  for (const pd of d.ponds ?? []) {
    const p = P.at(pd.t);
    add(pd.surface ?? 'water', blob(p.x + p.nx * (pd.off ?? 0) * (pd.side ?? 1), p.y + p.ny * (pd.off ?? 0) * (pd.side ?? 1), pd.r, rand, 16, 0.2, pd.sx ?? 1, pd.sy ?? 1));
  }
  for (const sd of d.sand ?? []) {
    const p = P.at(sd.t);
    add('sand', blob(p.x + p.nx * (sd.off ?? 0) * (sd.side ?? 1), p.y + p.ny * (sd.off ?? 0) * (sd.side ?? 1), sd.r ?? 14, rand, 12, 0.25, sd.sx ?? 1, sd.sy ?? 1));
  }

  // Heightmap.
  const cell = 20;
  const hw = Math.ceil((x1 - x0) / cell) + 1;
  const hh = Math.ceil((y1 - y0) / cell) + 1;
  const hills = (d.hills ?? []).map(([t, side, off, r, h]) => {
    const p = P.at(t);
    return { x: p.x + p.nx * off * side, y: p.y + p.ny * off * side, r, h };
  });
  const phase = rand() * 10;
  const data = [];
  for (let j = 0; j < hh; j++) {
    for (let i = 0; i < hw; i++) {
      const x = x0 + i * cell;
      const y = y0 + j * cell;
      let z = ((d.slope ?? 0) * (y - tee[1])) / 100;
      for (const k of hills) z += k.h * Math.exp(-((x - k.x) ** 2 + (y - k.y) ** 2) / (k.r * k.r));
      z += (d.roll ?? 0.6) * Math.sin(x / 70 + phase) * Math.cos(y / 90 + phase * 0.7);
      data.push(r1(z));
    }
  }

  // Trees.
  const trees = [];
  const tr = d.trees ?? theme.trees;
  const area = (x1 - x0) * (y1 - y0);
  const tries = Math.round((area / 10000) * (tr.density ?? 1) * 3);
  const blocked = [...water, ...sand];
  const clear = (x, y, r) =>
    Math.hypot(x - tee[0], y - tee[1]) > 40 &&
    Math.hypot(x - basket[0], y - basket[1]) > 40 &&
    !blocked.some((p) => inPoly(x, y, p)) &&
    !ob.some((p) => inPoly(x, y, p)) &&
    trees.every((o) => Math.hypot(o.x - x, o.y - y) > o.r + r + 4);
  for (const [t, side, off, r] of d.gates ?? []) {
    const p = P.at(t);
    trees.push({ x: r1(p.x + p.nx * off * side), y: r1(p.y + p.ny * off * side), r });
  }
  for (let k = 0; k < tries; k++) {
    const x = x0 + rand() * (x1 - x0);
    const y = y0 + rand() * (y1 - y0);
    const r = r1((tr.rMin ?? 7) + rand() * ((tr.rMax ?? 12) - (tr.rMin ?? 7)));
    const t = P.distTo(x, y);
    // Fewer trees right at the fairway edge than further out.
    const edge = t - w(0.5) / 2 - (tr.margin ?? 10) - r;
    if (edge < 0) continue;
    if (rand() > Math.min(1, 0.35 + edge / 60)) continue;
    if (clear(x, y, r)) trees.push({ x: r1(x), y: r1(y), r });
  }

  const lengthFt = Math.round(P.L / 5) * 5;
  const hole = {
    id: d.id,
    name: d.name,
    par: d.par,
    lengthFt,
    tee,
    basket,
    bounds,
    fairway,
    green,
    ...(sand.length ? { sand } : {}),
    ...(water.length ? { water } : {}),
    ...(ob.length ? { ob } : {}),
    trees,
    heightmap: { cellFt: cell, w: hw, h: hh, originX: x0, originY: y0, data },
    windRange: d.wind ?? theme.wind,
    note: d.note,
  };
  return hole;
}

const THEMES = {
  park: { trees: { density: 1.1, rMin: 7, rMax: 12 }, wind: [0, 12] },
  lake: { trees: { density: 1.8, rMin: 7, rMax: 13 }, wind: [2, 16] },
  desert: { trees: { density: 0.45, rMin: 4, rMax: 8, margin: 14 }, wind: [4, 20] },
};

// ---------- Lantern Park: back nine ----------
const lanternBack = [
  { id: 10, name: 'SECOND SHIFT', par: 3, path: [[0, 0], [10, 120], [40, 215]], width: 40, sand: [{ t: 0.93, side: 1, off: 34, r: 13 }], slope: 0.5, note: 'SAND LEFT OF THE PIN' },
  { id: 11, name: 'POTLUCK', par: 4, path: [[0, 0], [0, 230], [-140, 360]], width: 46, gates: [[0.62, 1, 55, 11], [0.55, 1, 75, 12], [0.68, 1, 85, 10]], ponds: [{ t: 0.55, side: -1, off: 70, r: 36 }], note: 'DOGLEG LEFT · POND RIGHT' },
  { id: 12, name: 'TIEBREAKER', par: 3, path: [[0, 0], [0, 255]], width: 40, cross: [{ t: 0.5, depth: 36 }], slope: -2.4, note: 'DOWNHILL OVER THE CREEK' },
  { id: 13, name: 'STREETLIGHTS', par: 4, path: [[0, 0], [10, 200], [-10, 410]], width: 44, sides: [{ side: -1, off: 60 }], trees: { density: 1.6, rMin: 7, rMax: 12 }, note: 'ROAD RIGHT IS OB' },
  { id: 14, name: 'RAIN DATE', par: 3, path: [[0, 0], [-20, 185]], width: 38, cross: [{ t: 0.38, depth: 28 }], gates: [[0.8, -1, 6, 6]], ponds: [{ t: 0.95, side: 1, off: 50, r: 20 }], slope: 1.2, note: 'OVER THE CREEK · POND LEFT' },
  { id: 15, name: 'BENCH WARMER', par: 4, path: [[0, 0], [40, 130], [10, 260], [50, 365]], width: 42, gates: [[0.35, -1, 34, 10], [0.6, 1, 32, 10]], note: 'S-BEND THROUGH THE GATES' },
  { id: 16, name: 'FLASHLIGHT', par: 3, path: [[0, 0], [0, 225]], width: 30, trees: { density: 3.2, rMin: 7, rMax: 11, margin: 2 }, note: 'TUNNEL SHOT · KEEP IT FLAT' },
  { id: 17, name: 'LONG DRIVE HOME', par: 5, path: [[0, 0], [0, 210], [120, 360], [110, 590]], width: 50, cross: [{ t: 0.3, depth: 34 }], sides: [{ side: 1, off: 70, from: 0.55, to: 1.15 }], hills: [[0.5, 1, 80, 90, 6]], note: 'CREEK EARLY · OB LEFT LATE' },
  { id: 18, name: 'CLUBHOUSE', par: 4, path: [[0, 0], [0, 200], [-50, 375]], width: 46, ponds: [{ t: 0.9, side: -1, off: 45, r: 28 }], sand: [{ t: 1.06, side: 1, off: 0, r: 16, sx: 1.6 }], note: 'WATER SHORT RIGHT OF THE PIN' },
];

// ---------- Loon Lake ----------
const loon = [
  { id: 1, name: 'DOCK DAY', par: 3, path: [[0, 0], [15, 220]], width: 40, cross: [{ t: 0.45, depth: 60 }], note: 'OVER THE INLET' },
  { id: 2, name: 'PORTAGE', par: 4, path: [[0, 0], [20, 200], [-10, 405]], width: 46, sides: [{ side: -1, off: 55, surface: 'water' }], note: 'LAKE ALL DOWN THE RIGHT' },
  { id: 3, name: 'LOON CALL', par: 3, path: [[0, 0], [0, 180]], width: 30, gates: [[0.82, 1, 5, 6]], trees: { density: 3.5, rMin: 7, rMax: 12, margin: 2 }, note: 'PINE TUNNEL' },
  { id: 4, name: 'BIRCH BEND', par: 4, path: [[0, 0], [0, 200], [130, 320]], width: 44, ponds: [{ t: 0.6, side: -1, off: 0, r: 40 }], note: 'DOGLEG RIGHT AROUND THE POND' },
  { id: 5, name: 'FIRE TOWER', par: 3, path: [[0, 0], [-15, 265]], width: 42, slope: 4, note: 'STRAIGHT UP THE HILL' },
  { id: 6, name: 'CANOE CARRY', par: 4, path: [[0, 0], [10, 230], [40, 440]], width: 46, cross: [{ t: 0.22, depth: 30 }, { t: 0.7, depth: 34 }], note: 'TWO CROSSINGS' },
  { id: 7, name: 'MOSQUITO HOLLOW', par: 3, path: [[0, 0], [0, 215]], width: 38, slope: -4, sand: [{ t: 1.17, side: 1, off: 0, r: 13, sx: 1.8 }], note: 'DOWN INTO THE HOLLOW' },
  { id: 8, name: 'THE NARROWS', par: 4, path: [[0, 0], [-15, 200], [10, 400]], width: 40, sides: [{ side: 1, off: 50, surface: 'water' }], trees: { density: 2.6, rMin: 7, rMax: 12 }, note: 'WATER LEFT · PINES RIGHT' },
  { id: 9, name: 'LAKE EFFECT', par: 5, path: [[0, 0], [30, 280], [-20, 565]], width: 52, sides: [{ side: -1, off: 70, surface: 'water' }], wind: [8, 20], note: 'ALONG THE SHORE · WINDY' },
  { id: 10, name: 'SANDBAR', par: 3, path: [[0, 0], [-20, 240]], width: 40, ponds: [{ t: 0.85, side: 1, off: 55, r: 34 }], sand: [{ t: 0.97, side: 1, off: 24, r: 12 }], note: 'WATER LEFT OF THE PIN' },
  { id: 11, name: 'DRIFTWOOD', par: 4, path: [[0, 0], [0, 370]], width: 44, gates: [[0.35, 1, 14, 9], [0.55, -1, 14, 9], [0.75, 1, 12, 8]], note: 'THREE TREES IN THE WAY' },
  { id: 12, name: 'NORTHERN LIGHTS', par: 3, path: [[0, 0], [25, 200]], width: 40, slope: -5, ponds: [{ t: 0.92, side: -1, off: 40, r: 26 }], note: 'BIG DROP · WATER RIGHT' },
  { id: 13, name: 'TOWLINE', par: 4, path: [[0, 0], [0, 240], [-120, 400]], width: 44, sides: [{ side: 1, off: 75, from: 0.35, to: 1.15, surface: 'water' }], note: 'DOGLEG LEFT ALONG THE SHORE' },
  { id: 14, name: 'OLD GROWTH', par: 3, path: [[0, 0], [10, 260]], width: 34, trees: { density: 3, rMin: 9, rMax: 14, margin: 3 }, note: 'BIG TREES · SMALL GAPS' },
  { id: 15, name: 'LONG PADDLE', par: 5, path: [[0, 0], [0, 250], [-60, 420], [-40, 600]], width: 52, cross: [{ t: 0.3, depth: 40 }], sides: [{ side: -1, off: 80, surface: 'water', from: 0.5 }], gates: [[0.64, 1, 8, 10], [0.7, -1, 20, 9]], note: 'CROSS EARLY · LAKE RIGHT LATE' },
  { id: 16, name: 'BOATHOUSE', par: 3, path: [[0, 0], [0, 190]], width: 40, cross: [{ t: 0.45, depth: 34 }], note: 'CARRY THE BOAT SLIP' },
  { id: 17, name: 'CABIN FEVER', par: 4, path: [[0, 0], [-50, 130], [0, 260], [-30, 390]], width: 42, note: 'S-BEND THROUGH THE PINES' },
  { id: 18, name: 'LAST LIGHT', par: 4, path: [[0, 0], [10, 240], [-20, 420]], width: 46, margin: 140, cross: [{ t: 0.7, depth: 26 }], hills: [[1, 1, 0, 60, 3]], note: 'HERO SHOT OVER THE INLET' },
];

// ---------- Red Mesa ----------
const mesa = [
  { id: 1, name: 'TRAILHEAD', par: 3, path: [[0, 0], [10, 230]], width: 44, note: 'EASY DOES IT' },
  { id: 2, name: 'DRY WASH', par: 4, path: [[0, 0], [-20, 210], [10, 400]], width: 48, cross: [{ t: 0.45, depth: 46, surface: 'sand' }], note: 'SANDY WASH ACROSS THE MIDDLE' },
  { id: 3, name: 'SADDLEBACK', par: 3, path: [[0, 0], [0, 260]], width: 42, hills: [[0.5, 1, 0, 70, 12]], note: 'OVER THE SADDLE' },
  { id: 4, name: 'SWITCHBACK', par: 4, path: [[0, 0], [70, 140], [10, 280], [60, 420]], width: 44, slope: 3, note: 'ZIGZAG UPHILL' },
  { id: 5, name: 'THE DROP', par: 3, path: [[0, 0], [0, 290]], width: 44, slope: -8, sides: [{ side: 1, off: 70 }, { side: -1, off: 70 }], note: 'BIG DROP · CANYON BOTH SIDES' },
  { id: 6, name: 'SLOT CANYON', par: 4, path: [[0, 0], [15, 180], [-10, 360]], width: 36, sides: [{ side: 1, off: 40 }, { side: -1, off: 40 }], note: 'STAY IN THE SLOT' },
  { id: 7, name: 'DUST DEVIL', par: 3, path: [[0, 0], [0, 200]], width: 40, wind: [12, 22], note: 'THE WIND ALWAYS BLOWS HERE' },
  { id: 8, name: 'RIMROCK', par: 4, path: [[0, 0], [-20, 220], [10, 440]], width: 46, sides: [{ side: 1, off: 55 }], hills: [[0.6, -1, 90, 90, 8]], note: 'CLIFF EDGE LEFT IS OB' },
  { id: 9, name: 'HIGH NOON', par: 5, path: [[0, 0], [40, 290], [0, 580]], width: 50, cross: [{ t: 0.55, depth: 40, surface: 'sand' }], sand: [{ t: 0.98, side: -1, off: 28, r: 14 }], gates: [[0.66, 1, 10, 7], [0.72, -1, 14, 7]], note: 'LONG AND HOT' },
  { id: 10, name: 'COYOTE', par: 3, path: [[0, 0], [-10, 175]], width: 40, sand: [{ t: 0.9, side: 1, off: 26, r: 12 }, { t: 0.9, side: -1, off: 26, r: 12 }], gates: [[0.62, 1, 5, 5]], note: 'SAND EITHER SIDE' },
  { id: 11, name: 'ARROYO', par: 4, path: [[0, 0], [0, 200], [50, 410]], width: 44, sides: [{ side: 1, off: 45, surface: 'sand' }], note: 'WASH ALL DOWN THE LEFT' },
  { id: 12, name: 'MESA TOP', par: 3, path: [[0, 0], [20, 250]], width: 40, slope: 6, sides: [{ side: 1, off: 65, from: 0.6 }, { side: -1, off: 65, from: 0.6 }], note: 'UP ONTO THE MESA' },
  { id: 13, name: 'HOODOOS', par: 4, path: [[0, 0], [0, 380]], width: 46, gates: [[0.3, 1, 16, 7], [0.45, -1, 18, 8], [0.62, 1, 10, 6], [0.78, -1, 14, 7]], note: 'ROCK PILLARS IN THE FAIRWAY' },
  { id: 14, name: 'OASIS', par: 3, path: [[0, 0], [15, 210]], width: 40, ponds: [{ t: 0.88, side: -1, off: 40, r: 28 }], trees: { density: 1.2, rMin: 5, rMax: 9, margin: 10 }, note: 'THE ONLY WATER FOR MILES' },
  { id: 15, name: 'BADLANDS', par: 4, path: [[0, 0], [30, 230], [0, 455]], width: 42, sides: [{ side: 1, off: 68 }, { side: -1, off: 68 }], note: 'OB BOTH SIDES' },
  { id: 16, name: 'SUNBAKED', par: 3, path: [[0, 0], [-25, 270]], width: 42, slope: -2, sand: [{ t: 1.07, side: 1, off: 0, r: 16, sx: 1.6 }], note: 'LONG ONE · SAND LONG' },
  { id: 17, name: 'LONG SHADOW', par: 5, path: [[0, 0], [0, 230], [-110, 400], [-90, 615]], width: 50, cross: [{ t: 0.3, depth: 40, surface: 'sand' }], sides: [{ side: -1, off: 90, from: 0.45 }], note: 'DOGLEG LEFT · OB RIGHT LATE' },
  { id: 18, name: 'SUNDOWN', par: 4, path: [[0, 0], [10, 200], [-30, 400]], width: 46, hills: [[1.05, 1, 0, 60, 5]], sand: [{ t: 0.9, side: -1, off: 32, r: 13 }], note: 'FINISH UP THE HILL' },
];

function build(id, name, theme, designs, keep = []) {
  const t = { ...THEMES[theme], key: theme };
  const holes = [...keep, ...designs.map((d) => makeHole(d, t))];
  const json = { id, name, theme, holes };
  fs.writeFileSync(new URL(`${id}.json`, OUT), JSON.stringify(json) + '\n');
  const par = holes.reduce((a, h) => a + h.par, 0);
  const len = holes.reduce((a, h) => a + h.lengthFt, 0);
  console.log(`${name}: ${holes.length} holes, par ${par}, ${len} ft`);
}

const lantern = JSON.parse(fs.readFileSync(new URL('lantern-park.json', OUT), 'utf8'));
build('lantern-park', 'LANTERN PARK', 'park', lanternBack, lantern.holes.filter((h) => h.id <= 9));
build('loon-lake', 'LOON LAKE', 'lake', loon);
build('red-mesa', 'RED MESA', 'desert', mesa);
