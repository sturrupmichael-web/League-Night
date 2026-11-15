/**
 * A round: which holes, in what order, the card so far, mulligans left.
 * Plain data so it can be saved as JSON after every hole.
 */
import type { ThrowInput } from '../sim/flight';
import type { Vec2 } from '../sim/math';
import type { SwipeRead } from '../sim/putt';
import type { Wind } from '../sim/wind';
import type { CourseDef } from './hole';
import type { SkinsRule } from './skins';

export type RoundLength = 3 | 9 | 18;
/** casual = New Round, cup = the Lantern Cup championship, skins = skins vs one rival. */
export type RoundMode = 'casual' | 'cup' | 'skins';
/** throw = watch every rival throw; hole = just see their hole score. */
export type Pacing = 'throw' | 'hole';

export interface RoundSettings {
  courseId: string;
  length: RoundLength;
  hand: 'right' | 'left';
  mode?: RoundMode;
  chaserId?: string;
  pacing?: Pacing;
  /** Skins: who you are playing and how ties work. */
  rivalId?: string;
  skinsRule?: SkinsRule;
}

/** Enough to re-simulate a throw exactly (highlight replays, later async matches). */
export type ThrowReplay =
  | { t: 'throw'; input: ThrowInput; seed: number }
  /** pv: putting physics version (missing = 1, from before versions were recorded). */
  | { t: 'putt'; lie: Vec2; read: Extract<SwipeRead, { cancel: false }>; seed: number; pv?: number };

/** A rival's running card. */
export interface RivalCard {
  id: string;
  name: string;
  scores: number[];
}

/** One logged throw, for stats and (later) highlight replays. */
export interface ThrowLog {
  kind: 'throw' | 'putt' | 'gimme';
  /** 1-based throw number on the hole (ignores penalty strokes). */
  n: number;
  discId: string;
  discType: string;
  /** Distance to the basket before / after. */
  fromFt: number;
  toFt: number;
  /** Straight-line distance the disc travelled to where it stopped. */
  distanceFt: number;
  penalty: number;
  made: boolean;
  /** Surface the disc stopped on (before any drop). */
  surface: string;
  replay?: ThrowReplay;
}

export interface HoleRecord {
  holeId: number;
  par: number;
  strokes: number;
  penalties: number;
  pickedUp: boolean;
  mulligans: number;
  throws: ThrowLog[];
  /** The hole's wind, so replays fly in the same air. */
  wind?: Wind;
}

export interface RoundState {
  seed: number;
  settings: RoundSettings;
  /** Indices into course.holes, in play order. */
  order: number[];
  /** Completed holes, in order. */
  card: HoleRecord[];
  mulligansLeft: number;
  startedAt: number;
  /** Cup field or skins rival scores, hole by hole. */
  rivals?: RivalCard[];
  /** Skins: the player conceded the match. */
  conceded?: boolean;
  /** Cred won at the turn minigame. */
  turn?: { game: string; cred: number };
}

export const MULLIGANS_PER_ROUND = 3;

/** 3 = first three holes, 9 = the course once, 18 = the course twice (front and back). */
export function holeOrder(courseHoles: number, length: RoundLength): number[] {
  const out: number[] = [];
  for (let i = 0; i < length; i++) out.push(i % courseHoles);
  return out;
}

export function newRound(course: CourseDef, settings: RoundSettings, seed: number, now = Date.now()): RoundState {
  return {
    seed,
    settings,
    order: holeOrder(course.holes.length, settings.length),
    card: [],
    // Mulligans are a casual-round thing: none in the cup or in skins.
    mulligansLeft: (settings.mode ?? 'casual') === 'casual' ? MULLIGANS_PER_ROUND : 0,
    startedAt: now,
  };
}

export const currentHoleIndex = (r: RoundState) => r.card.length;
export const isRoundOver = (r: RoundState) => r.card.length >= r.order.length;

export function recordHole(r: RoundState, rec: HoleRecord): RoundState {
  if (isRoundOver(r)) return r;
  return { ...r, card: [...r.card, rec], mulligansLeft: Math.max(0, r.mulligansLeft - rec.mulligans) };
}

export const roundMode = (r: RoundState): RoundMode => r.settings.mode ?? 'casual';

/** Add one hole's scores to each rival card. */
export function recordRivals(r: RoundState, scores: Record<string, number>): RoundState {
  if (!r.rivals) return r;
  return { ...r, rivals: r.rivals.map((c) => (scores[c.id] === undefined ? c : { ...c, scores: [...c.scores, scores[c.id]] })) };
}

export const roundStrokes = (r: RoundState) => r.card.reduce((a, h) => a + h.strokes, 0);
export const roundPar = (r: RoundState) => r.card.reduce((a, h) => a + h.par, 0);
export const roundToPar = (r: RoundState) => roundStrokes(r) - roundPar(r);

/** Totals for a slice of the card, e.g. front nine. */
export function cardTotals(card: HoleRecord[]) {
  const strokes = card.reduce((a, h) => a + h.strokes, 0);
  const par = card.reduce((a, h) => a + h.par, 0);
  return { strokes, par, toPar: strokes - par };
}
