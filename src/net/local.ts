/**
 * A stand-in backend that keeps matches in localStorage and tells other tabs about changes.
 * Two tabs in one browser can play a full friend match with it. Used for dev (?fakenet) and
 * end-to-end tests; the rules are the same ones the Supabase trigger enforces.
 */
import { checkInsert, makeCode, opponentOf } from './rules';
import type { ChatRow, Match, MatchBundle, MatchSettings, NetBackend, NetEvent, PlayerMeta, ThrowPayload, ThrowRow } from './types';
import { MAX_CHAT } from './types';

interface Db {
  matches: Match[];
  throws: ThrowRow[];
  messages: ChatRow[];
}

const DB_KEY = 'leaguenight.fakenet.db';
const ME_KEY = 'leaguenight.fakenet.me';

export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export class LocalBackend implements NetBackend {
  readonly label = 'LOCAL TEST SERVER';
  private chan: BroadcastChannel | null = null;
  private listeners = new Set<(e: NetEvent) => void>();

  constructor(
    private store: KV,
    /** Per-tab identity store (sessionStorage), so two tabs are two players. */
    private ident: KV,
    private rand: () => number = Math.random,
  ) {
    try {
      this.chan = new BroadcastChannel('leaguenight.fakenet');
      this.chan.onmessage = (e) => this.emit(e.data as NetEvent, false);
    } catch {
      this.chan = null;
    }
  }

  private db(): Db {
    try {
      const raw = this.store.getItem(DB_KEY);
      if (raw) return JSON.parse(raw) as Db;
    } catch {
      /* fall through */
    }
    return { matches: [], throws: [], messages: [] };
  }
  private write(db: Db) {
    this.store.setItem(DB_KEY, JSON.stringify(db));
  }
  private emit(e: NetEvent, broadcast = true) {
    for (const l of this.listeners) l(e);
    if (broadcast) this.chan?.postMessage(e);
  }
  private id() {
    return Array.from({ length: 16 }, () => Math.floor(this.rand() * 16).toString(16)).join('');
  }
  private now() {
    return new Date().toISOString();
  }

  async me(): Promise<string> {
    let id = this.ident.getItem(ME_KEY);
    if (!id) {
      id = `p-${this.id()}`;
      this.ident.setItem(ME_KEY, id);
    }
    return id;
  }

  async createMatch(settings: MatchSettings, meta: PlayerMeta, seed: number): Promise<Match> {
    const me = await this.me();
    const db = this.db();
    let code = makeCode(this.rand);
    while (db.matches.some((m) => m.code === code && m.status === 'waiting')) code = makeCode(this.rand);
    const m: Match = {
      id: this.id(), code, host: me, guest: null, hostMeta: meta, guestMeta: null, seed: seed >>> 0, settings,
      status: 'waiting', concededBy: null, rematchOf: null, createdAt: this.now(), updatedAt: this.now(),
    };
    db.matches.push(m);
    this.write(db);
    this.emit({ kind: 'match', matchId: m.id });
    return m;
  }

  async joinMatch(code: string, meta: PlayerMeta): Promise<Match> {
    const me = await this.me();
    const db = this.db();
    const m = db.matches.find((x) => x.code === code.toUpperCase() && x.status === 'waiting');
    if (!m) throw new Error('NO OPEN MATCH WITH THAT CODE');
    if (m.host === me) throw new Error('THAT IS YOUR OWN MATCH');
    m.guest = me;
    m.guestMeta = meta;
    m.status = 'active';
    m.updatedAt = this.now();
    this.write(db);
    this.emit({ kind: 'match', matchId: m.id });
    return m;
  }

  async listMatches(): Promise<Match[]> {
    const me = await this.me();
    return this.db()
      .matches.filter((m) => m.host === me || m.guest === me)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getMatch(id: string): Promise<MatchBundle> {
    const me = await this.me();
    const db = this.db();
    const match = db.matches.find((m) => m.id === id);
    if (!match || (match.host !== me && match.guest !== me)) throw new Error('MATCH NOT FOUND');
    return { match, throws: db.throws.filter((t) => t.matchId === id), messages: db.messages.filter((c) => c.matchId === id) };
  }

  async postThrow(matchId: string, hole: number, seq: number, payload: ThrowPayload): Promise<void> {
    const me = await this.me();
    const db = this.db();
    const m = db.matches.find((x) => x.id === matchId);
    if (!m) throw new Error('MATCH NOT FOUND');
    const throws = db.throws.filter((t) => t.matchId === matchId);
    // Re-sending a row that is already stored (a retry) is fine.
    if (throws.some((t) => t.playerId === me && t.seq === seq)) return;
    const err = checkInsert(m, throws, me, hole, seq, payload);
    if (err) throw new Error(err.toUpperCase());
    db.throws.push({ matchId, playerId: me, hole, seq, payload, createdAt: this.now() });
    m.updatedAt = this.now();
    // Both cards in: the match is done.
    const all = db.throws.filter((t) => t.matchId === matchId && t.payload.kind === 'done');
    const done = (p: string | null) => all.filter((t) => t.playerId === p).length;
    if (done(m.host) >= m.settings.length && done(m.guest) >= m.settings.length) m.status = 'done';
    this.write(db);
    this.emit({ kind: 'throw', matchId });
  }

  async concede(matchId: string): Promise<void> {
    const me = await this.me();
    const db = this.db();
    const m = db.matches.find((x) => x.id === matchId);
    if (!m || (m.host !== me && m.guest !== me)) throw new Error('MATCH NOT FOUND');
    if (m.status !== 'active' && m.status !== 'waiting') return;
    m.status = 'conceded';
    m.concededBy = me;
    m.updatedAt = this.now();
    this.write(db);
    this.emit({ kind: 'match', matchId });
  }

  async rematch(matchId: string, meta: PlayerMeta, seed: number): Promise<Match> {
    const me = await this.me();
    const db = this.db();
    const old = db.matches.find((x) => x.id === matchId);
    if (!old || (old.host !== me && old.guest !== me)) throw new Error('MATCH NOT FOUND');
    const opp = opponentOf(old, me);
    const m: Match = {
      id: this.id(), code: makeCode(this.rand), host: me, guest: opp, hostMeta: meta, guestMeta: old.host === me ? old.guestMeta : old.hostMeta,
      seed: seed >>> 0, settings: old.settings, status: 'active', concededBy: null, rematchOf: old.id, createdAt: this.now(), updatedAt: this.now(),
    };
    db.matches.push(m);
    this.write(db);
    this.emit({ kind: 'match', matchId: m.id });
    return m;
  }

  async sendMessage(matchId: string, body: string): Promise<void> {
    const me = await this.me();
    const db = this.db();
    const m = db.matches.find((x) => x.id === matchId);
    if (!m || (m.host !== me && m.guest !== me)) throw new Error('MATCH NOT FOUND');
    const text = body.trim().slice(0, MAX_CHAT);
    if (!text) return;
    db.messages.push({ id: this.id(), matchId, playerId: me, body: text, createdAt: this.now() });
    this.write(db);
    this.emit({ kind: 'message', matchId });
  }

  subscribe(cb: (e: NetEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}
