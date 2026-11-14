/** Round stats from the throw logs. */
import type { HoleRecord, ThrowLog } from './round';

export const C1_FT = 33; // circle 1: inside 10 m
export const C2_FT = 66; // circle 2: 10–20 m

export interface RoundStats {
  fairwaysHit: number;
  fairwayChances: number;
  c1Made: number;
  c1Tries: number;
  c2Made: number;
  c2Tries: number;
  avgDriveFt: number | null;
  longestThrowFt: number;
  longestPuttFt: number;
  penalties: number;
  bestHole: { index: number; toPar: number } | null;
  birdiesOrBetter: number;
  aces: number;
}

const pct = (made: number, tries: number) => (tries ? Math.round((made / tries) * 100) : null);
export const formatPct = (made: number, tries: number) => {
  const p = pct(made, tries);
  return p === null ? '-' : `${p}% (${made}/${tries})`;
};

/** A putt attempt counts in C1/C2 by distance; gimmes are tap-ins and count as C1 makes. */
export function computeStats(card: HoleRecord[]): RoundStats {
  const s: RoundStats = {
    fairwaysHit: 0,
    fairwayChances: 0,
    c1Made: 0,
    c1Tries: 0,
    c2Made: 0,
    c2Tries: 0,
    avgDriveFt: null,
    longestThrowFt: 0,
    longestPuttFt: 0,
    penalties: 0,
    bestHole: null,
    birdiesOrBetter: 0,
    aces: 0,
  };
  const drives: number[] = [];
  card.forEach((h, i) => {
    s.penalties += h.penalties;
    const toPar = h.strokes - h.par;
    if (!s.bestHole || toPar < s.bestHole.toPar) s.bestHole = { index: i, toPar };
    if (!h.pickedUp && toPar <= -1) s.birdiesOrBetter++;
    if (!h.pickedUp && h.strokes === 1) s.aces++;
    const tee: ThrowLog | undefined = h.throws.find((t) => t.n === 1);
    if (tee && tee.kind === 'throw') {
      if (!tee.penalty) drives.push(tee.distanceFt);
      if (h.par >= 4) {
        s.fairwayChances++;
        if (!tee.penalty && (tee.surface === 'fairway' || tee.surface === 'green')) s.fairwaysHit++;
      }
    }
    for (const t of h.throws) {
      if (t.kind === 'throw' && !t.penalty) s.longestThrowFt = Math.max(s.longestThrowFt, t.distanceFt);
      if (t.kind === 'gimme' || (t.kind === 'putt' && t.fromFt <= C1_FT)) {
        s.c1Tries++;
        if (t.made) s.c1Made++;
      } else if (t.kind === 'putt' && t.fromFt <= C2_FT) {
        s.c2Tries++;
        if (t.made) s.c2Made++;
      }
      if (t.kind === 'putt' && t.made) s.longestPuttFt = Math.max(s.longestPuttFt, t.fromFt);
    }
  });
  if (drives.length) s.avgDriveFt = Math.round(drives.reduce((a, b) => a + b, 0) / drives.length);
  return s;
}
