/**
 * Temporary test launcher so the game can be tried on a phone without URL options.
 * The real title screen replaces this in Phase 3.
 */
import type { Scene } from '../core/scene';
import type { PointerInfo } from '../core/input';
import { VIEW_H, VIEW_W } from '../core/screen';
import { drawText } from '../render/font';
import { PAL } from '../render/palette';
import { type Button, drawButton, hit } from '../ui/button';

export interface LauncherItem { caption: string; value: string; onTap: () => void }

export class LauncherScene implements Scene {
  private buttons: Button[];
  private pressed: Button | null = null;
  private time = 0;

  constructor(items: LauncherItem[], private footer: () => string) {
    this.buttons = items.map((it, i) => ({
      x: 30, y: 120 + i * 28, w: 120, h: 22,
      caption: () => it.caption,
      value: () => it.value,
      onTap: it.onTap,
    }));
  }

  down(p: PointerInfo) {
    this.pressed = this.buttons.find((b) => hit(b, p.x, p.y)) ?? null;
    if (this.pressed) this.pressed.pressed = true;
  }
  move(p: PointerInfo) {
    if (this.pressed) this.pressed.pressed = hit(this.pressed, p.x, p.y);
  }
  up(p: PointerInfo) {
    const b = this.pressed;
    this.pressed = null;
    if (!b) return;
    b.pressed = false;
    if (hit(b, p.x, p.y)) b.onTap();
  }

  update(dt: number) {
    this.time += dt;
  }

  render(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = PAL.night1;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // A few lantern dots for atmosphere.
    for (let i = 0; i < 9; i++) {
      const x = 12 + i * 20;
      const y = 22 + Math.round(Math.sin(i * 1.7) * 4);
      ctx.fillStyle = PAL.night3;
      ctx.fillRect(x, 0, 1, y);
      ctx.fillStyle = Math.sin(this.time * 2 + i) > 0.6 ? PAL.ink : PAL.amber;
      ctx.fillRect(x - 1, y, 3, 3);
    }
    ctx.save();
    ctx.translate(VIEW_W / 2, 52);
    ctx.scale(2, 2);
    drawText(ctx, 'LEAGUE NIGHT', 0, 0, PAL.amber, 'center');
    ctx.restore();
    drawText(ctx, 'TEST BUILD', VIEW_W / 2, 72, PAL.haze, 'center');
    drawText(ctx, 'PICK WHAT TO TRY', VIEW_W / 2, 100, PAL.inkDim, 'center');
    for (const b of this.buttons) drawButton(ctx, b);
    drawText(ctx, this.footer(), VIEW_W / 2, VIEW_H - 14, PAL.dusk, 'center');
  }
}
