/** LOST AND FOUND: discs shake loose from the trees. Tap them before they hit the pond. Leave the pinecones. */
import { sfx } from '../../core/audio';
import type { PointerInfo } from '../../core/input';
import { EXTRA_H, VIEW_H, VIEW_W } from '../../core/screen';
import { drawText, drawTextShadow } from '../../render/font';
import { PAL } from '../../render/palette';
import { fillCircle } from '../../render/sprites';
import { makeRng, type Rng } from '../../sim/rng';
import { drawParkBackdrop, TurnGame } from './TurnGame';

const DURATION = 25;
const POND_Y = 262 + EXTRA_H;
/** Taller drop on tall phones: speed and gravity scale with it so each disc takes the same time to fall. */
const FALL = (POND_Y - 55) / (262 - 55);
const COLORS = ['#ff8a3d', '#8fd16a', '#7cc4d8', '#c792ea', '#f2b544', '#e86a5e'];

interface Faller { x: number; y: number; vy: number; vx: number; cone: boolean; color: string; caught: number }

export class LostAndFound extends TurnGame {
  private rng: Rng;
  private items: Faller[] = [];
  private spawnT = 0;
  private lost = 0;
  private pops: { x: number; y: number; text: string; t: number; bad: boolean }[] = [];

  constructor(onDone: (score: number, cred: number) => void, seed = Date.now()) {
    super({ id: 'lost', name: 'LOST AND FOUND', how: 'DISCS ARE SHAKING LOOSE FROM THE TREES. TAP EACH ONE BEFORE IT HITS THE POND. LEAVE THE PINECONES ALONE. 25 SECONDS.' }, onDone);
    this.rng = makeRng(seed >>> 0);
  }

  cred(score: number) {
    return Math.max(0, Math.round(score * 1.2));
  }
  scoreText(score: number) {
    return `${score} SAVED`;
  }

  protected reset() {
    this.items = [];
    this.spawnT = 0;
    this.lost = 0;
    this.pops = [];
  }

  protected playDown(p: PointerInfo) {
    let best: Faller | null = null;
    let bd = 16;
    for (const it of this.items) {
      if (it.caught) continue;
      const d = Math.hypot(it.x - p.x, it.y - p.y);
      if (d < bd) {
        bd = d;
        best = it;
      }
    }
    if (!best) return;
    best.caught = 0.01;
    if (best.cone) {
      this.score = Math.max(0, this.score - 1);
      this.pops.push({ x: best.x, y: best.y, text: 'OUCH -1', t: 0, bad: true });
      sfx.play('bad');
    } else {
      this.score++;
      this.pops.push({ x: best.x, y: best.y, text: '+1', t: 0, bad: false });
      sfx.play('tap');
    }
  }

  protected playUpdate(dt: number) {
    const left = DURATION - this.playT;
    if (left <= 0) {
      this.finish();
      return;
    }
    const heat = 1 + this.playT / 12;
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = (0.55 + this.rng() * 0.5) / heat;
      const cone = this.rng() < 0.22;
      this.items.push({
        x: 14 + this.rng() * (VIEW_W - 28),
        y: 40 + this.rng() * 30,
        vy: (30 + this.rng() * 30 * heat) * FALL,
        vx: (this.rng() - 0.5) * 20,
        cone,
        color: COLORS[Math.floor(this.rng() * COLORS.length)],
        caught: 0,
      });
    }
    for (const it of this.items) {
      if (it.caught) {
        it.caught += dt;
        continue;
      }
      it.vy += 60 * FALL * dt;
      it.y += it.vy * dt;
      it.x += it.vx * dt + Math.sin(this.playT * 4 + it.x) * 12 * dt;
      if (it.y >= POND_Y) {
        it.caught = -1;
        if (!it.cone) {
          this.lost++;
          sfx.play('splash');
        }
      }
    }
    this.items = this.items.filter((it) => it.caught >= 0 && it.caught < 0.3);
    for (const p of this.pops) p.t += dt;
    this.pops = this.pops.filter((p) => p.t < 0.8);
  }

  protected playRender(ctx: CanvasRenderingContext2D) {
    drawParkBackdrop(ctx, 90);
    // Tree canopy along the top, pond along the bottom.
    for (let x = 0; x < VIEW_W; x += 16) fillCircle(ctx, x + 8, 38 + ((x * 7) % 9), 14, PAL.pineLight);
    ctx.fillStyle = PAL.water;
    ctx.fillRect(0, POND_Y, VIEW_W, VIEW_H - POND_Y);
    ctx.fillStyle = PAL.waterLight;
    for (let x = (Math.floor(this.time * 10) % 12) - 12; x < VIEW_W; x += 12) ctx.fillRect(x, POND_Y + 6, 6, 1);
    for (const it of this.items) {
      const s = it.caught ? 1 + it.caught * 4 : 1;
      if (it.cone) {
        ctx.fillStyle = PAL.sandDark;
        ctx.fillRect(Math.round(it.x - 2 * s), Math.round(it.y - 3 * s), Math.round(4 * s), Math.round(6 * s));
        ctx.fillStyle = PAL.ob;
        ctx.fillRect(Math.round(it.x - 1), Math.round(it.y - 2 * s), 1, Math.round(4 * s));
      } else {
        ctx.fillStyle = PAL.night0;
        ctx.fillRect(Math.round(it.x - 5 * s) - 1, Math.round(it.y - 2) - 1, Math.round(10 * s) + 2, 5);
        ctx.fillStyle = it.color;
        ctx.fillRect(Math.round(it.x - 5 * s), Math.round(it.y - 2), Math.round(10 * s), 3);
      }
    }
    for (const p of this.pops) drawTextShadow(ctx, p.text, p.x, p.y - 10 - p.t * 20, p.bad ? PAL.red : PAL.amber, PAL.night0, 'center');
    drawText(ctx, `SAVED ${this.score}`, 6, 6, PAL.amber);
    drawText(ctx, `${Math.max(0, Math.ceil(DURATION - this.playT))} S`, VIEW_W - 6, 6, PAL.ink, 'right');
    drawText(ctx, `IN THE POND ${this.lost}`, VIEW_W / 2, POND_Y + 22, PAL.ink, 'center');
  }
}
