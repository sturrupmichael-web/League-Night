/** How to play: six short illustrated pages. */
import { VIEW_H, VIEW_W } from '../core/screen';
import { drawText, wrapText } from '../render/font';
import { PAL } from '../render/palette';
import { drawBasket, drawDisc, fillCircle, panel } from '../render/sprites';
import { drawButton } from '../ui/button';
import { MenuScene } from '../ui/menu';

interface Page { title: string; text: string[]; art: (ctx: CanvasRenderingContext2D, x: number, y: number, t: number) => void }

const dots = (ctx: CanvasRenderingContext2D, pts: [number, number][], color: string, every = 1) => {
  ctx.fillStyle = color;
  pts.forEach(([x, y], i) => i % every === 0 && ctx.fillRect(Math.round(x), Math.round(y), 1, 1));
};
const curve = (x0: number, y0: number, len: number, bend: (f: number) => number) => {
  const out: [number, number][] = [];
  for (let i = 0; i <= 60; i++) {
    const f = i / 60;
    out.push([x0 + bend(f), y0 - f * len]);
  }
  return out;
};

const PAGES: Page[] = [
  {
    title: '1 · THROWING',
    text: [
      'Put your thumb on the disc, pull back and let go. A longer pull means more power.',
      'Pull past the red mark for extra distance, but the release gets wild.',
      'Drag back onto the disc to cancel.',
    ],
    art: (ctx, x, y, t) => {
      const pull = 18 + Math.sin(t * 2) * 10;
      dots(ctx, curve(x + 70, y + 60, 50, () => 0), PAL.ink, 3);
      ctx.fillStyle = PAL.inkDim;
      for (let i = 0; i < pull; i += 2) ctx.fillRect(x + 70, y + 62 + i, 1, 1);
      fillCircle(ctx, x + 70, y + 64 + pull, 4, PAL.haze);
      drawDisc(ctx, x + 70, y + 62, 0, PAL.amber);
      panel(ctx, x + 118, y + 4, 8, 82, PAL.night1, PAL.dusk);
      const fill = Math.round((pull / 28) * 70);
      ctx.fillStyle = pull > 24 ? PAL.red : PAL.amber;
      ctx.fillRect(x + 120, y + 85 - fill, 4, fill);
      ctx.fillStyle = PAL.red;
      ctx.fillRect(x + 116, y + 18, 12, 1);
    },
  },
  {
    title: '2 · YOUR BAG',
    text: [
      'Every disc flies its own way. Its four flight numbers are in the Locker, under YOUR BAG.',
      'Putters sit where they land. Fast drivers skate on, but need a big arm or they dump early.',
      'Tap the disc button to swap.',
    ],
    art: (ctx, x, y) => {
      dots(ctx, curve(x + 70, y + 86, 45, (f) => -Math.pow(f, 3) * 8), PAL.ink, 2);
      dots(ctx, curve(x + 70, y + 86, 62, (f) => Math.sin(f * Math.PI) * 6 - Math.pow(f, 4) * 14), '#8fd16a', 2);
      dots(ctx, curve(x + 70, y + 86, 80, (f) => Math.sin(f * Math.PI * 0.8) * 10 - Math.pow(f, 4) * 22), '#ff8a3d', 2);
      drawText(ctx, 'PUTTER', x + 30, y + 40, PAL.ink);
      drawText(ctx, 'FAIRWAY', x + 82, y + 26, '#8fd16a');
      drawText(ctx, 'DRIVER', x + 74, y + 2, '#ff8a3d');
      drawDisc(ctx, x + 70, y + 88, 0, PAL.amber);
    },
  },
  {
    title: '3 · ANGLE AND STYLE',
    text: [
      'Hyzer curves toward the fade side, anhyzer toward the turn side. Flat holds its line longest.',
      'Forehand and lefties mirror the curve. A hammer goes high and short and lands upside down.',
    ],
    art: (ctx, x, y) => {
      dots(ctx, curve(x + 70, y + 86, 75, (f) => -Math.pow(f, 2) * 30), PAL.waterLight, 2);
      dots(ctx, curve(x + 70, y + 86, 80, (f) => -Math.pow(f, 4) * 10), PAL.ink, 2);
      dots(ctx, curve(x + 70, y + 86, 75, (f) => Math.pow(f, 1.5) * 30 - Math.pow(f, 6) * 12), PAL.amber, 2);
      drawText(ctx, 'HYZER', x + 8, y + 10, PAL.waterLight);
      drawText(ctx, 'FLAT', x + 56, y, PAL.ink);
      drawText(ctx, 'ANHYZER', x + 94, y + 10, PAL.amber);
      drawDisc(ctx, x + 70, y + 88, 0, PAL.amber);
    },
  },
  {
    title: '4 · WIND AND GROUND',
    text: [
      'Headwind adds turn and costs distance. Tailwind flattens it out and carries.',
      'Water or out of bounds costs a stroke; you play on from where it went out.',
      'A low, fast, flat disc can skip off water once.',
    ],
    art: (ctx, x, y, t) => {
      ctx.fillStyle = PAL.water;
      ctx.fillRect(x + 20, y + 52, 100, 18);
      ctx.fillStyle = PAL.waterLight;
      for (let i = 0; i < 100; i += 9) ctx.fillRect(x + 20 + ((i + Math.floor(t * 8)) % 100), y + 60, 4, 1);
      const arc = (x0: number, w: number, h: number) => {
        const pts: [number, number][] = [];
        for (let i = 0; i <= 30; i++) {
          const f = i / 30;
          pts.push([x0 + f * w, y + 52 - Math.sin(f * Math.PI) * h]);
        }
        dots(ctx, pts, PAL.ink, 2);
      };
      arc(x + 4, 56, 30);
      arc(x + 60, 40, 10);
      drawDisc(ctx, x + 102, y + 48, 0, PAL.amber);
      ctx.fillStyle = PAL.ink;
      for (let i = 0; i < 24; i++) ctx.fillRect(x + 50 + i, y + 12, 1, 1);
      for (let i = 0; i < 4; i++) {
        ctx.fillRect(x + 73 - i, y + 12 - i, 1, 1);
        ctx.fillRect(x + 73 - i, y + 12 + i, 1, 1);
      }
      drawText(ctx, 'WIND', x + 52, y + 2, PAL.inkDim);
    },
  },
  {
    title: '5 · PUTTING',
    text: [
      'Inside 70 ft with a putter, the view drops behind the disc. Swipe up at the chains.',
      'Swipe length is power. A quick flick adds a bit, a slow push takes some off, a curved swipe bends it.',
      'Stop your thumb or pull back to cancel. Inside 8 ft, just tap the disc.',
    ],
    art: (ctx, x, y, t) => {
      drawBasket(ctx, x + 70, y + 40, Math.sin(t * 3) > 0.8 ? 1 : 0);
      const f = (t * 0.8) % 1;
      ctx.fillStyle = PAL.amber;
      for (let i = 0; i < 40 * f; i += 2) ctx.fillRect(Math.round(x + 70 + Math.sin(i / 12) * 4), y + 92 - i, 2, 2);
    },
  },
  {
    title: '6 · SCORING',
    text: [
      'Par is the target. A hole stops at par + 5, so nobody is out there all night.',
      'You get 3 mulligans a round to rewind your last throw.',
      'The game saves after every hole. Continue from the title.',
    ],
    art: (ctx, x, y) => {
      panel(ctx, x + 20, y + 10, 100, 70, PAL.ink, PAL.inkDim);
      const rows = [['1', '3', '2'], ['2', '4', '4'], ['3', '3', '4']];
      rows.forEach((r, i) => {
        drawText(ctx, `HOLE ${r[0]}`, x + 28, y + 18 + i * 14, PAL.night1);
        drawText(ctx, `PAR ${r[1]}`, x + 62, y + 18 + i * 14, PAL.night3);
        drawText(ctx, r[2], x + 104, y + 18 + i * 14, PAL.night1);
      });
      ctx.strokeStyle = PAL.red;
      ctx.beginPath();
      ctx.arc(x + 105.5, y + 20.5, 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeRect(x + 100.5, y + 43.5, 10, 9);
    },
  },
];

export class HowToScene extends MenuScene {
  private page = 0;

  constructor(done: () => void) {
    super({ items: [], top: 0, onBack: done });
    const y = VIEW_H - 28;
    const last = () => this.page === PAGES.length - 1;
    const done_ = { x: 64, y, w: 52, h: 22, caption: () => '', value: () => 'DONE', onTap: done, primary: false };
    const next = { x: 122, y, w: 52, h: 22, caption: () => '', value: () => 'NEXT', onTap: () => this.turn(1), enabled: () => !last(), primary: true };
    this.buttons = [{ x: 6, y, w: 52, h: 22, caption: () => '', value: () => 'BACK', onTap: () => this.turn(-1), enabled: () => this.page > 0 }, done_, next];
    this.doneButton = done_;
    this.isLast = last;
  }

  private doneButton: { primary: boolean };
  private isLast: () => boolean;

  private turn(d: number) {
    this.page = Math.max(0, Math.min(PAGES.length - 1, this.page + d));
  }

  keyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowRight') this.turn(1);
    else if (e.key === 'ArrowLeft') this.turn(-1);
    else return super.keyDown(e);
    return true;
  }

  render(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = PAL.night1;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const p = PAGES[this.page];
    drawText(ctx, 'HOW TO PLAY', VIEW_W / 2, 10, PAL.haze, 'center');
    drawText(ctx, p.title, VIEW_W / 2, 24, PAL.amber, 'center');
    panel(ctx, 18, 36, 144, 100, PAL.grassDark, PAL.night3);
    p.art(ctx, 20, 40, this.time);
    let y = 148;
    for (const para of p.text) {
      for (const line of wrapText(para, VIEW_W - 20)) {
        drawText(ctx, line, 10, y, PAL.ink);
        y += 8;
      }
      y += 5;
    }
    // The amber button walks you through the pages, then finishes.
    this.doneButton.primary = this.isLast();
    drawText(ctx, `PAGE ${this.page + 1} OF ${PAGES.length}`, VIEW_W / 2, VIEW_H - 38, PAL.haze, 'center');
    for (const b of this.buttons) drawButton(ctx, b);
  }
}
