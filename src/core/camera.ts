/**
 * Top-down camera: follows the disc, lets the player drag to scout and pinch to zoom,
 * and can frame the whole hole (overview).
 */
import { clamp, lerp, type Vec2 } from '../sim/math';
import { type Camera, screenToWorld } from '../render/field';

export type CamMode = 'follow' | 'free' | 'overview';

export interface CamGoal { x: number; y: number; zoom: number; ay: number }

export class CameraRig {
  cam: Camera;
  mode: CamMode = 'follow';
  private goal: CamGoal;
  private pinch: { d0: number; zoom0: number; world: Vec2 } | null = null;

  constructor(
    start: CamGoal,
    private viewW: number,
    private limits: { minZoom: number; maxZoom: number },
  ) {
    this.cam = { x: start.x, y: start.y, zoom: start.zoom, ax: viewW / 2, ay: start.ay };
    this.goal = { ...start };
  }

  /** Where "follow" mode wants to be this frame. */
  setFollow(g: CamGoal) {
    if (this.mode === 'follow') this.goal = g;
  }

  /** Frame a box (world feet) inside the screen band [top, bottom]. */
  overview(box: { x0: number; y0: number; x1: number; y1: number }, top: number, bottom: number) {
    const pad = 8;
    const zoom = Math.min((this.viewW - pad * 2) / (box.x1 - box.x0), (bottom - top - pad * 2) / (box.y1 - box.y0));
    this.goal = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2, zoom, ay: (top + bottom) / 2 };
    this.mode = 'overview';
  }

  snapBack() {
    this.mode = 'follow';
  }

  /** Drag-to-scout, in screen pixels. */
  panBy(dx: number, dy: number) {
    if (this.mode !== 'free') {
      this.mode = 'free';
      this.goal = { x: this.cam.x, y: this.cam.y, zoom: this.cam.zoom, ay: this.cam.ay };
    }
    this.cam.x -= dx / this.cam.zoom;
    this.cam.y += dy / this.cam.zoom;
    this.goal.x = this.cam.x;
    this.goal.y = this.cam.y;
  }

  pinchStart(a: Vec2, b: Vec2) {
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this.pinch = { d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom0: this.cam.zoom, world: screenToWorld(this.cam, mid.x, mid.y) };
    if (this.mode !== 'free') {
      this.mode = 'free';
      this.goal = { x: this.cam.x, y: this.cam.y, zoom: this.cam.zoom, ay: this.cam.ay };
    }
  }

  pinchMove(a: Vec2, b: Vec2) {
    if (!this.pinch) return;
    const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const zoom = clamp((this.pinch.zoom0 * d) / this.pinch.d0, this.limits.minZoom, this.limits.maxZoom);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // Keep the world point that started under the fingers under the fingers.
    this.cam.zoom = zoom;
    this.cam.x = this.pinch.world.x - (mid.x - this.cam.ax) / zoom;
    this.cam.y = this.pinch.world.y + (mid.y - this.cam.ay) / zoom;
    this.goal = { x: this.cam.x, y: this.cam.y, zoom, ay: this.cam.ay };
  }

  pinchEnd() {
    this.pinch = null;
  }

  /** Mouse-wheel zoom around a screen point (desktop). */
  zoomAt(sx: number, sy: number, factor: number) {
    const w = screenToWorld(this.cam, sx, sy);
    const zoom = clamp(this.cam.zoom * factor, this.limits.minZoom, this.limits.maxZoom);
    this.mode = 'free';
    this.cam.zoom = zoom;
    this.cam.x = w.x - (sx - this.cam.ax) / zoom;
    this.cam.y = w.y + (sy - this.cam.ay) / zoom;
    this.goal = { x: this.cam.x, y: this.cam.y, zoom, ay: this.cam.ay };
  }

  update(dt: number, rate = 5) {
    if (this.mode === 'free' || this.pinch) return;
    const k = 1 - Math.exp(-dt * rate);
    this.cam.x = lerp(this.cam.x, this.goal.x, k);
    this.cam.y = lerp(this.cam.y, this.goal.y, k);
    this.cam.zoom = lerp(this.cam.zoom, this.goal.zoom, k);
    this.cam.ay = lerp(this.cam.ay, this.goal.ay, k);
  }

  /** Has the player moved the view away from the disc? */
  get detached() {
    return this.mode !== 'follow';
  }
}
