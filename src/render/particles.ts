/**
 * Little bursts for feel: chain sparks on a make, dust when a disc lands, spray from water,
 * needles from a tree. Purely visual, lives in the render layer, never touches the sim.
 * Particles live in world feet (x, y on the ground, z up) or in screen pixels (putt view).
 */
import { motion } from '../core/motion';
import { PAL } from './palette';

interface P {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  color: string;
  size: number;
  g: number;
}

export type BurstKind = 'chains' | 'dust' | 'splash' | 'needles' | 'sand';

const STYLE: Record<BurstKind, { n: number; colors: string[]; speed: number; up: number; g: number; life: number }> = {
  chains: { n: 22, colors: [PAL.white, PAL.amber, PAL.steel, PAL.ink], speed: 9, up: 10, g: 22, life: 0.8 },
  dust: { n: 8, colors: [PAL.grassLight, PAL.mow, PAL.inkDim], speed: 5, up: 3, g: 14, life: 0.45 },
  sand: { n: 10, colors: [PAL.sand, PAL.sandDark, PAL.ink], speed: 6, up: 4, g: 16, life: 0.5 },
  splash: { n: 16, colors: [PAL.waterLight, PAL.white, PAL.steel], speed: 6, up: 12, g: 30, life: 0.7 },
  needles: { n: 10, colors: [PAL.pineLight, PAL.grassLight, PAL.pine], speed: 7, up: 2, g: 10, life: 0.9 },
};

export class Particles {
  private list: P[] = [];

  /** World-space burst at (x, y), z feet off the ground. */
  burst(kind: BurstKind, x: number, y: number, z = 0, rand: () => number = Math.random) {
    const st = STYLE[kind];
    const n = motion.reduced ? Math.ceil(st.n / 3) : st.n;
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const sp = st.speed * (0.4 + rand() * 0.8);
      const life = st.life * (0.6 + rand() * 0.6);
      this.list.push({
        x, y, z,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        vz: st.up * (0.4 + rand() * 0.8),
        life, max: life,
        color: st.colors[Math.floor(rand() * st.colors.length)],
        size: rand() < 0.25 ? 2 : 1,
        g: st.g,
      });
    }
  }

  get active() {
    return this.list.length > 0;
  }

  update(dt: number) {
    for (const p of this.list) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vz -= p.g * dt;
      p.z = Math.max(0, p.z + p.vz * dt);
      if (p.z === 0) {
        p.vx *= 0.8;
        p.vy *= 0.8;
      }
    }
    this.list = this.list.filter((p) => p.life > 0);
  }

  /** Draw with a world-to-screen mapping; altitude is lifted by `alt` pixels per foot. */
  draw(ctx: CanvasRenderingContext2D, toScreen: (x: number, y: number) => { x: number; y: number }, alt: number) {
    for (const p of this.list) {
      const s = toScreen(p.x, p.y);
      if (p.life < p.max * 0.3 && Math.floor(p.life * 30) % 2) continue; // flicker out
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(s.x), Math.round(s.y - p.z * alt), p.size, p.size);
    }
  }

  clear() {
    this.list = [];
  }
}

/** Screen shake: a few pixels, fading fast. Off with reduced motion. */
export class Shake {
  private t = 0;
  private amp = 0;
  kick(px: number, dur = 0.35) {
    if (motion.reduced) return;
    this.amp = Math.max(this.amp, px);
    this.t = Math.max(this.t, dur);
  }
  update(dt: number) {
    this.t = Math.max(0, this.t - dt);
    if (!this.t) this.amp = 0;
  }
  offset(time: number): { x: number; y: number } {
    if (!this.t) return { x: 0, y: 0 };
    const k = this.amp * Math.min(1, this.t / 0.2);
    return { x: Math.round(Math.sin(time * 91) * k), y: Math.round(Math.cos(time * 67) * k) };
  }
}
