/**
 * Friend-match rules, shared by the client and the local backend. The Supabase trigger
 * enforces the same checks server-side (see supabase/migrations).
 */
import type { Match, ThrowPayload, ThrowRow } from './types';

export const opponentOf = (m: Match, me: string) => (m.host === me ? m.guest : m.host);
export const metaOf = (m: Match, id: string | null) => (id === m.host ? m.hostMeta : m.guestMeta);

export function rowsFor(throws: ThrowRow[], player: string | null) {
  return throws.filter((t) => t.playerId === player).sort((a, b) => a.seq - b.seq);
}

/** Strokes for each hole the player has finished. */
export function holeScores(throws: ThrowRow[], player: string | null): number[] {
  const out: number[] = [];
  for (const t of rowsFor(throws, player)) if (t.payload.kind === 'done') out[t.hole] = t.payload.strokes ?? 0;
  return out.filter((x) => x !== undefined);
}

export const holesDone = (throws: ThrowRow[], player: string | null) => holeScores(throws, player).length;

export function nextSeq(throws: ThrowRow[], player: string) {
  return rowsFor(throws, player).reduce((m, t) => Math.max(m, t.seq), 0) + 1;
}

/** Can `me` play their next hole now? */
export function canPlay(m: Match, throws: ThrowRow[], me: string): { ok: boolean; why: string } {
  if (m.status === 'waiting') return { ok: false, why: 'WAITING FOR YOUR FRIEND TO JOIN' };
  if (m.status !== 'active') return { ok: false, why: 'MATCH OVER' };
  const mine = holesDone(throws, me);
  if (mine >= m.settings.length) return { ok: false, why: 'YOUR CARD IS IN' };
  const theirs = holesDone(throws, opponentOf(m, me));
  if (!m.settings.playAhead && mine > theirs) return { ok: false, why: 'WAITING ON YOUR FRIEND' };
  return { ok: true, why: '' };
}

/** Throws already uploaded for the hole in progress (to resume after closing the app). */
export function holeInProgress(throws: ThrowRow[], me: string): ThrowPayload[] {
  const mine = rowsFor(throws, me);
  const hole = holesDone(throws, me);
  return mine.filter((t) => t.hole === hole && t.payload.kind !== 'done').map((t) => t.payload);
}

export interface MatchResult {
  over: boolean;
  winner: string | null; // null = tie
  totals: Record<string, number>;
}

export function matchResult(m: Match, throws: ThrowRow[]): MatchResult {
  const total = (p: string | null) => holeScores(throws, p).reduce((a, b) => a + b, 0);
  const totals: Record<string, number> = { [m.host]: total(m.host) };
  if (m.guest) totals[m.guest] = total(m.guest);
  if (m.status === 'conceded') return { over: true, winner: m.concededBy === m.host ? m.guest : m.host, totals };
  const over = !!m.guest && holesDone(throws, m.host) >= m.settings.length && holesDone(throws, m.guest) >= m.settings.length;
  if (!over) return { over: false, winner: null, totals };
  const a = totals[m.host];
  const b = totals[m.guest!];
  return { over: true, winner: a < b ? m.host : b < a ? m.guest : null, totals };
}

/** The checks the server makes on every throw insert. Returns an error message or null. */
export function checkInsert(m: Match, throws: ThrowRow[], me: string, hole: number, seq: number, payload: ThrowPayload): string | null {
  if (me !== m.host && me !== m.guest) return 'not in this match';
  if (m.status !== 'active') return 'match is not active';
  if (seq !== nextSeq(throws, me)) return `seq must be ${nextSeq(throws, me)}`;
  const done = holesDone(throws, me);
  if (hole !== done) return `you are on hole ${done}`;
  if (hole >= m.settings.length) return 'card is complete';
  if (!m.settings.playAhead && done > holesDone(throws, opponentOf(m, me))) return 'wait for your friend';
  if (JSON.stringify(payload).length > 4000) return 'payload too large';
  return null;
}

export function makeCode(rand: () => number): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += A[Math.floor(rand() * A.length)];
  return s;
}
