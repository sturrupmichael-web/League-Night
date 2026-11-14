/**
 * Course camera: a tilted perspective view that follows the disc, lets the player drag to
 * scout and pinch to zoom, and can frame the whole hole (overview).
 */
import { clamp, DEG, lerp, type Vec2 } from '../sim/math';
import { type Camera, screenToWorld, worldToScreen } from '../render/field';

export type CamMode = 'follow' | 'free' | 'overview';

export interface CamGoal { x: number; y: number; zoom: number; ay: number }

export interface CamSettings {
  minZoom: number;
  maxZoom: number;
  camPitchDeg: number;
  camOverviewPitchDeg: number;
  camDistPx: number;
}

export class CameraRig {
  cam: Camera;
  mode: CamMode = 'follow';
  private goal: CamGoal;
  private pinch: { d0: number; zoom0: number; world: Vec2 } | null = null;

  constructor(
    start: CamGoal,
    private viewW: number,
    private cfg: CamSettings,
  ) {
    this.cam = { x: start.x, y: start.y, zoom: start.zoom, ax: viewW / 2, ay: start.ay, pitch: cfg.camPitchDeg * DEG, dist: cfg.camDistPx };
    this.goal = { ...start };
  }

  /** Where "follow" mode wants to be this frame. */
  setFollow(g: CamGoal) {
    if (this.mode === 'follow') this.goal = g;
  }

  /** Frame a box (world feet) inside the screen band [top, bottom], at the overview tilt. */
  overview(box: { x0: number; y0: number; x1: number; y1: number }, top: number, bottom: number) {
    const pad = 8;
    const cx = (box.x0 + box.x1) / 2;
    const cy = (box.y0 + box.y1) / 2;
    const probe: Camera = { x: cx, y: cy, zoom: 1, ax: this.viewW / 2, ay: 0, pitch: this.cfg.camOverviewPitchDeg * DEG, dist: this.cfg.camDistPx };
    // Bisect the zoom that fits the projected box, then centre it in the band.
    let lo = 0.02;
    let hi = 4;
    let ay = (top + bottom) / 2;
    for (let i = 0; i < 24; i++) {
      probe.zoom = (lo + hi) / 2;
      const near = worldToScreen(probe, box.x0, box.y0);
      const nearR = worldToScreen(probe, box.x1, box.y0);
      const far = worldToScreen(probe, box.x0, box.y1);
      const farR = worldToScreen(probe, box.x1, box.y1);
      const w = Math.max(nearR.x - near.x, farR.x - far.x);
      const h = near.y - far.y;
      if (w <= this.viewW - pad * 2 && h <= bottom - top - pad * 2) {
        lo = probe.zoom;
        ay = (top + bottom) / 2 - (near.y + far.y) / 2;
      } else hi = probe.zoom;
    }
    this.goal = { x: cx, y: cy, zoom: lo, ay };
    this.mode = 'overview';
  }

  snapBack() {
    this.mode = 'follow';
  }

  private goFree() {
    if (this.mode !== 'free') {
      this.mode = 'free';
      this.goal = { x: this.cam.x, y: this.cam.y, zoom: this.cam.zoom, ay: this.cam.ay };
    }
  }

  /** Drag-to-scout: keep the ground point under the finger under the finger. */
  panBy(from: Vec2, to: Vec2) {
    this.goFree();
    const a = screenToWorld(this.cam, from.x, from.y);
    const b = screenToWorld(this.cam, to.x, to.y);
    const lim = 400 / this.cam.zoom;
    this.cam.x += clamp(a.x - b.x, -lim, lim);
    this.cam.y += clamp(a.y - b.y, -lim, lim);
    this.goal.x = this.cam.x;
    this.goal.y = this.cam.y;
  }

  pinchStart(a: Vec2, b: Vec2) {
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this.pinch = { d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom0: this.cam.zoom, world: screenToWorld(this.cam, mid.x, mid.y) };
    this.goFree();
  }

  pinchMove(a: Vec2, b: Vec2) {
    if (!this.pinch) return;
    const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const zoom = clamp((this.pinch.zoom0 * d) / this.pinch.d0, this.cfg.minZoom, this.cfg.maxZoom);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this.zoomKeeping(this.pinch.world, mid, zoom);
  }

  pinchEnd() {
    this.pinch = null;
  }

  /** Mouse-wheel zoom around a screen point (desktop). */
  zoomAt(sx: number, sy: number, factor: number) {
    const w = screenToWorld(this.cam, sx, sy);
    this.goFree();
    this.zoomKeeping(w, { x: sx, y: sy }, clamp(this.cam.zoom * factor, this.cfg.minZoom, this.cfg.maxZoom));
  }

  /** Set the zoom, then slide the camera so `world` sits under screen point `at`. */
  private zoomKeeping(world: Vec2, at: Vec2, zoom: number) {
    this.cam.zoom = zoom;
    const now = screenToWorld(this.cam, at.x, at.y);
    this.cam.x += world.x - now.x;
    this.cam.y += world.y - now.y;
    this.goal = { x: this.cam.x, y: this.cam.y, zoom, ay: this.cam.ay };
  }

  update(dt: number, rate = 5) {
    const k = 1 - Math.exp(-dt * rate);
    this.cam.dist = this.cfg.camDistPx;
    const pitchGoal = (this.mode === 'overview' ? this.cfg.camOverviewPitchDeg : this.mode === 'free' ? this.cam.pitch / DEG : this.cfg.camPitchDeg) * DEG;
    this.cam.pitch = lerp(this.cam.pitch, pitchGoal, k);
    if (this.mode === 'free' || this.pinch) return;
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
