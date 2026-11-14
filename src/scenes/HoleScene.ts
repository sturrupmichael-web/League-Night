/**
 * One hole, played or practised.
 *
 *  - Top-down view: slingshot the disc (grab it, pull back, release). Drag anywhere else to scout,
 *    pinch (or mouse wheel) to zoom, tap the minimap for the whole hole.
 *  - Inside putting range with a putter selected: behind-the-disc view, swipe up to putt.
 *  - Inside gimme range: tap the disc to drop it in.
 */
import type { Config } from '../config';
import { sfx } from '../core/audio';
import discsJson from '../content/discs.json';
import { CameraRig } from '../core/camera';
import type { PointerInfo } from '../core/input';
import type { Scene } from '../core/scene';
import { VIEW_H, VIEW_W } from '../core/screen';
import type { AiHole, AiThrow } from '../game/ai';
import { holeWind } from '../game/conditions';
import type { HoleDef } from '../game/hole';
import { applyThrow, formatToPar, type HoleState, isHoleOver, newHole, SCORE_LABEL, scoreKey } from '../game/rules';
import type { HoleRecord, ThrowLog } from '../game/round';
import { type Camera, worldToScreen } from '../render/field';
import { drawText, drawTextShadow } from '../render/font';
import { PAL } from '../render/palette';
import { drawPuttScene, PuttProjector } from '../render/puttView';
import { drawDisc, fillCircle, panel } from '../render/sprites';
import { HoleRenderer } from '../render/topdown';
import type { Disc } from '../sim/discs';
import type { Hand, Style, ThrowInput } from '../sim/flight';
import type { RestKind } from '../sim/ground';
import { angleFromDir, clamp, dist, lerp, type PathPoint, type Vec2 } from '../sim/math';
import { type PuttOutcome, type PuttPoint, type PuttResult, readSwipe, resolvePutt, type SwipePoint } from '../sim/putt';
import { makeRng, mixSeed } from '../sim/rng';
import { makeTerrain, type Terrain } from '../sim/terrain';
import { simulateThrow, type ThrowResult } from '../sim/throw';
import { CALM, rollWind, type Wind, windAt, windLabel } from '../sim/wind';
import type { SwipeRead } from '../sim/putt';
import { type Button, drawButton, hit } from '../ui/button';

const DISCS = discsJson as Disc[];
const RELEASES = [
  { v: -1, label: 'HYZER' },
  { v: 0, label: 'FLAT' },
  { v: 1, label: 'ANHYZER' },
];
const STYLES: Style[] = ['backhand', 'forehand', 'hammer'];
const PRACTICE_WINDS: { label: string; range: [number, number] }[] = [
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

const PUTT_TEXT: Record<PuttOutcome, string> = {
  chains: 'CHAINS!',
  spit: 'SPIT OUT',
  over: 'OVER THE TOP',
  cage: 'CAGED',
  short: 'SHORT',
  wide: 'WIDE',
};

type Mode = 'intro' | 'aim' | 'flight' | 'rest' | 'putting' | 'gimme' | 'rival' | 'done';

/** A rival on the same card (skins, throw by throw). Their hole is decided in advance and played out here. */
export interface RivalOnCard {
  name: string;
  color: string;
  hole: AiHole;
  /** Config the rival's hole was simulated with (the base config, no chaser bias). */
  cfg: Config;
}

export interface HoleSceneOpts {
  hole: HoleDef;
  practice: boolean;
  seed: number;
  holeNumber: number;
  holeCount: number;
  /** Round score to par before this hole. */
  roundToPar: number;
  /** Player's throwing hand (default right). */
  hand?: Hand;
  /** Show tutorial hints (default true). */
  hints?: boolean;
  /** Mulligans left in the round. 0 or missing = none. */
  mulligansLeft?: number;
  onThrow?: (r: ThrowResult) => void;
  onFinish?: (rec: HoleRecord) => void;
  onPause?: () => void;
  /** Disc dye from the locker; replaces every disc's colour. */
  dyeColor?: string | null;
  /** Rival whose throws are shown one by one on this hole. */
  rival?: RivalOnCard;
  /** Extra lines for the hole-complete panel (cup standing, skins result). */
  doneInfo?: (strokes: number) => string[];
  /** Small tag shown under the hole name in the intro (mode name). */
  introTag?: string;
  /** Called after every throw, putt and tap-in with where the next throw comes from (friend matches upload it). */
  onLog?: (log: ThrowLog, lie: Vec2) => void;
  /** Throws already played on this hole (a friend-match hole resumed after closing the app). */
  resume?: { log: ThrowLog; lie: Vec2 }[];
}

type Gesture =
  | { kind: 'sling'; id: number; pull: Vec2 }
  | { kind: 'pan'; id: number; last: Vec2 }
  | { kind: 'swipe'; id: number; pts: SwipePoint[] }
  | { kind: 'gimme'; id: number }
  | { kind: 'button'; id: number; b: Button }
  | { kind: 'mini'; id: number }
  | { kind: 'pinch' };

export class HoleScene implements Scene {
  private hole: HoleDef;
  private terrain: Terrain;
  private view: HoleRenderer;
  private rig: CameraRig;
  private state: HoleState;

  private mode: Mode;
  private discIdx = 4;
  private lastPutterIdx = 0;
  private releaseIdx = 1;
  private styleIdx = 0;
  private hand: Hand;
  private logs: ThrowLog[] = [];
  private undo: { state: HoleState; logs: ThrowLog[] }[] = [];
  private mullsUsed = 0;
  private windIdx = 0;
  private wind: Wind;
  private throwNo = 0;

  private gesture: Gesture | null = null;
  private preview: PathPoint[] = [];
  private current: ThrowResult | null = null;
  private playT = 0;
  private restTimer = 0;
  private introT = 0;
  private time = 0;
  private flash = 0;

  private putt: { proj: PuttProjector; res: PuttResult; t: number; done: boolean; read: Extract<SwipeRead, { cancel: false }>; seed: number } | null = null;
  private rivalNext = 0;
  private rivalLie: Vec2 = { x: 0, y: 0 };
  private rivalAnim: { th: AiThrow; path: PathPoint[]; t: number; end: number } | null = null;
  private gimme: { from: Vec2; t: number } | null = null;
  private toast: { title: string; sub: string; t: number; bad: boolean } | null = null;
  private hint: { text: string; t: number } | null = null;
  private projCache: { key: string; p: PuttProjector } | null = null;

  private buttons: Button[];
  private doneButtons: Button[];

  constructor(
    private cfg: Config,
    private opts: HoleSceneOpts,
  ) {
    this.hole = opts.hole;
    this.hand = opts.hand ?? 'right';
    this.terrain = makeTerrain(this.hole.terrain);
    this.view = new HoleRenderer(this.hole, this.terrain);
    this.state = newHole(this.hole.par, this.hole.tee);
    this.wind = opts.practice ? CALM : holeWind(opts.seed, this.hole);
    this.rivalLie = { ...this.hole.tee };
    this.rig = new CameraRig({ x: this.hole.tee.x, y: this.hole.tee.y, zoom: AIM_ZOOM, ay: DISC_ANCHOR_Y }, VIEW_W, cfg);
    this.mode = opts.practice ? 'aim' : 'intro';
    if (this.mode === 'intro') {
      this.rig.overview(this.hole.box, HUD_H, TRAY_Y);
      this.snapRigToGoal();
    }
    this.lastPutterIdx = DISCS.findIndex((d) => d.type === 'putter');
    if (opts.resume?.length) this.restore(opts.resume);
    this.buttons = this.makeTray();
    this.doneButtons = [
      {
        x: 40, y: 178, w: 100, h: 20,
        caption: () => (this.opts.holeNumber >= this.opts.holeCount ? 'ROUND COMPLETE' : `ON TO HOLE ${this.opts.holeNumber + 1}`),
        value: () => (this.opts.holeNumber >= this.opts.holeCount ? 'SEE THE CARD' : 'NEXT HOLE'),
        onTap: () => this.opts.onFinish?.(this.record()),
      },
    ];
  }

  private snapRigToGoal() {
    // Jump straight to the overview on load instead of easing in from the tee.
    for (let i = 0; i < 200; i++) this.rig.update(1 / 30, 30);
  }

  private makeTray(): Button[] {
    const row1 = TRAY_Y + 4;
    const row2 = TRAY_Y + 26;
    const putting = () => this.puttViewVisible();
    const tray: Button[] = [
      {
        x: 3, y: row1, w: 84, h: 20,
        caption: () => `${this.disc.type} ${this.disc.speed}/${this.disc.glide}/${this.disc.turn}/${this.disc.fade}`,
        value: () => `< ${this.disc.name} >`,
        onTap: () => this.swapDisc(),
      },
      {
        x: 89, y: row1, w: 44, h: 20,
        caption: () => 'ANGLE',
        value: () => RELEASES[this.releaseIdx].label,
        onTap: () => (this.releaseIdx = (this.releaseIdx + 1) % RELEASES.length),
        enabled: () => !putting(),
      },
      {
        x: 135, y: row1, w: 42, h: 20,
        caption: () => 'STYLE',
        value: () => this.style.toUpperCase(),
        onTap: () => (this.styleIdx = (this.styleIdx + 1) % STYLES.length),
        enabled: () => !putting(),
      },
      {
        x: 3, y: row2, w: 41, h: 20,
        caption: () => 'HAND',
        value: () => (this.hand === 'right' ? 'RIGHTY' : 'LEFTY'),
        onTap: () => (this.hand = this.hand === 'right' ? 'left' : 'right'),
      },
    ];
    const map: Button = {
      x: 0, y: row2, w: 41, h: 20,
      caption: () => 'VIEW',
      value: () => (this.rig.mode === 'overview' ? 'DISC' : 'MAP'),
      onTap: () => this.toggleOverview(),
    };
    if (this.opts.practice) {
      tray.push(
        { x: 46, y: row2, w: 41, h: 20, caption: () => 'WIND', value: () => PRACTICE_WINDS[this.windIdx].label, onTap: () => this.cycleWind() },
        { x: 89, y: row2, w: 44, h: 20, caption: () => 'BACK TO', value: () => 'TEE', onTap: () => this.resetHole() },
        { ...map, x: 135, w: 42 },
      );
    } else {
      tray.push(
        { ...map, x: 46 },
        {
          x: 89, y: row2, w: 44, h: 20,
          caption: () => 'FIND',
          value: () => 'DISC',
          onTap: () => this.rig.snapBack(),
          enabled: () => this.rig.detached,
        },
        {
          x: 135, y: row2, w: 42, h: 20,
          caption: () => 'MULLIGAN',
          value: () => `X${this.mullsLeft()}`,
          onTap: () => this.mulligan(),
          enabled: () => this.canMulligan(),
        },
      );
    }
    return tray;
  }

  get disc(): Disc {
    return DISCS[this.discIdx];
  }
  private get discColor(): string {
    return this.opts.dyeColor ?? this.disc.color;
  }
  get style(): Style {
    return STYLES[this.styleIdx];
  }

  /** Exposed for smoke tests. */
  get debug() {
    return { mode: this.mode, state: this.state, lie: this.state.lie, disc: this.disc.id, puttView: this.puttViewVisible() };
  }

  // ---------- Round bookkeeping ----------

  private record(): HoleRecord {
    const s = this.state;
    return { holeId: this.hole.id, par: s.par, strokes: s.strokes, penalties: s.penalties, pickedUp: s.pickedUp, mulligans: this.mullsUsed, throws: this.logs, wind: this.opts.practice ? undefined : this.wind };
  }

  private mullsLeft() {
    return Math.max(0, (this.opts.mulligansLeft ?? 0) - this.mullsUsed);
  }

  private canMulligan() {
    return !this.opts.practice && this.mullsLeft() > 0 && this.undo.length > 0 && !this.state.holed && (this.mode === 'aim' || this.mode === 'rest');
  }

  /** Rewind the last throw: lie, strokes and logs go back to before it. */
  private mulligan() {
    if (!this.canMulligan()) return;
    const u = this.undo.pop()!;
    this.state = u.state;
    this.logs = u.logs;
    this.mullsUsed++;
    this.mode = 'aim';
    this.current = null;
    this.putt = null;
    this.toast = { title: 'MULLIGAN', sub: `${this.mullsLeft()} LEFT THIS ROUND`, t: 0, bad: false };
    this.rig.snapBack();
  }

  private log(l: Omit<ThrowLog, 'n' | 'discId' | 'discType'>) {
    const entry: ThrowLog = { ...l, n: this.state.throws, discId: this.disc.id, discType: this.disc.type };
    this.logs.push(entry);
    this.opts.onLog?.(entry, { ...this.state.lie });
  }

  /** Pick a hole back up from throws already played (and uploaded). */
  private restore(done: { log: ThrowLog; lie: Vec2 }[]) {
    for (const { log, lie } of done) {
      if (log.kind !== 'gimme') this.throwNo++; // keeps the seed sequence in step
      this.state = applyThrow(this.state, this.cfg, { penalty: log.penalty, holed: log.made, lie: { ...lie } });
      this.logs.push(log);
    }
    if (isHoleOver(this.state)) this.mode = 'done';
    else {
      const d = this.distToBasket();
      if (d <= this.cfg.puttRangeFt && d > this.cfg.gimmeFt) this.discIdx = this.lastPutterIdx;
    }
  }

  private hintsOn() {
    return this.opts.hints !== false;
  }

  // ---------- Helpers ----------

  private distToBasket(p: Vec2 = this.state.lie) {
    return dist(p, this.hole.basket);
  }

  private inGimme() {
    return this.mode === 'aim' && this.distToBasket() <= this.cfg.gimmeFt;
  }

  private puttReady() {
    const d = this.distToBasket();
    return this.disc.type === 'putter' && d <= this.cfg.puttRangeFt && d > this.cfg.gimmeFt;
  }

  private puttViewVisible() {
    if (this.mode === 'putting' || (this.mode === 'rest' && this.putt)) return true;
    return this.mode === 'aim' && this.puttReady() && this.rig.mode !== 'overview';
  }

  private projector(): PuttProjector {
    const lie = this.state.lie;
    const key = `${lie.x},${lie.y}`;
    if (!this.projCache || this.projCache.key !== key) this.projCache = { key, p: new PuttProjector(this.terrain, lie, this.hole.basket) };
    return this.projCache.p;
  }

  private swapDisc() {
    this.discIdx = (this.discIdx + 1) % DISCS.length;
    if (this.disc.type === 'putter') this.lastPutterIdx = this.discIdx;
  }

  private cycleWind() {
    this.windIdx = (this.windIdx + 1) % PRACTICE_WINDS.length;
    const rng = makeRng(mixSeed(this.opts.seed, 1000 + this.throwNo * 7 + this.windIdx));
    this.wind = this.windIdx === 0 ? CALM : rollWind(rng, PRACTICE_WINDS[this.windIdx].range);
  }

  private toggleOverview() {
    if (this.rig.mode === 'overview') this.rig.snapBack();
    else this.rig.overview(this.hole.box, HUD_H, TRAY_Y);
  }

  private resetHole() {
    if (this.mode === 'flight' || this.mode === 'putting') return;
    this.state = newHole(this.hole.par, this.hole.tee);
    this.logs = [];
    this.undo = [];
    this.mode = 'aim';
    this.current = null;
    this.putt = null;
    this.gimme = null;
    this.toast = null;
    this.rig.snapBack();
  }

  private nextSeed() {
    this.throwNo++;
    return mixSeed(this.opts.seed, this.hole.id * 1000 + this.throwNo);
  }

  // ---------- Input ----------

  private discScreen(): Vec2 {
    return worldToScreen(this.rig.cam, this.state.lie.x, this.state.lie.y);
  }

  down(p: PointerInfo, all: Map<number, PointerInfo>) {
    if (all.size >= 2) {
      // Second finger: switch to pinch zoom, dropping whatever the first finger was doing.
      if (!this.puttViewVisible() && this.mode !== 'done') {
        const [a, b] = [...all.values()];
        this.gesture = { kind: 'pinch' };
        this.preview = [];
        this.rig.pinchStart(a, b);
      }
      return;
    }
    if (p.y < HUD_H && p.x < 22 && this.mode !== 'done') {
      sfx.play('tap');
      this.opts.onPause?.();
      return;
    }
    if (this.mode === 'intro') {
      this.endIntro();
      return;
    }
    if (this.mode === 'done') {
      const b = this.doneButtons.find((b) => hit(b, p.x, p.y));
      if (b) {
        b.pressed = true;
        this.gesture = { kind: 'button', id: p.id, b };
      }
      return;
    }
    if (this.mode === 'flight' && this.current) {
      this.playT = this.current.path[this.current.path.length - 1].t; // tap to skip
      return;
    }
    if (this.mode === 'putting' && this.putt) {
      this.putt.t = this.putt.res.path[this.putt.res.path.length - 1].t;
      return;
    }
    if (this.mode === 'rival' && this.rivalAnim) {
      this.rivalAnim.t = this.rivalAnim.end; // tap to skip
      return;
    }
    if (this.mode === 'gimme') return;
    const b = this.buttons.find((b) => hit(b, p.x, p.y));
    if (b) {
      b.pressed = true;
      this.gesture = { kind: 'button', id: p.id, b };
      return;
    }
    const m = this.view.miniRect;
    if (p.x >= m.x && p.x < m.x + m.w && p.y >= m.y && p.y < m.y + m.h) {
      this.gesture = { kind: 'mini', id: p.id };
      return;
    }
    if (this.mode === 'rest') this.finishRest();
    if (this.mode !== 'aim') return;

    if (this.puttViewVisible()) {
      if (p.y > HUD_H && p.y < TRAY_Y) this.gesture = { kind: 'swipe', id: p.id, pts: [{ x: p.x, y: p.y, t: performance.now() }] };
      return;
    }
    const d = this.discScreen();
    const near = Math.hypot(p.x - d.x, p.y - d.y) <= this.cfg.grabRadiusPx;
    if (near && this.inGimme()) this.gesture = { kind: 'gimme', id: p.id };
    else if (near) this.gesture = { kind: 'sling', id: p.id, pull: { x: 0, y: 0 } };
    else this.gesture = { kind: 'pan', id: p.id, last: { x: p.x, y: p.y } };
    this.preview = [];
  }

  move(p: PointerInfo, all: Map<number, PointerInfo>) {
    const g = this.gesture;
    if (!g) return;
    if (g.kind === 'pinch') {
      if (all.size >= 2) {
        const [a, b] = [...all.values()];
        this.rig.pinchMove(a, b);
      }
      return;
    }
    if (g.id !== p.id) return;
    switch (g.kind) {
      case 'button':
        g.b.pressed = hit(g.b, p.x, p.y);
        break;
      case 'sling': {
        const d = this.discScreen();
        g.pull = { x: d.x - p.x, y: d.y - p.y };
        this.updatePreview(g.pull);
        break;
      }
      case 'pan':
        this.rig.panBy(p.x - g.last.x, p.y - g.last.y);
        g.last = { x: p.x, y: p.y };
        break;
      case 'swipe':
        g.pts.push({ x: p.x, y: p.y, t: performance.now() });
        break;
      default:
    }
  }

  up(p: PointerInfo, all: Map<number, PointerInfo>) {
    const g = this.gesture;
    if (!g) return;
    if (g.kind === 'pinch') {
      if (all.size < 2) {
        this.rig.pinchEnd();
        // The finger still down carries on as a pan.
        const rest = [...all.values()][0];
        this.gesture = rest ? { kind: 'pan', id: rest.id, last: { x: rest.x, y: rest.y } } : null;
      }
      return;
    }
    if (g.id !== p.id) return;
    this.gesture = null;
    switch (g.kind) {
      case 'button':
        g.b.pressed = false;
        if (hit(g.b, p.x, p.y) && (g.b.enabled ? g.b.enabled() : true)) {
          sfx.play('tap');
          g.b.onTap();
        }
        break;
      case 'mini':
        this.toggleOverview();
        break;
      case 'sling': {
        this.preview = [];
        if (Math.hypot(g.pull.x, g.pull.y) < this.cfg.cancelPullPx) return; // dragged back onto the disc
        this.throwDisc(this.inputFromPull(g.pull));
        break;
      }
      case 'swipe':
        g.pts.push({ x: p.x, y: p.y, t: performance.now() });
        this.puttFromSwipe(g.pts);
        break;
      case 'gimme': {
        const d = this.discScreen();
        if (Math.hypot(p.x - d.x, p.y - d.y) <= this.cfg.grabRadiusPx) this.startGimme();
        break;
      }
      default:
    }
  }

  cancel() {
    if (this.gesture?.kind === 'button') this.gesture.b.pressed = false;
    if (this.gesture?.kind === 'pinch') this.rig.pinchEnd();
    this.gesture = null;
    this.preview = [];
  }

  wheel(x: number, y: number, deltaY: number) {
    if (this.puttViewVisible() || this.mode === 'done') return;
    this.rig.zoomAt(x, y, deltaY > 0 ? 0.9 : 1 / 0.9);
  }

  // ---------- Throwing ----------

  private powerFromPull(pull: Vec2) {
    return clamp(Math.hypot(pull.x, pull.y) / this.cfg.maxPullPx, 0, this.cfg.maxPower);
  }

  private inputFromPull(pull: Vec2): ThrowInput {
    return {
      origin: { ...this.state.lie },
      aim: angleFromDir(pull.x, -pull.y), // screen y points down, world y points up-field
      power: this.powerFromPull(pull),
      release: RELEASES[this.releaseIdx].v,
      style: this.style,
      hand: this.hand,
    };
  }

  private env() {
    return { terrain: this.terrain, wind: this.wind, basket: this.hole.basket };
  }

  private updatePreview(pull: Vec2) {
    if (Math.hypot(pull.x, pull.y) < this.cfg.cancelPullPx) {
      this.preview = [];
      return;
    }
    const input = this.inputFromPull(pull);
    input.power = Math.min(1, input.power); // the preview never shows redline wobble
    const r = simulateThrow(input, this.disc, this.env(), 1, this.cfg);
    const cut = r.flight.landing.t * this.cfg.previewFraction;
    this.preview = r.flight.path.filter((q) => q.t <= cut);
  }

  private throwDisc(input: ThrowInput) {
    this.undo.push({ state: this.state, logs: [...this.logs] });
    const r = simulateThrow(input, this.disc, this.env(), this.nextSeed(), this.cfg);
    this.current = r;
    this.playT = 0;
    sfx.play('throw');
    this.mode = 'flight';
    this.toast = null;
    this.rig.snapBack();
    this.opts.onThrow?.(r);
  }

  private endFlight() {
    const r = this.current!;
    const g = r.ground;
    this.mode = 'rest';
    this.restTimer = 0;
    const red = r.input.power > 1.005 ? ' · REDLINE' : '';
    const sub = g.penalty ? `CARRY ${Math.round(r.carry)} FT${red}` : `${Math.round(r.total)} FT · CARRY ${Math.round(r.carry)}${red}`;
    const ace = g.kind === 'holed' && this.state.throws === 0 && !this.opts.practice;
    this.toast = { title: ace ? 'ACE!' : REST_TEXT[g.kind], sub, t: 0, bad: g.penalty > 0 };
    if (g.kind === 'holed') this.flash = 1.2;
    sfx.play(g.kind === 'holed' ? 'chains' : g.kind === 'water' ? 'splash' : g.kind === 'ob' ? 'ob' : 'tap');
    const from = this.distToBasket();
    this.state = applyThrow(this.state, this.cfg, { penalty: g.penalty, holed: g.kind === 'holed', lie: g.lie });
    this.log({ kind: 'throw', fromFt: from, toFt: this.distToBasket(), distanceFt: r.total, penalty: g.penalty, made: g.kind === 'holed', surface: g.surface, replay: { t: 'throw', input: r.input, seed: r.seed } });
  }

  private puttFromSwipe(pts: SwipePoint[]) {
    const read = readSwipe(pts, this.cfg);
    if (read.cancel) {
      const why = read.reason === 'parked' ? 'THUMB STOPPED · NO PUTT' : read.reason === 'backward' ? 'PULLED BACK · NO PUTT' : 'SWIPE UP AT THE CHAINS';
      this.hint = { text: why, t: 0 };
      return;
    }
    const proj = this.projector();
    const w = windAt(this.wind, 0, 0, this.cfg.windScale);
    const seed = this.nextSeed();
    const res = resolvePutt(read, { distance: proj.distance, rise: proj.rise, crosswind: proj.crosswind(w) }, makeRng(seed), this.cfg);
    this.undo.push({ state: this.state, logs: [...this.logs] });
    this.putt = { proj, res, t: 0, done: false, read, seed };
    this.mode = 'putting';
    sfx.play('putt');
    this.toast = null;
    this.hint = null;
  }

  private endPutt() {
    const { proj, res } = this.putt!;
    this.putt!.done = true;
    const restW = proj.toWorld(res.rest.u, res.rest.v);
    const surf = this.terrain.surface(restW.x, restW.y);
    const penalty = !res.made && (surf === 'water' || surf === 'ob') ? 1 : 0;
    const lie = res.made ? { ...this.hole.basket } : penalty ? { ...this.state.lie } : restW;
    let title = PUTT_TEXT[res.outcome];
    if (res.outcome === 'wide') title = res.atBasket && res.atBasket.u < 0 ? 'WIDE LEFT' : 'WIDE RIGHT';
    if (penalty) title += surf === 'water' ? ' · SPLASH +1' : ' · OB +1';
    const sub = res.made ? `${Math.round(proj.distance)} FT PUTT` : `${Math.round(dist(lie, this.hole.basket))} FT TO GO`;
    this.toast = { title, sub, t: 0, bad: !res.made };
    if (res.made) this.flash = 1.2;
    sfx.play(res.made ? 'chains' : penalty ? 'splash' : 'land');
    const from = proj.distance;
    this.state = applyThrow(this.state, this.cfg, { penalty, holed: res.made, lie });
    const pt = this.putt!;
    this.log({ kind: 'putt', fromFt: from, toFt: this.distToBasket(), distanceFt: dist(pt.proj.lie, restW), penalty, made: res.made, surface: surf, replay: { t: 'putt', lie: { ...pt.proj.lie }, read: pt.read, seed: pt.seed } });
    this.mode = 'rest';
    this.restTimer = 0;
  }

  private startGimme() {
    this.gimme = { from: { ...this.state.lie }, t: 0 };
    this.mode = 'gimme';
    this.toast = null;
  }

  private endGimme() {
    this.flash = 1.2;
    this.toast = { title: 'TAP-IN', sub: 'GIMME', t: 0, bad: false };
    sfx.play('chains');
    const from = this.distToBasket(this.gimme!.from);
    this.state = applyThrow(this.state, this.cfg, { penalty: 0, holed: true, lie: this.hole.basket });
    this.log({ kind: 'gimme', fromFt: from, toFt: 0, distanceFt: from, penalty: 0, made: true, surface: 'green' });
    this.gimme = null;
    this.mode = 'rest';
    this.restTimer = 0;
  }

  private finishRest() {
    this.putt = null;
    if (isHoleOver(this.state)) {
      if (this.opts.practice) {
        this.state = newHole(this.hole.par, this.hole.tee);
        this.mode = 'aim';
        this.current = null;
        return;
      }
      this.current = null;
      if (this.rivalTurn()) return;
      this.toDone();
      return;
    }
    this.mode = 'aim';
    this.current = null;
    if (this.rivalTurn()) return;
    // Inside putting range, hand the player their putter.
    const d = this.distToBasket();
    if (d <= this.cfg.puttRangeFt && d > this.cfg.gimmeFt && this.disc.type !== 'putter') this.discIdx = this.lastPutterIdx;
  }

  private endIntro() {
    this.mode = 'aim';
    this.rig.snapBack();
    this.toast = null;
  }

  private toDone() {
    this.mode = 'done';
    this.toast = null;
    const d = this.state.strokes - this.state.par;
    sfx.play(this.state.pickedUp || d >= 2 ? 'bad' : d <= -1 ? 'good' : 'tap');
  }

  // ---------- Rival on the card ----------

  private rivalDone() {
    const r = this.opts.rival;
    return !r || this.rivalNext >= r.hole.throws.length;
  }

  /** Farthest from the basket throws first; at the tee the player has the honour. */
  private rivalDue() {
    if (this.rivalDone()) return false;
    if (isHoleOver(this.state)) return true;
    return dist(this.rivalLie, this.hole.basket) > this.distToBasket() + 0.01;
  }

  /** Start the rival's next throw if it is their turn. Returns true if one started. */
  private rivalTurn(): boolean {
    if (!this.rivalDue()) return false;
    const r = this.opts.rival!;
    const th = r.hole.throws[this.rivalNext];
    let path: PathPoint[];
    if (th.kind === 'throw' && th.input && th.discId) {
      const disc = DISCS.find((d) => d.id === th.discId) ?? DISCS[4];
      path = simulateThrow(th.input, disc, { terrain: this.terrain, wind: this.wind, basket: this.hole.basket }, th.seed ?? 1, r.cfg).path;
    } else {
      // Putts and tap-ins: a short hop from the lie to where it finished.
      const n = 24;
      const T = th.kind === 'gimme' ? 0.4 : 0.9;
      path = [];
      for (let i = 0; i <= n; i++) {
        const f = i / n;
        const x = lerp(th.from.x, th.to.x, f);
        const y = lerp(th.from.y, th.to.y, f);
        path.push({ x, y, z: this.terrain.height(x, y) + Math.sin(f * Math.PI) * (th.kind === 'gimme' ? 2 : 4), t: f * T });
      }
    }
    this.rivalAnim = { th, path, t: 0, end: path[path.length - 1].t };
    this.mode = 'rival';
    this.toast = { title: `${r.name} IS UP`, sub: th.kind === 'throw' ? `${Math.round(th.fromFt)} FT OUT` : `${Math.round(th.fromFt)} FT PUTT`, t: 0, bad: false };
    sfx.play(th.kind === 'throw' ? 'throw' : 'putt');
    return true;
  }

  private endRivalThrow() {
    const a = this.rivalAnim!;
    const r = this.opts.rival!;
    const th = a.th;
    this.rivalNext++;
    this.rivalLie = { ...th.to };
    let title: string;
    if (th.made) title = th.kind === 'throw' ? `${r.name} HOLES OUT!` : `${r.name} DROPS IT`;
    else if (th.penalty) title = `${r.name} · PENALTY +${th.penalty}`;
    else title = th.kind === 'throw' ? `${r.name} · ${Math.round(th.toFt)} FT TO GO` : `${r.name} MISSES`;
    const strokes = r.hole.throws.slice(0, this.rivalNext).reduce((n, t) => n + 1 + t.penalty, 0);
    this.toast = { title, sub: `${r.name} · ${strokes} THROW${strokes === 1 ? '' : 'S'}`, t: 0, bad: false };
    if (th.made) {
      this.flash = 0.8;
      sfx.play('chains');
    } else sfx.play(th.penalty ? 'splash' : 'land');
    this.rivalAnim = null;
    this.restTimer = 0;
    this.mode = 'rest';
  }

  // ---------- Update ----------

  update(dt: number) {
    this.time += dt;
    if (this.flash > 0) this.flash -= dt;
    if (this.toast) this.toast.t += dt;
    if (this.hint) {
      this.hint.t += dt;
      if (this.hint.t > 2) this.hint = null;
    }

    switch (this.mode) {
      case 'intro':
        this.introT += dt;
        if (this.introT > 2.6) this.endIntro();
        break;
      case 'flight': {
        const prev = this.playT;
        this.playT += dt;
        const f = this.current!.flight;
        for (const th of f.treeHitTimes) if (th > prev && th <= this.playT) sfx.play('tree');
        if (f.landing.t > prev && f.landing.t <= this.playT && !f.holed) {
          const g = this.current!.ground;
          if (g.skipped) sfx.play('skip');
          else if (g.kind !== 'water') sfx.play('land');
        }
        const end = this.current!.path[this.current!.path.length - 1].t;
        if (this.playT >= end) {
          this.playT = end;
          this.endFlight();
        }
        break;
      }
      case 'putting': {
        const pt = this.putt!;
        pt.t += dt;
        if (pt.t >= pt.res.path[pt.res.path.length - 1].t + 0.3) this.endPutt();
        break;
      }
      case 'rival': {
        const a = this.rivalAnim!;
        a.t += dt;
        if (a.t >= a.end + 0.2) this.endRivalThrow();
        break;
      }
      case 'gimme':
        this.gimme!.t += dt;
        if (this.gimme!.t > 0.5) this.endGimme();
        break;
      case 'rest':
        this.restTimer += dt;
        if (this.restTimer > (isHoleOver(this.state) ? 1.8 : 1.5)) this.finishRest();
        break;
      default:
    }

    if (this.mode === 'rival' && this.rivalAnim) {
      const p = samplePath(this.rivalAnim.path, this.rivalAnim.t);
      this.rig.setFollow({ x: p.x, y: p.y, zoom: FLIGHT_ZOOM, ay: 150 });
    } else if (this.mode === 'flight' || (this.mode === 'rest' && this.current)) {
      const p = this.discPosNow();
      this.rig.setFollow({ x: p.x, y: p.y, zoom: FLIGHT_ZOOM, ay: 150 });
    } else {
      const lie = this.state.lie;
      this.rig.setFollow({ x: lie.x, y: lie.y, zoom: AIM_ZOOM, ay: DISC_ANCHOR_Y });
    }
    this.rig.update(dt, this.mode === 'intro' ? 3 : 5);
  }

  private discPosNow(): PathPoint {
    if (this.current && (this.mode === 'flight' || this.mode === 'rest')) return samplePath(this.current.path, this.playT);
    if (this.gimme) {
      const f = Math.min(1, this.gimme.t / 0.4);
      const b = this.hole.basket;
      const x = lerp(this.gimme.from.x, b.x, f);
      const y = lerp(this.gimme.from.y, b.y, f);
      return { x, y, z: this.terrain.height(x, y) + Math.sin(f * Math.PI) * 3, t: 0 };
    }
    const l = this.state.lie;
    return { x: l.x, y: l.y, z: this.terrain.height(l.x, l.y), t: 0 };
  }

  // ---------- Render ----------

  render(ctx: CanvasRenderingContext2D) {
    if (this.puttViewVisible()) this.renderPuttView(ctx);
    else this.renderTopDown(ctx);

    this.drawHud(ctx);
    if (this.mode !== 'intro') {
      const d = this.discPosNow();
      this.view.drawMinimap(ctx, VIEW_W - 3, HUD_H + 4, 30, 46, d, this.rig.cam, Math.floor(this.time * 3) % 3 !== 0);
    }
    if (this.gesture?.kind === 'sling') this.drawPowerMeter(ctx, this.gesture.pull);
    this.drawToast(ctx);
    this.drawHint(ctx);
    this.drawTray(ctx);
    if (this.mode === 'intro') this.drawIntro(ctx);
    if (this.mode === 'done') this.drawDone(ctx);
  }

  private renderTopDown(ctx: CanvasRenderingContext2D) {
    const c = this.rig.cam;
    const cam: Camera = { ...c, x: Math.round(c.x * c.zoom) / c.zoom, y: Math.round(c.y * c.zoom) / c.zoom };
    this.view.drawWorld(ctx, cam, this.time, { flash: this.flash, top: HUD_H, bottom: TRAY_Y });
    const altScale = 0.5 * cam.zoom; // oblique: altitude drawn as an upward offset

    if (this.current && (this.mode === 'flight' || this.mode === 'rest')) {
      ctx.fillStyle = 'rgba(244,233,205,0.35)';
      for (const q of this.current.path) {
        if (q.t > this.playT) break;
        const s = worldToScreen(cam, q.x, q.y);
        ctx.fillRect(Math.round(s.x), Math.round(s.y - (q.z - this.terrain.height(q.x, q.y)) * altScale), 1, 1);
      }
      const g = this.current.ground;
      if (this.mode === 'rest' && g.penalty) {
        const d = worldToScreen(cam, g.lie.x, g.lie.y);
        drawDropMarker(ctx, d.x, d.y);
      }
    }

    if (this.gesture?.kind === 'sling') this.drawAim(ctx, cam, this.gesture.pull);

    const p = this.discPosNow();
    const ds = worldToScreen(cam, p.x, p.y);
    const alt = Math.max(0, p.z - this.terrain.height(p.x, p.y));
    const wet = this.mode === 'rest' && this.current?.ground.kind === 'water';
    const holedNow = this.mode === 'rest' && this.state.holed;
    if (!holedNow && (!wet || Math.floor(this.time * 6) % 2 === 0)) drawDisc(ctx, ds.x, ds.y, alt * altScale, this.discColor, 1 + alt / 25);

    this.drawRival(ctx, cam);

    if (this.mode === 'aim' && !this.gesture) {
      const r = 6 + Math.sin(this.time * (this.inGimme() ? 8 : 4)) * 1.5;
      ringPixels(ctx, ds.x, ds.y - 1, r, this.inGimme() ? PAL.white : PAL.amber);
      if (this.inGimme() && this.hintsOn()) drawTextShadow(ctx, 'GIMME! TAP THE DISC', VIEW_W / 2, Math.min(TRAY_Y - 10, ds.y + 12), PAL.ink, PAL.night0, 'center');
      // Off-screen? point the way home.
      if (ds.x < 0 || ds.x > VIEW_W || ds.y < HUD_H || ds.y > TRAY_Y) {
        drawTextShadow(ctx, 'TAP FIND DISC TO RETURN', VIEW_W / 2, TRAY_Y - 9, PAL.ink, PAL.night0, 'center');
      }
    }
  }

  private drawRival(ctx: CanvasRenderingContext2D, cam: Camera) {
    const r = this.opts.rival;
    if (!r) return;
    let p: PathPoint;
    if (this.rivalAnim) p = samplePath(this.rivalAnim.path, this.rivalAnim.t);
    else {
      if (this.rivalNext > 0 && r.hole.throws[this.rivalNext - 1].made) return; // in the basket
      p = { x: this.rivalLie.x, y: this.rivalLie.y, z: this.terrain.height(this.rivalLie.x, this.rivalLie.y), t: 0 };
    }
    if (this.rivalAnim) {
      ctx.fillStyle = 'rgba(244,233,205,0.3)';
      for (const q of this.rivalAnim.path) {
        if (q.t > this.rivalAnim.t) break;
        const s = worldToScreen(cam, q.x, q.y);
        ctx.fillRect(Math.round(s.x), Math.round(s.y - (q.z - this.terrain.height(q.x, q.y)) * 0.5 * cam.zoom), 1, 1);
      }
    }
    const s = worldToScreen(cam, p.x, p.y);
    const alt = Math.max(0, p.z - this.terrain.height(p.x, p.y));
    drawDisc(ctx, s.x, s.y, alt * 0.5 * cam.zoom, r.color, 1 + alt / 25);
    if (!this.rivalAnim) drawTextShadow(ctx, r.name.split(' ')[0], s.x, s.y + 4, r.color, PAL.night0, 'center');
  }

  private renderPuttView(ctx: CanvasRenderingContext2D) {
    const proj = this.putt?.proj ?? this.projector();
    const disc: PuttPoint | null = this.putt ? samplePutt(this.putt.res.path, this.putt.t) : null;
    drawPuttScene(ctx, proj, { bottom: TRAY_Y, time: this.time, disc, discColor: this.discColor, flash: this.flash, showHandDisc: this.mode === 'aim' });

    // Read of the putt: distance, slope, wind.
    const y = HUD_H + 4;
    panel(ctx, 3, y, 56, 22, 'rgba(13,11,19,0.8)', PAL.night3);
    drawText(ctx, `${Math.round(proj.distance)} FT PUTT`, 6, y + 4, PAL.ink);
    const rise = proj.rise;
    const slope = Math.abs(rise) < 0.5 ? 'FLAT' : rise > 0 ? `UPHILL ${rise.toFixed(1)}` : `DOWNHILL ${(-rise).toFixed(1)}`;
    drawText(ctx, slope, 6, y + 12, rise > 0.5 ? PAL.amber : rise < -0.5 ? PAL.waterLight : PAL.inkDim);

    if (this.mode === 'aim') {
      const g = this.gesture;
      if (g?.kind === 'swipe') {
        ctx.fillStyle = PAL.amber;
        for (const q of g.pts) ctx.fillRect(Math.round(q.x) - 1, Math.round(q.y) - 1, 2, 2);
      } else if (this.hintsOn()) {
        const bob = Math.round(Math.sin(this.time * 4) * 2);
        drawTextShadow(ctx, 'SWIPE UP AT THE CHAINS', VIEW_W / 2, TRAY_Y - 40 + bob, PAL.ink, PAL.night0, 'center');
        drawTextShadow(ctx, 'FLICK = MORE · PUSH = LESS · CURVE = BEND', VIEW_W / 2, TRAY_Y - 8, PAL.inkDim, PAL.night0, 'center');
      }
    }
  }

  private drawAim(ctx: CanvasRenderingContext2D, cam: Camera, pull: Vec2) {
    const d = this.discScreen();
    const len = Math.hypot(pull.x, pull.y);
    if (len < this.cfg.cancelPullPx) {
      if (this.hintsOn()) drawTextShadow(ctx, 'PULL BACK TO THROW', VIEW_W / 2, d.y + 14, PAL.ink, PAL.night0, 'center');
      return;
    }
    const ux = pull.x / len;
    const uy = pull.y / len;
    const power = this.powerFromPull(pull);
    ctx.fillStyle = power > 1.005 ? PAL.red : PAL.inkDim;
    for (let i = 0; i < len; i += 2) ctx.fillRect(Math.round(d.x - ux * i), Math.round(d.y - uy * i), 1, 1);
    ctx.fillStyle = PAL.ink;
    const aimLen = 28 + power * 20;
    for (let i = 4; i < aimLen; i += 3) ctx.fillRect(Math.round(d.x + ux * i), Math.round(d.y + uy * i), 1, 1);
    const altScale = 0.5 * cam.zoom;
    ctx.fillStyle = 'rgba(242,181,68,0.55)';
    for (let i = 0; i < this.preview.length; i += 3) {
      const q = this.preview[i];
      const s = worldToScreen(cam, q.x, q.y);
      ctx.fillRect(Math.round(s.x), Math.round(s.y - (q.z - this.terrain.height(q.x, q.y)) * altScale), 1, 1);
    }
  }

  private drawPowerMeter(ctx: CanvasRenderingContext2D, pull: Vec2) {
    const power = this.powerFromPull(pull);
    const x = VIEW_W - 10;
    const top = 90;
    const h = 140;
    const maxP = this.cfg.maxPower;
    panel(ctx, x - 1, top - 1, 8, h + 2, PAL.night1, PAL.dusk);
    const fill = Math.round((power / maxP) * h);
    const redY = top + h - Math.round((1 / maxP) * h);
    ctx.fillStyle = PAL.night3;
    ctx.fillRect(x + 1, top, 4, redY - top);
    ctx.fillStyle = power > 1.005 ? PAL.red : PAL.amber;
    ctx.fillRect(x + 1, top + h - fill, 4, fill);
    ctx.fillStyle = PAL.red;
    ctx.fillRect(x - 2, redY, 10, 1);
    drawTextShadow(ctx, `${Math.round(power * 100)}`, x + 3, top + h + 4, power > 1.005 ? PAL.red : PAL.ink, PAL.night0, 'center');
    if (power > 1.005) drawTextShadow(ctx, 'REDLINE', x + 6, top - 9, PAL.red, PAL.night0, 'right');
  }

  private drawHud(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = 'rgba(13,11,19,0.85)';
    ctx.fillRect(0, 0, VIEW_W, HUD_H);
    ctx.fillStyle = PAL.night3;
    ctx.fillRect(0, HUD_H, VIEW_W, 1);
    const toBasket = Math.round(this.distToBasket(this.mode === 'flight' ? this.discPosNow() : this.state.lie));
    // Pause button.
    panel(ctx, 2, 3, 17, 18, PAL.night2, PAL.dusk);
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(7, 8, 2, 8);
    ctx.fillRect(12, 8, 2, 8);
    const tx = 23;
    if (this.opts.practice) {
      drawText(ctx, 'PRACTICE FIELD', tx, 4, PAL.amber);
      drawText(ctx, `BASKET ${toBasket} FT`, tx, 13, PAL.ink);
    } else {
      const s = this.state;
      drawText(ctx, `HOLE ${this.opts.holeNumber} · PAR ${this.hole.par}`, tx, 4, PAL.amber);
      const toPar = this.opts.roundToPar + (isHoleOver(s) ? s.strokes - s.par : 0);
      const throwText = isHoleOver(s) ? `${s.strokes} THROWS` : `THROW ${s.strokes + 1}`;
      drawText(ctx, `${toBasket} FT · ${throwText} · ${formatToPar(toPar)}`, tx, 13, PAL.ink);
    }

    // Wind: arrow shape + words, so it never relies on colour.
    const cx = VIEW_W - 12;
    const cy = 12;
    fillCircle(ctx, cx, cy, 8, PAL.night2);
    const label = windLabel(this.wind);
    if (label === 'CALM') {
      fillCircle(ctx, cx, cy, 2, PAL.inkDim);
    } else {
      const dx = Math.sin(this.wind.dir);
      const dy = -Math.cos(this.wind.dir);
      ctx.fillStyle = PAL.ink;
      for (let i = -6; i <= 6; i++) ctx.fillRect(Math.round(cx + dx * i), Math.round(cy + dy * i), 1, 1);
      for (const side of [-1, 1]) {
        const hx = -dx * 0.7 - dy * 0.7 * side;
        const hy = -dy * 0.7 + dx * 0.7 * side;
        for (let i = 0; i < 4; i++) ctx.fillRect(Math.round(cx + dx * 6 + hx * i), Math.round(cy + dy * 6 + hy * i), 1, 1);
      }
    }
    drawText(ctx, label, cx - 12, 4, PAL.ink, 'right');
    drawText(ctx, label === 'CALM' ? '0 MPH' : `${this.wind.mph} MPH`, cx - 12, 13, PAL.inkDim, 'right');
  }

  private drawToast(ctx: CanvasRenderingContext2D) {
    if (!this.toast || this.mode === 'flight' || this.mode === 'putting' || this.mode === 'done') return;
    const t = this.toast;
    if (this.mode === 'aim' && t.t > 3) return;
    const y = HUD_H + 30;
    panel(ctx, 14, y, VIEW_W - 28, 22, PAL.night1, t.bad ? PAL.red : PAL.amber);
    drawText(ctx, t.title, VIEW_W / 2, y + 4, t.bad ? PAL.red : PAL.amber, 'center');
    drawText(ctx, t.sub, VIEW_W / 2, y + 13, PAL.ink, 'center');
  }

  private drawHint(ctx: CanvasRenderingContext2D) {
    if (!this.hint) return;
    drawTextShadow(ctx, this.hint.text, VIEW_W / 2, TRAY_Y - 60, PAL.red, PAL.night0, 'center');
  }

  private drawTray(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = PAL.night1;
    ctx.fillRect(0, TRAY_Y, VIEW_W, VIEW_H - TRAY_Y);
    ctx.fillStyle = PAL.night3;
    ctx.fillRect(0, TRAY_Y, VIEW_W, 1);
    for (const b of this.buttons) drawButton(ctx, b);
    ctx.fillStyle = this.discColor;
    ctx.fillRect(6, TRAY_Y + 8, 3, 2);
  }

  private drawIntro(ctx: CanvasRenderingContext2D) {
    const h = this.hole;
    const y = 96;
    panel(ctx, 10, y, VIEW_W - 20, 50, 'rgba(13,11,19,0.88)', PAL.amber);
    drawText(ctx, `HOLE ${this.opts.holeNumber} · PAR ${h.par} · ${h.lengthFt} FT`, VIEW_W / 2, y + 6, PAL.amber, 'center');
    drawText(ctx, h.name, VIEW_W / 2, y + 17, PAL.ink, 'center');
    if (h.note) drawText(ctx, h.note, VIEW_W / 2, y + 28, PAL.inkDim, 'center');
    if (this.opts.introTag) drawTextShadow(ctx, this.opts.introTag, VIEW_W / 2, y - 10, PAL.amber, PAL.night0, 'center');
    drawText(ctx, 'TAP TO TEE OFF', VIEW_W / 2, y + 40, PAL.haze, 'center');
  }

  private drawDone(ctx: CanvasRenderingContext2D) {
    const s = this.state;
    ctx.fillStyle = 'rgba(13,11,19,0.6)';
    ctx.fillRect(0, HUD_H + 1, VIEW_W, TRAY_Y - HUD_H - 1);
    const y = 96;
    panel(ctx, 14, y, VIEW_W - 28, 110, PAL.night1, PAL.amber);
    const title = s.pickedUp ? 'PICKED UP' : SCORE_LABEL[scoreKey(s.strokes, s.par)];
    drawText(ctx, `HOLE ${this.opts.holeNumber} · ${this.hole.name}`, VIEW_W / 2, y + 7, PAL.inkDim, 'center');
    // Big title: draw the 3x5 font doubled.
    drawBig(ctx, title, VIEW_W / 2, y + 20, s.strokes <= s.par ? PAL.amber : PAL.ink);
    drawText(ctx, `${s.strokes} THROWS · PAR ${s.par}`, VIEW_W / 2, y + 40, PAL.ink, 'center');
    if (s.penalties) drawText(ctx, `INCLUDES ${s.penalties} PENALTY`, VIEW_W / 2, y + 50, PAL.red, 'center');
    drawText(ctx, `ROUND ${formatToPar(this.opts.roundToPar + s.strokes - s.par)}`, VIEW_W / 2, y + 62, PAL.haze, 'center');
    const extra = this.opts.doneInfo?.(s.strokes) ?? [];
    extra.slice(0, 2).forEach((line, i) => drawText(ctx, line, VIEW_W / 2, y + 70 + i * 8, i === 0 ? PAL.amber : PAL.inkDim, 'center'));
    for (const b of this.doneButtons) drawButton(ctx, b);
  }
}

function drawBig(ctx: CanvasRenderingContext2D, s: string, cx: number, y: number, color: string) {
  ctx.save();
  ctx.translate(Math.round(cx), y);
  ctx.scale(2, 2);
  drawText(ctx, s, 0, 0, PAL.night0, 'center');
  ctx.restore();
  ctx.save();
  ctx.translate(Math.round(cx) - 1, y - 1);
  ctx.scale(2, 2);
  drawText(ctx, s, 0, 0, color, 'center');
  ctx.restore();
}

function drawDropMarker(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = PAL.ink;
  const X = Math.round(x);
  const Y = Math.round(y);
  ctx.fillRect(X - 2, Y - 2, 5, 1);
  ctx.fillRect(X - 2, Y + 2, 5, 1);
  ctx.fillRect(X - 2, Y - 2, 1, 5);
  ctx.fillRect(X + 2, Y - 2, 1, 5);
  drawTextShadow(ctx, 'DROP', x, y + 5, PAL.ink, PAL.night0, 'center');
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

function ringPixels(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.fillStyle = color;
  const n = Math.max(12, Math.round(r * 5));
  for (let i = 0; i < n; i += 2) {
    const a = (i / n) * Math.PI * 2;
    ctx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 1, 1);
  }
}
