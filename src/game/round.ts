/**
 * A round: which holes, in what order, the card so far, mulligans left.
 * Plain data so it can be saved as JSON after every hole.
 */
import type { CourseDef } from './hole';

export type RoundLength = 3 | 9 | 18;

export interface RoundSettings {
  courseId: string;
  length: RoundLength;
  hand: 'right' | 'left';
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
}

export interface HoleRecord {
  holeId: number;
  par: number;
  strokes: number;
  penalties: number;
  pickedUp: boolean;
  mulligans: number;
  throws: ThrowLog[];
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
    mulligansLeft: MULLIGANS_PER_ROUND,
    startedAt: now,
  };
}

export const currentHoleIndex = (r: RoundState) => r.card.length;
export const isRoundOver = (r: RoundState) => r.card.length >= r.order.length;

export function recordHole(r: RoundState, rec: HoleRecord): RoundState {
  if (isRoundOver(r)) return r;
  return { ...r, card: [...r.card, rec], mulligansLeft: Math.max(0, r.mulligansLeft - rec.mulligans) };
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
