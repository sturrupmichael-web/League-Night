/**
 * Pointer Events for touch and mouse, one code path. Tracks every active pointer
 * (so later phases can do two-finger pinch) and forwards events in view coordinates.
 */
import type { Screen } from './screen';

export interface PointerInfo { id: number; x: number; y: number; startX: number; startY: number; startTime: number }

export interface InputHandler {
  down?(p: PointerInfo, all: Map<number, PointerInfo>): void;
  move?(p: PointerInfo, all: Map<number, PointerInfo>): void;
  up?(p: PointerInfo, all: Map<number, PointerInfo>): void;
  cancel?(p: PointerInfo, all: Map<number, PointerInfo>): void;
  /** Mouse wheel / trackpad: deltaY > 0 = zoom out. */
  wheel?(x: number, y: number, deltaY: number): void;
}

export class Input {
  readonly pointers = new Map<number, PointerInfo>();
  handler: InputHandler | null = null;

  constructor(private screen: Screen) {
    const c = screen.canvas;
    c.addEventListener('pointerdown', this.onDown);
    c.addEventListener('pointermove', this.onMove);
    c.addEventListener('pointerup', this.onUp);
    c.addEventListener('pointercancel', this.onCancel);
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const v = this.screen.toView(e.clientX, e.clientY);
        this.handler?.wheel?.(v.x, v.y, e.deltaY);
      },
      { passive: false },
    );
  }

  private onDown = (e: PointerEvent) => {
    e.preventDefault();
    this.screen.canvas.setPointerCapture(e.pointerId);
    const v = this.screen.toView(e.clientX, e.clientY);
    const p: PointerInfo = { id: e.pointerId, x: v.x, y: v.y, startX: v.x, startY: v.y, startTime: performance.now() };
    this.pointers.set(e.pointerId, p);
    this.handler?.down?.(p, this.pointers);
  };

  private onMove = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const v = this.screen.toView(e.clientX, e.clientY);
    p.x = v.x;
    p.y = v.y;
    this.handler?.move?.(p, this.pointers);
  };

  private onUp = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const v = this.screen.toView(e.clientX, e.clientY);
    p.x = v.x;
    p.y = v.y;
    this.pointers.delete(e.pointerId);
    this.handler?.up?.(p, this.pointers);
  };

  private onCancel = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    this.handler?.cancel?.(p, this.pointers);
  };
}
