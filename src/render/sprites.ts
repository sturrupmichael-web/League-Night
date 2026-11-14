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

const treeCache = new Map<string, HTMLCanvasElement | null>();

/** Seeded per-tree variety: pines and round broadleaf trees. */
const hash = (x: number, y: number) => {
  let h = Math.imul(Math.round(x * 7) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(Math.round(y * 13), 0xc2b2ae35);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
};

type TreeKind = 'pine' | 'leaf' | 'cactus' | 'rock';

function treeSprite(r: number, kind: TreeKind): HTMLCanvasElement | null {
  const R = Math.max(1, Math.round(r));
  const key = `${kind}:${R}`;
  if (treeCache.has(key)) return treeCache.get(key)!;
  let c: HTMLCanvasElement | null = null;
  try {
    c = document.createElement('canvas');
    const pad = Math.ceil(R * 0.45) + 3;
    c.width = c.height = R * 2 + pad + 2;
    const g = c.getContext('2d')!;
    const cx = R + 1;
    const cy = R + 1;
    fillCircle(g, cx + R * 0.4, cy + R * 0.4, R, 'rgba(10,8,14,0.45)'); // shadow, down-right
    if (kind === 'cactus') {
      // Seen from above: a ribbed round cactus with a couple of arms.
      g.fillStyle = PAL.night0;
      g.fillRect(cx - R - 1, cy - 1, R * 2 + 3, 3);
      fillCircle(g, cx, cy, R * 0.62 + 0.7, PAL.night0);
      fillCircle(g, cx, cy, R * 0.62, '#4f7a3a');
      g.fillStyle = '#4f7a3a';
      g.fillRect(cx - R, cy, R * 2 + 1, 1);
      g.fillStyle = '#7da35a';
      g.fillRect(cx - 1, cy - Math.round(R * 0.5), 1, Math.max(1, Math.round(R * 0.9)));
      g.fillRect(cx - R, cy, 1, 1);
      g.fillRect(cx + R, cy, 1, 1);
      g.fillStyle = PAL.ink;
      g.fillRect(cx, cy - 1, 1, 1);
    } else if (kind === 'rock') {
      // A red-rock boulder / hoodoo top.
      fillCircle(g, cx, cy, R + 0.6, PAL.night0);
      fillCircle(g, cx, cy, R, '#8a4a36');
      fillCircle(g, cx - R * 0.25, cy - R * 0.3, R * 0.65, '#b0654a');
      fillCircle(g, cx - R * 0.35, cy - R * 0.4, Math.max(0.6, R * 0.25), '#d08a64');
      g.fillStyle = '#5e3226';
      g.fillRect(Math.round(cx + R * 0.1), Math.round(cy + R * 0.2), Math.max(1, Math.round(R * 0.5)), 1);
    } else if (kind === 'pine') {
      // Outline, body, then a ring of branch tips and a lit side.
      fillCircle(g, cx, cy, R + 0.6, PAL.night0);
      fillCircle(g, cx, cy, R, PAL.pine);
      const tips = Math.max(6, Math.round(R * 1.4));
      g.fillStyle = PAL.pine;
      for (let i = 0; i < tips; i++) {
        const a = (i / tips) * Math.PI * 2;
        g.fillRect(Math.round(cx + Math.cos(a) * (R + 0.8)), Math.round(cy + Math.sin(a) * (R + 0.8)), 1, 1);
      }
      fillCircle(g, cx - R * 0.2, cy - R * 0.2, R * 0.68, PAL.pineLight);
      fillCircle(g, cx, cy, Math.max(0.6, R * 0.22), PAL.pine); // the crown's centre
      g.fillStyle = PAL.grassLight;
      for (let i = 0; i < R; i++) {
        const a = Math.PI * 1.1 + (i / R) * Math.PI * 0.6;
        const d = R * (0.35 + 0.3 * ((i * 7) % 3) / 2);
        g.fillRect(Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d), 1, 1);
      }
    } else {
      // Broadleaf: a lumpy cluster of canopy blobs.
      const blobs = [
        [0.3, 0.25, 0.75],
        [-0.3, 0.2, 0.7],
        [0, -0.3, 0.72],
      ];
      for (const [bx, by, br] of blobs) fillCircle(g, cx + bx * R, cy + by * R, br * R + 0.7, PAL.night0);
      for (const [bx, by, br] of blobs) fillCircle(g, cx + bx * R, cy + by * R, br * R, PAL.grassDark);
      for (const [bx, by, br] of blobs) fillCircle(g, cx + bx * R - br * R * 0.25, cy + by * R - br * R * 0.25, br * R * 0.55, PAL.grass);
      fillCircle(g, cx - R * 0.35, cy - R * 0.45, Math.max(0.6, R * 0.2), PAL.mow);
    }
  } catch {
    c = null; // no DOM (tests)
  }
  treeCache.set(key, c);
  return c;
}

export function drawTree(ctx: CanvasRenderingContext2D, sx: number, sy: number, r: number, wx = 0, wy = 0, theme = 'park') {
  const h = hash(wx, wy);
  const kind: TreeKind = theme === 'desert' ? (h < 0.5 ? 'cactus' : 'rock') : theme === 'lake' ? (h < 0.9 ? 'pine' : 'leaf') : h < 0.72 ? 'pine' : 'leaf';
  const spr = treeSprite(r, kind);
  if (spr) {
    const R = Math.max(1, Math.round(r));
    ctx.drawImage(spr, Math.round(sx) - R - 1, Math.round(sy) - R - 1);
    return;
  }
  fillCircle(ctx, sx, sy, r, PAL.pine);
}

/** Basket seen from above-ish: shadow, pole, tray, chains, band. (sx, sy) is the base. */
export function drawBasket(ctx: CanvasRenderingContext2D, sx: number, sy: number, flash = 0) {
  const x = Math.round(sx);
  const y = Math.round(sy);
  ctx.fillStyle = 'rgba(10,8,14,0.5)';
  ctx.fillRect(x - 3, y, 8, 2);
  ctx.fillStyle = PAL.night0;
  ctx.fillRect(x - 5, y - 13, 11, 10); // outline so it reads on any grass
  ctx.fillStyle = PAL.steel;
  ctx.fillRect(x, y - 12, 1, 12);
  // Tray.
  ctx.fillStyle = PAL.steel;
  ctx.fillRect(x - 4, y - 6, 9, 2);
  ctx.fillStyle = PAL.dusk;
  ctx.fillRect(x - 4, y - 4, 9, 1);
  // Chains, glinting when something lands in them.
  const lit = flash > 0;
  for (let i = -3; i <= 3; i++) {
    if (i === 0) continue;
    ctx.fillStyle = lit && (i + Math.floor(flash * 20)) % 2 === 0 ? PAL.white : i % 2 ? PAL.inkDim : PAL.steel;
    ctx.fillRect(x + i, y - 11 + Math.abs(i) / 2, 1, 5 - Math.abs(i) / 2);
  }
  // Top band.
  ctx.fillStyle = PAL.amber;
  ctx.fillRect(x - 4, y - 13, 9, 2);
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(x - 4, y - 13, 3, 1);
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
