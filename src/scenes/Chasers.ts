/** Pick your chaser: stats, hand, outfit and their story, one chapter at a time. */
import type { SaveData } from '../core/save';
import { VIEW_W } from '../core/screen';
import { chaptersUnlocked, CHASERS, isChaserUnlocked, STAT_EFFECT } from '../game/chasers';
import { credTier, CRED_TIERS, OUTFIT_TIERS } from '../game/cred';
import { drawText, wrapText } from '../render/font';
import { PAL } from '../render/palette';
import { drawChaser } from '../render/portrait';
import { panel } from '../render/sprites';
import { drawBigText, drawLanterns, MenuScene } from '../ui/menu';

const STAT_ROWS: { key: keyof typeof STAT_EFFECT; label: string }[] = [
  { key: 'power', label: 'POWER' },
  { key: 'accuracy', label: 'ACCURACY' },
  { key: 'putting', label: 'PUTTING' },
  { key: 'wind', label: 'WIND' },
];

export class ChaserScene extends MenuScene {
  private idx: number;
  private chapter = 0;

  constructor(
    private save: SaveData,
    private persist: () => void,
    done: () => void,
  ) {
    super({ items: [], top: 0 });
    this.opts.draw = (ctx) => this.drawContent(ctx);
    this.idx = Math.max(0, CHASERS.findIndex((c) => c.id === save.chaserId));
    const c = () => CHASERS[this.idx];
    const unlocked = () => isChaserUnlocked(c(), save);
    const row = 252;
    this.buttons = [
      { x: 4, y: 64, w: 20, h: 22, caption: () => '', value: () => '<', onTap: () => this.cycle(-1) },
      { x: 156, y: 64, w: 20, h: 22, caption: () => '', value: () => '>', onTap: () => this.cycle(1) },
      { x: 4, y: 226, w: 56, h: 20, caption: () => 'STORY', value: () => `< CH ${this.chapter + 1} >`, onTap: () => (this.chapter = (this.chapter + 1) % 3) },
      {
        x: 62, y: 226, w: 56, h: 20,
        caption: () => 'OUTFIT',
        value: () => `${this.outfit() + 1} OF 3`,
        onTap: () => this.cycleOutfit(),
        enabled: unlocked,
      },
      {
        x: 120, y: 226, w: 56, h: 20,
        caption: () => 'HAND',
        value: () => (save.settings.hand === 'right' ? 'RIGHTY' : 'LEFTY'),
        onTap: () => {
          save.settings.hand = save.settings.hand === 'right' ? 'left' : 'right';
          persist();
        },
      },
      {
        x: 4, y: row + 12, w: 84, h: 22,
        caption: () => (unlocked() ? (save.chaserId === c().id ? 'YOUR CHASER' : 'PLAY AS') : 'LOCKED'),
        value: () => (unlocked() ? c().name.split(' ')[0] : '----'),
        onTap: () => {
          if (!unlocked()) return;
          save.chaserId = c().id;
          save.settings.hand = c().hand;
          persist();
          done();
        },
        enabled: unlocked,
      },
      { x: 92, y: row + 12, w: 84, h: 22, caption: () => '', value: () => 'BACK', onTap: done },
    ];
  }

  private outfit() {
    return this.save.outfits[CHASERS[this.idx].id] ?? 0;
  }

  private cycleOutfit() {
    const tier = credTier(this.save.cred).index;
    const id = CHASERS[this.idx].id;
    let o = this.outfit();
    for (let k = 0; k < 3; k++) {
      o = (o + 1) % 3;
      if (tier >= OUTFIT_TIERS[o]) break;
    }
    this.save.outfits[id] = o;
    this.persist();
  }

  private cycle(d: number) {
    this.idx = (this.idx + d + CHASERS.length) % CHASERS.length;
    this.chapter = 0;
  }

  private drawContent(ctx: CanvasRenderingContext2D) {
    drawLanterns(ctx, this.time, -8);
    const c = CHASERS[this.idx];
    const unlocked = isChaserUnlocked(c, this.save);
    drawBigText(ctx, 'CHASERS', VIEW_W / 2, 16, PAL.amber);
    drawText(ctx, unlocked ? c.name : '? ? ?', VIEW_W / 2, 34, PAL.ink, 'center');
    drawText(ctx, c.title, VIEW_W / 2, 43, PAL.haze, 'center');
    // Portrait.
    panel(ctx, 30, 52, 52, 72, PAL.night2, PAL.night3);
    drawChaser(ctx, 56, 120, c, this.outfit(), 2, (Math.sin(this.time * 2) + 1) / 2, !unlocked);
    // Stats: pips from -2 to +2.
    STAT_ROWS.forEach((r, i) => {
      const y = 58 + i * 15;
      drawText(ctx, r.label, 88, y, PAL.haze);
      const v = c.stats[r.key];
      for (let k = -2; k <= 2; k++) {
        if (k === 0) continue;
        const on = (k > 0 && v >= k) || (k < 0 && v <= k);
        ctx.fillStyle = on ? (k > 0 ? PAL.amber : PAL.red) : PAL.night3;
        ctx.fillRect(88 + (k + 2) * 9 - (k > 0 ? 9 : 0), y + 7, 7, 3);
      }
    });
    drawText(ctx, `THROWS ${c.hand === 'right' ? 'RIGHTY' : 'LEFTY'}`, 88, 118, PAL.inkDim);
    // Story or lock.
    panel(ctx, 4, 130, VIEW_W - 8, 92, PAL.night1, PAL.dusk);
    if (!unlocked) {
      drawText(ctx, 'LOCKED', VIEW_W / 2, 150, PAL.red, 'center');
      wrapText(c.lock?.text ?? '', VIEW_W - 24).forEach((l, i) => drawText(ctx, l, VIEW_W / 2, 164 + i * 9, PAL.ink, 'center'));
    } else {
      const open = chaptersUnlocked(c, this.save);
      drawText(ctx, `CHAPTER ${this.chapter + 1} OF 3`, VIEW_W / 2, 135, PAL.amber, 'center');
      if (this.chapter < open) {
        wrapText(c.story[this.chapter], VIEW_W - 20).slice(0, 9).forEach((l, i) => drawText(ctx, l, 10, 146 + i * 8, PAL.ink));
      } else {
        const need = this.chapter === 1 ? `FINISH A ROUND AS ${c.name.split(' ')[0]}` : `WIN THE CUP OR A SKINS MATCH AS ${c.name.split(' ')[0]}`;
        drawText(ctx, 'NOT YET', VIEW_W / 2, 160, PAL.dusk, 'center');
        wrapText(need, VIEW_W - 24).forEach((l, i) => drawText(ctx, l, VIEW_W / 2, 174 + i * 9, PAL.inkDim, 'center'));
      }
    }
    const o = this.outfit();
    const tier = credTier(this.save.cred).index;
    const nextLocked = OUTFIT_TIERS.findIndex((t) => t > tier);
    if (unlocked && nextLocked > 0 && o === 0) drawText(ctx, `MORE OUTFITS AT ${CRED_TIERS[OUTFIT_TIERS[nextLocked]].name}`, VIEW_W / 2, 250, PAL.dusk, 'center');
  }
}
