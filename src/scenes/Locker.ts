/** The locker: Cred and tier, disc dyes, pins and trophies, and the turn games to play any time. */
import type { SaveData } from '../core/save';
import { VIEW_W } from '../core/screen';
import { credTier, CRED_TIERS, DYES } from '../game/cred';
import { drawText } from '../render/font';
import { PAL } from '../render/palette';
import { fillCircle, panel } from '../render/sprites';
import { drawBigText, drawLanterns, MenuScene } from '../ui/menu';

export const TURN_GAMES = [
  { id: 'bullseye', name: 'BULLSEYE BOARD' },
  { id: 'lost', name: 'LOST AND FOUND' },
  { id: 'skip', name: 'SKIP CONTEST' },
];

export class LockerScene extends MenuScene {
  constructor(
    private save: SaveData,
    persist: () => void,
    actions: { back: () => void; turnGame: (id: string) => void },
  ) {
    super({ items: [], top: 0 });
    this.opts.draw = (ctx, t) => this.drawContent(ctx, t);
    const tier = () => credTier(save.cred).index;
    const dye = () => DYES.find((d) => d.id === save.dye) ?? DYES[0];
    this.buttons = [
      {
        x: 20, y: 120, w: 140, h: 22,
        caption: () => 'DISC DYE',
        value: () => `< ${dye().name} >`,
        onTap: () => {
          const open = DYES.filter((d) => d.tier <= tier());
          const i = open.findIndex((d) => d.id === save.dye);
          save.dye = open[(i + 1) % open.length].id;
          persist();
        },
      },
      ...TURN_GAMES.map((g, i) => ({
        x: 20, y: 214 + i * 24, w: 140, h: 22,
        caption: () => 'PLAY FOR CRED',
        value: () => g.name,
        onTap: () => actions.turnGame(g.id),
      })),
      { x: 50, y: 290, w: 80, h: 22, caption: () => '', value: () => 'BACK', onTap: actions.back },
    ];
  }

  private drawContent(ctx: CanvasRenderingContext2D, time: number) {
    drawLanterns(ctx, time, -8);
    drawBigText(ctx, 'LOCKER', VIEW_W / 2, 16, PAL.amber);
    const s = this.save;
    const { tier, next } = credTier(s.cred);
    panel(ctx, 8, 36, VIEW_W - 16, 52, PAL.night2, PAL.dusk);
    drawText(ctx, `${s.cred} CRED`, 14, 42, PAL.amber);
    drawText(ctx, tier.name, VIEW_W - 14, 42, PAL.ink, 'right');
    const x = 14;
    const w = VIEW_W - 28;
    ctx.fillStyle = PAL.night3;
    ctx.fillRect(x, 52, w, 5);
    const f = next ? (s.cred - tier.at) / (next.at - tier.at) : 1;
    ctx.fillStyle = PAL.amber;
    ctx.fillRect(x, 52, Math.round(w * Math.min(1, f)), 5);
    drawText(ctx, next ? `${next.at - s.cred} TO ${next.name}` : 'TOP OF THE LEAGUE', VIEW_W / 2, 62, PAL.inkDim, 'center');
    drawText(ctx, 'TIERS UNLOCK DYES AND OUTFITS', VIEW_W / 2, 74, PAL.dusk, 'center');
    // Dye preview swatch.
    const dye = DYES.find((d) => d.id === s.dye) ?? DYES[0];
    const nextDye = DYES.find((d) => d.tier > credTier(s.cred).index);
    drawText(ctx, nextDye ? `NEXT DYE AT ${CRED_TIERS[nextDye.tier].name}` : 'EVERY DYE UNLOCKED', VIEW_W / 2, 98, PAL.dusk, 'center');
    ctx.fillStyle = PAL.night0;
    ctx.fillRect(VIEW_W / 2 - 11, 106, 22, 8);
    ctx.fillStyle = dye.color ?? PAL.amber;
    ctx.fillRect(VIEW_W / 2 - 10, 107, 20, 6);
    // Pins and trophies.
    drawText(ctx, 'PINS AND TROPHIES', VIEW_W / 2, 152, PAL.haze, 'center');
    const items: { label: string; got: boolean; cup: boolean }[] = [
      { label: 'LANTERN PARK PIN', got: s.pins.includes('lantern-park'), cup: false },
      { label: 'THE LANTERN CUP', got: s.trophies.includes('lantern-cup'), cup: true },
    ];
    items.forEach((it, i) => {
      const cx = 52 + i * 76;
      const cy = 172;
      if (it.cup) {
        ctx.fillStyle = it.got ? PAL.amber : PAL.night3;
        ctx.fillRect(cx - 6, cy - 6, 12, 7);
        ctx.fillRect(cx - 2, cy + 1, 4, 4);
        ctx.fillRect(cx - 5, cy + 5, 10, 2);
      } else {
        fillCircle(ctx, cx, cy, 6, it.got ? PAL.amber : PAL.night3);
        fillCircle(ctx, cx, cy, 3, it.got ? PAL.red : PAL.night2);
      }
      drawText(ctx, it.label, cx, cy + 12, it.got ? PAL.ink : PAL.dusk, 'center');
    });
    drawText(ctx, `CUPS ${s.cupsWon} · SKINS MATCHES ${s.skinsMatchesWon} · ROUNDS ${s.roundsFinished}`, VIEW_W / 2, 198, PAL.inkDim, 'center');
  }
}
