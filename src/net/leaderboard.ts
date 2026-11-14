/** Leaderboard helpers shared by both backends and the screens. */
import { type RoundState, roundMode } from '../game/round';
import { type BoardKey, NAME_MAX } from './types';
import { BOARD_LENGTHS } from './verifyRound';

export const GAME_VERSION = 'web-1';

/**
 * Trims a typed name to what the shared `players` table accepts: letters, digits and a few
 * marks, single spaces, no blanks or control characters, at most NAME_MAX long.
 */
export function cleanName(name: string): string {
  return String(name ?? '')
    .replace(/[^\p{L}\p{N} ._\-'!?]|[ᅟᅠㅤﾠ]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
    .trim();
}

/** Whether a finished round can go on the board: a whole 9 or 18, not conceded. */
export function postable(round: RoundState): boolean {
  return !round.conceded && (BOARD_LENGTHS as readonly number[]).includes(round.order.length) && round.card.length === round.order.length && ['casual', 'cup', 'skins'].includes(roundMode(round));
}

/** Monday 00:00 local time of this week, as ISO: the "this week" board. */
export function weekStart(now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString();
}

export const boardLabel = (k: BoardKey) => `${k.holes} HOLES · ${k.since ? 'THIS WEEK' : 'ALL TIME'}`;
