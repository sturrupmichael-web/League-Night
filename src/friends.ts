/**
 * Play a Friend: host or join a match, the match card, quick chat, playing a match hole
 * (uploading every throw), watching a friend's hole, concede, rematch and your-turn alerts.
 */
import { config, type Config } from './config';
import discsJson from './content/discs.json';
import type { Game } from './core/game';
import { VIEW_W } from './core/screen';
import type { AiHole, AiThrow } from './game/ai';
import { chaserById, chaserConfig } from './game/chasers';
import type { CourseDef, HoleDef } from './game/hole';
import { holeOrder, type Pacing, type RoundLength, type ThrowLog } from './game/round';
import { formatToPar } from './game/rules';
import { getBackend } from './net';
import { canPlay, holeInProgress, holeScores, holesDone, matchResult, metaOf, nextSeq, opponentOf, rowsFor } from './net/rules';
import { MAX_CHAT, type Match, type MatchBundle, type MatchSettings, type NetBackend, type PlayerMeta, QUICK_CHAT, type ThrowPayload } from './net/types';
import { matchHoleSeed, type Verdict, verifyHole } from './net/verify';
import { drawText, wrapText } from './render/font';
import { PAL } from './render/palette';
import { CodeEntryScene } from './scenes/CodeEntry';
import { HoleScene } from './scenes/HoleScene';
import type { Disc } from './sim/discs';
import { dist, type Vec2 } from './sim/math';
import { makeTerrain } from './sim/terrain';
import type { ThrowResult } from './sim/throw';
import { drawBigText, drawLanterns, type MenuItem, MenuScene } from './ui/menu';

const DISCS = discsJson as Disc[];
const ALERTS_KEY = 'leaguenight.alerts';
const USED_KEY = 'leaguenight.friends';

export interface FriendHost {
  game: Game;
  courses: CourseDef[];
  /** The course picker row from the setup screens, and the course it has selected. */
  courseItem(back?: () => void): MenuItem;
  selectedCourse(): CourseDef;
  meta(): PlayerMeta;
  dyeColor(): string | null;
  hints(): boolean;
  onThrow?: (r: ThrowResult) => void;
  title(): void;
  chasers(back: () => void): void;
  toggles(): MenuItem[];
  /** Pay Cred once per finished match. Returns the lines paid (empty if already paid). */
  payMatch(id: string, won: boolean, finished: boolean): number;
}

interface Upload {
  matchId: string;
  hole: number;
  seq: number;
  payload: ThrowPayload;
}

const LENGTHS: RoundLength[] = [3, 9, 18];
const first = (s: string | undefined) => (s ?? 'FRIEND').split(' ')[0];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ls = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

export class Friends {
  private net: NetBackend | null = null;
  private meId = '';
  private lengthIdx = 1;
  private playAhead = false;
  private pacing: Pacing = 'throw';
  /** The match on screen, kept fresh by live updates. */
  private cur: MatchBundle | null = null;
  private verdicts = new Map<string, Verdict>();
  private queue: Upload[] = [];
  private flushing: Promise<void> | null = null;
  syncError = '';
  private status = '';
  private unsub: (() => void) | null = null;
  /** Matches where it is your turn (shown on the title screen). */
  yourTurn = 0;
  private turnSeen = new Map<string, boolean>();
  private inHole = false;

  constructor(private host: FriendHost) {
    // Someone who has played a friend match before gets your-turn updates from the start.
    if (ls.get(USED_KEY)) void this.connect().catch(() => {});
  }

  private get game() {
    return this.host.game;
  }

  private async connect(): Promise<NetBackend> {
    if (this.net) return this.net;
    const net = await getBackend();
    this.meId = await net.me();
    this.net = net;
    ls.set(USED_KEY, '1');
    this.unsub ??= net.subscribe((e) => void this.onEvent(e.matchId));
    void this.refreshTurns();
    return net;
  }

  // ---------- Live updates and alerts ----------

  private async onEvent(matchId: string) {
    if (this.cur && this.cur.match.id === matchId && this.net) {
      try {
        this.setCur(await this.net.getMatch(matchId));
      } catch {
        /* keep what we have */
      }
    }
    void this.refreshTurns(matchId);
  }

  private async refreshTurns(only?: string) {
    const net = this.net;
    if (!net) return;
    try {
      const list = (await net.listMatches()).filter((m) => m.status === 'active' && (!only || m.id === only));
      for (const m of list) {
        const b = await net.getMatch(m.id);
        const mine = canPlay(b.match, b.throws, this.meId).ok;
        const before = this.turnSeen.get(m.id);
        this.turnSeen.set(m.id, mine);
        if (mine && before === false && !(this.inHole && this.cur?.match.id === m.id)) this.alert(b.match);
      }
      if (!only) for (const id of [...this.turnSeen.keys()]) if (!list.some((m) => m.id === id)) this.turnSeen.delete(id);
      this.yourTurn = [...this.turnSeen.values()].filter(Boolean).length;
    } catch {
      /* offline: try again on the next event */
    }
  }

  private alert(m: Match) {
    const opp = first(metaOf(m, opponentOf(m, this.meId))?.name);
    if (ls.get(ALERTS_KEY) !== 'on' || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (!document.hidden) return;
    try {
      new Notification('League Night', { body: `Your turn against ${opp}.`, tag: `ln-${m.id}`, icon: './icons/icon-192.png' });
    } catch {
      /* some browsers only allow notifications from a service worker */
    }
  }

  private alertsLabel() {
    if (typeof Notification === 'undefined') return 'NOT ON THIS BROWSER';
    if (Notification.permission === 'denied') return 'BLOCKED IN BROWSER';
    return ls.get(ALERTS_KEY) === 'on' && Notification.permission === 'granted' ? 'ON' : 'OFF';
  }

  private async toggleAlerts() {
    if (typeof Notification === 'undefined' || Notification.permission === 'denied') return;
    if (ls.get(ALERTS_KEY) === 'on') return ls.set(ALERTS_KEY, 'off');
    const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    ls.set(ALERTS_KEY, p === 'granted' ? 'on' : 'off');
  }

  // ---------- Menus ----------

  menu() {
    this.cur = null;
    const backendLabel = () => this.net?.label ?? '';
    this.game.set(
      new MenuScene({
        top: 96,
        items: [
          { caption: 'GET A CODE TO SHARE', value: 'HOST A MATCH', onTap: () => this.setupHost() },
          { caption: 'TYPE YOUR FRIEND\'S CODE', value: 'JOIN WITH A CODE', onTap: () => this.join() },
          { caption: () => (this.yourTurn ? `YOUR TURN IN ${this.yourTurn}` : 'MATCHES IN PROGRESS'), value: 'YOUR ROUNDS', onTap: () => void this.rounds() },
          { caption: 'WHEN IT IS YOUR TURN', value: () => `ALERTS: ${this.alertsLabel()}`, onTap: () => void this.toggleAlerts() },
          { caption: '', value: 'BACK', onTap: () => this.host.title() },
        ],
        draw: (ctx, t) => {
          drawLanterns(ctx, t);
          drawBigText(ctx, 'PLAY A FRIEND', VIEW_W / 2, 36, PAL.amber);
          drawText(ctx, 'SAME COURSE · SAME WIND · YOUR OWN PACE', VIEW_W / 2, 58, PAL.ink, 'center');
          drawText(ctx, 'EVERY THROW IS CHECKED ON BOTH PHONES', VIEW_W / 2, 70, PAL.haze, 'center');
          if (this.status) drawText(ctx, this.status, VIEW_W / 2, 236, PAL.red, 'center');
          const l = backendLabel();
          if (l) drawText(ctx, l, VIEW_W / 2, 306, PAL.dusk, 'center');
        },
      }),
    );
    void this.connect().catch((e) => (this.status = this.errText(e)));
  }

  private errText(e: unknown) {
    const m = e instanceof Error ? e.message : String(e);
    return (/fetch|network/i.test(m) ? 'NO CONNECTION' : m).toUpperCase().slice(0, 40);
  }

  private setupHost() {
    this.game.set(
      new MenuScene({
        top: 84,
        gap: 25,
        items: [
          this.host.courseItem(),
          { caption: () => (LENGTHS[this.lengthIdx] === 3 ? 'QUICK ONE' : LENGTHS[this.lengthIdx] === 9 ? 'THE FRONT NINE' : 'THE FULL COURSE'), value: () => `< ${LENGTHS[this.lengthIdx]} HOLES >`, onTap: () => (this.lengthIdx = (this.lengthIdx + 1) % LENGTHS.length) },
          {
            caption: () => (this.playAhead ? 'PLAY YOUR WHOLE CARD ANY TIME' : 'AT MOST ONE HOLE AHEAD'),
            value: () => (this.playAhead ? 'PLAY AHEAD: ON' : 'PLAY AHEAD: OFF'),
            onTap: () => (this.playAhead = !this.playAhead),
          },
          {
            caption: () => (this.pacing === 'throw' ? "WATCH YOUR FRIEND'S THROWS" : 'JUST THEIR HOLE SCORES'),
            value: () => (this.pacing === 'throw' ? 'THROW BY THROW' : 'HOLE BY HOLE'),
            onTap: () => (this.pacing = this.pacing === 'throw' ? 'hole' : 'throw'),
          },
          {
            caption: 'YOUR CHASER',
            value: () => `${first(this.host.meta().name)} · ${this.host.meta().hand === 'right' ? 'RIGHTY' : 'LEFTY'}`,
            onTap: () => this.host.chasers(() => this.setupHost()),
          },
          { caption: 'NO MULLIGANS', value: 'GET A CODE', onTap: () => void this.create() },
          { caption: '', value: 'BACK', onTap: () => this.menu() },
        ],
        draw: (ctx, t) => {
          drawLanterns(ctx, t);
          drawBigText(ctx, 'HOST A MATCH', VIEW_W / 2, 36, PAL.amber);
          drawText(ctx, 'LOWEST CARD WINS', VIEW_W / 2, 58, PAL.haze, 'center');
          if (this.status) drawText(ctx, this.status, VIEW_W / 2, 70, PAL.red, 'center');
        },
      }),
    );
  }

  private async create() {
    this.status = 'CREATING...';
    try {
      const net = await this.connect();
      const settings: MatchSettings = { courseId: this.host.selectedCourse().id, length: LENGTHS[this.lengthIdx], playAhead: this.playAhead, pacing: this.pacing };
      const m = await net.createMatch(settings, this.host.meta(), newSeed());
      this.status = '';
      await this.open(m.id);
    } catch (e) {
      this.status = this.errText(e);
    }
  }

  join(initial = '') {
    const scene = new CodeEntryScene(
      async (code, s) => {
        s.busy = true;
        try {
          const net = await this.connect();
          const m = await net.joinMatch(code, this.host.meta());
          s.dispose();
          await this.open(m.id);
        } catch (e) {
          s.message = this.errText(e);
        } finally {
          s.busy = false;
        }
      },
      () => this.menu(),
      initial,
    );
    this.game.set(scene);
  }

  private async rounds() {
    try {
      const net = await this.connect();
      const list = (await net.listMatches()).slice(0, 7);
      const bundles = await Promise.all(list.map((m) => net.getMatch(m.id).catch(() => null)));
      const items: MenuItem[] = [];
      list.forEach((m, i) => {
        const b = bundles[i];
        const opp = metaOf(m, opponentOf(m, this.meId));
        const name = opp ? first(opp.name) : 'NOBODY YET';
        let cap: string;
        if (m.status === 'waiting') cap = `CODE ${m.code} · WAITING`;
        else if (m.status === 'conceded') cap = m.concededBy === this.meId ? 'YOU CONCEDED' : `${name} CONCEDED`;
        else if (b && m.status === 'done') {
          const r = matchResult(m, b.throws);
          cap = r.winner === this.meId ? 'YOU WON' : r.winner ? `${name} WON` : 'TIED';
        } else cap = b && canPlay(m, b.throws, this.meId).ok ? `YOUR TURN · HOLE ${holesDone(b.throws, this.meId) + 1}` : `${name}'S TURN`;
        items.push({ caption: `${cap} · ${m.settings.length} HOLES`, value: `VS ${name}`, onTap: () => void this.open(m.id) });
      });
      items.push({ caption: list.length ? '' : 'NO MATCHES YET', value: 'BACK', onTap: () => this.menu() });
      this.game.set(
        new MenuScene({
          top: 60,
          gap: 28,
          width: 150,
          items,
          draw: (ctx, t) => {
            drawLanterns(ctx, t);
            drawBigText(ctx, 'YOUR ROUNDS', VIEW_W / 2, 32, PAL.amber);
          },
        }),
      );
    } catch (e) {
      this.status = this.errText(e);
      this.menu();
    }
  }

  // ---------- The match card ----------

  private setCur(b: MatchBundle) {
    this.cur = b;
    // Check every hole the friend has finished by replaying it.
    const opp = opponentOf(b.match, this.meId);
    const meta = metaOf(b.match, opp);
    if (!opp || !meta) return;
    const cfg = chaserConfig(config, chaserById(meta.chaserId));
    const rows = rowsFor(b.throws, opp);
    const done = holesDone(b.throws, opp);
    for (let i = 0; i < done; i++) {
      const key = `${b.match.id}:${i}`;
      if (this.verdicts.has(key)) continue;
      const hole = this.holeFor(b.match, i);
      const payloads = rows.filter((r) => r.hole === i).map((r) => r.payload);
      this.verdicts.set(key, verifyHole(payloads, hole, makeTerrain(hole.terrain), b.match.seed, i, cfg));
    }
  }

  private holeFor(m: Match, idx: number): HoleDef {
    const course = this.host.courses.find((c) => c.id === m.settings.courseId) ?? this.host.courses[0];
    const order = holeOrder(course.holes.length, m.settings.length);
    return course.holes[order[idx]];
  }

  async open(id: string) {
    const net = await this.connect();
    this.setCur(await net.getMatch(id));
    this.matchScreen();
  }

  private matchScreen() {
    const b = () => this.cur!;
    const me = this.meId;
    let confirmConcede = false;
    let copied = '';
    const m = () => b().match;
    const opp = () => opponentOf(m(), me);
    const oppName = () => first(metaOf(m(), opp())?.name ?? 'FRIEND');
    const over = () => m().status === 'done' || m().status === 'conceded';
    const waiting = () => m().status === 'waiting';
    const play = () => canPlay(m(), b().throws, me);
    const rematchOf = { id: '' };
    const items: MenuItem[] = [
      {
        caption: () => (this.syncError ? 'THROWS NOT SAVED YET' : waiting() ? 'SEND IT TO YOUR FRIEND' : over() ? 'SAME SETTINGS, NEW SEED' : play().ok ? `PAR ${this.holeFor(m(), holesDone(b().throws, me)).par}` : play().why),
        value: () => (this.syncError ? 'RETRY' : waiting() ? copied || 'SHARE CODE' : over() ? (rematchOf.id ? 'OPEN REMATCH' : 'REMATCH') : `PLAY HOLE ${Math.min(m().settings.length, holesDone(b().throws, me) + 1)}`),
        onTap: () => {
          if (this.syncError) return void this.flush();
          if (waiting()) return void this.share(m()).then((t) => (copied = t));
          if (over()) return void (rematchOf.id ? this.open(rematchOf.id) : this.rematch());
          if (play().ok) this.playHole();
        },
        enabled: () => !!this.syncError || waiting() || over() || play().ok,
        box: { x: 20, y: 236, w: 140, h: 24 },
      },
      { caption: 'QUICK CHAT', value: 'CHAT', onTap: () => this.chat(), enabled: () => !waiting(), box: { x: 4, y: 270, w: 56, h: 22 } },
      {
        caption: () => (confirmConcede ? 'CANNOT UNDO' : waiting() ? 'CALL IT OFF' : 'GIVE IT AWAY'),
        value: () => (confirmConcede ? 'REALLY?' : waiting() ? 'CANCEL' : 'CONCEDE'),
        onTap: () => {
          if (!confirmConcede) return void (confirmConcede = true);
          confirmConcede = false;
          void this.concede();
        },
        enabled: () => !over(),
        box: { x: 62, y: 270, w: 56, h: 22 },
      },
      { caption: '', value: 'BACK', onTap: () => this.menu(), box: { x: 120, y: 270, w: 56, h: 22 } },
    ];
    // Rematch already started by either player?
    if (over() && this.net) {
      void this.net.listMatches().then((list) => {
        const r = list.find((x) => x.rematchOf === m().id);
        if (r) rematchOf.id = r.id;
      });
    }
    this.payIfOver();
    this.game.set(
      new MenuScene({
        top: 0,
        items,
        draw: (ctx, t) => {
          drawLanterns(ctx, t, -8);
          if (over()) this.payIfOver();
          this.drawMatch(ctx, b(), oppName());
        },
      }),
    );
  }

  private payIfOver() {
    const c = this.cur;
    if (!c) return;
    const r = matchResult(c.match, c.throws);
    if (!r.over || !c.match.guest) return;
    this.host.payMatch(c.match.id, r.winner === this.meId, c.match.status === 'done');
  }

  private drawMatch(ctx: CanvasRenderingContext2D, b: MatchBundle, oppName: string) {
    const m = b.match;
    const me = this.meId;
    const opp = opponentOf(m, me);
    drawBigText(ctx, `YOU VS ${opp ? oppName : '?'}`, VIEW_W / 2, 20, PAL.amber);
    const tag = `${m.settings.length} HOLES · ${m.settings.playAhead ? 'PLAY AHEAD' : 'ONE AHEAD MAX'} · ${m.settings.pacing === 'throw' ? 'THROW BY THROW' : 'HOLE BY HOLE'}`;
    drawText(ctx, tag, VIEW_W / 2, 40, PAL.inkDim, 'center');
    if (m.status === 'waiting') {
      drawText(ctx, 'YOUR MATCH CODE', VIEW_W / 2, 74, PAL.haze, 'center');
      drawBigText(ctx, m.code, VIEW_W / 2, 88, PAL.ink, 4);
      wrapText('YOUR FRIEND OPENS LEAGUE NIGHT, TAPS PLAY A FRIEND, THEN JOIN WITH A CODE. YOU CAN START AS SOON AS THEY JOIN.', VIEW_W - 30).forEach((l, i) =>
        drawText(ctx, l, VIEW_W / 2, 124 + i * 9, PAL.haze, 'center'),
      );
      return;
    }
    // Score grid, nine holes to a block.
    const pars = Array.from({ length: m.settings.length }, (_, i) => this.holeFor(m, i).par);
    const mine = holeScores(b.throws, me);
    const theirs = holeScores(b.throws, opp);
    const blocks = Math.ceil(m.settings.length / 9);
    let y = 52;
    for (let k = 0; k < blocks; k++) {
      const n = Math.min(9, m.settings.length - k * 9);
      drawText(ctx, '#', 4, y, PAL.haze);
      drawText(ctx, 'YOU', 4, y + 10, PAL.amber);
      drawText(ctx, first(oppName).slice(0, 5), 4, y + 20, PAL.ink);
      for (let j = 0; j < n; j++) {
        const i = k * 9 + j;
        const x = 34 + j * 16;
        drawText(ctx, String(i + 1), x, y, PAL.haze, 'center');
        const cell = (s: number | undefined, yy: number, other: number | undefined) => {
          if (s === undefined) return drawText(ctx, '-', x, yy, PAL.dusk, 'center');
          const c = other !== undefined && s < other ? PAL.amber : s < pars[i] ? PAL.amber : s > pars[i] ? PAL.inkDim : PAL.ink;
          drawText(ctx, String(s), x, yy, c, 'center');
        };
        cell(mine[i], y + 10, theirs[i]);
        cell(theirs[i], y + 20, mine[i]);
        const v = this.verdicts.get(`${m.id}:${i}`);
        if (v && !v.ok) {
          ctx.fillStyle = PAL.red;
          ctx.fillRect(x - 3, y + 27, 7, 1);
        }
      }
      y += 34;
    }
    // Totals, compared through the holes both have played.
    const both = Math.min(mine.length, theirs.length);
    const sum = (a: number[], n: number) => a.slice(0, n).reduce((s, x) => s + x, 0);
    const parThru = (n: number) => sum(pars, n);
    drawText(ctx, `YOU ${formatToPar(sum(mine, mine.length) - parThru(mine.length))} THRU ${mine.length}`, 4, y, PAL.amber);
    drawText(ctx, `${first(oppName)} ${formatToPar(sum(theirs, theirs.length) - parThru(theirs.length))} THRU ${theirs.length}`, VIEW_W - 4, y, PAL.ink, 'right');
    y += 11;
    const r = matchResult(m, b.throws);
    let line: string;
    if (m.status === 'conceded') line = m.concededBy === me ? `YOU CONCEDED · ${first(oppName)} WINS` : `${first(oppName)} CONCEDED · YOU WIN`;
    else if (r.over) line = r.winner === me ? 'YOU WIN THE MATCH!' : r.winner ? `${first(oppName)} WINS THE MATCH` : 'ALL SQUARE';
    else if (both) {
      const d = sum(mine, both) - sum(theirs, both);
      line = d === 0 ? `ALL SQUARE THRU ${both}` : d < 0 ? `YOU LEAD BY ${-d} THRU ${both}` : `${first(oppName)} LEADS BY ${d} THRU ${both}`;
    } else line = 'NO HOLES COMPARED YET';
    drawText(ctx, line, VIEW_W / 2, y, r.over ? PAL.amber : PAL.ink, 'center');
    y += 11;
    // Card check.
    const checked = [...this.verdicts.entries()].filter(([k]) => k.startsWith(m.id + ':'));
    const bad = checked.filter(([, v]) => !v.ok);
    if (checked.length) {
      const txt = bad.length ? `CARD MISMATCH ON HOLE ${bad.map(([k]) => Number(k.split(':')[1]) + 1).join(', ')}` : `${first(oppName)}'S THROWS REPLAY CLEAN`;
      drawText(ctx, txt, VIEW_W / 2, y, bad.length ? PAL.red : PAL.haze, 'center');
    }
    y += 13;
    // Chat: the last few lines.
    const msgs = b.messages.slice(-Math.max(1, Math.floor((230 - y) / 9)));
    for (const c of msgs) {
      const who = c.playerId === me ? 'YOU' : first(oppName);
      drawText(ctx, `${who}: ${c.body}`.slice(0, 44), 6, y, c.playerId === me ? PAL.inkDim : PAL.ink);
      y += 9;
    }
    if (this.syncError) drawText(ctx, this.syncError.slice(0, 44), VIEW_W / 2, 226, PAL.red, 'center');
  }

  private async share(m: Match): Promise<string> {
    const text = `Play me at League Night. Match code: ${m.code}`;
    try {
      if (navigator.share) {
        await navigator.share({ text });
        return 'SHARED';
      }
      await navigator.clipboard.writeText(m.code);
      return 'COPIED';
    } catch {
      return 'SHARE CODE';
    }
  }

  private chat() {
    const send = (body: string) => {
      this.game.pop();
      const c = this.cur;
      if (!c || !this.net) return;
      void this.net
        .sendMessage(c.match.id, body)
        .then(() => this.net!.getMatch(c.match.id))
        .then((bb) => this.setCur(bb))
        .catch(() => {});
    };
    this.game.push(
      new MenuScene({
        overlay: { title: 'QUICK CHAT', sub: `UP TO ${MAX_CHAT} LETTERS OF YOUR OWN` },
        top: 50,
        gap: 24,
        items: [
          ...QUICK_CHAT.map((q) => ({ caption: '', value: q, onTap: () => send(q) })),
          {
            caption: '',
            value: 'TYPE YOUR OWN',
            onTap: () => {
              const t = window.prompt('Say something (60 letters max)', '');
              if (t && t.trim()) send(t.trim().toUpperCase().slice(0, MAX_CHAT));
              else this.game.pop();
            },
          },
          { caption: '', value: 'CLOSE', onTap: () => this.game.pop() },
        ],
      }),
    );
  }

  private async concede() {
    const c = this.cur;
    if (!c || !this.net) return;
    try {
      await this.net.concede(c.match.id);
      this.setCur(await this.net.getMatch(c.match.id));
    } catch (e) {
      this.syncError = this.errText(e);
    }
  }

  private async rematch() {
    const c = this.cur;
    if (!c || !this.net) return;
    try {
      const m = await this.net.rematch(c.match.id, this.host.meta(), newSeed());
      await this.open(m.id);
    } catch (e) {
      this.syncError = this.errText(e);
    }
  }

  // ---------- Uploading throws ----------

  private enqueue(u: Upload) {
    this.queue.push(u);
    return this.flush();
  }

  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.syncError = '';
    this.flushing = (async () => {
      let tries = 0;
      while (this.queue.length && this.net) {
        const u = this.queue[0];
        try {
          await this.net.postThrow(u.matchId, u.hole, u.seq, u.payload);
          this.queue.shift();
          tries = 0;
        } catch (e) {
          if (++tries >= 4) {
            this.syncError = this.errText(e);
            break;
          }
          await sleep(600 * 2 ** tries);
        }
      }
    })().finally(() => (this.flushing = null));
    return this.flushing;
  }

  // ---------- Playing a match hole ----------

  private playHole() {
    const b = this.cur!;
    const m = b.match;
    const me = this.meId;
    const idx = holesDone(b.throws, me);
    const hole = this.holeFor(m, idx);
    const seed = matchHoleSeed(m.seed, idx);
    const myMeta = metaOf(m, me)!;
    const opp = opponentOf(m, me);
    const oppMeta = metaOf(m, opp);
    const oppName = first(oppMeta?.name);
    let seq = nextSeq(b.throws, me);
    const resume = holeInProgress(b.throws, me).map((p) => ({ log: toLog(p), lie: p.lie ?? hole.basket }));
    const oppRows = rowsFor(b.throws, opp).filter((r) => r.hole === idx).map((r) => r.payload);
    const oppDone = oppRows.find((p) => p.kind === 'done');
    const rival =
      m.settings.pacing === 'throw' && oppMeta && oppRows.some((p) => p.kind !== 'done')
        ? { name: oppName, color: PAL.steel, hole: toAiHole(oppRows, hole), cfg: chaserConfig(config, chaserById(oppMeta.chaserId)) as Config }
        : undefined;
    const myScores = holeScores(b.throws, me);
    const pars = Array.from({ length: m.settings.length }, (_, i) => this.holeFor(m, i).par);
    const toPar = myScores.reduce((s, x, i) => s + x - pars[i], 0);
    this.inHole = true;
    const scene = new HoleScene(chaserConfig(config, chaserById(myMeta.chaserId)), {
      hole,
      practice: false,
      seed,
      holeNumber: idx + 1,
      holeCount: m.settings.length,
      roundToPar: toPar,
      hand: myMeta.hand,
      hints: this.host.hints(),
      mulligansLeft: 0,
      dyeColor: this.host.dyeColor(),
      onThrow: this.host.onThrow,
      introTag: `VS ${oppName} · FRIEND MATCH`,
      rival,
      resume,
      onLog: (log, lie) => void this.enqueue({ matchId: m.id, hole: idx, seq: seq++, payload: toPayload(log, lie) }),
      onPause: () => this.pause(),
      doneInfo: (strokes) => {
        const theirs = oppDone?.strokes;
        const a = theirs === undefined ? `${oppName} HAS NOT PLAYED IT YET` : `${oppName} SCORED ${theirs}${strokes < theirs ? ' · YOU WIN THE HOLE' : strokes > theirs ? ` · ${oppName} WINS IT` : ' · HALVED'}`;
        return [a];
      },
      onFinish: (rec) => void this.finishHole(m.id, idx, seq++, rec.strokes, rec.pickedUp),
    });
    this.game.set(scene);
  }

  private async finishHole(matchId: string, idx: number, seq: number, strokes: number, pickedUp: boolean) {
    this.inHole = false;
    this.game.set(
      new MenuScene({
        top: 400,
        items: [],
        draw: (ctx, t) => {
          drawLanterns(ctx, t);
          drawText(ctx, 'SAVING YOUR CARD...', VIEW_W / 2, 150, PAL.ink, 'center');
        },
      }),
    );
    await this.enqueue({ matchId, hole: idx, seq, payload: { kind: 'done', n: strokes, strokes, pickedUp } });
    try {
      await this.open(matchId);
    } catch (e) {
      this.syncError = this.errText(e);
      this.menu();
    }
  }

  private pause() {
    let confirm = false;
    this.game.push(
      new MenuScene({
        overlay: { title: 'PAUSED', sub: 'FRIEND MATCH · EVERY THROW IS SAVED' },
        top: 100,
        items: [
          { caption: '', value: 'RESUME', onTap: () => this.game.pop() },
          ...this.host.toggles(),
          { caption: 'PICK UP HERE LATER', value: 'BACK TO THE CARD', onTap: () => this.leaveHole() },
          {
            caption: () => (confirm ? 'CANNOT BE UNDONE' : 'ENDS IT FOR BOTH OF YOU'),
            value: () => (confirm ? 'REALLY CONCEDE?' : 'CONCEDE'),
            onTap: () => {
              if (!confirm) return void (confirm = true);
              this.inHole = false;
              void this.concede().then(() => this.matchScreen());
            },
          },
        ],
      }),
    );
  }

  private leaveHole() {
    this.inHole = false;
    const id = this.cur!.match.id;
    void this.flush().then(() => this.open(id).catch(() => this.menu()));
  }
}

export const newSeed = () => (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;

/** A logged throw as an upload. */
export function toPayload(log: ThrowLog, lie: Vec2): ThrowPayload {
  return {
    kind: log.kind,
    n: log.n,
    discId: log.discId,
    replay: log.replay,
    lie: { x: round2(lie.x), y: round2(lie.y) },
    penalty: log.penalty,
    made: log.made,
    fromFt: round2(log.fromFt),
    toFt: round2(log.toFt),
    distanceFt: round2(log.distanceFt),
    surface: log.surface,
  };
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** An uploaded throw back as a log entry (resuming a hole). */
export function toLog(p: ThrowPayload): ThrowLog {
  const disc = DISCS.find((d) => d.id === p.discId);
  return {
    kind: p.kind === 'done' ? 'throw' : p.kind,
    n: p.n,
    discId: p.discId ?? '',
    discType: disc?.type ?? 'putter',
    fromFt: p.fromFt ?? 0,
    toFt: p.toFt ?? 0,
    distanceFt: p.distanceFt ?? 0,
    penalty: p.penalty ?? 0,
    made: !!p.made,
    surface: p.surface ?? 'fairway',
    replay: p.replay,
  };
}

/** A friend's uploaded hole in the shape the on-card rival player understands. */
export function toAiHole(payloads: ThrowPayload[], hole: HoleDef): AiHole {
  let from: Vec2 = { ...hole.tee };
  const throws: AiThrow[] = [];
  let strokes = 0;
  let penalties = 0;
  for (const p of payloads) {
    if (p.kind === 'done') continue;
    const to = p.lie ?? hole.basket;
    throws.push({
      kind: p.kind,
      from,
      to,
      fromFt: dist(from, hole.basket),
      toFt: dist(to, hole.basket),
      penalty: p.penalty ?? 0,
      made: !!p.made,
      input: p.replay?.t === 'throw' ? p.replay.input : undefined,
      discId: p.discId,
      seed: p.replay?.seed,
    });
    strokes += 1 + (p.penalty ?? 0);
    penalties += p.penalty ?? 0;
    from = to;
  }
  const done = payloads.find((p) => p.kind === 'done');
  return { strokes: done?.strokes ?? strokes, penalties, pickedUp: !!done?.pickedUp, throws };
}
