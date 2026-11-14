import type { InputHandler } from './input';
import type { Track } from './music';

export interface Scene extends InputHandler {
  /** Fixed-step simulation tick (dt is always 1/60 s). */
  update(dt: number): void;
  render(ctx: CanvasRenderingContext2D, alpha: number): void;
  /** Draw the scene beneath this one first (pause menus, prompts). */
  overlay?: boolean;
  /** Music for this screen (default: the menu tune). Overlays keep what is playing. */
  music?: Track;
}
