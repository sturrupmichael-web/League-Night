/** BULLSEYE BOARD: flick five discs at a target board that drifts across the tree line. */
import { sfx } from '../../core/audio';
import type { PointerInfo } from '../../core/input';
import { EXTRA_H, VIEW_W } from '../../core/screen';
import { drawText, drawTextShadow } from '../../render/font';
import { PAL } from '../../render/palette';
import { fillCircle } from '../../render/sprites';
import { lerp } from '../../sim/math';
import { makeRng, type Rng } from '../../sim/rng';
import { drawParkBackdrop, TurnGame } from './TurnGame';

// On tall phones the board drops a little and the disc sits at the bottom of the screen.
const BOARD_Y = 70 + Math.round(EXTRA_H / 4);
const START = { x: 90, y: 268 + EXTRA_H };
const TOSSES = 5;
const RINGS = [
  { r: 5, pts: 50, color: PAL.red },
  { r: 11, pts: 25, color: PAL.ink },
  { r: 17, pts: 10, color: PAL.red },
];

export class Bullseye extends TurnGame {
  private rng: Rng;
  private tossed = 0;
  private drag: { x0: number; y0: number; t0: number; x: number; y: number } | null = null;
  private flying: { x0: number; vx: number; t: number; drift: number } | null = null;
  private marks: { x: number; y: number; pts: number }[] = [];
  private wind = 0;
  private last: { text: string; t: number } | null = null;

  constructor(onDone: (score: number, cred: number) => void, seed = Date.now()) {
    super({ id: 'bullseye', name: 'BULLSEYE BOARD', how: 'FLICK UP FROM THE DISC TO TOSS IT AT THE BOARD. IT SLIDES, AND THE WIND PUSHES. FIVE TOSSES. CENTRE RING IS 50.' }, onDone);
    this.rng = makeRng(seed >>> 0);
  }

  cred(score: number) {
    return Math.round(score / 10);
  }
  scoreText(score: number) {
    return `${score} PTS`;
  }

  protected reset() {
    this.tossed = 0;
    this.marks = [];
    this.flying = null;
    this.rollWind();
  }

  private rollWind() {
    this.wind = Math.round((this.rng() * 2 - 1) * 8);
  }

  private boardX() {
    return VIEW_W / 2 + Math.sin(this.playT * 1.3) * 48 + Math.sin(this.playT * 0.47) * 10;
  }

  protected playDown(p: PointerInfo) {
    if (this.flying || this.tossed >= TOSSES) return;
    this.drag = { x0: p.x, y0: p.y, t0: performance.now(), x: p.x, y: p.y };
  }
  protected playMove(p: PointerInfo) {
    if (this.drag) {
      this.drag.x = p.x;
      this.drag.y = p.y;
    }
  }
  protected playUp(p: PointerInfo) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const up = d.y0 - p.y;
    if (up < 20) return;
    // Direction of the flick, extended to the board line.
    const slope = (p.x - d.x0) / up;
    this.flying = { x0: START.x, vx: slope * (START.y - BOARD_Y), t: 0, drift: this.wind * 1.6 };
    sfx.play('throw');
  }

  protected playUpdate(dt: number) {
    if (this.last) {
      this.last.t += dt;
      if (this.last.t > 1.2) this.last = null;
    }
    const f = this.flying;
    if (!f) {
      if (this.tossed >= TOSSES && !this.last) this.finish();
      return;
    }
    f.t += dt / 0.7;
    if (f.t >= 1) {
      const x = f.x0 + f.vx + f.drift;
      const bx = this.boardX();
      const d = Math.abs(x - bx);
      const ring = RINGS.find((r) => d <= r.r);
      const pts = ring ? ring.pts : 0;
      this.score += pts;
      this.marks.push({ x: x - bx, y: (this.rng() - 0.5) * 6, pts });
      this.last = { text: pts ? `+${pts}` : 'MISSED THE BOARD', t: 0 };
      sfx.play(pts >= 50 ? 'chains' : pts ? 'land' : 'bad');
      this.tossed++;
      this.flying = null;
      this.rollWind();
    }
  }

  protected playRender(ctx: CanvasRenderingContext2D) {
    drawParkBackdrop(ctx, BOARD_Y + 50);
    const bx = this.boardX();
    // Board on a post.
    ctx.fillStyle = PAL.night0;
    ctx.fillRect(Math.round(bx) - 1, BOARD_Y, 3, 60);
    fillCircle(ctx, bx, BOARD_Y, 19, PAL.night0);
    for (const r of [...RINGS].reverse()) fillCircle(ctx, bx, BOARD_Y, r.r, r.color);
    for (const m of this.marks) {
      ctx.fillStyle = PAL.amber;
      ctx.fillRect(Math.round(bx + m.x) - 1, Math.round(BOARD_Y + m.y), 3, 2);
    }
    // Disc in flight or in hand.
    const f = this.flying;
    if (f) {
      const x = lerp(f.x0, f.x0 + f.vx + f.drift * f.t * f.t, f.t);
      const y = lerp(START.y, BOARD_Y, f.t) - Math.sin(f.t * Math.PI) * 20;
      const s = Math.round(lerp(8, 3, f.t));
      ctx.fillStyle = PAL.amber;
      ctx.fillRect(Math.round(x - s / 2), Math.round(y), s, Math.max(1, Math.round(s / 3)));
    } else if (this.tossed < TOSSES && this.phase === 'play') {
      ctx.fillStyle = PAL.night0;
      ctx.fillRect(START.x - 9, START.y - 1, 18, 6);
      ctx.fillStyle = PAL.amber;
      ctx.fillRect(START.x - 8, START.y, 16, 4);
      if (this.drag) {
        ctx.fillStyle = PAL.ink;
        const dx = this.drag.x - this.drag.x0;
        const dy = this.drag.y - this.drag.y0;
        for (let i = 0; i < 20; i += 2) ctx.fillRect(Math.round(START.x + (dx * i) / 20), Math.round(START.y + (dy * i) / 20), 1, 1);
      }
    }
    // HUD.
    drawText(ctx, `SCORE ${this.score}`, 6, 6, PAL.amber);
    drawText(ctx, `DISC ${Math.min(this.tossed + 1, TOSSES)} OF ${TOSSES}`, VIEW_W - 6, 6, PAL.ink, 'right');
    const w = this.wind;
    drawText(ctx, w === 0 ? 'WIND: NONE' : `WIND: ${w > 0 ? '>>' : '<<'} ${Math.abs(w)}`, VIEW_W / 2, 16, PAL.inkDim, 'center');
    if (this.last) drawTextShadow(ctx, this.last.text, VIEW_W / 2, 150 + Math.round(EXTRA_H / 2), this.last.text.startsWith('+') ? PAL.amber : PAL.red, PAL.night0, 'center');
    if (this.phase === 'play' && !this.flying && this.tossed === 0 && !this.drag) drawTextShadow(ctx, 'FLICK UP', VIEW_W / 2, START.y - 18, PAL.ink, PAL.night0, 'center');
  }
}
