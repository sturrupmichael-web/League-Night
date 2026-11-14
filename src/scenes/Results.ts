/** End-of-round card: scorecard and stats. */
import type { CourseDef } from '../game/hole';
import { cardTotals, type RoundState } from '../game/round';
import { formatToPar } from '../game/rules';
import { computeStats, formatPct } from '../game/stats';
import { VIEW_H, VIEW_W } from '../core/screen';
import { drawText } from '../render/font';
import { PAL } from '../render/palette';
import { drawButton } from '../ui/button';
import { drawBigText, drawLanterns, MenuScene } from '../ui/menu';

export class ResultsScene extends MenuScene {
  private tab: 'card' | 'stats' = 'card';

  constructor(
    private round: RoundState,
    private course: CourseDef,
    actions: { again: () => void; title: () => void },
  ) {
    super({ items: [], top: 0 });
    const y = VIEW_H - 26;
    this.buttons = [
      { x: 6, y: 52, w: 82, h: 18, caption: () => '', value: () => 'SCORECARD', onTap: () => (this.tab = 'card'), enabled: () => true },
      { x: 92, y: 52, w: 82, h: 18, caption: () => '', value: () => 'THE NUMBERS', onTap: () => (this.tab = 'stats'), enabled: () => true },
      { x: 6, y, w: 82, h: 22, caption: () => 'SAME AGAIN', value: () => 'NEW ROUND', onTap: actions.again },
      { x: 92, y, w: 82, h: 22, caption: () => 'BACK TO', value: () => 'TITLE', onTap: actions.title },
    ];
  }

  render(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = PAL.night1;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    drawLanterns(ctx, this.time, -8);
    const r = this.round;
    const t = cardTotals(r.card);
    drawText(ctx, `${this.course.name} · ${r.order.length} HOLES`, VIEW_W / 2, 18, PAL.inkDim, 'center');
    drawBigText(ctx, `${formatToPar(t.toPar)}  (${t.strokes})`, VIEW_W / 2, 28, t.toPar <= 0 ? PAL.amber : PAL.ink);
    for (const b of this.buttons.slice(0, 2)) {
      const on = (b === this.buttons[0]) === (this.tab === 'card');
      ctx.fillStyle = on ? PAL.night3 : PAL.night2;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = on ? PAL.amber : PAL.dusk;
      ctx.fillRect(b.x, b.y + b.h - 1, b.w, 1);
      drawText(ctx, b.value(), b.x + b.w / 2, b.y + 7, on ? PAL.ink : PAL.haze, 'center');
    }
    if (this.tab === 'card') this.drawCard(ctx);
    else this.drawStats(ctx);
    for (const b of this.buttons.slice(2)) drawButton(ctx, b);
  }

  private drawCard(ctx: CanvasRenderingContext2D) {
    const card = this.round.card;
    const rowH = card.length > 9 ? 8 : 10;
    let y = 76;
    const col = { n: 8, name: 22, par: 128, score: 150, diff: 172 };
    drawText(ctx, '#', col.n, y, PAL.haze, 'center');
    drawText(ctx, 'HOLE', col.name, y, PAL.haze);
    drawText(ctx, 'PAR', col.par, y, PAL.haze, 'center');
    drawText(ctx, 'YOU', col.score, y, PAL.haze, 'center');
    y += rowH;
    const totalRow = (label: string, slice: typeof card) => {
      const t = cardTotals(slice);
      ctx.fillStyle = PAL.night3;
      ctx.fillRect(4, y - 2, VIEW_W - 8, 1);
      drawText(ctx, label, col.name, y, PAL.amber);
      drawText(ctx, String(t.par), col.par, y, PAL.inkDim, 'center');
      drawText(ctx, String(t.strokes), col.score, y, PAL.ink, 'center');
      drawText(ctx, formatToPar(t.toPar), col.diff, y, t.toPar <= 0 ? PAL.amber : PAL.ink, 'right');
      y += rowH;
    };
    card.forEach((h, i) => {
      const hole = this.course.holes.find((x) => x.id === h.holeId);
      if (i % 2 === 0) {
        ctx.fillStyle = PAL.night2;
        ctx.fillRect(4, y - 2, VIEW_W - 8, rowH);
      }
      drawText(ctx, String(i + 1), col.n, y, PAL.inkDim, 'center');
      drawText(ctx, (hole?.name ?? '').slice(0, 24), col.name, y, PAL.ink);
      drawText(ctx, String(h.par), col.par, y, PAL.inkDim, 'center');
      const d = h.strokes - h.par;
      drawText(ctx, h.pickedUp ? `${h.strokes}*` : String(h.strokes), col.score, y, d < 0 ? PAL.amber : PAL.ink, 'center');
      // Shapes, not just colour: circles under par, boxes over par (doubled for 2+).
      const cx = col.score;
      const cy = y + 2;
      ctx.strokeStyle = d < 0 ? PAL.amber : PAL.haze;
      ctx.lineWidth = 1;
      if (d < 0) {
        ctx.beginPath();
        ctx.arc(cx + 0.5, cy + 0.5, 5, 0, Math.PI * 2);
        ctx.stroke();
        if (d <= -2) {
          ctx.beginPath();
          ctx.arc(cx + 0.5, cy + 0.5, 7, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (d > 0) {
        ctx.strokeRect(cx - 4.5, cy - 4.5, 10, 9);
        if (d >= 2) ctx.strokeRect(cx - 6.5, cy - 6.5, 14, 13);
      }
      drawText(ctx, formatToPar(d), col.diff, y, d < 0 ? PAL.amber : d > 0 ? PAL.inkDim : PAL.haze, 'right');
      y += rowH;
      if (card.length > 9 && i === 8) totalRow('OUT', card.slice(0, 9));
    });
    if (card.length > 9) totalRow('IN', card.slice(9));
    totalRow('TOTAL', card);
    if (card.some((h) => h.pickedUp)) drawText(ctx, '* PICKED UP AT THE LIMIT', VIEW_W / 2, y + 2, PAL.dusk, 'center');
  }

  private drawStats(ctx: CanvasRenderingContext2D) {
    const s = computeStats(this.round.card);
    const mulls = this.round.card.reduce((a, h) => a + h.mulligans, 0);
    const best = s.bestHole ? `HOLE ${s.bestHole.index + 1} (${formatToPar(s.bestHole.toPar)})` : '-';
    const rows: [string, string][] = [
      ['FAIRWAYS HIT', s.fairwayChances ? `${s.fairwaysHit}/${s.fairwayChances}` : '-'],
      ['C1 PUTTING (33 FT)', formatPct(s.c1Made, s.c1Tries)],
      ['C2 PUTTING (66 FT)', formatPct(s.c2Made, s.c2Tries)],
      ['AVERAGE DRIVE', s.avgDriveFt === null ? '-' : `${s.avgDriveFt} FT`],
      ['LONGEST THROW', `${Math.round(s.longestThrowFt)} FT`],
      ['LONGEST PUTT MADE', s.longestPuttFt ? `${Math.round(s.longestPuttFt)} FT` : '-'],
      ['BIRDIES OR BETTER', String(s.birdiesOrBetter)],
      ['ACES', String(s.aces)],
      ['PENALTY STROKES', String(s.penalties)],
      ['MULLIGANS USED', String(mulls)],
      ['BEST HOLE', best],
    ];
    let y = 82;
    rows.forEach(([k, v], i) => {
      if (i % 2 === 0) {
        ctx.fillStyle = PAL.night2;
        ctx.fillRect(4, y - 3, VIEW_W - 8, 13);
      }
      drawText(ctx, k, 8, y, PAL.haze);
      drawText(ctx, v, VIEW_W - 8, y, PAL.ink, 'right');
      y += 14;
    });
    drawText(ctx, 'C1 COUNTS GIMMES AS MAKES', VIEW_W / 2, y + 4, PAL.dusk, 'center');
  }
}
