/**
 * Scene stack. The top scene gets input and updates; overlay scenes (pause, prompts)
 * draw on top of whatever is beneath them.
 */
import { sfx } from './audio';
import type { InputHandler, PointerInfo } from './input';
import type { Scene } from './scene';

export class Game implements InputHandler {
  private stack: Scene[] = [];

  get top(): Scene | undefined {
    return this.stack[this.stack.length - 1];
  }

  set(scene: Scene) {
    this.stack = [scene];
  }
  push(scene: Scene) {
    this.top?.cancel?.({} as PointerInfo, new Map());
    this.stack.push(scene);
  }
  pop() {
    if (this.stack.length > 1) this.stack.pop();
  }

  update(dt: number) {
    this.top?.update(dt);
  }

  render(ctx: CanvasRenderingContext2D, alpha: number) {
    let start = this.stack.length - 1;
    while (start > 0 && this.stack[start].overlay) start--;
    for (let i = start; i < this.stack.length; i++) this.stack[i].render(ctx, alpha);
  }

  down(p: PointerInfo, all: Map<number, PointerInfo>) {
    sfx.unlock();
    this.top?.down?.(p, all);
  }
  move(p: PointerInfo, all: Map<number, PointerInfo>) {
    this.top?.move?.(p, all);
  }
  up(p: PointerInfo, all: Map<number, PointerInfo>) {
    this.top?.up?.(p, all);
  }
  cancel(p: PointerInfo, all: Map<number, PointerInfo>) {
    this.top?.cancel?.(p, all);
  }
  wheel(x: number, y: number, d: number) {
    this.top?.wheel?.(x, y, d);
  }
}
