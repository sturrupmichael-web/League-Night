/**
 * Screen flow: title, the three modes (New Round, Lantern Cup, Skins), the turn minigames,
 * results and the meta screens. Owns the save file and writes it after every hole.
 */
import { config } from './config';
import { COURSE_BLURB, courseById, COURSES } from './content/courses';
import discsJson from './content/discs.json';
import { PRACTICE_HOLE } from './content/practiceField';
import rivalsJson from './content/rivals.json';
import { sfx } from './core/audio';
import { motion } from './core/motion';
import { music } from './core/music';
import type { Game } from './core/game';
import { loadSave, type SaveData, writeSave } from './core/save';
import { EXTRA_H, VIEW_W } from './core/screen';
import { type AiHole, playAiHole } from './game/ai';
import { cupWinner, standings } from './game/championship';
import { chaserById, chaserConfig, CHASERS, chaptersUnlocked, isChaserUnlocked } from './game/chasers';
import { holeWind } from './game/conditions';
import { credTier, type CredLine, roundCred } from './game/cred';
import { pickHighlights } from './game/highlights';
import type { CourseDef, HoleDef } from './game/hole';
import {
  currentHoleIndex, type HoleRecord, isRoundOver, newRound, type Pacing, recordHole, recordRivals, type RoundLength, type RoundMode, roundMode,
  type RoundSettings, type RoundState, roundToPar,
} from './game/round';
import { formatToPar } from './game/rules';
import { type SkinsRule, skinsOutcome, tallySkins } from './game/skins';
import { DYES } from './game/cred';
import { drawText, wrapText } from './render/font';
import { PAL } from './render/palette';
import { drawChaser } from './render/portrait';
import type { Disc } from './sim/discs';
import { mixSeed } from './sim/rng';
import { makeTerrain } from './sim/terrain';
import type { ThrowResult } from './sim/throw';
import { ChaserScene } from './scenes/Chasers';
import { HoleScene } from './scenes/HoleScene';
import { BagScene } from './scenes/Bag';
import { HowToScene } from './scenes/HowTo';
import { LockerScene, TURN_GAMES } from './scenes/Locker';
import { type Clip, ReplayScene } from './scenes/Replay';
import { type NightSummary, ResultsScene } from './scenes/Results';
import { Bullseye } from './scenes/turn/Bullseye';
import { LostAndFound } from './scenes/turn/LostAndFound';
import { SkipContest } from './scenes/turn/SkipContest';
import { drawBigText, drawLanterns, type MenuItem, MenuScene } from './ui/menu';
import { Friends } from './friends';
import { getBackend } from './net';
import { postable } from './net/leaderboard';
import type { LeaderboardApi } from './net/types';
import { LeaderboardScene } from './scenes/Leaderboard';
import { NameEntryScene } from './scenes/NameEntry';

const DISCS = discsJson as Disc[];

interface Rival { id: string; name: string; skill: number; hand: 'right' | 'left'; arm: number; color: string; quip: string }
export const RIVALS = rivalsJson as Rival[];

const LENGTHS: { n: RoundLength; label: string; caption: string }[] = [
  { n: 3, label: '3 HOLES', caption: 'QUICK ONE' },
  { n: 9, label: '9 HOLES', caption: 'THE FRONT NINE' },
  { n: 18, label: '18 HOLES', caption: 'THE FULL COURSE' },
];

const MODE_NAME: Record<RoundMode, string> = { casual: 'NEW ROUND', cup: 'THE LANTERN CUP', skins: 'SKINS' };

export interface AppHooks {
  onThrow?: (r: ThrowResult) => void;
  enableDev?: () => void;
  devOn?: () => boolean;
}

export class App {
  /** The course picked on the setup screens. */
  private courseIdx = 0;
  get course(): CourseDef {
    return COURSES[this.courseIdx];
  }
  private courseOf(round: RoundState): CourseDef {
    return courseById(round.settings.courseId);
  }
  save: SaveData = loadSave();
  private lengthIdx = 1;
  private cupLengthIdx = 1;
  private skinsLengthIdx = 1;
  private rivalIdx = 0;
  private skinsRule: SkinsRule = 'carry';
  private pacing: Pacing = 'throw';
  /** A dev/test round that must not touch the save file. */
  private ephemeral: RoundState | null = null;
  /** Rival holes for the hole being played, keyed by rival id. */
  private rivalHoles: Record<string, AiHole> = {};
  readonly friends: Friends;

  constructor(
    private game: Game,
    private hooks: AppHooks = {},
  ) {
    sfx.enabled = this.save.settings.sfx;
    music.setEnabled(this.save.settings.music);
    motion.set(this.save.settings.motion);
    this.friends = new Friends({
      game,
      courses: COURSES,
      courseItem: (back) => this.courseItem(back),
      selectedCourse: () => this.course,
      meta: () => ({ name: this.chaser.name, chaserId: this.chaser.id, hand: this.save.settings.hand }),
      dyeColor: () => this.dyeColor,
      hints: () => this.save.settings.hints,
      onThrow: hooks.onThrow,
      title: () => this.title(),
      chasers: (back) => this.chasers(back),
      toggles: () => this.toggles(),
      payMatch: (id, won, finished) => this.payFriendMatch(id, won, finished),
    });
  }

  /** Cred for a friend match, paid once: 15 for finishing the card, 25 more for winning. */
  private payFriendMatch(id: string, won: boolean, finished: boolean): number {
    if (this.save.friendPaid.includes(id)) return 0;
    const cred = (finished ? 15 : 0) + (won ? 25 : 0);
    this.save.friendPaid.push(id);
    this.save.cred += cred;
    this.persist();
    return cred;
  }

  private persist() {
    writeSave(this.save);
  }

  private get chaser() {
    return chaserById(this.save.chaserId);
  }

  private get dyeColor() {
    return DYES.find((d) => d.id === this.save.dye)?.color ?? null;
  }

  // ---------- Title ----------

  title() {
    this.ephemeral = null;
    const r = this.save.round;
    const items: MenuItem[] = [];
    if (r && !isRoundOver(r)) {
      const n = currentHoleIndex(r) + 1;
      items.push({ caption: `${MODE_NAME[roundMode(r)]} · HOLE ${n} OF ${r.order.length}`, value: 'CONTINUE', onTap: () => this.playHole(), primary: true });
    }
    items.push(
      { caption: 'YOU AND THE COURSE', value: 'NEW ROUND', onTap: () => this.newRoundFlow(), primary: !(r && !isRoundOver(r)) },
      { caption: 'SEASON FINALE VS THE FIELD', value: 'THE LANTERN CUP', onTap: () => this.setupCup() },
      { caption: 'HEAD TO HEAD FOR SKINS', value: 'SKINS', onTap: () => this.setupSkins() },
      { caption: () => (this.friends.yourTurn ? `YOUR TURN IN ${this.friends.yourTurn} MATCH${this.friends.yourTurn > 1 ? 'ES' : ''}` : 'ONLINE · SAME COURSE'), value: 'PLAY A FRIEND', onTap: () => this.friends.menu() },
      { caption: 'BEST ROUNDS ONLINE', value: 'LEADERBOARD', onTap: () => this.leaderboard(() => this.title()) },
      { caption: 'NO SCORE', value: 'PRACTICE FIELD', onTap: () => this.practice() },
    );
    const small = (x: number, y: number, caption: string, value: string, onTap: () => void): MenuItem => ({ caption, value, onTap, box: { x, y, w: 56, h: 20 } });
    items.push(
      small(4, 254 + EXTRA_H, 'WHO YOU ARE', 'CHASERS', () => this.chasers(() => this.title())),
      small(62, 254 + EXTRA_H, 'CRED', 'LOCKER', () => this.locker()),
      small(120, 254 + EXTRA_H, 'SIX PAGES', 'HOW TO', () => this.game.set(new HowToScene(() => this.title()))),
      small(4, 277 + EXTRA_H, 'MUSIC · SOUND', 'SETTINGS', () => this.settings()),
      small(62, 277 + EXTRA_H, '', 'CREDITS', () => this.credits()),
    );
    const ch = this.chaser;
    this.game.set(
      new MenuScene({
        items,
        top: items.length > 11 ? 82 : 92,
        gap: items.length > 11 ? 24 : 25,
        draw: (ctx, t) => {
          drawLanterns(ctx, t);
          drawBigText(ctx, 'LEAGUE', VIEW_W / 2, 32, PAL.amber, 3);
          drawBigText(ctx, 'NIGHT', VIEW_W / 2, 52, PAL.ink, 3);
          drawText(ctx, 'TEE TIME IS AT DUSK', VIEW_W / 2, 74, PAL.haze, 'center');
          drawChaser(ctx, 150, 316 + EXTRA_H, ch, this.save.outfits[ch.id] ?? 0, 1, (Math.sin(t * 2) + 1) / 2);
          drawText(ctx, `${this.save.cred} CRED`, 150, 278 + EXTRA_H, PAL.amber, 'center');
        },
      }),
    );
  }

  // ---------- Meta screens ----------

  private chasers(back: () => void, startId?: string) {
    this.game.set(new ChaserScene(this.save, () => this.persist(), back, startId));
  }

  private locker(back: () => void = () => this.title()) {
    this.game.set(
      new LockerScene(this.save, () => this.persist(), {
        back,
        turnGame: (id) => this.turnGame(id, (cred) => this.addCred(cred), () => this.locker(back)),
        bag: () => this.game.set(new BagScene(() => this.locker(back))),
      }),
    );
  }

  private addCred(n: number) {
    if (this.ephemeral) return;
    this.save.cred += n;
    this.persist();
  }

  private turnGame(id: string, onCred: (cred: number) => void, then: () => void) {
    const done = (_score: number, cred: number) => {
      onCred(cred);
      then();
    };
    const g = id === 'bullseye' ? new Bullseye(done) : id === 'lost' ? new LostAndFound(done) : new SkipContest(done);
    this.game.set(g);
  }

  // ---------- Setup ----------

  private newRoundFlow() {
    if (!this.save.offeredPractice) {
      this.save.offeredPractice = true;
      this.persist();
      this.game.push(
        new MenuScene({
          overlay: { title: 'FIRST NIGHT AT THE LEAGUE?', sub: 'WARM UP BEFORE YOUR CARD' },
          top: 128,
          items: [
            { caption: 'SIX SHORT PAGES', value: 'HOW TO PLAY', onTap: () => this.game.push(new HowToScene(() => this.game.pop())) },
            { caption: 'NO SCORE, NO PRESSURE', value: 'PRACTICE FIELD', onTap: () => this.practice() },
            { caption: "I'M READY", value: 'SKIP', onTap: () => this.setup(), primary: true },
          ],
        }),
      );
      return;
    }
    this.setup();
  }

  private chaserItem(back: () => void): MenuItem {
    return {
      caption: 'YOUR CHASER',
      value: () => `${this.chaser.name.split(' ')[0]} · ${this.save.settings.hand === 'right' ? 'RIGHTY' : 'LEFTY'}`,
      onTap: () => this.chasers(back),
    };
  }

  /** Cycle through the courses (shown on every setup screen). */
  private courseItem(_back?: () => void): MenuItem {
    return {
      caption: () => `PAR ${this.course.par} · ${(this.course.holes.reduce((a, h) => a + h.lengthFt, 0) / 1000).toFixed(1)}K FT${this.save.pins.includes(this.course.id) ? ' · PIN' : ''}`,
      value: () => `< ${this.course.name} >`,
      onTap: () => (this.courseIdx = (this.courseIdx + 1) % COURSES.length),
    };
  }

  private replacesNote() {
    return !!this.save.round && !isRoundOver(this.save.round) ? 'REPLACES YOUR SAVED ROUND' : '';
  }

  private setup() {
    this.game.set(
      new MenuScene({
        top: 96,
        items: [
          this.courseItem(),
          { caption: () => LENGTHS[this.lengthIdx].caption, value: () => `< ${LENGTHS[this.lengthIdx].label} >`, onTap: () => (this.lengthIdx = (this.lengthIdx + 1) % LENGTHS.length) },
          this.chaserItem(() => this.setup()),
          { caption: this.replacesNote() || '3 MULLIGANS', value: 'TEE OFF', primary: true, onTap: () => this.startRound({ mode: 'casual', length: LENGTHS[this.lengthIdx].n }) },
          { caption: '', value: 'BACK', onTap: () => this.title() },
        ],
        draw: (ctx, t) => {
          drawLanterns(ctx, t);
          drawBigText(ctx, 'NEW ROUND', VIEW_W / 2, 40, PAL.amber);
          drawText(ctx, COURSE_BLURB[this.course.id] ?? '', VIEW_W / 2, 64, PAL.ink, 'center');
          drawText(ctx, 'SAVES EVERY HOLE', VIEW_W / 2, 76, PAL.haze, 'center');
        },
      }),
    );
  }

  private setupCup() {
    this.game.set(
      new MenuScene({
        top: 110,
        items: [
          this.courseItem(),
          { caption: () => LENGTHS[this.cupLengthIdx].caption, value: () => `< ${LENGTHS[this.cupLengthIdx].label} >`, onTap: () => (this.cupLengthIdx = (this.cupLengthIdx + 1) % LENGTHS.length) },
          this.chaserItem(() => this.setupCup()),
          { caption: this.replacesNote() || 'NO MULLIGANS', value: 'TEE OFF', primary: true, onTap: () => this.startRound({ mode: 'cup', length: LENGTHS[this.cupLengthIdx].n }) },
          { caption: '', value: 'BACK', onTap: () => this.title() },
        ],
        draw: (ctx, t) => {
          drawLanterns(ctx, t);
          drawBigText(ctx, 'THE LANTERN CUP', VIEW_W / 2, 36, PAL.amber);
          drawText(ctx, 'SEASON FINALE AT ' + this.course.name, VIEW_W / 2, 58, PAL.ink, 'center');
          wrapText('YOU AGAINST EIGHT LEAGUE REGULARS. LEADERBOARD AFTER EVERY HOLE. LOWEST CARD LIFTS THE CUP.', VIEW_W - 30).forEach((l, i) =>
            drawText(ctx, l, VIEW_W / 2, 72 + i * 9, PAL.haze, 'center'),
          );
          if (this.save.trophies.includes('lantern-cup')) drawText(ctx, `CUPS WON: ${this.save.cupsWon}`, VIEW_W / 2, 230, PAL.amber, 'center');
        },
      }),
    );
  }

  private setupSkins() {
    const rival = () => RIVALS[this.rivalIdx];
    this.game.set(
      new MenuScene({
        top: 104,
        items: [
          { caption: () => `SKILL ${'*'.repeat(Math.max(1, Math.round(rival().skill * 5)))}`, value: () => `< ${rival().name} >`, onTap: () => (this.rivalIdx = (this.rivalIdx + 1) % RIVALS.length) },
          {
            caption: () => (this.skinsRule === 'carry' ? 'TIES CARRY THE POT' : 'TIES LOSE THE SKIN'),
            value: () => (this.skinsRule === 'carry' ? '< CARRY-OVER >' : '< SUDDEN DEATH >'),
            onTap: () => (this.skinsRule = this.skinsRule === 'carry' ? 'sudden' : 'carry'),
          },
          {
            caption: () => (this.pacing === 'throw' ? 'WATCH EVERY RIVAL THROW' : 'JUST THE HOLE RESULTS'),
            value: () => (this.pacing === 'throw' ? '< THROW BY THROW >' : '< HOLE BY HOLE >'),
            onTap: () => (this.pacing = this.pacing === 'throw' ? 'hole' : 'throw'),
          },
          this.courseItem(),
          { caption: () => LENGTHS[this.skinsLengthIdx].caption, value: () => `< ${LENGTHS[this.skinsLengthIdx].label} >`, onTap: () => (this.skinsLengthIdx = (this.skinsLengthIdx + 1) % LENGTHS.length) },
          this.chaserItem(() => this.setupSkins()),
          {
            caption: this.replacesNote() || 'NO MULLIGANS',
            value: 'TEE OFF',
            primary: true,
            onTap: () => this.startRound({ mode: 'skins', length: LENGTHS[this.skinsLengthIdx].n, rivalId: rival().id, skinsRule: this.skinsRule, pacing: this.pacing }),
          },
          { caption: '', value: 'BACK', onTap: () => this.title() },
        ],
        gap: 24,
        draw: (ctx, t) => {
          drawLanterns(ctx, t);
          drawBigText(ctx, 'SKINS', VIEW_W / 2, 36, PAL.amber);
          drawText(ctx, 'ONE RIVAL · ONE SKIN A HOLE', VIEW_W / 2, 58, PAL.ink, 'center');
          wrapText(rival().quip, VIEW_W - 30).forEach((l, i) => drawText(ctx, l, VIEW_W / 2, 74 + i * 9, PAL.haze, 'center'));
        },
      }),
    );
  }

  private startRound(s: Partial<RoundSettings> & { mode: RoundMode; length: RoundLength }) {
    this.ephemeral = null;
    const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    const settings: RoundSettings = { courseId: this.course.id, hand: this.save.settings.hand, chaserId: this.chaser.id, ...s };
    let round = newRound(courseById(settings.courseId), settings, seed);
    if (s.mode === 'cup') round = { ...round, rivals: RIVALS.map((r) => ({ id: r.id, name: r.name, scores: [] })) };
    if (s.mode === 'skins') {
      const r = RIVALS.find((x) => x.id === s.rivalId) ?? RIVALS[0];
      round = { ...round, rivals: [{ id: r.id, name: r.name, scores: [] }] };
    }
    this.save.round = round;
    this.persist();
    this.playHole();
  }

  /** Test-play a hole from the editor (?testhole). */
  private customHole: HoleDef | null = null;
  startCustomHole(hole: HoleDef) {
    this.customHole = hole;
    this.startSingleHole(0, (Date.now() >>> 0) || 5);
  }

  private holeAt(round: RoundState, idx: number): HoleDef {
    return this.customHole ?? this.courseOf(round).holes[round.order[idx]];
  }

  /** Start a one-off round on a single hole (dev/testing: ?hole=N). */
  startSingleHole(index: number, seed: number, courseId?: string) {
    const course = courseById(courseId);
    const r = newRound(course, { courseId: course.id, length: 3, hand: this.save.settings.hand, chaserId: this.chaser.id }, seed);
    this.ephemeral = { ...r, order: [index] };
    this.playHole();
  }

  // ---------- Playing ----------

  private computeRivalHoles(round: RoundState, idx: number) {
    this.rivalHoles = {};
    if (!round.rivals?.length) return;
    const hole = this.holeAt(round, idx);
    const env = { hole, terrain: makeTerrain(hole.terrain), wind: holeWind(mixSeed(round.seed, idx), hole) };
    round.rivals.forEach((card, k) => {
      const r = RIVALS.find((x) => x.id === card.id);
      if (!r) return;
      this.rivalHoles[r.id] = playAiHole(env, { skill: r.skill, hand: r.hand, arm: r.arm }, DISCS, mixSeed(round.seed, 5000 + idx * 16 + k), config);
    });
  }

  private playHole() {
    const round = this.ephemeral ?? this.save.round;
    if (!round) return this.title();
    const idx = currentHoleIndex(round);
    const hole = this.holeAt(round, idx);
    const mode = roundMode(round);
    this.computeRivalHoles(round, idx);
    const chaser = chaserById(round.settings.chaserId);
    const skinsRival = mode === 'skins' ? RIVALS.find((r) => r.id === round.rivals?.[0]?.id) : undefined;
    const scene: HoleScene = new HoleScene(chaserConfig(config, chaser), {
      hole,
      practice: false,
      seed: mixSeed(round.seed, idx),
      holeNumber: this.ephemeral && !this.customHole && round.order.length === 1 ? hole.id : idx + 1,
      holeCount: round.order.length,
      roundToPar: roundToPar(round),
      hand: round.settings.hand,
      hints: this.save.settings.hints,
      mulligansLeft: round.mulligansLeft,
      dyeColor: this.dyeColor,
      onThrow: this.hooks.onThrow,
      onPause: () => this.pause(round),
      onFinish: (rec) => this.finishHole(rec),
      introTag: mode === 'cup' ? 'THE LANTERN CUP' : mode === 'skins' ? this.skinsTag(round) : undefined,
      rival:
        skinsRival && round.settings.pacing === 'throw'
          ? { name: skinsRival.name.split(' ')[0], color: skinsRival.color, hole: this.rivalHoles[skinsRival.id], cfg: config }
          : undefined,
      doneInfo: mode === 'casual' ? undefined : (strokes) => this.doneInfo(round, hole.par, strokes),
    });
    this.game.set(scene);
  }

  private skinsTag(round: RoundState) {
    const t = this.skinsTally(round);
    const pot = 1 + (round.settings.skinsRule === 'carry' ? t.carry : 0);
    return `SKINS · ${pot} ON THE LINE · ${t.you}-${t.rival}`;
  }

  private skinsTally(round: RoundState, extra?: { you: number; rival: number }) {
    const you = round.card.map((h) => h.strokes);
    const rival = [...(round.rivals?.[0]?.scores ?? [])];
    if (extra) {
      you.push(extra.you);
      rival.push(extra.rival);
    }
    return tallySkins(you, rival, round.settings.skinsRule ?? 'carry', round.order.length);
  }

  /** Lines for the hole-complete panel. */
  private doneInfo(round: RoundState, par: number, strokes: number): string[] {
    const mode = roundMode(round);
    if (mode === 'skins') {
      const r = round.rivals![0];
      const rs = this.rivalHoles[r.id]?.strokes ?? par;
      const t = this.skinsTally(round, { you: strokes, rival: rs });
      const h = t.holes[t.holes.length - 1];
      const first = r.name.split(' ')[0];
      const line = h.winner === 'you' ? `YOU TAKE ${h.paid} SKIN${h.paid > 1 ? 'S' : ''}` : h.winner === 'rival' ? `${first} TAKES ${h.paid}` : t.voided ? 'TIED · POT VOIDED' : round.settings.skinsRule === 'carry' ? `TIED · ${t.carry} CARRY OVER` : 'TIED · SKIN LOST';
      return [`${first} ${rs} · ${line}`, `SKINS: YOU ${t.you} · ${first} ${t.rival}`];
    }
    const pars = round.order.map((_, k) => this.holeAt(round, k).par);
    const rows = standings(this.entrants(round, strokes), pars);
    const me = rows.find((x) => x.you)!;
    const lead = rows[0];
    return [`YOU: ${me.tied ? 'T' : ''}${me.place} AT ${formatToPar(me.toPar)}`, lead.you ? 'YOU LEAD THE FIELD' : `LEADER ${lead.name} ${formatToPar(lead.toPar)}`];
  }

  private entrants(round: RoundState, pending?: number) {
    const you = round.card.map((h) => h.strokes);
    if (pending !== undefined) you.push(pending);
    return [
      { id: 'you', name: 'YOU', scores: you, you: true },
      ...(round.rivals ?? []).map((c) => ({ id: c.id, name: c.name, scores: pending !== undefined && this.rivalHoles[c.id] ? [...c.scores, this.rivalHoles[c.id].strokes] : c.scores })),
    ];
  }

  private finishHole(rec: HoleRecord) {
    const base = this.ephemeral ?? this.save.round!;
    let round = recordHole(base, rec);
    const scores: Record<string, number> = {};
    for (const [id, h] of Object.entries(this.rivalHoles)) scores[id] = h.strokes;
    round = recordRivals(round, scores);
    if (this.ephemeral) {
      this.ephemeral = round;
      return this.finishRound(round);
    }
    this.save.round = isRoundOver(round) ? null : round;
    this.persist();
    const after = () => this.afterHole(round);
    const mode = roundMode(round);
    if (mode === 'cup') this.cupBoard(round, after);
    else if (mode === 'skins') this.skinsBoard(round, after);
    else after();
  }

  /** At the turn (after hole 9 of a 9 or 18), offer a minigame; then the next hole or the results. */
  private afterHole(round: RoundState) {
    const atTurn = round.card.length === 9 && round.order.length >= 9 && !round.turn;
    const next = () => (isRoundOver(round) ? this.finishRound(round) : this.playHole());
    if (!atTurn) return next();
    const play = (id: string) =>
      this.turnGame(
        id,
        (cred) => {
          round = { ...round, turn: { game: id, cred } };
          if (this.save.round) this.save.round = round;
          this.addCred(cred);
        },
        () => (isRoundOver(round) ? this.finishRound(round) : this.playHole()),
      );
    this.game.set(
      new MenuScene({
        top: 116,
        items: [
          ...TURN_GAMES.map((g) => ({ caption: '30 SECONDS · EARN CRED', value: g.name, onTap: () => play(g.id) })),
          { caption: isRoundOver(round) ? 'STRAIGHT TO THE CARD' : 'STRAIGHT TO THE BACK NINE', value: 'SKIP', onTap: next },
        ],
        draw: (ctx, t) => {
          drawLanterns(ctx, t);
          drawBigText(ctx, 'AT THE TURN', VIEW_W / 2, 40, PAL.amber);
          drawText(ctx, `NINE DOWN · ${formatToPar(roundToPar(round))}`, VIEW_W / 2, 62, PAL.ink, 'center');
          drawText(ctx, 'GRAB A SNACK AND PLAY A QUICK ONE?', VIEW_W / 2, 80, PAL.haze, 'center');
        },
      }),
    );
  }

  private cupBoard(round: RoundState, next: () => void) {
    const pars = round.order.map((_, k) => this.holeAt(round, k).par);
    const rows = standings(this.entrants(round), pars);
    const over = isRoundOver(round);
    this.game.set(
      new MenuScene({
        top: 270 + EXTRA_H,
        items: [{ caption: over ? 'FINAL STANDINGS' : `HOLE ${round.card.length + 1} NEXT`, value: over ? 'SEE THE CARD' : 'NEXT HOLE', onTap: next, primary: true }],
        draw: (ctx, t) => {
          drawLanterns(ctx, t, -8);
          drawBigText(ctx, 'LEADERBOARD', VIEW_W / 2, 18, PAL.amber);
          drawText(ctx, `THE LANTERN CUP · THRU ${round.card.length} OF ${round.order.length}`, VIEW_W / 2, 38, PAL.inkDim, 'center');
          let y = 54;
          drawText(ctx, 'POS', 8, y, PAL.haze);
          drawText(ctx, 'PLAYER', 30, y, PAL.haze);
          drawText(ctx, 'LAST', 132, y, PAL.haze, 'center');
          drawText(ctx, 'TOT', VIEW_W - 8, y, PAL.haze, 'right');
          y += 12;
          for (const r of rows) {
            const e = r.you ? round.card.map((h) => h.strokes) : (round.rivals!.find((c) => c.id === r.id)?.scores ?? []);
            if (r.you) {
              ctx.fillStyle = PAL.night3;
              ctx.fillRect(4, y - 3, VIEW_W - 8, 12);
            }
            drawText(ctx, `${r.tied ? 'T' : ''}${r.place}`, 8, y, r.you ? PAL.amber : PAL.inkDim);
            drawText(ctx, r.you ? `YOU (${this.chaser.name.split(' ')[0]})` : r.name, 30, y, r.you ? PAL.amber : PAL.ink);
            drawText(ctx, String(e[e.length - 1] ?? '-'), 132, y, PAL.inkDim, 'center');
            drawText(ctx, formatToPar(r.toPar), VIEW_W - 8, y, r.toPar < 0 ? PAL.amber : PAL.ink, 'right');
            y += 13;
          }
        },
      }),
    );
  }

  private skinsBoard(round: RoundState, next: () => void) {
    const t = this.skinsTally(round);
    const rival = round.rivals![0];
    const first = rival.name.split(' ')[0];
    const over = isRoundOver(round);
    this.game.set(
      new MenuScene({
        top: 270 + EXTRA_H,
        items: [{ caption: over ? 'MATCH OVER' : `${1 + (round.settings.skinsRule === 'carry' ? t.carry : 0)} ON THE LINE NEXT`, value: over ? 'SEE THE CARD' : 'NEXT HOLE', onTap: next, primary: true }],
        draw: (ctx, tm) => {
          drawLanterns(ctx, tm, -8);
          drawBigText(ctx, `${t.you} - ${t.rival}`, VIEW_W / 2, 18, t.you >= t.rival ? PAL.amber : PAL.ink);
          drawText(ctx, `YOU VS ${rival.name} · ${round.settings.skinsRule === 'carry' ? 'CARRY-OVER' : 'SUDDEN DEATH'}`, VIEW_W / 2, 38, PAL.inkDim, 'center');
          let y = 56;
          drawText(ctx, '#', 10, y, PAL.haze, 'center');
          drawText(ctx, 'YOU', 50, y, PAL.haze, 'center');
          drawText(ctx, first, 90, y, PAL.haze, 'center');
          drawText(ctx, 'SKINS', VIEW_W - 8, y, PAL.haze, 'right');
          y += 11;
          const rows = t.holes.slice(-17);
          const off = t.holes.length - rows.length;
          rows.forEach((h, i) => {
            const n = off + i;
            drawText(ctx, String(n + 1), 10, y, PAL.inkDim, 'center');
            drawText(ctx, String(round.card[n].strokes), 50, y, h.winner === 'you' ? PAL.amber : PAL.ink, 'center');
            drawText(ctx, String(rival.scores[n]), 90, y, h.winner === 'rival' ? PAL.amber : PAL.ink, 'center');
            const txt = h.winner === 'you' ? `YOU +${h.paid}` : h.winner === 'rival' ? `${first} +${h.paid}` : n === round.order.length - 1 && t.voided ? 'VOID' : round.settings.skinsRule === 'carry' ? 'CARRY' : 'LOST';
            drawText(ctx, txt, VIEW_W - 8, y, h.winner === 'tie' ? PAL.dusk : PAL.ink, 'right');
            y += 11;
          });
        },
      }),
    );
  }

  /** Round over: pay Cred, record unlocks, show results. */
  private finishRound(round: RoundState) {
    const mode = roundMode(round);
    const ephemeral = !!this.ephemeral && this.ephemeral === round;
    const s = this.save;
    const chaser = chaserById(round.settings.chaserId);
    const before = { tier: credTier(s.cred).index, chasers: CHASERS.filter((c) => isChaserUnlocked(c, s)).map((c) => c.id), chapters: chaptersUnlocked(chaser, s) };
    const full = round.order.length >= 9;
    const cred: CredLine[] = round.conceded ? [] : roundCred(round.card, { full });
    const unlocks: string[] = [];
    let night: NightSummary;
    let won = false;
    const pars = round.order.map((_, k) => this.holeAt(round, k).par);
    const tp = roundToPar(round);

    if (mode === 'cup') {
      const ents = this.entrants(round);
      const rows = standings(ents, pars);
      const winner = cupWinner(ents, pars);
      won = winner === 'you';
      const me = rows.find((r) => r.you)!;
      if (won) cred.push({ label: 'LIFTED THE CUP', cred: 100 });
      else if (me.place <= 3) cred.push({ label: 'TOP THREE FINISH', cred: 30 });
      const champ = rows.find((r) => r.id === winner)!;
      night = {
        headline: won ? 'YOU WIN THE LANTERN CUP!' : `${champ.name} WINS THE CUP`,
        sub: `YOU FINISHED ${me.tied ? 'T' : ''}${me.place} OF ${rows.length} AT ${formatToPar(me.toPar)}`,
        table: rows.map((r) => ({ left: `${r.tied ? 'T' : ''}${r.place}  ${r.you ? 'YOU' : r.name}`, right: formatToPar(r.toPar), you: r.you })),
        cred,
        unlocks,
      };
    } else if (mode === 'skins') {
      const rival = round.rivals![0];
      const t = this.skinsTally(round);
      let you = t.you;
      let them = t.rival;
      if (round.conceded) them += round.order.length - t.holes.length + t.carry; // the rest of the skins go to the rival
      const out = round.conceded ? 'rival' : skinsOutcome({ ...t, you, rival: them });
      won = out === 'you';
      if (you) cred.push({ label: `SKINS WON X${you}`, cred: you * 10 });
      if (won) cred.push({ label: 'WON THE MATCH', cred: 25 });
      const first = rival.name.split(' ')[0];
      night = {
        headline: round.conceded ? `CONCEDED · ${first} TAKES IT` : won ? `YOU WIN THE SKINS ${you}-${them}` : out === 'halved' ? `ALL SQUARE ${you}-${them}` : `${first} WINS ${them}-${you}`,
        sub: t.voided ? `${t.voided} SKIN${t.voided > 1 ? 'S' : ''} VOIDED ON THE LAST HOLE` : `YOU VS ${rival.name}`,
        table: [
          { left: 'YOU', right: `${you} SKINS · ${formatToPar(tp)}`, you: true },
          { left: rival.name, right: `${them} SKINS · ${formatToPar(rival.scores.reduce((a, b) => a + b, 0) - pars.slice(0, rival.scores.length).reduce((a, b) => a + b, 0))}` },
        ],
        cred,
        unlocks,
      };
      void you;
    } else {
      night = {
        headline: tp < 0 ? 'UNDER PAR. NICE NIGHT.' : tp === 0 ? 'EVEN PAR. RESPECTABLE.' : 'THERE IS ALWAYS NEXT WEEK.',
        sub: `${this.courseOf(round).name} · ${round.order.length} HOLE${round.order.length === 1 ? '' : 'S'} · ${formatToPar(tp)}`,
        cred,
        unlocks,
      };
    }
    if (round.turn) cred.push({ label: 'AT THE TURN (ALREADY ADDED)', cred: 0 });

    if (!ephemeral) {
      s.roundsFinished++;
      const key = `${round.settings.courseId}:${round.order.length}`;
      if (!round.conceded && (s.bestRounds[key] === undefined || tp < s.bestRounds[key])) s.bestRounds[key] = tp;
      s.cred += cred.reduce((a, l) => a + l.cred, 0);
      const prog = s.chaserProgress[chaser.id] ?? { rounds: 0, wins: 0 };
      s.chaserProgress[chaser.id] = { rounds: prog.rounds + (round.conceded ? 0 : 1), wins: prog.wins + (won ? 1 : 0) };
      if (full && !round.conceded && !s.pins.includes(round.settings.courseId)) {
        s.pins.push(round.settings.courseId);
        unlocks.push(`${this.courseOf(round).name} PIN`);
      }
      if (mode === 'cup' && won) {
        s.cupsWon++;
        if (!s.trophies.includes('lantern-cup')) {
          s.trophies.push('lantern-cup');
          unlocks.push('THE LANTERN CUP TROPHY');
        }
      }
      if (mode === 'skins' && won) s.skinsMatchesWon++;
      const tier = credTier(s.cred);
      if (tier.index > before.tier) unlocks.push(`TIER: ${tier.tier.name}`);
      for (const c of CHASERS) if (!before.chasers.includes(c.id) && isChaserUnlocked(c, s)) unlocks.push(`CHASER: ${c.name}`);
      if (chaptersUnlocked(chaser, s) > before.chapters) unlocks.push(`${chaser.name.split(' ')[0]}: CHAPTER ${chaptersUnlocked(chaser, s)}`);
      s.round = null;
      this.persist();
    }
    this.results(round, night);
  }

  private results(round: RoundState, night: NightSummary) {
    const highlights = pickHighlights(round.card);
    const cfg = chaserConfig(config, chaserById(round.settings.chaserId));
    const clips: Clip[] = highlights.map((hl) => {
      const rec = round.card[hl.holeIndex];
      const hole = this.holeAt(round, hl.holeIndex);
      return { hl, hole, wind: rec.wind ?? holeWind(mixSeed(round.seed, hl.holeIndex), hole) };
    });
    const show = () =>
      this.game.set(
        new ResultsScene(
          round,
          this.courseOf(round),
          {
            again: () => {
              const st = round.settings;
              this.startRound({ ...st, mode: st.mode ?? 'casual', length: round.order.length as RoundLength });
            },
            title: () => this.title(),
            reel: () => this.game.set(new ReplayScene(clips, cfg, show, this.dyeColor)),
            post: !this.ephemeral && postable(round) ? (scene) => void this.postRound(round, scene) : undefined,
            board: (scene) => this.leaderboard(() => this.game.set(scene), { courseId: round.settings.courseId, holes: round.order.length === 18 ? 18 : 9 }),
            unlock: (line, scene) => {
              const back = () => this.game.set(scene);
              // "CHASER: JUNE LINDQVIST" or "MAE: CHAPTER 2": open on that chaser.
              const who = CHASERS.find((c) => line === `CHASER: ${c.name}` || line.startsWith(`${c.name.split(' ')[0]}: CHAPTER`));
              if (who) this.chasers(back, who.id);
              else this.locker(back);
            },
          },
          night,
          highlights,
        ),
      );
    show();
  }

  // ---------- Leaderboard ----------

  leaderboard(back: () => void, start: { courseId?: string; holes?: 9 | 18 } = { courseId: this.course.id }) {
    const net = getBackend();
    const board: LeaderboardScene = new LeaderboardScene(net, {
      back,
      changeName: () =>
        void net.then(async (api) =>
          this.pickName(api, (await api.myName().catch(() => null)) ?? '', () => {
            this.game.set(board);
            board.load();
          }),
        ),
    }, start);
    this.game.set(board);
  }

  /** Name entry; `done` runs after a save or on BACK. */
  private pickName(api: LeaderboardApi, initial: string, done: (saved: boolean) => void, why?: string) {
    const scene = new NameEntryScene(
      (name, sc) => {
        sc.busy = true;
        api
          .setName(name)
          .then(() => {
            sc.dispose();
            done(true);
          })
          .catch((e: Error) => {
            sc.message = e.message || 'COULD NOT SAVE THE NAME';
          })
          .finally(() => (sc.busy = false));
      },
      () => done(false),
      initial,
      why,
    );
    this.game.set(scene);
  }

  /** Send a finished round to the board, asking for a name first if there isn't one. */
  private async postRound(round: RoundState, scene: ResultsScene) {
    scene.posting = true;
    scene.postMsg = null;
    try {
      const api = await getBackend();
      if (!(await api.myName())) {
        scene.posting = false;
        this.pickName(api, '', (saved) => {
          this.game.set(scene);
          if (saved) void this.postRound(round, scene);
        }, 'PICK A NAME FOR THE LEADERBOARD');
        return;
      }
      const r = await api.submit(round);
      scene.posted = `#${r.rank}`;
      scene.postMsg = { text: `${r.name} · #${r.rank} ON ${this.courseOf(round).name} ${round.order.length}`, bad: false };
    } catch (e) {
      scene.postMsg = { text: (e as Error).message || 'COULD NOT POST THE SCORE', bad: true };
    } finally {
      scene.posting = false;
    }
  }

  practice() {
    this.game.set(
      new HoleScene(chaserConfig(config, this.chaser), {
        hole: PRACTICE_HOLE,
        practice: true,
        seed: Date.now() >>> 0,
        holeNumber: 0,
        holeCount: 0,
        roundToPar: 0,
        hand: this.save.settings.hand,
        hints: this.save.settings.hints,
        dyeColor: this.dyeColor,
        onThrow: this.hooks.onThrow,
        onPause: () => this.pause(null),
      }),
    );
  }

  // ---------- Pause ----------

  private pause(round: RoundState | null) {
    let confirmRestart = false;
    let confirmConcede = false;
    const items: MenuItem[] = [
      { caption: '', value: 'RESUME', onTap: () => this.game.pop(), primary: true },
      { caption: 'SIX SHORT PAGES', value: 'HOW TO PLAY', onTap: () => this.game.push(new HowToScene(() => this.game.pop())) },
      ...this.toggles(),
    ];
    if (round && roundMode(round) === 'skins' && !this.ephemeral) {
      items.push({
        caption: () => (confirmConcede ? 'CANNOT BE UNDONE' : 'GIVE THE MATCH AWAY'),
        value: () => (confirmConcede ? 'REALLY CONCEDE?' : 'CONCEDE'),
        onTap: () => {
          if (!confirmConcede) {
            confirmConcede = true;
            return;
          }
          const r = { ...round, conceded: true };
          this.save.round = null;
          this.persist();
          this.finishRound(r);
        },
      });
    } else if (round) {
      items.push({
        caption: () => (confirmRestart ? 'TAP AGAIN TO CONFIRM' : 'FROM HOLE 1'),
        value: () => (confirmRestart ? 'REALLY?' : 'START OVER'),
        onTap: () => {
          if (!confirmRestart) {
            confirmRestart = true;
            return;
          }
          this.startRound({ ...round.settings, mode: roundMode(round), length: round.order.length as RoundLength });
        },
      });
    }
    items.push({ caption: round ? 'SAVED AT THE LAST HOLE' : '', value: 'QUIT TO TITLE', onTap: () => this.title() });
    this.game.push(
      new MenuScene({
        overlay: { title: 'PAUSED', sub: round ? `${MODE_NAME[roundMode(round)]} · HOLE ${currentHoleIndex(round) + 1} OF ${round.order.length}` : 'PRACTICE FIELD' },
        top: 88,
        items,
        onBack: () => this.game.pop(),
      }),
    );
  }

  private toggles(): MenuItem[] {
    return [
      {
        caption: 'MUSIC',
        value: () => (this.save.settings.music ? 'ON' : 'OFF'),
        onTap: () => {
          this.save.settings.music = !this.save.settings.music;
          music.setEnabled(this.save.settings.music);
          this.persist();
        },
      },
      {
        caption: 'SOUND EFFECTS',
        value: () => (this.save.settings.sfx ? 'ON' : 'OFF'),
        onTap: () => {
          this.save.settings.sfx = !this.save.settings.sfx;
          sfx.enabled = this.save.settings.sfx;
          this.persist();
        },
      },
      {
        caption: 'TUTORIAL HINTS',
        value: () => (this.save.settings.hints ? 'ON' : 'OFF'),
        onTap: () => {
          this.save.settings.hints = !this.save.settings.hints;
          this.persist();
        },
      },
    ];
  }

  // ---------- Settings and credits ----------

  private settings() {
    this.game.set(
      new MenuScene({
        top: 80,
        items: [
          ...this.toggles(),
          {
            caption: 'NO SHAKE, CALMER EFFECTS',
            value: () => `< REDUCE MOTION: ${{ auto: 'AUTO', on: 'ON', off: 'OFF' }[this.save.settings.motion]} >`,
            onTap: () => {
              const order = ['auto', 'on', 'off'] as const;
              this.save.settings.motion = order[(order.indexOf(this.save.settings.motion) + 1) % 3];
              motion.set(this.save.settings.motion);
              this.persist();
            },
          },
          {
            caption: 'THROWING HAND',
            value: () => (this.save.settings.hand === 'right' ? '< RIGHTY >' : '< LEFTY >'),
            onTap: () => {
              this.save.settings.hand = this.save.settings.hand === 'right' ? 'left' : 'right';
              this.persist();
            },
          },
          // Developer tuning: only offered when the game was opened with ?dev=1.
          ...(this.hooks.devOn?.() ? [{ caption: 'TUNING SLIDERS', value: 'DEV PANEL ON', onTap: () => {} }] : []),
          { caption: '', value: 'BACK', onTap: () => this.title() },
        ],
        draw: (ctx, t) => {
          drawLanterns(ctx, t);
          drawBigText(ctx, 'SETTINGS', VIEW_W / 2, 40, PAL.amber);
        },
      }),
    );
  }

  private credits() {
    const lines: [string, string][] = [
      ['LEAGUE NIGHT', PAL.amber],
      ['A DISC GOLF GAME', PAL.ink],
      ['', ''],
      ['GAME DESIGN, CODE AND PIXELS', PAL.haze],
      ['MADE FOR THIS PROJECT', PAL.ink],
      ['', ''],
      ['CHASERS AND LEAGUE REGULARS', PAL.haze],
      ['ALL CHARACTERS ARE FICTIONAL', PAL.ink],
      ['', ''],
      ['MUSIC AND SOUND', PAL.haze],
      ['SYNTHESISED IN YOUR BROWSER', PAL.ink],
      ['', ''],
      ['TYPE', PAL.haze],
      ['AN ORIGINAL 3X5 PIXEL FONT', PAL.ink],
      ['', ''],
      ['BUILT WITH', PAL.haze],
      ['VITE · TYPESCRIPT · VITEST', PAL.ink],
      ['', ''],
      ['SEE YOU AT THE NEXT LEAGUE NIGHT', PAL.amber],
    ];
    this.game.set(
      new MenuScene({
        top: 274 + EXTRA_H,
        items: [{ caption: '', value: 'BACK', onTap: () => this.title() }],
        draw: (ctx, t) => {
          drawLanterns(ctx, t);
          lines.forEach(([s, c], i) => s && drawText(ctx, s, VIEW_W / 2, 36 + i * 12, c, 'center'));
        },
      }),
    );
  }
}
