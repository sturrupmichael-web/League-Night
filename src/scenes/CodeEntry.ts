/** Type a friend's 6-character match code on an on-screen keypad (or a real keyboard). */
import { sfx } from '../core/audio';
import type { PointerInfo } from '../core/input';
import type { Scene } from '../core/scene';
import { VIEW_W } from '../core/screen';
import { CODE_ALPHABET } from '../net/types';
import { drawText } from '../render/font';
import { PAL } from '../render/palette';
import { panel } from '../render/sprites';
import { type Button, drawButton, hit } from '../ui/button';
import { drawBigText, drawLanterns } from '../ui/menu';

const COLS = 8;
const KEY_W = 20;
const KEY_H = 22;
const KEYS_X = Math.round((VIEW_W - COLS * KEY_W) / 2);
const KEYS_Y = 128;

export class CodeEntryScene implements Scene {
  code = '';
  private time = 0;
  private buttons: Button[];
  private pressed: Button | null = null;
  message = '';
  busy = false;
  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Backspace') this.del();
    else if (e.key === 'Enter') this.submit();
    else if (e.key.length === 1) this.type(e.key.toUpperCase());
  };

  constructor(
    private onJoin: (code: string, scene: CodeEntryScene) => void,
    private onBack: () => void,
    initial = '',
  ) {
    for (const c of initial.toUpperCase()) this.type(c);
    this.buttons = [...CODE_ALPHABET].map((ch, i) => ({
      x: KEYS_X + (i % COLS) * KEY_W,
      y: KEYS_Y + Math.floor(i / COLS) * KEY_H,
      w: KEY_W - 2,
      h: KEY_H - 2,
      caption: () => '',
      value: () => ch,
      onTap: () => this.type(ch),
    }));
    const y = KEYS_Y + 4 * KEY_H + 8;
    this.buttons.push(
      { x: 10, y, w: 50, h: 22, caption: () => 'UNDO', value: () => 'DEL', onTap: () => this.del() },
      { x: 64, y, w: 52, h: 22, caption: () => 'FROM CLIPBOARD', value: () => 'PASTE', onTap: () => void this.paste(), enabled: () => !!navigator.clipboard?.readText },
      { x: 120, y, w: 50, h: 22, caption: () => (this.code.length === 6 ? 'GO' : `${6 - this.code.length} MORE`), value: () => 'JOIN', onTap: () => this.submit(), enabled: () => this.code.length === 6 && !this.busy },
      { x: 30, y: y + 34, w: 120, h: 22, caption: () => '', value: () => 'BACK', onTap: () => this.leave() },
    );
    window.addEventListener('keydown', this.onKey);
  }

  private type(ch: string) {
    if (this.code.length >= 6 || !CODE_ALPHABET.includes(ch)) return;
    this.code += ch;
    this.message = '';
  }
  private del() {
    this.code = this.code.slice(0, -1);
    this.message = '';
  }
  private async paste() {
    try {
      const t = (await navigator.clipboard.readText()).toUpperCase();
      const m = new RegExp(`[${CODE_ALPHABET}]{6}`).exec(t.replace(/[^A-Z0-9]/g, ''));
      if (m) this.code = m[0];
      else this.message = 'NO CODE ON THE CLIPBOARD';
    } catch {
      this.message = 'CLIPBOARD NOT ALLOWED';
    }
  }
  private submit() {
    if (this.code.length !== 6 || this.busy) return;
    this.onJoin(this.code, this);
  }
  private leave() {
    this.dispose();
    this.onBack();
  }
  dispose() {
    window.removeEventListener('keydown', this.onKey);
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
    ctx.fillStyle = PAL.night1;
    ctx.fillRect(0, 0, VIEW_W, 320);
    drawLanterns(ctx, this.time);
    drawBigText(ctx, 'JOIN A MATCH', VIEW_W / 2, 36, PAL.amber);
    drawText(ctx, "TYPE YOUR FRIEND'S CODE", VIEW_W / 2, 58, PAL.haze, 'center');
    // Six code slots.
    const sw = 20;
    const x0 = Math.round((VIEW_W - 6 * (sw + 4) + 4) / 2);
    for (let i = 0; i < 6; i++) {
      const x = x0 + i * (sw + 4);
      const cur = i === this.code.length && Math.floor(this.time * 2) % 2 === 0;
      panel(ctx, x, 74, sw, 26, PAL.night2, cur ? PAL.amber : PAL.dusk);
      if (this.code[i]) drawBigText(ctx, this.code[i], x + sw / 2, 82, PAL.ink);
    }
    if (this.message) drawText(ctx, this.message, VIEW_W / 2, 110, PAL.red, 'center');
    else if (this.busy) drawText(ctx, 'JOINING...', VIEW_W / 2, 110, PAL.inkDim, 'center');
    for (const b of this.buttons) drawButton(ctx, b);
  }
}
