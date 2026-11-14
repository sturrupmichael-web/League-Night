/** Pick a leaderboard name on an on-screen keyboard (or a real one). */
import { VIEW_H, VIEW_W } from '../core/screen';
import { cleanName } from '../net/leaderboard';
import { NAME_MAX } from '../net/types';
import { drawText } from '../render/font';
import { PAL } from '../render/palette';
import { panel } from '../render/sprites';
import { drawButton } from '../ui/button';
import { drawBigText, drawLanterns, MenuScene } from '../ui/menu';

const KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-.';
const COLS = 8;
const KEY_W = 20;
const KEY_H = 20;
const KEYS_X = Math.round((VIEW_W - COLS * KEY_W) / 2);
const KEYS_Y = 112;

export class NameEntryScene extends MenuScene {
  name = '';
  message = '';
  busy = false;
  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Backspace') this.del();
    else if (e.key === 'Enter') this.submit();
    else if (e.key.length === 1) this.type(e.key.toUpperCase());
  };

  constructor(
    private onSave: (name: string, scene: NameEntryScene) => void,
    private onBack: () => void,
    initial = '',
    private why = 'SHOWN ON THE LEADERBOARD',
  ) {
    super({ items: [], top: 0 });
    this.name = cleanName(initial).toUpperCase();
    this.buttons = [...KEYS].map((ch, i) => ({
      x: KEYS_X + (i % COLS) * KEY_W,
      y: KEYS_Y + Math.floor(i / COLS) * KEY_H,
      w: KEY_W - 2,
      h: KEY_H - 2,
      caption: () => '',
      value: () => ch,
      onTap: () => this.type(ch),
    }));
    const y = KEYS_Y + 5 * KEY_H + 6;
    this.buttons.push(
      { x: 10, y, w: 50, h: 22, caption: () => '', value: () => 'SPACE', onTap: () => this.type(' ') },
      { x: 64, y, w: 52, h: 22, caption: () => '', value: () => 'DEL', onTap: () => this.del() },
      { x: 120, y, w: 50, h: 22, caption: () => (this.busy ? 'SAVING' : ''), value: () => 'SAVE', onTap: () => this.submit(), enabled: () => cleanName(this.name).length > 0 && !this.busy },
      { x: 30, y: y + 32, w: 120, h: 22, caption: () => '', value: () => 'BACK', onTap: () => this.leave() },
    );
    window.addEventListener('keydown', this.onKey);
  }

  private type(ch: string) {
    if (this.name.length >= NAME_MAX) return;
    if (ch === ' ' ? this.name === '' || this.name.endsWith(' ') : !/^[A-Z0-9\-.'!?_]$/.test(ch)) return;
    this.name += ch;
    this.message = '';
  }
  private del() {
    this.name = this.name.slice(0, -1);
    this.message = '';
  }
  private submit() {
    const n = cleanName(this.name);
    if (!n || this.busy) return;
    this.onSave(n, this);
  }
  private leave() {
    this.dispose();
    this.onBack();
  }
  dispose() {
    window.removeEventListener('keydown', this.onKey);
  }

  render(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = PAL.night1;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    drawLanterns(ctx, this.time);
    drawBigText(ctx, 'YOUR NAME', VIEW_W / 2, 30, PAL.amber);
    drawText(ctx, this.why, VIEW_W / 2, 52, PAL.haze, 'center');
    panel(ctx, 14, 72, VIEW_W - 28, 22, PAL.night2, PAL.amber);
    const cursor = Math.floor(this.time * 2) % 2 === 0 && this.name.length < NAME_MAX ? '_' : '';
    drawBigText(ctx, this.name + cursor, VIEW_W / 2, 79, PAL.ink);
    if (this.message) drawText(ctx, this.message, VIEW_W / 2, 100, PAL.red, 'center');
    else drawText(ctx, `${this.name.length}/${NAME_MAX}`, VIEW_W / 2, 100, PAL.night3, 'center');
    for (const b of this.buttons) drawButton(ctx, b);
  }
}
