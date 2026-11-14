/** The Lantern Cup: you against a field of league regulars, ranked hole by hole. */
export interface Entrant {
  id: string;
  name: string;
  /** Strokes per completed hole. */
  scores: number[];
  you?: boolean;
}

export interface Standing {
  id: string;
  name: string;
  you: boolean;
  toPar: number;
  strokes: number;
  thru: number;
  /** 1-based place, shared on ties ("T2"). */
  place: number;
  tied: boolean;
}

/** Rank entrants by score to par through the holes played. Ties break by the later holes (countback) for display only. */
export function standings(entrants: Entrant[], pars: number[]): Standing[] {
  const rows = entrants.map((e) => {
    const thru = Math.min(e.scores.length, pars.length);
    const strokes = e.scores.slice(0, thru).reduce((a, b) => a + b, 0);
    const par = pars.slice(0, thru).reduce((a, b) => a + b, 0);
    return { id: e.id, name: e.name, you: !!e.you, toPar: strokes - par, strokes, thru, place: 0, tied: false };
  });
  rows.sort((a, b) => a.toPar - b.toPar || Number(b.you) - Number(a.you) || a.name.localeCompare(b.name));
  rows.forEach((r, i) => {
    const first = rows.findIndex((x) => x.toPar === r.toPar);
    r.place = first + 1;
    r.tied = rows.filter((x) => x.toPar === r.toPar).length > 1;
    void i;
  });
  return rows;
}

/**
 * Who wins the cup. A tie for first is settled by countback: lowest score over the last
 * holes, working backwards; if still level the player shares it (and we call that a win).
 */
export function cupWinner(entrants: Entrant[], pars: number[]): string {
  const rows = standings(entrants, pars);
  const best = rows[0].toPar;
  const leaders = entrants.filter((e) => rows.find((r) => r.id === e.id)!.toPar === best);
  if (leaders.length === 1) return leaders[0].id;
  for (let k = 1; k <= pars.length; k++) {
    const sum = (e: Entrant) => e.scores.slice(-k).reduce((a, b) => a + b, 0);
    const low = Math.min(...leaders.map(sum));
    const left = leaders.filter((e) => sum(e) === low);
    if (left.length === 1) return left[0].id;
  }
  return leaders.find((e) => e.you)?.id ?? leaders[0].id;
}
