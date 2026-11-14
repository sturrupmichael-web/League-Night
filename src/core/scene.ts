import type { InputHandler } from './input';

export interface Scene extends InputHandler {
  /** Fixed-step simulation tick (dt is always 1/60 s). */
  update(dt: number): void;
  render(ctx: CanvasRenderingContext2D, alpha: number): void;
}
