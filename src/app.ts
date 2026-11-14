/**
 * Screen flow: title, setup, rounds, pause, results, how to play, settings, credits.
 * Owns the save file and writes it after every hole.
 */
import { config } from './config';
import courseJson from './content/courses/lantern-park.json';
import { PRACTICE_HOLE } from './content/practiceField';
import { sfx } from './core/audio';
import type { Game } from './core/game';
import { loadSave, type SaveData, writeSave } from './core/save';
import { VIEW_W } from './core/screen';
import { type CourseJson, parseCourse } from './game/hole';
import { currentHoleIndex, isRoundOver, newRound, recordHole, type RoundLength, type RoundState, roundToPar } from './game/round';
import { formatToPar } from './game/rules';
import { drawText } from './render/font';
import { PAL } from './render/palette';
import { mixSeed } from './sim/rng';
import type { ThrowResult } from './sim/throw';
import { HoleScene } from './scenes/HoleScene';
import { HowToScene } from './scenes/HowTo';
import { ResultsScene } from './scenes/Results';
import { drawBigText, drawLanterns, type MenuItem, MenuScene } from './ui/menu';

const LENGTHS: { n: RoundLength; label: string; caption: string }[] = [
  { n: 3, label: '3 HOLES', caption: 'QUICK ONE' },
  { n: 9, label: '9 HOLES', caption: 'THE FULL COURSE' },
  { n: 18, label: '18 HOLES', caption: 'TWICE AROUND' },
];

export interface AppHooks {
  onThrow?: (r: ThrowResult) => void;
  enableDev?: () => void;
  devOn?: () => boolean;
}

export class App {
  readonly course = parseCourse(courseJson as CourseJson);
  save: SaveData = loadSave();
  private lengthIdx = 1;
  /** A dev/test round that must not touch the save file. */
  private ephemeral: RoundState | null = null;

  constructor(
    private game: Game,
    private hooks: AppHooks = {},
  ) {
    sfx.enabled = this.save.settings.sfx;
  }

  private persist() {
    writeSave(this.save);
  }

  // ---------- Title ----------

  title() {
    this.ephemeral = null;
    const r = this.save.round;
    const items: MenuItem[] = [];
    if (r && !isRoundOver(r)) {
      const n = currentHoleIndex(r) + 1;
      items.push({ caption: `HOLE ${n} OF ${r.order.length} · ${formatToPar(roundToPar(r))}`, value: 'CONTINUE', onTap: () => this.playHole() });
    }
    items.push(
      { caption: this.course.name, value: 'NEW ROUND', onTap: () => this.newRoundFlow() },
      { caption: 'NO SCORE', value: 'PRACTICE FIELD', onTap: () => this.practice() },
      { caption: 'SIX QUICK PAGES', value: 'HOW TO PLAY', onTap: () => this.game.set(new HowToScene(() => this.title())) },
      { caption: 'SOUND · HINTS · HAND', value: 'SETTINGS', onTap: () => this.settings() },
      { caption: 'WHO MADE THIS', value: 'CREDITS', onTap: () => this.credits() },
    );
    const best = this.save.bestRounds[`${this.course.id}:9`];
    this.game.set(
      new MenuScene({
        items,
        top: 100,
        draw: (ctx, t) => {
          drawLanterns(ctx, t);
          drawBigText(ctx, 'LEAGUE', VIEW_W / 2, 36, PAL.amber, 3);
          drawBigText(ctx, 'NIGHT', VIEW_W / 2, 56, PAL.ink, 3);
          drawText(ctx, 'TEE TIME IS AT DUSK', VIEW_W / 2, 80, PAL.haze, 'center');
          const foot = best !== undefined ? `BEST 9 AT ${this.course.name}: ${formatToPar(best)}` : `ROUNDS PLAYED: ${this.save.roundsFinished}`;
          drawText(ctx, foot, VIEW_W / 2, 296, PAL.dusk, 'center');
        },
      }),
    );
  }

  // ---------- New round ----------

  private newRoundFlow() {
    if (!this.save.offeredPractice) {
      this.save.offeredPractice = true;
      this.persist();
      this.game.push(
        new MenuScene({
          overlay: { title: 'FIRST NIGHT AT THE LEAGUE?', sub: 'WARM UP BEFORE YOUR CARD' },
          top: 128,
          items: [
            { caption: 'NO SCORE, NO PRESSURE', value: 'PRACTICE FIELD', onTap: () => this.practice() },
            { caption: "I'M READY", value: 'SKIP', onTap: () => this.setup() },
          ],
        }),
      );
      return;
    }
    this.setup();
  }

  private setup() {
    const has = !!this.save.round && !isRoundOver(this.save.round);
    this.game.set(
      new MenuScene({
        top: 96,
        items: [
          { caption: () => LENGTHS[this.lengthIdx].caption, value: () => `< ${LENGTHS[this.lengthIdx].label} >`, onTap: () => (this.lengthIdx = (this.lengthIdx + 1) % LENGTHS.length) },
          {
            caption: 'THROWING HAND',
            value: () => (this.save.settings.hand === 'right' ? 'RIGHTY' : 'LEFTY'),
            onTap: () => {
              this.save.settings.hand = this.save.settings.hand === 'right' ? 'left' : 'right';
              this.persist();
            },
          },
          { caption: has ? 'REPLACES YOUR SAVED ROUND' : `${this.course.holes.length} HOLES · PAR ${this.course.par}`, value: 'TEE OFF', onTap: () => this.startRound() },
          { caption: '', value: 'BACK', onTap: () => this.title() },
        ],
        draw: (ctx, t) => {
          drawLanterns(ctx, t);
          drawBigText(ctx, 'NEW ROUND', VIEW_W / 2, 40, PAL.amber);
          drawText(ctx, this.course.name, VIEW_W / 2, 64, PAL.ink, 'center');
          drawText(ctx, '3 MULLIGANS · SAVES EVERY HOLE', VIEW_W / 2, 76, PAL.haze, 'center');
        },
      }),
    );
  }

  private startRound() {
    this.ephemeral = null;
    const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    const length = LENGTHS[this.lengthIdx].n;
    this.save.round = newRound(this.course, { courseId: this.course.id, length, hand: this.save.settings.hand }, seed);
    this.persist();
    this.playHole();
  }

  /** Start a one-off round on a single hole (dev/testing: ?hole=N). */
  startSingleHole(index: number, seed: number) {
    const r = newRound(this.course, { courseId: this.course.id, length: 3, hand: this.save.settings.hand }, seed);
    this.ephemeral = { ...r, order: [index] };
    this.playHole();
  }

  // ---------- Playing ----------

  private playHole() {
    const round = this.ephemeral ?? this.save.round;
    if (!round) return this.title();
    const idx = currentHoleIndex(round);
    const hole = this.course.holes[round.order[idx]];
    const scene: HoleScene = new HoleScene(config, {
      hole,
      practice: false,
      seed: mixSeed(round.seed, idx),
      holeNumber: idx + 1,
      holeCount: round.order.length,
      roundToPar: roundToPar(round),
      hand: round.settings.hand,
      hints: this.save.settings.hints,
      mulligansLeft: round.mulligansLeft,
      onThrow: this.hooks.onThrow,
      onPause: () => this.pause(round),
      onFinish: (rec) => this.finishHole(rec),
    });
    this.game.set(scene);
  }

  private finishHole(rec: Parameters<typeof recordHole>[1]) {
    if (this.ephemeral) {
      const r = recordHole(this.ephemeral, rec);
      this.ephemeral = null;
      return this.results(r);
    }
    const round = recordHole(this.save.round!, rec);
    if (isRoundOver(round)) {
      this.save.round = null;
      this.save.roundsFinished++;
      const key = `${round.settings.courseId}:${round.order.length}`;
      const tp = roundToPar(round);
      if (this.save.bestRounds[key] === undefined || tp < this.save.bestRounds[key]) this.save.bestRounds[key] = tp;
      this.persist();
      this.results(round);
    } else {
      this.save.round = round;
      this.persist();
      this.playHole();
    }
  }

  private results(round: RoundState) {
    this.game.set(
      new ResultsScene(round, this.course, {
        again: () => {
          this.lengthIdx = Math.max(0, LENGTHS.findIndex((l) => l.n === round.order.length));
          this.startRound();
        },
        title: () => this.title(),
      }),
    );
  }

  practice() {
    this.game.set(
      new HoleScene(config, {
        hole: PRACTICE_HOLE,
        practice: true,
        seed: Date.now() >>> 0,
        holeNumber: 0,
        holeCount: 0,
        roundToPar: 0,
        hand: this.save.settings.hand,
        hints: this.save.settings.hints,
        onThrow: this.hooks.onThrow,
        onPause: () => this.pause(null),
      }),
    );
  }

  // ---------- Pause ----------

  private pause(round: RoundState | null) {
    let confirmRestart = false;
    const items: MenuItem[] = [
      { caption: '', value: 'RESUME', onTap: () => this.game.pop() },
      ...this.toggles(),
    ];
    if (round) {
      items.push({
        caption: () => (confirmRestart ? 'TAP AGAIN TO CONFIRM' : 'FROM HOLE 1'),
        value: () => (confirmRestart ? 'REALLY?' : 'START OVER'),
        onTap: () => {
          if (!confirmRestart) {
            confirmRestart = true;
            return;
          }
          const length = round.order.length as RoundLength;
          this.lengthIdx = Math.max(0, LENGTHS.findIndex((l) => l.n === length));
          this.startRound();
        },
      });
    }
    items.push({ caption: round ? 'SAVED AT THE LAST HOLE' : '', value: 'QUIT TO TITLE', onTap: () => this.title() });
    this.game.push(
      new MenuScene({
        overlay: { title: 'PAUSED', sub: round ? `HOLE ${currentHoleIndex(round) + 1} OF ${round.order.length} · ${this.course.name}` : 'PRACTICE FIELD' },
        top: 88,
        items,
      }),
    );
  }

  private toggles() {
    return [
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
            caption: 'THROWING HAND',
            value: () => (this.save.settings.hand === 'right' ? 'RIGHTY' : 'LEFTY'),
            onTap: () => {
              this.save.settings.hand = this.save.settings.hand === 'right' ? 'left' : 'right';
              this.persist();
            },
          },
          {
            caption: 'TUNING SLIDERS',
            value: () => (this.hooks.devOn?.() ? 'DEV PANEL ON' : 'TURN ON'),
            onTap: () => this.hooks.enableDev?.(),
          },
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
      ['SOUND', PAL.haze],
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
        top: 268,
        items: [{ caption: '', value: 'BACK', onTap: () => this.title() }],
        draw: (ctx, t) => {
          drawLanterns(ctx, t);
          lines.forEach(([s, c], i) => s && drawText(ctx, s, VIEW_W / 2, 50 + i * 12, c, 'center'));
        },
      }),
    );
  }
}
