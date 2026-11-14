/** A simple stacked-button screen, used by the title, setup, pause and other small screens. */
import { sfx } from '../core/audio';
import type { PointerInfo } from '../core/input';
import type { Scene } from '../core/scene';
import { VIEW_H, VIEW_W } from '../core/screen';
import { drawText } from '../render/font';
import { PAL } from '../render/palette';
import { panel } from '../render/sprites';
import { type Button, drawButton, hit } from './button';

export interface MenuItem {
  caption: string | (() => string);
  value: string | (() => string);
  onTap: () => void;
  enabled?: () => boolean;
}

export interface MenuOpts {
  items: MenuItem[];
  /** First button's top edge. */
  top: number;
  width?: number;
  gap?: number;
  /** Draw a dimmed panel over the scene beneath. */
  overlay?: { title: string; sub?: string };
  /** Background / extra drawing, called before the buttons. */
  draw?: (ctx: CanvasRenderingContext2D, time: number) => void;
}

const fn = (v: string | (() => string)) => (typeof v === 'function' ? v : () => v);

export class MenuScene implements Scene {
  overlay: boolean;
  protected buttons: Button[];
  private pressed: Button | null = null;
  protected time = 0;

  constructor(protected opts: MenuOpts) {
    this.overlay = !!opts.overlay;
    const w = opts.width ?? 120;
    const gap = opts.gap ?? 26;
    this.buttons = opts.items.map((it, i) => ({
      x: Math.round((VIEW_W - w) / 2),
      y: opts.top + i * gap,
      w,
      h: 22,
      caption: fn(it.caption),
      value: fn(it.value),
      onTap: it.onTap,
      enabled: it.enabled,
    }));
  }

  down(p: PointerInfo) {
    const b = this.buttons.find((b) => hit(b, p.x, p.y) && (b.enabled ? b.enabled() : true));
    this.pressed = b ?? null;
    if (b) b.pressed = true;
  }
  move(p: PointerInfo) {
    if (this.pressed) this.pressed.pressed = hit(this.pressed, p.x, p.y);
  }
  up(p: PointerInfo) {
    const b = this.pressed;
    this.pressed = null;
    if (!b) return;
    b.pressed = false;
    if (hit(b, p.x, p.y)) {
      sfx.play('tap');
      b.onTap();
    }
  }
  cancel() {
    if (this.pressed) this.pressed.pressed = false;
    this.pressed = null;
  }

  update(dt: number) {
    this.time += dt;
  }

  render(ctx: CanvasRenderingContext2D) {
    if (this.opts.overlay) {
      ctx.fillStyle = 'rgba(13,11,19,0.75)';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      const n = this.buttons.length;
      const top = this.opts.top - 34;
      const h = 34 + n * (this.opts.gap ?? 26) + 6;
      panel(ctx, 16, top, VIEW_W - 32, h, PAL.night1, PAL.amber);
      drawText(ctx, this.opts.overlay.title, VIEW_W / 2, top + 8, PAL.amber, 'center');
      if (this.opts.overlay.sub) drawText(ctx, this.opts.overlay.sub, VIEW_W / 2, top + 18, PAL.inkDim, 'center');
    } else {
      ctx.fillStyle = PAL.night1;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    this.opts.draw?.(ctx, this.time);
    for (const b of this.buttons) drawButton(ctx, b);
  }
}

/** Big 2× text with a drop shadow. */
export function drawBigText(ctx: CanvasRenderingContext2D, s: string, cx: number, y: number, color: string, scale = 2) {
  for (const [dx, c] of [[1, PAL.night0], [0, color]] as const) {
    ctx.save();
    ctx.translate(Math.round(cx) + dx, y + dx);
    ctx.scale(scale, scale);
    drawText(ctx, s, 0, 0, c, 'center');
    ctx.restore();
  }
}

/** A string of lanterns across the top: the league-night signature. */
export function drawLanterns(ctx: CanvasRenderingContext2D, time: number, y0 = 0) {
  ctx.fillStyle = PAL.night3;
  for (let x = 0; x < VIEW_W; x++) {
    const sag = Math.round(10 + 6 * Math.sin((x / VIEW_W) * Math.PI));
    ctx.fillRect(x, y0 + sag, 1, 1);
  }
  for (let i = 0; i < 8; i++) {
    const x = 14 + i * 22;
    const sag = Math.round(10 + 6 * Math.sin((x / VIEW_W) * Math.PI));
    const glow = Math.sin(time * 1.7 + i * 1.3) > 0.7;
    ctx.fillStyle = PAL.night3;
    ctx.fillRect(x, y0 + sag, 1, 3);
    ctx.fillStyle = glow ? PAL.ink : i % 3 === 0 ? PAL.red : PAL.amber;
    ctx.fillRect(x - 2, y0 + sag + 3, 5, 5);
    ctx.fillStyle = PAL.night0;
    ctx.fillRect(x - 2, y0 + sag + 8, 5, 1);
  }
}
