/** End-of-round card: tonight's summary, scorecard, stats and the highlight reel. */
import type { CredLine } from '../game/cred';
import type { Highlight } from '../game/highlights';
import type { CourseDef } from '../game/hole';
import { cardTotals, type RoundState } from '../game/round';
import { formatToPar } from '../game/rules';
import { computeStats, formatPct } from '../game/stats';
import { VIEW_H, VIEW_W } from '../core/screen';
import { drawText } from '../render/font';
import { PAL } from '../render/palette';
import { drawButton } from '../ui/button';
import { drawBigText, drawLanterns, MenuScene } from '../ui/menu';

export interface NightSummary {
  headline: string;
  sub?: string;
  /** Standings or skins rows. */
  table?: { left: string; right: string; you?: boolean }[];
  cred: CredLine[];
  unlocks: string[];
}

type Tab = 'night' | 'card' | 'stats' | 'reel';
const TABS: { id: Tab; label: string }[] = [
  { id: 'night', label: 'TONIGHT' },
  { id: 'card', label: 'CARD' },
  { id: 'stats', label: 'NUMBERS' },
  { id: 'reel', label: 'REEL' },
];

export class ResultsScene extends MenuScene {
  private tab: Tab = 'night';
  private tabCount = TABS.length;
  /** Leaderboard posting: in flight, the place once posted (e.g. "#4"), or a message. */
  posting = false;
  posted = '';
  postMsg: { text: string; bad: boolean } | null = null;

  constructor(
    private round: RoundState,
    private course: CourseDef,
    actions: {
      again: () => void;
      title: () => void;
      reel: () => void;
      post?: (scene: ResultsScene) => void;
      /** Open the leaderboard on this round's course and length (after posting). */
      board?: (scene: ResultsScene) => void;
      /** Open the screen where an unlock lives (Chasers or Locker). */
      unlock?: (line: string, scene: ResultsScene) => void;
    },
    private night: NightSummary,
    private highlights: Highlight[],
  ) {
    super({ items: [], top: 0 });
    this.onUnlock = actions.unlock ? (u) => actions.unlock!(u, this) : null;
    const y = VIEW_H - 26;
    const tw = 42;
    this.buttons = [
      ...TABS.map((t, i) => ({ x: 4 + i * (tw + 1), y: 52, w: tw, h: 18, caption: () => '', value: () => t.label, onTap: () => (this.tab = t.id), enabled: () => true })),
      {
        x: 40, y: 236, w: 100, h: 22,
        caption: () => `${this.highlights.length} CLIP${this.highlights.length === 1 ? '' : 'S'}`,
        value: () => 'PLAY THE REEL',
        onTap: () => this.tab === 'reel' && this.highlights.length > 0 && actions.reel(),
        enabled: () => this.tab === 'reel' && this.highlights.length > 0,
      },
      ...(actions.post
        ? [
            { x: 4, y, w: 56, h: 22, caption: () => 'SAME AGAIN', value: () => 'PLAY', onTap: actions.again, primary: true },
            {
              x: 62, y, w: 56, h: 22,
              caption: () => (this.posting ? 'SENDING' : this.posted ? `YOU ARE ${this.posted}` : 'LEADERBOARD'),
              value: () => (this.posted && actions.board ? 'SEE BOARD' : this.posted || 'POST'),
              onTap: () => (this.posted ? actions.board?.(this) : actions.post!(this)),
              enabled: () => !this.posting && (!this.posted || !!actions.board),
            },
            { x: 120, y, w: 56, h: 22, caption: () => '', value: () => 'TITLE', onTap: actions.title },
          ]
        : [
            { x: 6, y, w: 82, h: 22, caption: () => 'SAME AGAIN', value: () => 'PLAY AGAIN', onTap: actions.again, primary: true },
            { x: 92, y, w: 82, h: 22, caption: () => '', value: () => 'TITLE', onTap: actions.title },
          ]),
    ];
  }

  private onUnlock: ((line: string) => void) | null;
  /** Where each unlock line was drawn on the TONIGHT tab, for taps. */
  private unlockRows: { y: number; line: string }[] = [];

  // The reel button only exists on the reel tab.
  down(p: Parameters<MenuScene['down']>[0]) {
    if (this.tab === 'night' && this.onUnlock) {
      const row = this.unlockRows.find((r) => p.y >= r.y - 2 && p.y < r.y + 8);
      if (row) {
        this.onUnlock(row.line);
        return;
      }
    }
    if (this.tab !== 'reel' && p.y >= 236 && p.y < 258 && p.x >= 40 && p.x < 140) return;
    super.down(p);
  }

  render(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = PAL.night1;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    drawLanterns(ctx, this.time, -14); // high enough to clear the header
    const r = this.round;
    const t = cardTotals(r.card);
    drawText(ctx, `${this.course.name} · ${r.order.length} HOLE${r.order.length === 1 ? '' : 'S'}`, VIEW_W / 2, 18, PAL.inkDim, 'center');
    drawBigText(ctx, `${formatToPar(t.toPar)}  (${t.strokes})`, VIEW_W / 2, 28, t.toPar <= 0 ? PAL.amber : PAL.ink);
    this.buttons.slice(0, this.tabCount).forEach((b, i) => {
      const on = TABS[i].id === this.tab;
      ctx.fillStyle = on ? PAL.night3 : PAL.night2;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = on ? PAL.amber : PAL.dusk;
      ctx.fillRect(b.x, b.y + b.h - 1, b.w, 1);
      drawText(ctx, b.value(), b.x + b.w / 2, b.y + 7, on ? PAL.ink : PAL.haze, 'center');
    });
    if (this.tab === 'card') this.drawCard(ctx);
    else if (this.tab === 'stats') this.drawStats(ctx);
    else if (this.tab === 'night') this.drawNight(ctx);
    else this.drawReel(ctx);
    const rest = this.buttons.slice(this.tabCount);
    if (this.tab === 'reel') drawButton(ctx, rest[0]);
    for (const b of rest.slice(1)) drawButton(ctx, b);
    if (this.postMsg) {
      const y = VIEW_H - 38;
      ctx.fillStyle = PAL.night1;
      ctx.fillRect(0, y - 2, VIEW_W, 10);
      drawText(ctx, this.postMsg.text, VIEW_W / 2, y, this.postMsg.bad ? PAL.red : PAL.amber, 'center');
    }
  }

  private drawNight(ctx: CanvasRenderingContext2D) {
    const n = this.night;
    let y = 78;
    drawText(ctx, n.headline, VIEW_W / 2, y, PAL.amber, 'center');
    y += 9;
    if (n.sub) {
      drawText(ctx, n.sub, VIEW_W / 2, y, PAL.inkDim, 'center');
      y += 9;
    }
    y += 3;
    for (const row of (n.table ?? []).slice(0, 9)) {
      if (row.you) {
        ctx.fillStyle = PAL.night3;
        ctx.fillRect(4, y - 2, VIEW_W - 8, 9);
      }
      drawText(ctx, row.left, 8, y, row.you ? PAL.amber : PAL.ink);
      drawText(ctx, row.right, VIEW_W - 8, y, row.you ? PAL.amber : PAL.inkDim, 'right');
      y += 9;
    }
    y += 4;
    ctx.fillStyle = PAL.night3;
    ctx.fillRect(4, y, VIEW_W - 8, 1);
    y += 5;
    const total = n.cred.reduce((a, l) => a + l.cred, 0);
    for (const l of n.cred.slice(0, 6)) {
      drawText(ctx, l.label, 8, y, PAL.haze);
      drawText(ctx, `+${l.cred}`, VIEW_W - 8, y, PAL.ink, 'right');
      y += 8;
    }
    drawText(ctx, 'CRED EARNED', 8, y + 1, PAL.amber);
    drawText(ctx, `+${total}`, VIEW_W - 8, y + 1, PAL.amber, 'right');
    y += 12;
    this.unlockRows = [];
    for (const u of n.unlocks.slice(0, 3)) {
      drawText(ctx, `NEW: ${u}${this.onUnlock ? ' >' : ''}`, VIEW_W / 2, y, PAL.amber, 'center');
      this.unlockRows.push({ y, line: u });
      y += 9;
    }
    this.drawMiniCard(ctx, y + 6);
  }

  /** The scorecard in short: hole numbers over each hole's score against par, nine to a row, if there's room. */
  private drawMiniCard(ctx: CanvasRenderingContext2D, top: number) {
    const card = this.round.card;
    const rows = Math.ceil(card.length / 9);
    const bottom = VIEW_H - 44; // above the post message and the buttons
    if (!card.length || top + rows * 20 + 8 > bottom) return;
    ctx.fillStyle = PAL.night3;
    ctx.fillRect(4, top, VIEW_W - 8, 1);
    let y = top + 6;
    const cw = 16;
    for (let r = 0; r < rows; r++) {
      const slice = card.slice(r * 9, r * 9 + 9);
      const x0 = 8;
      drawText(ctx, 'HOLE', x0, y, PAL.haze);
      drawText(ctx, 'PAR', x0, y + 9, PAL.haze);
      slice.forEach((h, i) => {
        const cx = x0 + 22 + i * cw + cw / 2;
        const d = h.strokes - h.par;
        drawText(ctx, String(r * 9 + i + 1), cx, y, PAL.inkDim, 'center');
        // Each hole against par (-1, E, +2): readable without the colour.
        drawText(ctx, formatToPar(d), cx, y + 9, d < 0 ? PAL.amber : d > 0 ? PAL.inkDim : PAL.ink, 'center');
      });
      y += 20;
    }
  }

  private drawReel(ctx: CanvasRenderingContext2D) {
    let y = 84;
    drawText(ctx, 'TONIGHT ON THE REEL', VIEW_W / 2, y, PAL.amber, 'center');
    y += 14;
    if (!this.highlights.length) drawText(ctx, 'NOTHING WORTH REPLAYING. YET.', VIEW_W / 2, y + 20, PAL.inkDim, 'center');
    this.highlights.forEach((h, i) => {
      ctx.fillStyle = i % 2 ? PAL.night1 : PAL.night2;
      ctx.fillRect(8, y - 3, VIEW_W - 16, 26);
      drawText(ctx, h.title, 14, y + 2, PAL.amber);
      drawText(ctx, h.sub, 14, y + 12, PAL.ink);
      y += 30;
    });
    drawText(ctx, 'REPLAYED FROM YOUR INPUTS WITH THE SAME SIM', VIEW_W / 2, 224, PAL.dusk, 'center');
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
