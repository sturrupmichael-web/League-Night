/** SKIP CONTEST: two taps, power then angle, to skip a disc across the pond. Three tries; count the skips. */
import { sfx } from '../../core/audio';
import type { PointerInfo } from '../../core/input';
import { EXTRA_H, VIEW_H, VIEW_W } from '../../core/screen';
import { drawText, drawTextShadow } from '../../render/font';
import { PAL } from '../../render/palette';
import { panel } from '../../render/sprites';
import { clamp } from '../../sim/math';
import { drawParkBackdrop, TurnGame } from './TurnGame';

const TRIES = 3;
// Tall phones: the pond moves down half the extra height and the meters sit at the bottom.
const WATER_Y = 200 + Math.round(EXTRA_H / 2);
const METER_Y = 230 + EXTRA_H;
const SWEET_POWER = 0.82;
const SWEET_ANGLE = 0.3;

/** Skips from the two meter readings (0..1 each). Pure so it can be tested. */
export function skipsFor(power: number, angle: number): number {
  const p = clamp(1 - Math.abs(power - SWEET_POWER) * 3.2, 0, 1);
  const a = clamp(1 - Math.abs(angle - SWEET_ANGLE) * 3.5, 0, 1);
  return Math.round(9 * p * a);
}

export class SkipContest extends TurnGame {
  private step: 'power' | 'angle' | 'fly' = 'power';
  private power = 0;
  private angle = 0;
  private meterT = 0;
  private tries = 0;
  private fly: { skips: number; t: number; hops: { x: number; t: number }[] } | null = null;
  private lastSkips: number | null = null;

  constructor(onDone: (score: number, cred: number) => void) {
    super({ id: 'skip', name: 'SKIP CONTEST', how: 'TAP ONCE TO SET POWER, AGAIN TO SET THE ANGLE. LOW, FAST AND FLAT SKIPS FURTHEST. THREE TRIES. EVERY SKIP COUNTS.' }, onDone);
  }

  cred(score: number) {
    return Math.round(score * 1.5);
  }
  scoreText(score: number) {
    return `${score} SKIPS`;
  }

  protected reset() {
    this.step = 'power';
    this.tries = 0;
    this.meterT = 0;
    this.fly = null;
    this.lastSkips = null;
  }

  private meter(speed: number) {
    // Ping-pong 0..1.
    const v = (this.meterT * speed) % 2;
    return v < 1 ? v : 2 - v;
  }

  protected playDown(_p: PointerInfo) {
    if (this.step === 'power') {
      this.power = this.meter(1.4);
      this.step = 'angle';
      this.meterT = 0;
      sfx.play('tap');
    } else if (this.step === 'angle') {
      this.angle = this.meter(1.8);
      const skips = skipsFor(this.power, this.angle);
      const hops: { x: number; t: number }[] = [];
      let x = 40;
      let gap = 14 + this.power * 26;
      for (let i = 0; i < skips; i++) {
        x += gap;
        hops.push({ x, t: 0.25 + i * 0.22 });
        gap *= 0.82;
      }
      this.fly = { skips, t: 0, hops };
      this.step = 'fly';
      sfx.play('throw');
    }
  }

  protected playUpdate(dt: number) {
    this.meterT += dt;
    const f = this.fly;
    if (!f) return;
    const prev = f.t;
    f.t += dt;
    for (const h of f.hops) if (h.t > prev && h.t <= f.t) sfx.play('skip');
    const end = (f.hops.length ? f.hops[f.hops.length - 1].t : 0) + 0.6;
    if (f.t >= end) {
      sfx.play('splash');
      this.score += f.skips;
      this.lastSkips = f.skips;
      this.tries++;
      this.fly = null;
      this.step = 'power';
      this.meterT = 0;
      if (this.tries >= TRIES) this.finish();
    }
  }

  protected playRender(ctx: CanvasRenderingContext2D) {
    drawParkBackdrop(ctx, WATER_Y - 10);
    ctx.fillStyle = PAL.water;
    ctx.fillRect(0, WATER_Y, VIEW_W, VIEW_H - WATER_Y);
    ctx.fillStyle = PAL.waterLight;
    for (let i = 0; i < Math.floor((METER_Y - WATER_Y) / 11) + 8; i++) ctx.fillRect(((i * 37 + Math.floor(this.time * 8)) % (VIEW_W + 20)) - 10, WATER_Y + 8 + i * 11, 8, 1);
    // Thrower's dock.
    ctx.fillStyle = PAL.sandDark;
    ctx.fillRect(0, WATER_Y - 4, 34, 6);
    const f = this.fly;
    if (f) {
      // Splash rings at each hop already made.
      for (const h of f.hops) {
        if (h.t > f.t) break;
        const age = f.t - h.t;
        ctx.fillStyle = `rgba(244,233,205,${Math.max(0, 0.8 - age)})`;
        const r = Math.round(2 + age * 10);
        ctx.fillRect(Math.round(h.x - r), WATER_Y + 1, r * 2, 1);
      }
      // Disc position between hops.
      let x0 = 34;
      let t0 = 0;
      let disc = { x: 34, y: WATER_Y - 8 };
      for (const h of f.hops) {
        if (f.t <= h.t) {
          const u = (f.t - t0) / (h.t - t0);
          disc = { x: x0 + (h.x - x0) * u, y: WATER_Y - 2 - Math.sin(u * Math.PI) * 10 };
          break;
        }
        x0 = h.x;
        t0 = h.t;
        disc = { x: h.x, y: WATER_Y - 2 };
      }
      ctx.fillStyle = PAL.amber;
      ctx.fillRect(Math.round(disc.x) - 3, Math.round(disc.y), 6, 2);
    }
    // Meters.
    panel(ctx, 10, METER_Y, VIEW_W - 20, 54, PAL.night1, PAL.dusk);
    const bar = (y: number, label: string, v: number, sweet: number, live: boolean, done: boolean) => {
      drawText(ctx, label, 16, y, live ? PAL.ink : PAL.haze);
      const x = 54;
      const w = VIEW_W - 74;
      ctx.fillStyle = PAL.night3;
      ctx.fillRect(x, y, w, 6);
      ctx.fillStyle = PAL.mow;
      ctx.fillRect(Math.round(x + (sweet - 0.08) * w), y, Math.round(0.16 * w), 6);
      if (live || done) {
        ctx.fillStyle = live ? PAL.amber : PAL.ink;
        ctx.fillRect(Math.round(x + v * w) - 1, y - 2, 2, 10);
      }
    };
    const step = this.step;
    bar(METER_Y + 10, 'POWER', step === 'power' ? this.meter(1.4) : this.power, SWEET_POWER, step === 'power', step !== 'power');
    bar(METER_Y + 28, 'ANGLE', step === 'angle' ? this.meter(1.8) : this.angle, SWEET_ANGLE, step === 'angle', step === 'fly');
    drawText(ctx, step === 'fly' ? 'GO GO GO' : 'TAP!', VIEW_W / 2, METER_Y + 42, PAL.inkDim, 'center');
    drawText(ctx, `SKIPS ${this.score}`, 6, 6, PAL.amber);
    drawText(ctx, `TRY ${Math.min(this.tries + 1, TRIES)} OF ${TRIES}`, VIEW_W - 6, 6, PAL.ink, 'right');
    if (this.lastSkips !== null && !f) drawTextShadow(ctx, this.lastSkips ? `${this.lastSkips} SKIPS!` : 'PLUNK.', VIEW_W / 2, 150 + Math.round(EXTRA_H / 2), this.lastSkips ? PAL.amber : PAL.red, PAL.night0, 'center');
  }
}
