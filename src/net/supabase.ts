/**
 * The real backend: Supabase with anonymous sign-in. Matches are only changed through the
 * ln_* database functions; throws and chat are plain inserts that row-level security and the
 * ln_check_throw trigger police (see supabase/migrations).
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type { RoundState } from '../game/round';
import { cleanName, GAME_VERSION } from './leaderboard';
import type { BoardKey, BoardRow, ChatRow, Match, MatchBundle, MatchSettings, NetBackend, NetEvent, PlayerMeta, PostedScore, ThrowPayload, ThrowRow } from './types';
import { MAX_CHAT } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export const toMatch = (r: Row): Match => ({
  id: r.id,
  code: r.code,
  host: r.host,
  guest: r.guest ?? null,
  hostMeta: r.host_meta,
  guestMeta: r.guest_meta ?? null,
  seed: Number(r.seed) >>> 0,
  settings: r.settings,
  status: r.status,
  concededBy: r.conceded_by ?? null,
  rematchOf: r.rematch_of ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toThrow = (r: Row): ThrowRow => ({ matchId: r.match_id, playerId: r.player_id, hole: r.hole, seq: r.seq, payload: r.payload, createdAt: r.created_at });
const toChat = (r: Row): ChatRow => ({ id: r.id, matchId: r.match_id, playerId: r.player_id, body: r.body, createdAt: r.created_at });

/** Database errors arrive in lower case from the trigger; show them in the game's caps. */
const fail = (e: { message?: string } | null, fallback: string): never => {
  throw new Error((e?.message || fallback).toUpperCase());
};

export class SupabaseBackend implements NetBackend {
  readonly label = 'ONLINE';
  private sb: SupabaseClient;
  private uid: string | null = null;
  private channel: RealtimeChannel | null = null;
  private listeners = new Set<(e: NetEvent) => void>();

  constructor(url: string, key: string) {
    this.sb = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'leaguenight.auth' } });
  }

  async me(): Promise<string> {
    if (this.uid) return this.uid;
    const { data } = await this.sb.auth.getSession();
    if (data.session?.user) return (this.uid = data.session.user.id);
    const { data: d, error } = await this.sb.auth.signInAnonymously();
    if (error || !d.user) fail(error, 'COULD NOT SIGN IN');
    return (this.uid = d.user!.id);
  }

  async createMatch(settings: MatchSettings, meta: PlayerMeta, seed: number): Promise<Match> {
    await this.me();
    const { data, error } = await this.sb.rpc('ln_create_match', { p_settings: settings, p_meta: meta, p_seed: seed >>> 0 });
    if (error) fail(error, 'COULD NOT CREATE THE MATCH');
    return toMatch(data);
  }

  async joinMatch(code: string, meta: PlayerMeta): Promise<Match> {
    await this.me();
    const { data, error } = await this.sb.rpc('ln_join_match', { p_code: code.toUpperCase(), p_meta: meta });
    if (error) fail(error, 'COULD NOT JOIN');
    return toMatch(data);
  }

  async listMatches(): Promise<Match[]> {
    const me = await this.me();
    const { data, error } = await this.sb.from('ln_matches').select('*').or(`host.eq.${me},guest.eq.${me}`).order('updated_at', { ascending: false }).limit(30);
    if (error) fail(error, 'COULD NOT LOAD YOUR ROUNDS');
    return (data ?? []).map(toMatch);
  }

  async getMatch(id: string): Promise<MatchBundle> {
    await this.me();
    const [m, t, c] = await Promise.all([
      this.sb.from('ln_matches').select('*').eq('id', id).single(),
      this.sb.from('ln_throws').select('*').eq('match_id', id).order('seq'),
      this.sb.from('ln_messages').select('*').eq('match_id', id).order('created_at').limit(200),
    ]);
    if (m.error) fail(m.error, 'MATCH NOT FOUND');
    if (t.error) fail(t.error, 'COULD NOT LOAD THROWS');
    if (c.error) fail(c.error, 'COULD NOT LOAD CHAT');
    return { match: toMatch(m.data), throws: (t.data ?? []).map(toThrow), messages: (c.data ?? []).map(toChat) };
  }

  async postThrow(matchId: string, hole: number, seq: number, payload: ThrowPayload): Promise<void> {
    const me = await this.me();
    const { error } = await this.sb.from('ln_throws').insert({ match_id: matchId, player_id: me, hole, seq, payload });
    // 23505 = this seq is already stored: a retry after a dropped reply. That's fine.
    if (error && error.code !== '23505') fail(error, 'THROW NOT SAVED');
  }

  async concede(matchId: string): Promise<void> {
    await this.me();
    const { error } = await this.sb.rpc('ln_concede', { p_match: matchId });
    if (error) fail(error, 'COULD NOT CONCEDE');
  }

  async rematch(matchId: string, meta: PlayerMeta, seed: number): Promise<Match> {
    await this.me();
    const { data, error } = await this.sb.rpc('ln_rematch', { p_match: matchId, p_meta: meta, p_seed: seed >>> 0 });
    if (error) fail(error, 'COULD NOT START A REMATCH');
    return toMatch(data);
  }

  async sendMessage(matchId: string, body: string): Promise<void> {
    const me = await this.me();
    const text = body.trim().slice(0, MAX_CHAT);
    if (!text) return;
    const { error } = await this.sb.from('ln_messages').insert({ match_id: matchId, player_id: me, body: text });
    if (error) fail(error, 'MESSAGE NOT SENT');
  }

  subscribe(cb: (e: NetEvent) => void): () => void {
    this.listeners.add(cb);
    if (!this.channel) void this.openChannel();
    return () => {
      this.listeners.delete(cb);
      if (!this.listeners.size && this.channel) {
        void this.sb.removeChannel(this.channel);
        this.channel = null;
      }
    };
  }

  private async openChannel() {
    await this.me();
    const emit = (e: NetEvent) => this.listeners.forEach((l) => l(e));
    // Row-level security filters these to the player's own matches.
    this.channel = this.sb
      .channel('ln-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ln_matches' }, (p) => emit({ kind: 'match', matchId: ((p.new as Row)?.id ?? (p.old as Row)?.id) as string }))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ln_throws' }, (p) => emit({ kind: 'throw', matchId: (p.new as Row).match_id }))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ln_messages' }, (p) => emit({ kind: 'message', matchId: (p.new as Row).match_id }))
      .subscribe();
  }

  // ---------- Leaderboard ----------

  async myName(): Promise<string | null> {
    const me = await this.me();
    const { data, error } = await this.sb.from('players').select('name').eq('user_id', me).maybeSingle();
    if (error) fail(error, 'COULD NOT LOAD YOUR NAME');
    return (data?.name as string | undefined) ?? null;
  }

  async setName(name: string): Promise<string> {
    const me = await this.me();
    const clean = cleanName(name);
    if (!clean) fail(null, 'TYPE A NAME FIRST');
    const had = await this.myName();
    const { error } = had
      ? await this.sb.from('players').update({ name: clean }).eq('user_id', me)
      : await this.sb.from('players').insert({ name: clean });
    if (error) fail(error.code === '23505' ? { message: 'THAT NAME IS TAKEN' } : error, 'COULD NOT SAVE THE NAME');
    return clean;
  }

  async submit(round: RoundState): Promise<PostedScore> {
    await this.me();
    const { data, error } = await this.sb.functions.invoke('ln-submit-score', { body: { round, version: GAME_VERSION } });
    if (error) {
      // The function's own message is in the response body.
      let msg = '';
      try {
        const ctx = (error as { context?: Response }).context;
        msg = ctx ? ((await ctx.json()) as { error?: string }).error ?? '' : '';
      } catch {
        /* keep the generic message */
      }
      fail({ message: msg || error.message }, 'COULD NOT POST THE SCORE');
    }
    return { name: data.name, rank: data.rank, toPar: data.to_par };
  }

  async board(key: BoardKey): Promise<BoardRow[]> {
    const { data, error } = await this.sb.rpc('ln_leaderboard', { p_course: key.courseId, p_holes: key.holes, p_since: key.since, p_limit: 20 });
    if (error) fail(error, 'COULD NOT LOAD THE BOARD');
    return ((data ?? []) as Row[]).map((r) => ({ rank: Number(r.rank), name: r.name, strokes: r.strokes, toPar: r.to_par, chaser: r.chaser }));
  }

  async myBest(key: BoardKey) {
    await this.me();
    const { data, error } = await this.sb.rpc('ln_my_best', { p_course: key.courseId, p_holes: key.holes, p_since: key.since });
    if (error) fail(error, 'COULD NOT LOAD YOUR BEST');
    return data ? { rank: Number(data.rank), strokes: data.strokes, toPar: data.to_par } : null;
  }
}
