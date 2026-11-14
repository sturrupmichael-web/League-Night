/**
 * Versioned save in localStorage. Every read and write is guarded: private windows, blocked
 * storage or a corrupt save just mean "no save", never a crash.
 */
import type { RoundState } from '../game/round';

export const SAVE_KEY = 'leaguenight.save';
export const SAVE_VERSION = 2;

export interface Settings {
  sfx: boolean;
  hints: boolean;
  hand: 'right' | 'left';
}

export interface SaveData {
  v: number;
  settings: Settings;
  /** Round in progress, saved after every hole. */
  round: RoundState | null;
  /** Has the player been offered the practice field yet? */
  offeredPractice: boolean;
  roundsFinished: number;
  bestRounds: Record<string, number>; // `${courseId}:${length}` -> best score to par
  // ---- v2: chasers, Cred and unlocks ----
  chaserId: string;
  /** Chosen outfit index per chaser. */
  outfits: Record<string, number>;
  dye: string;
  /** Lifetime Cred earned (sets the tier). */
  cred: number;
  /** Course pins (course ids finished) and trophies ('lantern-cup'). */
  pins: string[];
  trophies: string[];
  chaserProgress: Record<string, { rounds: number; wins: number }>;
  cupsWon: number;
  skinsMatchesWon: number;
}

export const defaultSave = (): SaveData => ({
  v: SAVE_VERSION,
  settings: { sfx: true, hints: true, hand: 'right' },
  round: null,
  offeredPractice: false,
  roundsFinished: 0,
  bestRounds: {},
  chaserId: 'mae',
  outfits: {},
  dye: 'stock',
  cred: 0,
  pins: [],
  trophies: [],
  chaserProgress: {},
  cupsWon: 0,
  skinsMatchesWon: 0,
});

/** Bring an older or partial save up to the current shape. Unknown junk gives a fresh save. */
export function migrate(raw: unknown): SaveData {
  const base = defaultSave();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<SaveData> & { v?: number };
  if (typeof r.v !== 'number' || r.v > SAVE_VERSION) return base;
  // v1 -> v2 only added fields, which the defaults below fill in.
  const arr = (a: unknown): string[] => (Array.isArray(a) ? a.filter((x) => typeof x === 'string') : []);
  return {
    ...base,
    ...r,
    v: SAVE_VERSION,
    settings: { ...base.settings, ...(r.settings ?? {}) },
    bestRounds: { ...(r.bestRounds ?? {}) },
    outfits: { ...(r.outfits ?? {}) },
    chaserProgress: { ...(r.chaserProgress ?? {}) },
    pins: arr(r.pins),
    trophies: arr(r.trophies),
    cred: typeof r.cred === 'number' && isFinite(r.cred) ? r.cred : 0,
    round: r.round && Array.isArray(r.round.card) && Array.isArray(r.round.order) ? r.round : null,
  };
}

export interface Storage { getItem(k: string): string | null; setItem(k: string, v: string): void }

const store = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

export function loadSave(s: Storage | null = store()): SaveData {
  try {
    const raw = s?.getItem(SAVE_KEY);
    return raw ? migrate(JSON.parse(raw)) : defaultSave();
  } catch {
    return defaultSave();
  }
}

export function writeSave(data: SaveData, s: Storage | null = store()): boolean {
  try {
    s?.setItem(SAVE_KEY, JSON.stringify(data));
    return !!s;
  } catch {
    return false;
  }
}
