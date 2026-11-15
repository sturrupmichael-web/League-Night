/** Your bag: every disc with its four flight numbers and a line on how it flies. Opened from the Locker. */
import discsJson from '../content/discs.json';
import { EXTRA_H, VIEW_H, VIEW_W } from '../core/screen';
import { drawText, wrapText } from '../render/font';
import { PAL } from '../render/palette';
import type { Disc } from '../sim/discs';
import { drawBigText, drawLanterns, MenuScene } from '../ui/menu';

const DISCS = discsJson as (Disc & { blurb?: string })[];
/** Right edges of the four number columns. */
const COLS = [118, 134, 150, 168];

export class BagScene extends MenuScene {
  constructor(back: () => void) {
    super({ items: [], top: 0, onBack: back });
    this.opts.draw = (ctx, t) => this.drawBag(ctx, t);
    this.buttons = [{ x: 50, y: VIEW_H - 28, w: 80, h: 22, caption: () => '', value: () => 'BACK', onTap: back }];
  }

  private drawBag(ctx: CanvasRenderingContext2D, time: number) {
    drawLanterns(ctx, time, -14);
    drawBigText(ctx, 'YOUR BAG', VIEW_W / 2, 14, PAL.amber);
    let y = 36 + Math.round(EXTRA_H / 4);
    ['S', 'G', 'T', 'F'].forEach((h, i) => drawText(ctx, h, COLS[i], y, PAL.haze, 'right'));
    y += 10;
    // Rows share what's left above the two key lines and the BACK button.
    const rowH = Math.min(34, Math.floor((VIEW_H - 28 - 24 - y) / DISCS.length));
    DISCS.forEach((d, i) => {
      if (i % 2 === 0) {
        ctx.fillStyle = PAL.night2;
        ctx.fillRect(4, y - 3, VIEW_W - 8, rowH);
      }
      ctx.fillStyle = PAL.night0;
      ctx.fillRect(8, y - 1, 7, 7);
      ctx.fillStyle = d.color;
      ctx.fillRect(9, y, 5, 5);
      drawText(ctx, d.name, 19, y, PAL.ink);
      drawText(ctx, d.type.toUpperCase(), 19 + (d.name.length + 1) * 4, y, PAL.haze);
      [d.speed, d.glide, d.turn, d.fade].forEach((n, k) => drawText(ctx, String(n), COLS[k], y, PAL.ink, 'right'));
      wrapText(d.blurb ?? '', VIEW_W - 24)
        .slice(0, 2)
        .forEach((line, k) => drawText(ctx, line, 19, y + 9 + k * 8, PAL.inkDim));
      y += rowH;
    });
    drawText(ctx, 'S SPEED · G GLIDE · T TURN · F FADE', VIEW_W / 2, y + 2, PAL.haze, 'center');
    drawText(ctx, 'TURN BELOW 0 FLIPS EARLY · FADE HOOKS LATE', VIEW_W / 2, y + 11, PAL.inkDim, 'center');
  }
}
