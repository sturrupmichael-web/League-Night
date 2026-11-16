/**
 * Shared shell for the turn minigames: a title card with how-to text, the game itself,
 * then a result card that pays Cred. Each game is about 30 seconds.
 */
import { sfx } from '../../core/audio';
import type { PointerInfo } from '../../core/input';
import type { Scene } from '../../core/scene';
import { EXTRA_H, VIEW_H, VIEW_W } from '../../core/screen';

/** On tall phones the card sits in the middle of the extra height. */
const CARD_DY = Math.round(EXTRA_H / 2);
import { drawText, drawTextShadow, wrapText } from '../../render/font';
import { PAL } from '../../render/palette';
import { panel } from '../../render/sprites';
import { type Button, drawButton, hit } from '../../ui/button';
import { drawBigText } from '../../ui/menu';

export interface TurnGameInfo {
  id: string;
  name: string;
  how: string;
}

export abstract class TurnGame implements Scene {
  readonly music = 'turn' as const;
  protected phase: 'intro' | 'play' | 'result' = 'intro';
  protected time = 0;
  protected playT = 0;
  protected score = 0;
  private button: Button;
  private pressed = false;

  constructor(
    readonly info: TurnGameInfo,
    private onDone: (score: number, cred: number) => void,
  ) {
    this.button = { x: 40, y: 236 + CARD_DY, w: 100, h: 22, caption: () => '', value: () => 'LET\'S GO', onTap: () => this.advance() };
  }

  /** Cred paid for a score. */
  abstract cred(score: number): number;
  abstract scoreText(score: number): string;
  protected abstract playUpdate(dt: number): void;
  protected abstract playRender(ctx: CanvasRenderingContext2D): void;
  protected abstract playDown(p: PointerInfo): void;
  protected playMove(_p: PointerInfo): void {}
  protected playUp(_p: PointerInfo): void {}
  protected reset(): void {}

  /** Call from playUpdate when the game is over. */
  protected finish() {
    this.phase = 'result';
    sfx.play(this.score > 0 ? 'good' : 'bad');
    this.button = { ...this.button, caption: () => `+${this.cred(this.score)} CRED`, value: () => 'COLLECT' };
  }

  private advance() {
    if (this.phase === 'intro') {
      this.phase = 'play';
      this.playT = 0;
      this.score = 0;
      this.reset();
    } else if (this.phase === 'result') this.onDone(this.score, this.cred(this.score));
  }

  down(p: PointerInfo) {
    if (this.phase === 'play') return this.playDown(p);
    if (hit(this.button, p.x, p.y)) {
      this.pressed = true;
      this.button.pressed = true;
    }
  }
  move(p: PointerInfo) {
    if (this.phase === 'play') this.playMove(p);
  }
  up(p: PointerInfo) {
    if (this.phase === 'play') return this.playUp(p);
    if (this.pressed && hit(this.button, p.x, p.y)) {
      sfx.play('tap');
      this.advance();
    }
    this.pressed = false;
    this.button.pressed = false;
  }

  update(dt: number) {
    this.time += dt;
    if (this.phase === 'play') {
      this.playT += dt;
      this.playUpdate(dt);
    }
  }

  render(ctx: CanvasRenderingContext2D) {
    this.playRender(ctx);
    if (this.phase === 'play') return;
    ctx.fillStyle = 'rgba(13,11,19,0.7)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    panel(ctx, 14, 70 + CARD_DY, VIEW_W - 28, 196, PAL.night1, PAL.amber);
    drawText(ctx, 'AT THE TURN', VIEW_W / 2, 80 + CARD_DY, PAL.haze, 'center');
    drawBigText(ctx, this.info.name, VIEW_W / 2, 92 + CARD_DY, PAL.amber);
    if (this.phase === 'intro') {
      wrapText(this.info.how, VIEW_W - 48).forEach((l, i) => drawText(ctx, l, VIEW_W / 2, 120 + CARD_DY + i * 9, PAL.ink, 'center'));
    } else {
      drawText(ctx, 'FINAL', VIEW_W / 2, 130 + CARD_DY, PAL.haze, 'center');
      drawBigText(ctx, this.scoreText(this.score), VIEW_W / 2, 142 + CARD_DY, PAL.ink);
      drawTextShadow(ctx, `+${this.cred(this.score)} CRED`, VIEW_W / 2, 176 + CARD_DY, PAL.amber, PAL.night0, 'center');
    }
    drawButton(ctx, this.button);
  }
}

/** Little sky-and-trees backdrop shared by the turn games. */
export function drawParkBackdrop(ctx: CanvasRenderingContext2D, groundY: number) {
  const bands = [PAL.night1, PAL.night2, PAL.night3, PAL.dusk];
  const bh = Math.ceil(groundY / bands.length);
  bands.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(0, i * bh, VIEW_W, bh);
  });
  ctx.fillStyle = PAL.pine;
  for (let x = 0; x < VIEW_W; x++) {
    const h = 14 + Math.round(5 * Math.sin(x * 0.21) + 3 * Math.sin(x * 0.9 + 1) + 2 * Math.sin(x * 2.3));
    ctx.fillRect(x, groundY - h, 1, h);
  }
  ctx.fillStyle = PAL.grass;
  ctx.fillRect(0, groundY, VIEW_W, VIEW_H - groundY);
}
