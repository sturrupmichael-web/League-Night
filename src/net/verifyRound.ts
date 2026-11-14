/**
 * Check a finished round for the leaderboard: re-simulate every hole from the recorded
 * inputs and the round seed, and work out the real score. Runs in the game (to warn before
 * posting) and on the server (supabase/functions/ln-submit-score), from the same code.
 */
import { DEFAULT_CONFIG } from '../config';
import { COURSES } from '../content/courses';
import { chaserById, chaserConfig } from '../game/chasers';
import { MULLIGANS_PER_ROUND, type RoundState } from '../game/round';
import { makeTerrain } from '../sim/terrain';
import type { ThrowPayload } from './types';
import { verifyHole } from './verify';

export interface RoundVerdict {
  ok: boolean;
  issues: string[];
  courseId: string;
  holes: number;
  strokes: number;
  par: number;
  mulligans: number;
  mode: string;
  chaserId: string;
}

/** The rounds that go on the board: whole New Rounds, Cups and Skins on a real course. */
export const BOARD_LENGTHS = [9, 18] as const;

export function verifyRound(round: RoundState): RoundVerdict {
  const issues: string[] = [];
  const s = round.settings;
  const course = COURSES.find((c) => c.id === s.courseId);
  const mode = s.mode ?? 'casual';
  const chaserId = s.chaserId ?? '';
  const base = { courseId: s.courseId, holes: round.order.length, mode, chaserId };
  if (!course) return { ...base, ok: false, issues: ['unknown course'], strokes: 0, par: 0, mulligans: 0 };
  if (!(BOARD_LENGTHS as readonly number[]).includes(s.length)) issues.push('only 9 and 18 hole rounds go on the board');
  if (round.order.length !== s.length || round.card.length !== s.length) issues.push('the round is not finished');
  round.order.forEach((h, i) => {
    if (h !== i % course.holes.length) issues.push(`hole ${i + 1} is out of order`);
  });
  const cfg = chaserConfig(DEFAULT_CONFIG, chaserById(chaserId));
  const allowed = mode === 'casual' ? MULLIGANS_PER_ROUND : 0;
  let strokes = 0;
  let par = 0;
  let mulligans = 0;
  round.card.forEach((rec, i) => {
    const hole = course.holes[round.order[i] ?? -1];
    if (!hole) return;
    par += hole.par;
    mulligans += Math.max(0, rec.mulligans | 0);
    const payloads: ThrowPayload[] = rec.throws.map((t) => ({ kind: t.kind, n: t.n, discId: t.discId, replay: t.replay, penalty: t.penalty, made: t.made }));
    const v = verifyHole(payloads, hole, makeTerrain(hole.terrain), round.seed, i, cfg, Math.max(0, rec.mulligans | 0));
    for (const m of v.issues) issues.push(`hole ${i + 1}: ${m}`);
    const last = v.strokes;
    if (last !== rec.strokes) issues.push(`hole ${i + 1}: card says ${rec.strokes}, throws add up to ${last}`);
    const lastThrow = rec.throws[rec.throws.length - 1];
    if (!rec.pickedUp && !lastThrow?.made) issues.push(`hole ${i + 1}: not holed out`);
    strokes += last;
  });
  if (mulligans > allowed) issues.push(`${mulligans} mulligans, only ${allowed} allowed`);
  return { ...base, ok: issues.length === 0, issues, strokes, par, mulligans };
}
