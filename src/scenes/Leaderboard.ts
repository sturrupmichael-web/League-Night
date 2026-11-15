/** The online leaderboard: each player's best round per course and length, all time or this week. */
import { EXTRA_H, VIEW_H, VIEW_W } from '../core/screen';
import { COURSES } from '../content/courses';
import { formatToPar } from '../game/rules';
import { boardLabel, weekStart } from '../net/leaderboard';
import type { BoardKey, BoardRow, LeaderboardApi } from '../net/types';
import { drawText } from '../render/font';
import { PAL } from '../render/palette';
import { drawButton } from '../ui/button';
import { drawBigText, drawLanterns, MenuScene } from '../ui/menu';

const ROWS = 14 + Math.floor(EXTRA_H / 10); // taller phones show more of the board

export class LeaderboardScene extends MenuScene {
  private courseIdx: number;
  private holes: 9 | 18;
  private week = false;
  private rows: BoardRow[] | null = null;
  private mine: { rank: number; strokes: number; toPar: number } | null = null;
  private name: string | null = null;
  private error = '';
  private loadNo = 0;
  private label = '';
  private toggles: { b: { x: number; y: number; w: number; h: number }; on: () => boolean }[] = [];

  constructor(
    private net: Promise<LeaderboardApi & { label: string }>,
    private actions: { back: () => void; changeName: () => void },
    start: { courseId?: string; holes?: 9 | 18 } = {},
  ) {
    super({ items: [], top: 0 });
    this.courseIdx = Math.max(0, COURSES.findIndex((c) => c.id === start.courseId));
    this.holes = start.holes ?? 18;
    const tog = (x: number, w: number, value: string, on: () => boolean, tap: () => void) => {
      const b = { x, y: 62, w, h: 22, caption: () => '', value: () => value, onTap: () => { if (!on()) { tap(); this.load(); } } };
      this.toggles.push({ b, on });
      return b;
    };
    this.buttons = [
      { x: 4, y: 40, w: 20, h: 20, caption: () => '', value: () => '<', onTap: () => { this.courseIdx = (this.courseIdx + COURSES.length - 1) % COURSES.length; this.load(); } },
      { x: VIEW_W - 24, y: 40, w: 20, h: 20, caption: () => '', value: () => '>', onTap: () => { this.courseIdx = (this.courseIdx + 1) % COURSES.length; this.load(); } },
      tog(4, 40, '9', () => this.holes === 9, () => (this.holes = 9)),
      tog(46, 40, '18', () => this.holes === 18, () => (this.holes = 18)),
      tog(92, 42, 'ALL TIME', () => !this.week, () => (this.week = false)),
      tog(136, 40, 'WEEK', () => this.week, () => (this.week = true)),
      { x: 6, y: VIEW_H - 26, w: 82, h: 22, caption: () => (this.name ? 'YOU ARE' : 'NO NAME YET'), value: () => (this.name ?? 'PICK A NAME').toUpperCase(), onTap: () => this.actions.changeName(), enabled: () => !this.error },
      { x: 92, y: VIEW_H - 26, w: 82, h: 22, caption: () => '', value: () => 'BACK', onTap: () => this.actions.back() },
    ];
    this.load();
  }

  get key(): BoardKey {
    return { courseId: COURSES[this.courseIdx].id, holes: this.holes, since: this.week ? weekStart() : null };
  }

  /** Reload the board (and the player's own best). Older answers that arrive late are dropped. */
  load() {
    this.rows = null;
    this.mine = null;
    this.error = '';
    const n = ++this.loadNo;
    const key = this.key;
    this.net
      .then((api) => {
        // The local stand-in only knows this browser's rounds: say so.
        this.label = api.label === 'ONLINE' ? '' : api.label;
        return Promise.all([api.board(key), api.myBest(key).catch(() => null), api.myName().catch(() => null)]);
      })
      .then(([rows, mine, name]) => {
        if (n !== this.loadNo) return;
        this.rows = rows;
        this.mine = mine;
        this.name = name;
      })
      .catch((e: Error) => {
        if (n === this.loadNo) this.error = e.message || "CAN'T REACH THE LEADERBOARD";
      });
  }

  render(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = PAL.night1;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    drawLanterns(ctx, this.time, -8);
    drawBigText(ctx, 'LEADERBOARD', VIEW_W / 2, 20, PAL.amber);
    const course = COURSES[this.courseIdx];
    drawText(ctx, course.name, VIEW_W / 2, 43, PAL.ink, 'center');
    drawText(ctx, `PAR ${this.holes === 18 ? course.holes.reduce((a, h) => a + h.par, 0) : course.holes.slice(0, 9).reduce((a, h) => a + h.par, 0)}`, VIEW_W / 2, 52, PAL.inkDim, 'center');
    for (const b of this.buttons) drawButton(ctx, b);
    for (const t of this.toggles) {
      if (!t.on()) continue;
      ctx.strokeStyle = PAL.amber;
      ctx.lineWidth = 1;
      ctx.strokeRect(t.b.x + 0.5, t.b.y + 0.5, t.b.w - 1, t.b.h - 1);
    }

    let y = 89;
    drawText(ctx, boardLabel(this.key), VIEW_W / 2, y, PAL.haze, 'center');
    y += 11;
    if (this.error) {
      drawText(ctx, this.error, VIEW_W / 2, y + 30, PAL.red, 'center');
      return;
    }
    if (this.label) drawText(ctx, this.label, VIEW_W / 2, VIEW_H - 50, PAL.inkDim, 'center');
    if (!this.rows) {
      drawText(ctx, 'LOADING...', VIEW_W / 2, y + 30, PAL.inkDim, 'center');
      return;
    }
    if (!this.rows.length) {
      drawText(ctx, 'NOBODY YET.', VIEW_W / 2, y + 26, PAL.ink, 'center');
      drawText(ctx, `FINISH ${this.holes} HOLES HERE AND POST IT`, VIEW_W / 2, y + 36, PAL.inkDim, 'center');
    }
    const me = this.name?.toUpperCase();
    for (const r of this.rows.slice(0, ROWS)) {
      const you = !!me && r.name.toUpperCase() === me;
      if (you) {
        ctx.fillStyle = PAL.night3;
        ctx.fillRect(4, y - 2, VIEW_W - 8, 9);
      }
      const c = you ? PAL.amber : r.rank <= 3 ? PAL.ink : PAL.inkDim;
      drawText(ctx, `${r.rank}`, 18, y, c, 'right');
      drawText(ctx, r.name, 24, y, c);
      drawText(ctx, `${r.strokes}`, VIEW_W - 34, y, PAL.inkDim, 'right');
      drawText(ctx, formatToPar(r.toPar), VIEW_W - 8, y, c, 'right');
      y += 10;
    }
    const shown = this.mine && this.rows.slice(0, ROWS).some((r) => me && r.name.toUpperCase() === me);
    if (this.mine && !shown) {
      drawText(ctx, `YOU: #${this.mine.rank} · ${formatToPar(this.mine.toPar)} (${this.mine.strokes})`, VIEW_W / 2, VIEW_H - 40, PAL.amber, 'center');
    }
  }
}
