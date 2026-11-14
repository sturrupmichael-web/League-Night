import { drawText } from '../render/font';
import { PAL } from '../render/palette';
import { panel } from '../render/sprites';

export interface Button {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Small caption on top. */
  caption: () => string;
  /** Main value below the caption. */
  value: () => string;
  onTap: () => void;
  enabled?: () => boolean;
  pressed?: boolean;
}

export const hit = (b: Button, x: number, y: number) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;

export function drawButton(ctx: CanvasRenderingContext2D, b: Button) {
  const on = b.enabled ? b.enabled() : true;
  const dy = b.pressed ? 1 : 0;
  if (!b.pressed) {
    ctx.fillStyle = PAL.night0;
    ctx.fillRect(b.x, b.y + b.h, b.w, 1);
  }
  panel(ctx, b.x, b.y + dy, b.w, b.h, b.pressed ? PAL.night3 : PAL.night2, on ? PAL.dusk : PAL.night3);
  const cx = b.x + b.w / 2;
  drawText(ctx, b.caption(), cx, b.y + 3 + dy, on ? PAL.haze : PAL.night3, 'center');
  drawText(ctx, b.value(), cx, b.y + 11 + dy, on ? PAL.ink : PAL.dusk, 'center');
}
