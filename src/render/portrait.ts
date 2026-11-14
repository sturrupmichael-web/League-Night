/** Chaser portraits, drawn from rectangles so outfits are just palette swaps. */
import type { Chaser } from '../game/chasers';
import { PAL } from './palette';

/**
 * Draw a chaser standing, feet at (x, y). Each unit is `s` pixels; the figure is 16 units
 * wide and 30 tall. `pose` 0..1 lifts the throwing arm a little for idle animation.
 */
export function drawChaser(ctx: CanvasRenderingContext2D, x: number, y: number, c: Chaser, outfit: number, s = 2, pose = 0, locked = false) {
  const [shirt, trim] = c.colors.outfits[outfit % c.colors.outfits.length];
  const skin = locked ? PAL.night3 : c.colors.skin;
  const hair = locked ? PAL.night2 : c.colors.hair;
  const top = locked ? PAL.night3 : shirt;
  const acc = locked ? PAL.night2 : trim;
  const ox = Math.round(x - 8 * s);
  const oy = Math.round(y - 30 * s);
  const R = (u: number, v: number, w: number, h: number, col: string) => {
    ctx.fillStyle = col;
    ctx.fillRect(ox + u * s, oy + v * s, w * s, h * s);
  };
  // Shadow.
  ctx.fillStyle = 'rgba(10,8,14,0.45)';
  ctx.fillRect(ox + 2 * s, oy + 29 * s, 12 * s, s);
  // Legs and shoes.
  R(5, 20, 2, 8, PAL.night2);
  R(9, 20, 2, 8, PAL.night2);
  R(4, 28, 3, 1, PAL.night0);
  R(9, 28, 3, 1, PAL.night0);
  // Body.
  R(4, 11, 8, 10, top);
  R(4, 19, 8, 2, acc);
  R(7, 11, 2, 2, acc);
  // Arms: the throwing arm holds a disc.
  const lift = Math.round(pose * 2);
  R(2, 12, 2, 7, top);
  R(2, 19, 2, 1, skin);
  R(12, 12 - lift, 2, 6, top);
  R(12, 18 - lift, 2, 1, skin);
  R(13, 17 - lift, 3, 2, PAL.amber);
  // Head.
  R(5, 4, 6, 7, skin);
  R(6, 7, 1, 1, PAL.night0);
  R(9, 7, 1, 1, PAL.night0);
  // Hair and headwear by character.
  switch (c.id) {
    case 'mae':
      R(5, 3, 6, 2, hair);
      R(4, 4, 1, 4, hair);
      R(11, 4, 1, 4, hair);
      R(7, 1, 3, 2, hair); // bun
      R(4, 13, 1, 4, PAL.inkDim); // clipboard edge
      break;
    case 'dez':
      R(4, 3, 8, 2, acc); // cap
      R(10, 4, 3, 1, acc);
      R(5, 5, 1, 2, hair);
      break;
    case 'june':
      R(5, 3, 6, 2, hair);
      R(4, 4, 1, 8, hair);
      R(11, 4, 1, 8, hair);
      R(5, 2, 6, 1, hair);
      break;
    default:
      R(4, 3, 8, 1, acc); // flat cap
      R(5, 2, 6, 1, acc);
      R(5, 9, 6, 2, hair); // beard
      R(4, 5, 1, 3, hair);
      R(11, 5, 1, 3, hair);
  }
}
