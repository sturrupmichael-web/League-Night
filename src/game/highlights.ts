/** Pick the reel: aces and throw-ins first, then the longest throw and the longest made putt. */
import type { HoleRecord, ThrowLog } from './round';

export interface Highlight {
  title: string;
  sub: string;
  /** Index into the round's card. */
  holeIndex: number;
  log: ThrowLog;
}

export function pickHighlights(card: HoleRecord[], max = 3): Highlight[] {
  const all = card.flatMap((h, holeIndex) => h.throws.filter((l) => l.replay).map((log) => ({ h, holeIndex, log })));
  const out: Highlight[] = [];
  const used = new Set<ThrowLog>();
  const add = (x: (typeof all)[number] | undefined, title: string, sub: string) => {
    if (!x || used.has(x.log) || out.length >= max) return;
    used.add(x.log);
    out.push({ title, sub, holeIndex: x.holeIndex, log: x.log });
  };
  for (const x of all.filter((x) => x.log.kind === 'throw' && x.log.made)) {
    add(x, x.log.n === 1 ? 'ACE!' : 'THROW-IN', `${Math.round(x.log.fromFt)} FT · HOLE ${x.holeIndex + 1}`);
  }
  const longest = all.filter((x) => x.log.kind === 'throw' && x.log.penalty === 0).sort((a, b) => b.log.distanceFt - a.log.distanceFt)[0];
  if (longest) add(longest, 'LONGEST THROW', `${Math.round(longest.log.distanceFt)} FT · HOLE ${longest.holeIndex + 1}`);
  const putt = all.filter((x) => x.log.kind === 'putt' && x.log.made).sort((a, b) => b.log.fromFt - a.log.fromFt)[0];
  if (putt) add(putt, 'LONGEST PUTT', `${Math.round(putt.log.fromFt)} FT · HOLE ${putt.holeIndex + 1}`);
  // Room left: the next-longest throws.
  for (const x of all.filter((x) => x.log.kind === 'throw' && x.log.penalty === 0).sort((a, b) => b.log.distanceFt - a.log.distanceFt)) {
    add(x, 'BIG ONE', `${Math.round(x.log.distanceFt)} FT · HOLE ${x.holeIndex + 1}`);
  }
  return out;
}
