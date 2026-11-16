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
  /** The one action the screen is for: drawn filled in amber. */
  primary?: boolean;
  /** Tapping steps through a list of values: small arrows at both ends say so. */
  cycle?: boolean;
}

export const hit = (b: Button, x: number, y: number) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;

export function drawButton(ctx: CanvasRenderingContext2D, b: Button) {
  const on = b.enabled ? b.enabled() : true;
  const dy = b.pressed ? 1 : 0;
  if (!b.pressed) {
    ctx.fillStyle = PAL.night0;
    ctx.fillRect(b.x, b.y + b.h, b.w, 1);
  }
  const cx = b.x + b.w / 2;
  // Keep labels inside the frame (and clear of the cycle chevrons).
  const fit = b.w - (b.cycle ? 12 : 4);
  // With no caption the value sits in the middle of the button instead of under an empty line.
  const vy = b.caption() ? b.y + 11 + dy : b.y + Math.floor((b.h - 5) / 2) + dy;
  if (b.primary && on) {
    panel(ctx, b.x, b.y + dy, b.w, b.h, b.pressed ? PAL.sandDark : PAL.amber, PAL.sandDark);
    drawText(ctx, b.caption(), cx, b.y + 3 + dy, PAL.night3, 'center', fit);
    drawText(ctx, b.value(), cx, vy, PAL.night0, 'center', fit);
    return;
  }
  panel(ctx, b.x, b.y + dy, b.w, b.h, b.pressed ? PAL.night3 : PAL.night2, on ? PAL.dusk : PAL.night3);
  drawText(ctx, b.caption(), cx, b.y + 3 + dy, on ? PAL.inkDim : PAL.night3, 'center', fit);
  drawText(ctx, b.value(), cx, vy, on ? PAL.ink : PAL.dusk, 'center', fit);
  if (b.cycle) {
    // Small 2x3 chevrons hugging the edges, so they fit beside long values on narrow buttons.
    ctx.fillStyle = on ? PAL.haze : PAL.night3;
    const l = b.x + 2;
    const r = b.x + b.w - 4;
    const t = vy + 1;
    ctx.fillRect(l + 1, t, 1, 1);
    ctx.fillRect(l, t + 1, 1, 1);
    ctx.fillRect(l + 1, t + 2, 1, 1);
    ctx.fillRect(r, t, 1, 1);
    ctx.fillRect(r + 1, t + 1, 1, 1);
    ctx.fillRect(r, t + 2, 1, 1);
  }
}
