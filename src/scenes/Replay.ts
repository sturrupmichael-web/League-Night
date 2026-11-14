/**
 * Highlight reel. Each clip is re-simulated from the recorded inputs and seed with the same
 * deterministic sim, then played back: fairway throws on the map, putts from behind the disc.
 */
import type { Config } from '../config';
import { CameraRig } from '../core/camera';
import { sfx } from '../core/audio';
import type { PointerInfo } from '../core/input';
import type { Scene } from '../core/scene';
import { VIEW_H, VIEW_W } from '../core/screen';
import discsJson from '../content/discs.json';
import type { Highlight } from '../game/highlights';
import type { HoleDef } from '../game/hole';
import { worldToScreen } from '../render/field';
import { drawText, drawTextShadow } from '../render/font';
import { PAL } from '../render/palette';
import { drawPuttScene, PuttProjector } from '../render/puttView';
import { drawDisc, panel } from '../render/sprites';
import { HoleRenderer } from '../render/topdown';
import type { Disc } from '../sim/discs';
import { lerp, type PathPoint } from '../sim/math';
import { type PuttPoint, resolvePutt } from '../sim/putt';
import { makeRng } from '../sim/rng';
import { makeTerrain } from '../sim/terrain';
import { simulateThrow } from '../sim/throw';
import { CALM, windAt, type Wind } from '../sim/wind';
import { type Button, drawButton, hit } from '../ui/button';

const DISCS = discsJson as Disc[];
const TOP = 24;
const BOTTOM = 290;

export interface Clip {
  hl: Highlight;
  hole: HoleDef;
  wind: Wind;
}

type Live =
  | { kind: 'throw'; view: HoleRenderer; rig: CameraRig; path: PathPoint[]; end: number; color: string; holed: boolean }
  | { kind: 'putt'; proj: PuttProjector; path: PuttPoint[]; end: number; made: boolean; color: string };

export class ReplayScene implements Scene {
  private i = 0;
  private t = 0;
  private live: Live | null = null;
  private time = 0;
  private back: Button;
  private pressed = false;

  constructor(
    private clips: Clip[],
    private cfg: Config,
    private onBack: () => void,
    private dye: string | null = null,
  ) {
    this.back = { x: 50, y: BOTTOM + 6, w: 80, h: 22, caption: () => '', value: () => 'BACK', onTap: onBack };
    this.load();
  }

  private load() {
    this.t = 0;
    const c = this.clips[this.i];
    if (!c) {
      this.live = null;
      return;
    }
    const rp = c.hl.log.replay!;
    const terrain = makeTerrain(c.hole.terrain);
    const disc = DISCS.find((d) => d.id === c.hl.log.discId) ?? DISCS[0];
    const color = this.dye ?? disc.color;
    if (rp.t === 'throw') {
      const r = simulateThrow(rp.input, disc, { terrain, wind: c.wind, basket: c.hole.basket }, rp.seed, this.cfg);
      const view = new HoleRenderer(c.hole, terrain);
      const rig = new CameraRig({ x: rp.input.origin.x, y: rp.input.origin.y, zoom: 0.7, ay: 160 }, VIEW_W, this.cfg);
      this.live = { kind: 'throw', view, rig, path: r.path, end: r.path[r.path.length - 1].t, color, holed: r.ground.kind === 'holed' };
    } else {
      const proj = new PuttProjector(terrain, rp.lie, c.hole.basket);
      const w = windAt(c.wind ?? CALM, 0, 0, this.cfg.windScale);
      const res = resolvePutt(rp.read, { distance: proj.distance, rise: proj.rise, crosswind: proj.crosswind(w) }, makeRng(rp.seed), this.cfg);
      this.live = { kind: 'putt', proj, path: res.path, end: res.path[res.path.length - 1].t, made: res.made, color };
    }
    sfx.play(rp.t === 'throw' ? 'throw' : 'putt');
  }

  private next() {
    this.i++;
    if (this.i >= this.clips.length) this.i = 0; // loop the reel
    this.load();
  }

  down(p: PointerInfo) {
    if (hit(this.back, p.x, p.y)) {
      this.pressed = true;
      this.back.pressed = true;
      return;
    }
    // Tap anywhere else: skip to the next clip.
    this.next();
  }
  up(p: PointerInfo) {
    if (this.pressed && hit(this.back, p.x, p.y)) {
      sfx.play('tap');
      this.onBack();
    }
    this.pressed = false;
    this.back.pressed = false;
  }

  update(dt: number) {
    this.time += dt;
    const L = this.live;
    if (!L) return;
    const prev = this.t;
    this.t += dt;
    if ((L.kind === 'throw' ? L.holed : L.made) && prev < L.end && this.t >= L.end) sfx.play('chains');
    if (L.kind === 'throw') {
      const p = sample(L.path, Math.min(this.t, L.end));
      L.rig.setFollow({ x: p.x, y: p.y, zoom: 0.7, ay: 160 });
      L.rig.update(dt, 4);
    }
    if (this.t > L.end + 1.6) this.next();
  }

  render(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = PAL.night1;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const L = this.live;
    const c = this.clips[this.i];
    if (L && c) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, TOP, VIEW_W, BOTTOM - TOP);
      ctx.clip();
      if (L.kind === 'throw') {
        const cam = L.rig.cam;
        L.view.drawWorld(ctx, cam, this.time, { flash: 0, top: TOP, bottom: BOTTOM });
        ctx.fillStyle = 'rgba(244,233,205,0.4)';
        const tNow = Math.min(this.t, L.end);
        for (const q of L.path) {
          if (q.t > tNow) break;
          const s = worldToScreen(cam, q.x, q.y);
          ctx.fillRect(Math.round(s.x), Math.round(s.y - (q.z - L.view.terrain.height(q.x, q.y)) * 0.5 * cam.zoom), 1, 1);
        }
        const p = sample(L.path, tNow);
        const s = worldToScreen(cam, p.x, p.y);
        const alt = Math.max(0, p.z - L.view.terrain.height(p.x, p.y));
        if (!(L.holed && this.t >= L.end)) drawDisc(ctx, s.x, s.y, alt * 0.5 * cam.zoom, L.color, 1 + alt / 25);
      } else {
        const d = samplePutt(L.path, Math.min(this.t, L.end));
        drawPuttScene(ctx, L.proj, { bottom: BOTTOM, time: this.time, disc: L.made && this.t >= L.end ? null : d, discColor: L.color, flash: L.made && this.t >= L.end ? 1 : 0, showHandDisc: false });
      }
      ctx.restore();
      // Title card.
      panel(ctx, 6, TOP + 6, VIEW_W - 12, 24, 'rgba(13,11,19,0.85)', PAL.amber);
      drawText(ctx, c.hl.title, VIEW_W / 2, TOP + 10, PAL.amber, 'center');
      drawText(ctx, `${c.hl.sub} · ${c.hole.name}`, VIEW_W / 2, TOP + 19, PAL.ink, 'center');
    } else {
      drawText(ctx, 'NOTHING ON THE REEL YET', VIEW_W / 2, 150, PAL.inkDim, 'center');
    }
    ctx.fillStyle = 'rgba(13,11,19,0.9)';
    ctx.fillRect(0, 0, VIEW_W, TOP);
    drawText(ctx, 'THE REEL', 6, 9, PAL.amber);
    if (this.clips.length) drawText(ctx, `${this.i + 1} / ${this.clips.length} · TAP TO SKIP`, VIEW_W - 6, 9, PAL.inkDim, 'right');
    ctx.fillStyle = PAL.night1;
    ctx.fillRect(0, BOTTOM, VIEW_W, VIEW_H - BOTTOM);
    drawButton(ctx, this.back);
    if (Math.floor(this.time * 2) % 2 === 0) drawTextShadow(ctx, 'REC', VIEW_W - 16, TOP + 36, PAL.red, PAL.night0, 'center');
  }
}

function sample(path: PathPoint[], t: number): PathPoint {
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

function samplePutt(path: PuttPoint[], t: number): PuttPoint {
  if (t <= path[0].t) return path[0];
  for (let i = 1; i < path.length; i++) {
    if (path[i].t >= t) {
      const a = path[i - 1];
      const b = path[i];
      const f = (t - a.t) / Math.max(1e-6, b.t - a.t);
      return { u: lerp(a.u, b.u, f), v: lerp(a.v, b.v, f), h: lerp(a.h, b.h, f), t };
    }
  }
  return path[path.length - 1];
}
