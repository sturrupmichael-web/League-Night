/** Friend matches: shared types for the client, the local stand-in backend and Supabase. */
import type { Pacing, RoundLength, ThrowReplay } from '../game/round';
import type { Vec2 } from '../sim/math';

export interface PlayerMeta {
  name: string;
  chaserId: string;
  hand: 'right' | 'left';
}

export interface MatchSettings {
  courseId: string;
  length: RoundLength;
  /** Off: you can be at most one hole ahead of your friend. On: play the whole card. */
  playAhead: boolean;
  /** throw: watch your friend's throws on each hole; hole: just their hole scores. */
  pacing: Pacing;
}

export type MatchStatus = 'waiting' | 'active' | 'done' | 'conceded';

export interface Match {
  id: string;
  code: string;
  host: string;
  guest: string | null;
  hostMeta: PlayerMeta;
  guestMeta: PlayerMeta | null;
  seed: number;
  settings: MatchSettings;
  status: MatchStatus;
  concededBy: string | null;
  rematchOf: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One recorded throw (or the end-of-hole marker). Enough to re-simulate and check it. */
export interface ThrowPayload {
  kind: 'throw' | 'putt' | 'gimme' | 'done';
  /** Throw number on the hole (1-based). For 'done', the hole's strokes. */
  n: number;
  discId?: string;
  replay?: ThrowReplay;
  /** Where the next throw comes from (the basket if holed). */
  lie?: Vec2;
  penalty?: number;
  made?: boolean;
  fromFt?: number;
  toFt?: number;
  distanceFt?: number;
  surface?: string;
  /** 'done' rows only. */
  strokes?: number;
  pickedUp?: boolean;
}

export interface ThrowRow {
  matchId: string;
  playerId: string;
  /** 0-based hole index in the match. */
  hole: number;
  /** Per player, strictly increasing from 1. */
  seq: number;
  payload: ThrowPayload;
  createdAt: string;
}

export interface ChatRow {
  id: string;
  matchId: string;
  playerId: string;
  body: string;
  createdAt: string;
}

export interface MatchBundle {
  match: Match;
  throws: ThrowRow[];
  messages: ChatRow[];
}

export type NetEvent = { kind: 'match' | 'throw' | 'message'; matchId: string };

/** What the game needs from a backend. Supabase in production, localStorage for dev and tests. */
export interface NetBackend {
  readonly label: string;
  /** Sign in (anonymously) if needed and return the player id. */
  me(): Promise<string>;
  createMatch(settings: MatchSettings, meta: PlayerMeta, seed: number): Promise<Match>;
  joinMatch(code: string, meta: PlayerMeta): Promise<Match>;
  listMatches(): Promise<Match[]>;
  getMatch(id: string): Promise<MatchBundle>;
  postThrow(matchId: string, hole: number, seq: number, payload: ThrowPayload): Promise<void>;
  concede(matchId: string): Promise<void>;
  rematch(matchId: string, meta: PlayerMeta, seed: number): Promise<Match>;
  sendMessage(matchId: string, body: string): Promise<void>;
  /** Live updates for the player's matches. Returns an unsubscribe function. */
  subscribe(cb: (e: NetEvent) => void): () => void;
}

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const MAX_CHAT = 60;
export const QUICK_CHAT = ['NICE THROW!', 'GOOD GAME', 'YOUR TURN', 'CHAINS!', 'UNLUCKY', 'REMATCH?', 'SEE YOU THURSDAY', 'TREE GOT ME'];
