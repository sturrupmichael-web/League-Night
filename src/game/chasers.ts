/**
 * Chasers: the playable characters. Each has a small stat bias that nudges the config the
 * player throws with (never the rivals'), a hand, outfits and a 3-chapter story.
 */
import type { Config } from '../config';
import chasersJson from '../content/chasers.json';
import type { Hand } from '../sim/flight';

export interface ChaserStats { power: number; accuracy: number; putting: number; wind: number }

export interface Chaser {
  id: string;
  name: string;
  title: string;
  hand: Hand;
  stats: ChaserStats;
  colors: { skin: string; hair: string; outfits: [string, string][] };
  lock: { kind: 'rounds' | 'cred'; n: number; text: string } | null;
  story: string[];
}

export const CHASERS = chasersJson as Chaser[];

export const chaserById = (id: string | undefined): Chaser => CHASERS.find((c) => c.id === id) ?? CHASERS[0];

/** What the unlock rules look at. */
export interface ChaserMeta {
  roundsFinished: number;
  cred: number;
  trophies: string[];
  chaserProgress: Record<string, { rounds: number; wins: number }>;
}

export function isChaserUnlocked(c: Chaser, m: ChaserMeta): boolean {
  if (!c.lock) return true;
  if (c.lock.kind === 'rounds') return m.roundsFinished >= c.lock.n;
  return m.cred >= c.lock.n || m.trophies.includes('lantern-cup');
}

/** Chapter 1 is free; chapter 2 after a finished round with them; chapter 3 after a win with them. */
export function chaptersUnlocked(c: Chaser, m: ChaserMeta): number {
  const p = m.chaserProgress[c.id] ?? { rounds: 0, wins: 0 };
  return 1 + (p.rounds >= 1 ? 1 : 0) + (p.wins >= 1 ? 1 : 0);
}

/** How much each stat point moves things. */
export const STAT_EFFECT = {
  power: 0.03, // arm speed per point
  accuracy: 0.15, // redline wobble per point
  putting: 0.06, // chain window per point
  wind: 0.1, // wind push per point
};

/**
 * The player's config with their chaser's bias applied. A live view over `base`, so dev-panel
 * changes still apply mid-hole.
 */
export function chaserConfig(base: Config, c: Chaser): Config {
  const s = c.stats;
  const adj: Partial<Record<keyof Config, (v: number) => number>> = {
    armSpeed: (v) => v * (1 + STAT_EFFECT.power * s.power),
    redlineAimWobbleDeg: (v) => v * Math.max(0.2, 1 - STAT_EFFECT.accuracy * s.accuracy),
    redlineBankWobbleDeg: (v) => v * Math.max(0.2, 1 - STAT_EFFECT.accuracy * s.accuracy),
    chainHalfWidth: (v) => v * (1 + STAT_EFFECT.putting * s.putting),
    windScale: (v) => v * Math.max(0.2, 1 - STAT_EFFECT.wind * s.wind),
  };
  return new Proxy(base, {
    get(t, k: string | symbol) {
      const v = (t as Record<string | symbol, unknown>)[k];
      const f = adj[k as keyof Config];
      return f && typeof v === 'number' ? f(v) : v;
    },
  });
}
