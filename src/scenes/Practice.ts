/**
 * Practice field: slingshot a disc around an open park with distance markers.
 * Grab near the disc, pull back, release. Pull length = power; past the red line is the redline gamble.
 */
import { type Config } from '../config';
import { PRACTICE_BASKET, PRACTICE_FIELD, PRACTICE_MARKERS, PRACTICE_TEE } from '../content/practiceField';
import discsJson from '../content/discs.json';
import type { PointerInfo } from '../core/input';
import type { Scene } from '../core/scene';
import { VIEW_H, VIEW_W } from '../core/screen';
import { type Camera, FieldRenderer, worldToScreen } from '../render/field';
import { drawText, drawTextShadow } from '../render/font';
import { PAL } from '../render/palette';
import { drawBasket, drawDisc, drawTeePad, drawTree, fillCircle, panel } from '../render/sprites';
import type { Disc } from '../sim/discs';
import type { Hand, Style, ThrowInput } from '../sim/flight';
import type { RestKind } from '../sim/ground';
import { angleFromDir, clamp, dist, lerp, type PathPoint, type Vec2 } from '../sim/math';
import { makeRng, mixSeed } from '../sim/rng';
import { makeTerrain } from '../sim/terrain';
import { simulateThrow, type ThrowResult } from '../sim/throw';
import { CALM, rollWind, type Wind, windLabel } from '../sim/wind';
import { type Button, drawButton, hit } from '../ui/button';

const DISCS = discsJson as Disc[];
const RELEASES: { v: number; label: string }[] = [
  { v: -1, label: 'HYZER' },
  { v: 0, label: 'FLAT' },
  { v: 1, label: 'ANHYZER' },
];
const STYLES: Style[] = ['backhand', 'forehand', 'hammer'];
const WINDS: { label: string; range: [number, number] }[] = [
  { label: 'CALM', range: [0, 0] },
  { label: 'BREEZY', range: [4, 9] },
  { label: 'GUSTY', range: [10, 18] },
];

const AIM_ZOOM = 0.55;
const FLIGHT_ZOOM = 0.7;
const DISC_ANCHOR_Y = 200;
const HUD_H = 24;
const TRAY_Y = 270;

const REST_TEXT: Record<RestKind, string> = {
  holed: 'CHAINS!',
  sit: 'SITS DOWN',
  skate: 'SKATES',
  roll: 'ROLLER!',
  skip: 'SKIPS!',
  tumble: 'TUMBLES',
  water: 'SPLASH! +1',
  ob: 'OUT OF BOUNDS +1',
};

type Mode = 'aim' | 'flight' | 'rest';

export interface PracticeStats {
  last: ThrowResult | null;
}

export class PracticeScene implements Scene {
  private terrain = makeTerrain(PRACTICE_FIELD);
  private field = new FieldRenderer(this.terrain, -220, -120, 220, 700);
  private cam: Camera = { x: PRACTICE_TEE.x, y: PRACTICE_TEE.y, zoom: AIM_ZOOM, ax: VIEW_W / 2, ay: DISC_ANCHOR_Y };

  private mode: Mode = 'aim';
  private lie: Vec2 = { ...PRACTICE_TEE };
  private discIdx = 4;
  private releaseIdx = 1;
  private styleIdx = 0;
  private hand: Hand = 'right';
  private windIdx = 0;
  private wind: Wind = CALM;
  private throwCount = 0;
  private sessionSeed = (Date.now() >>> 0) ^ 0x5eed;

  private drag: { id: number; pull: Vec2 } | null = null;
  private preview: PathPoint[] = [];
  private current: ThrowResult | null = null;
  private playT = 0;
  private restTimer = 0;
  private toast: { title: string; sub: string; t: number; bad: boolean } | null = null;
  private time = 0;
  private flash = 0;
  private buttons: Button[];
  private pressed: Button | null = null;

  constructor(private cfg: Config, private onThrow?: (r: ThrowResult) => void) {
    const row1 = TRAY_Y + 4;
    const row2 = TRAY_Y + 26;
    this.buttons = [
      {
        x: 3, y: row1, w: 84, h: 20,
        caption: () => `${this.disc.type} ${this.disc.speed}/${this.disc.glide}/${this.disc.turn}/${this.disc.fade}`,
        value: () => `< ${this.disc.name} >`,
        onTap: () => (this.discIdx = (this.discIdx + 1) % DISCS.length),
      },
      {
        x: 89, y: row1, w: 44, h: 20,
        caption: () => 'ANGLE',
        value: () => RELEASES[this.releaseIdx].label,
        onTap: () => (this.releaseIdx = (this.releaseIdx + 1) % RELEASES.length),
      },
      {
        x: 135, y: row1, w: 42, h: 20,
        caption: () => 'STYLE',
        value: () => this.style.toUpperCase(),
        onTap: () => (this.styleIdx = (this.styleIdx + 1) % STYLES.length),
      },
      {
        x: 3, y: row2, w: 41, h: 20,
        caption: () => 'HAND',
        value: () => (this.hand === 'right' ? 'RIGHTY' : 'LEFTY'),
        onTap: () => (this.hand = this.hand === 'right' ? 'left' : 'right'),
      },
      {
        x: 46, y: row2, w: 41, h: 20,
        caption: () => 'WIND',
        value: () => WINDS[this.windIdx].label,
        onTap: () => this.cycleWind(),
      },
      {
        x: 89, y: row2, w: 44, h: 20,
        caption: () => 'BACK TO',
        value: () => 'TEE',
        onTap: () => this.resetToTee(),
      },
      {
        x: 135, y: row2, w: 42, h: 20,
        caption: () => 'THROWS',
        value: () => String(this.throwCount),
        onTap: () => (this.throwCount = 0),
      },
    ];
  }

  get disc(): Disc {
    return DISCS[this.discIdx];
  }
  get style(): Style {
    return STYLES[this.styleIdx];
  }

  private cycleWind() {
    this.windIdx = (this.windIdx + 1) % WINDS.length;
    const rng = makeRng(mixSeed(this.sessionSeed, 1000 + this.throwCount * 7 + this.windIdx));
    this.wind = this.windIdx === 0 ? CALM : rollWind(rng, WINDS[this.windIdx].range);
  }

  private resetToTee() {
    if (this.mode === 'flight') return;
    this.lie = { ...PRACTICE_TEE };
    this.mode = 'aim';
    this.current = null;
  }

  // ---------- Input ----------

  private discScreen(): Vec2 {
    return worldToScreen(this.cam, this.lie.x, this.lie.y);
  }

  down(p: PointerInfo) {
    if (this.mode === 'flight') {
      // Tap to skip ahead.
      if (this.current) this.playT = this.current.path[this.current.path.length - 1].t;
      return;
    }
    const b = this.buttons.find((b) => hit(b, p.x, p.y));
    if (b) {
      this.pressed = b;
      b.pressed = true;
      return;
    }
    if (this.mode === 'rest') this.finishRest();
    const d = this.discScreen();
    if (!this.drag && Math.hypot(p.x - d.x, p.y - d.y) <= this.cfg.grabRadiusPx) {
      this.drag = { id: p.id, pull: { x: 0, y: 0 } };
      this.preview = [];
    }
  }

  move(p: PointerInfo) {
    if (this.pressed) {
      this.pressed.pressed = hit(this.pressed, p.x, p.y);
      return;
    }
    if (!this.drag || this.drag.id !== p.id) return;
    const d = this.discScreen();
    this.drag.pull = { x: d.x - p.x, y: d.y - p.y };
    this.updatePreview();
  }

  up(p: PointerInfo) {
    if (this.pressed) {
      const b = this.pressed;
      b.pressed = false;
      this.pressed = null;
      if (hit(b, p.x, p.y) && this.mode !== 'flight') b.onTap();
      return;
    }
    if (!this.drag || this.drag.id !== p.id) return;
    const pull = this.drag.pull;
    this.drag = null;
    this.preview = [];
    if (Math.hypot(pull.x, pull.y) < this.cfg.cancelPullPx) return; // dragged back onto the disc: cancel
    this.throwDisc(this.inputFromPull(pull), this.nextSeed());
  }

  cancel() {
    this.drag = null;
    this.preview = [];
    if (this.pressed) this.pressed.pressed = false;
    this.pressed = null;
  }

  private nextSeed() {
    return mixSeed(this.sessionSeed, this.throwCount + 1);
  }

  private powerFromPull(pull: Vec2) {
    const len = Math.hypot(pull.x, pull.y);
    return clamp(len / this.cfg.maxPullPx, 0, this.cfg.maxPower);
  }

  private inputFromPull(pull: Vec2): ThrowInput {
    return {
      origin: { ...this.lie },
      // Screen y points down, world y points up-field.
      aim: angleFromDir(pull.x, -pull.y),
      power: this.powerFromPull(pull),
      release: RELEASES[this.releaseIdx].v,
      style: this.style,
      hand: this.hand,
    };
  }

  private updatePreview() {
    if (!this.drag || Math.hypot(this.drag.pull.x, this.drag.pull.y) < this.cfg.cancelPullPx) {
      this.preview = [];
      return;
    }
    const input = this.inputFromPull(this.drag.pull);
    // Preview never shows redline wobble: cap at 1.0 so it is the same for every seed.
    input.power = Math.min(1, input.power);
    const r = simulateThrow(input, this.disc, this.env(), 1, this.cfg);
    const cut = r.flight.landing.t * this.cfg.previewFraction;
    this.preview = r.flight.path.filter((q) => q.t <= cut);
  }

  private env() {
    return { terrain: this.terrain, wind: this.wind, basket: PRACTICE_BASKET };
  }

  // ---------- Throwing ----------

  private throwDisc(input: ThrowInput, seed: number) {
    const r = simulateThrow(input, this.disc, this.env(), seed, this.cfg);
    this.current = r;
    this.playT = 0;
    this.mode = 'flight';
    this.throwCount++;
    this.toast = null;
    this.onThrow?.(r);
  }

  private finishRest() {
    if (!this.current) return;
    const g = this.current.ground;
    this.lie = g.kind === 'holed' ? { ...PRACTICE_TEE } : { ...g.lie };
    this.mode = 'aim';
  }

  update(dt: number) {
    this.time += dt;
    if (this.flash > 0) this.flash -= dt;
    if (this.toast) this.toast.t += dt;

    if (this.mode === 'flight' && this.current) {
      this.playT += dt;
      const end = this.current.path[this.current.path.length - 1].t;
      if (this.playT >= end) {
        this.playT = end;
        this.mode = 'rest';
        this.restTimer = 0;
        const r = this.current;
        const red = r.input.power > 1 ? ' · REDLINE' : '';
        const sub = r.ground.penalty
          ? `CARRY ${Math.round(r.carry)} FT${red}`
          : `${Math.round(r.total)} FT · CARRY ${Math.round(r.carry)}${red}`;
        this.toast = { title: REST_TEXT[r.ground.kind], sub, t: 0, bad: r.ground.penalty > 0 };
        if (r.ground.kind === 'holed') this.flash = 1.2;
      }
    } else if (this.mode === 'rest') {
      this.restTimer += dt;
      if (this.restTimer > 1.6) this.finishRest();
    }

    this.updateCamera(dt);
  }

  private discPosNow(): PathPoint {
    if (this.current && (this.mode === 'flight' || this.mode === 'rest')) return samplePath(this.current.path, this.playT);
    return { x: this.lie.x, y: this.lie.y, z: this.terrain.height(this.lie.x, this.lie.y), t: 0 };
  }

  private updateCamera(dt: number) {
    let tx: number;
    let ty: number;
    let tz: number;
    let ay: number;
    if (this.mode === 'aim') {
      tx = this.lie.x;
      ty = this.lie.y;
      tz = AIM_ZOOM;
      ay = DISC_ANCHOR_Y;
    } else {
      const p = this.discPosNow();
      tx = p.x;
      ty = p.y;
      tz = FLIGHT_ZOOM;
      ay = 150;
    }
    const k = 1 - Math.exp(-dt * (this.mode === 'aim' ? 6 : 5));
    this.cam.x = lerp(this.cam.x, tx, k);
    this.cam.y = lerp(this.cam.y, ty, k);
    this.cam.zoom = lerp(this.cam.zoom, tz, k);
    this.cam.ay = lerp(this.cam.ay, ay, k);
  }

  // ---------- Rendering ----------

  render(ctx: CanvasRenderingContext2D) {
    const cam = { ...this.cam, x: Math.round(this.cam.x * this.cam.zoom) / this.cam.zoom, y: Math.round(this.cam.y * this.cam.zoom) / this.cam.zoom };
    this.field.draw(ctx, cam, this.time);
    this.drawMarkers(ctx, cam);

    const tee = worldToScreen(cam, PRACTICE_TEE.x, PRACTICE_TEE.y);
    drawTeePad(ctx, tee.x, tee.y, cam.zoom);
    const altScale = 0.5 * cam.zoom; // oblique: altitude drawn as an upward offset

    // Trees and basket, back to front.
    const props: { y: number; draw: () => void }[] = [];
    for (const t of this.terrain.trees) {
      const s = worldToScreen(cam, t.x, t.y);
      if (s.y < -20 || s.y > VIEW_H + 20) continue;
      props.push({ y: s.y, draw: () => drawTree(ctx, s.x, s.y, t.r * cam.zoom) });
    }
    const b = worldToScreen(cam, PRACTICE_BASKET.x, PRACTICE_BASKET.y);
    props.push({ y: b.y, draw: () => drawBasket(ctx, b.x, b.y, this.flash) });
    props.sort((a, c) => a.y - c.y).forEach((p) => p.draw());

    // Flight trail.
    if (this.current && this.mode !== 'aim') {
      for (const q of this.current.path) {
        if (q.t > this.playT) break;
        const s = worldToScreen(cam, q.x, q.y);
        const alt = (q.z - this.terrain.height(q.x, q.y)) * altScale;
        ctx.fillStyle = 'rgba(244,233,205,0.35)';
        ctx.fillRect(Math.round(s.x), Math.round(s.y - alt), 1, 1);
      }
      const g = this.current.ground;
      if (this.mode === 'rest' && g.penalty) {
        const d = worldToScreen(cam, g.lie.x, g.lie.y);
        this.drawDropMarker(ctx, d.x, d.y);
      }
    }

    // Aim line + preview.
    if (this.drag && this.mode !== 'flight') this.drawAim(ctx, cam);

    // The disc.
    const p = this.discPosNow();
    const ds = worldToScreen(cam, p.x, p.y);
    const alt = Math.max(0, p.z - this.terrain.height(p.x, p.y));
    const inWater = this.mode === 'rest' && this.current?.ground.kind === 'water';
    if (!inWater || Math.floor(this.time * 6) % 2 === 0) drawDisc(ctx, ds.x, ds.y, alt * altScale, this.disc.color, 1 + alt / 25);
    if (this.mode === 'aim' && !this.drag) {
      // Pulse ring so first-timers know where to grab.
      const r = 6 + Math.sin(this.time * 4) * 1.5;
      ringPixels(ctx, ds.x, ds.y - 1, r, PAL.amber);
    }

    this.drawHud(ctx);
    if (this.drag) this.drawPowerMeter(ctx);
    this.drawToast(ctx);
    this.drawTray(ctx);
  }

  private drawMarkers(ctx: CanvasRenderingContext2D, cam: Camera) {
    for (const m of PRACTICE_MARKERS) {
      const l = worldToScreen(cam, -50, PRACTICE_TEE.y + m);
      const r = worldToScreen(cam, 50, PRACTICE_TEE.y + m);
      if (l.y < HUD_H || l.y > TRAY_Y) continue;
      ctx.fillStyle = 'rgba(244,233,205,0.28)';
      for (let x = Math.round(l.x); x < r.x; x += 3) ctx.fillRect(x, Math.round(l.y), 1, 1);
      drawTextShadow(ctx, String(m), Math.round(l.x) - 3, Math.round(l.y) - 2, PAL.inkDim, PAL.night0, 'right');
    }
  }

  private drawAim(ctx: CanvasRenderingContext2D, cam: Camera) {
    if (!this.drag) return;
    const d = this.discScreen();
    const pull = this.drag.pull;
    const len = Math.hypot(pull.x, pull.y);
    if (len < this.cfg.cancelPullPx) {
      drawTextShadow(ctx, 'PULL BACK TO THROW', VIEW_W / 2, d.y + 14, PAL.ink, PAL.night0, 'center');
      return;
    }
    // Slingshot band from the disc to the finger.
    const ux = pull.x / len;
    const uy = pull.y / len;
    const power = this.powerFromPull(pull);
    const red = power > 1;
    ctx.fillStyle = red ? PAL.red : PAL.inkDim;
    for (let i = 0; i < len; i += 2) ctx.fillRect(Math.round(d.x - ux * i), Math.round(d.y - uy * i), 1, 1);
    // Aim line ahead of the disc.
    ctx.fillStyle = PAL.ink;
    const aimLen = 28 + power * 20;
    for (let i = 4; i < aimLen; i += 3) ctx.fillRect(Math.round(d.x + ux * i), Math.round(d.y + uy * i), 1, 1);
    // Faint predicted start of the flight.
    const altScale = 0.5 * cam.zoom;
    ctx.fillStyle = 'rgba(242,181,68,0.55)';
    for (let i = 0; i < this.preview.length; i += 3) {
      const q = this.preview[i];
      const s = worldToScreen(cam, q.x, q.y);
      ctx.fillRect(Math.round(s.x), Math.round(s.y - (q.z - this.terrain.height(q.x, q.y)) * altScale), 1, 1);
    }
  }

  private drawPowerMeter(ctx: CanvasRenderingContext2D) {
    if (!this.drag) return;
    const power = this.powerFromPull(this.drag.pull);
    const x = VIEW_W - 10;
    const top = 70;
    const h = 150;
    const maxP = this.cfg.maxPower;
    panel(ctx, x - 1, top - 1, 8, h + 2, PAL.night1, PAL.dusk);
    const fill = Math.round((power / maxP) * h);
    const redY = top + h - Math.round((1 / maxP) * h);
    ctx.fillStyle = PAL.night3;
    ctx.fillRect(x + 1, top, 4, redY - top);
    ctx.fillStyle = power > 1 ? PAL.red : PAL.amber;
    ctx.fillRect(x + 1, top + h - fill, 4, fill);
    ctx.fillStyle = PAL.red;
    ctx.fillRect(x - 2, redY, 10, 1);
    drawTextShadow(ctx, `${Math.round(power * 100)}`, x + 3, top + h + 4, power > 1 ? PAL.red : PAL.ink, PAL.night0, 'center');
    if (power > 1) drawTextShadow(ctx, 'REDLINE', x + 6, top - 9, PAL.red, PAL.night0, 'right');
  }

  private drawHud(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = 'rgba(13,11,19,0.82)';
    ctx.fillRect(0, 0, VIEW_W, HUD_H);
    ctx.fillStyle = PAL.night3;
    ctx.fillRect(0, HUD_H, VIEW_W, 1);
    drawText(ctx, 'PRACTICE FIELD', 4, 4, PAL.amber);
    const toBasket = Math.round(dist(this.mode === 'aim' ? this.lie : this.discPosNow(), PRACTICE_BASKET));
    drawText(ctx, `BASKET ${toBasket} FT`, 4, 13, PAL.ink);

    // Wind: arrow (shape, not colour) + words.
    const cx = VIEW_W - 12;
    const cy = 12;
    fillCircle(ctx, cx, cy, 8, PAL.night2);
    const label = windLabel(this.wind);
    if (label === 'CALM') {
      fillCircle(ctx, cx, cy, 2, PAL.inkDim);
    } else {
      // World +y is screen up.
      const dx = Math.sin(this.wind.dir);
      const dy = -Math.cos(this.wind.dir);
      ctx.fillStyle = PAL.ink;
      for (let i = -6; i <= 6; i++) ctx.fillRect(Math.round(cx + dx * i), Math.round(cy + dy * i), 1, 1);
      // Arrow head.
      for (const side of [-1, 1]) {
        const hx = -dx * 0.7 + -dy * 0.7 * side;
        const hy = -dy * 0.7 + dx * 0.7 * side;
        for (let i = 0; i < 4; i++) ctx.fillRect(Math.round(cx + dx * 6 + hx * i), Math.round(cy + dy * 6 + hy * i), 1, 1);
      }
    }
    drawText(ctx, label, cx - 12, 4, PAL.ink, 'right');
    drawText(ctx, label === 'CALM' ? '0 MPH' : `${this.wind.mph} MPH`, cx - 12, 13, PAL.inkDim, 'right');
  }

  private drawToast(ctx: CanvasRenderingContext2D) {
    if (!this.toast || this.mode === 'flight') return;
    const t = this.toast;
    if (this.mode === 'aim' && t.t > 3.5) return;
    const y = HUD_H + 8;
    panel(ctx, 14, y, VIEW_W - 28, 22, PAL.night1, t.bad ? PAL.red : PAL.amber);
    drawText(ctx, t.title, VIEW_W / 2, y + 4, t.bad ? PAL.red : PAL.amber, 'center');
    drawText(ctx, t.sub, VIEW_W / 2, y + 13, PAL.ink, 'center');
  }

  private drawDropMarker(ctx: CanvasRenderingContext2D, x: number, y: number) {
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(Math.round(x) - 2, Math.round(y) - 2, 5, 1);
    ctx.fillRect(Math.round(x) - 2, Math.round(y) + 2, 5, 1);
    ctx.fillRect(Math.round(x) - 2, Math.round(y) - 2, 1, 5);
    ctx.fillRect(Math.round(x) + 2, Math.round(y) - 2, 1, 5);
    drawTextShadow(ctx, 'DROP', x, y + 5, PAL.ink, PAL.night0, 'center');
  }

  private drawTray(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = PAL.night1;
    ctx.fillRect(0, TRAY_Y, VIEW_W, VIEW_H - TRAY_Y);
    ctx.fillStyle = PAL.night3;
    ctx.fillRect(0, TRAY_Y, VIEW_W, 1);
    // Disc colour swatch on the disc button.
    for (const b of this.buttons) drawButton(ctx, b);
    ctx.fillStyle = this.disc.color;
    ctx.fillRect(6, TRAY_Y + 8, 3, 2);
  }
}

function samplePath(path: PathPoint[], t: number): PathPoint {
  if (t <= path[0].t) return path[0];
  for (let i = 1; i < path.length; i++) {
    if (path[i].t >= t) {
      const a = path[i - 1];
      const b = path[i];
      const f = (t - a.t) / Math.max(1e-6, b.t - a.t);
      return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), z: lerp(a.z, b.z, f), t };
    }
  }
  return path[path.length - 1];
}

function ringPixels(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.fillStyle = color;
  const n = Math.max(12, Math.round(r * 5));
  for (let i = 0; i < n; i += 2) {
    const a = (i / n) * Math.PI * 2;
    ctx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 1, 1);
  }
}
