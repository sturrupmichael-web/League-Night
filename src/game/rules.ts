/** Strokes, penalties, caps and score names. Pure and unit-tested. */
import type { Config } from '../config';
import type { Vec2 } from '../sim/math';

export type ScoreKey = 'ace' | 'albatross' | 'eagle' | 'birdie' | 'par' | 'bogey' | 'double' | 'triple' | 'worse';

export interface HoleState {
  par: number;
  /** Strokes including penalties. */
  strokes: number;
  penalties: number;
  /** Throws actually made (no penalties). */
  throws: number;
  holed: boolean;
  /** True when the hole ended at the stroke cap instead of holing out. */
  pickedUp: boolean;
  lie: Vec2;
  /** Lie before each throw, so a later phase can rewind (mulligans). */
  history: Vec2[];
}

export function newHole(par: number, tee: Vec2): HoleState {
  return { par, strokes: 0, penalties: 0, throws: 0, holed: false, pickedUp: false, lie: { ...tee }, history: [] };
}

export const maxStrokes = (par: number, cfg: Config) => par + cfg.maxOverPar;
export const isHoleOver = (s: HoleState) => s.holed || s.pickedUp;

/** Record a throw (fairway throw, putt or gimme). Returns a new state. */
export function applyThrow(s: HoleState, cfg: Config, r: { penalty: number; holed: boolean; lie: Vec2 }): HoleState {
  if (isHoleOver(s)) return s;
  const strokes = s.strokes + 1 + r.penalty;
  const cap = maxStrokes(s.par, cfg);
  const holed = r.holed && strokes <= cap;
  return {
    ...s,
    strokes: Math.min(strokes, cap),
    penalties: s.penalties + r.penalty,
    throws: s.throws + 1,
    holed,
    pickedUp: !holed && strokes >= cap,
    lie: { ...r.lie },
    history: [...s.history, { ...s.lie }],
  };
}

export function scoreKey(strokes: number, par: number): ScoreKey {
  if (strokes === 1) return 'ace';
  const d = strokes - par;
  if (d <= -3) return 'albatross';
  if (d === -2) return 'eagle';
  if (d === -1) return 'birdie';
  if (d === 0) return 'par';
  if (d === 1) return 'bogey';
  if (d === 2) return 'double';
  if (d === 3) return 'triple';
  return 'worse';
}

export const SCORE_LABEL: Record<ScoreKey, string> = {
  ace: 'ACE!',
  albatross: 'ALBATROSS!',
  eagle: 'EAGLE!',
  birdie: 'BIRDIE!',
  par: 'PAR',
  bogey: 'BOGEY',
  double: 'DOUBLE BOGEY',
  triple: 'TRIPLE BOGEY',
  worse: 'ROUGH ONE',
};

/** Score relative to par: "E", "+2", "-1". */
export function formatToPar(n: number): string {
  if (n === 0) return 'E';
  return n > 0 ? `+${n}` : `${n}`;
}
