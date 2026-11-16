/** Friend matches: shared types for the client, the local stand-in backend and Supabase. */
import type { Pacing, RoundLength, RoundState, ThrowReplay } from '../game/round';
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
/** One line on a leaderboard: a player's best round on that course and length. */
export interface BoardRow {
  rank: number;
  name: string;
  strokes: number;
  toPar: number;
  chaser: string;
}

/** Which board: a course, a round length, all time or since a date (ISO). */
export interface BoardKey {
  courseId: string;
  holes: 9 | 18;
  since: string | null;
}

export interface PostedScore {
  name: string;
  rank: number;
  toPar: number;
}

/** The online leaderboard. Names are shared with Michael's other games (the `players` table). */
export interface LeaderboardApi {
  /** The player's leaderboard name, or null if they haven't picked one. */
  myName(): Promise<string | null>;
  /** Claim or change the name. Resolves to the stored name; rejects with a message in caps. */
  setName(name: string): Promise<string>;
  /** Send a finished round. The server replays it before it goes on the board. */
  submit(round: RoundState): Promise<PostedScore>;
  board(key: BoardKey): Promise<BoardRow[]>;
  myBest(key: BoardKey): Promise<{ rank: number; strokes: number; toPar: number } | null>;
}

export const NAME_MAX = 12;

export interface NetBackend extends LeaderboardApi {
  readonly label: string;
  /**
   * Return the player id: the Google account signed in on michaelsturrup.com if there is one,
   * otherwise this browser's guest account (signed in anonymously if needed).
   */
  me(): Promise<string>;
  /** True when playing as the site's Google account. Backends without accounts leave it out. */
  signedIn?(): boolean;
  /** Called with the new player id after a sign-in or sign-out elsewhere on the site. */
  onAccountChange?(cb: (id: string) => void): () => void;
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
