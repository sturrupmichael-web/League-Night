/** Cred: the league's soft currency. Lifetime Cred sets your tier; tiers unlock cosmetics. */
import type { HoleRecord } from './round';

export interface CredTier { name: string; at: number }

export const CRED_TIERS: CredTier[] = [
  { name: 'WALK-ON', at: 0 },
  { name: 'REGULAR', at: 100 },
  { name: 'CARD CAPTAIN', at: 300 },
  { name: 'LEAGUE LEGEND', at: 700 },
  { name: 'HALL OF CHAINS', at: 1500 },
];

export function credTier(cred: number): { tier: CredTier; index: number; next: CredTier | null } {
  let index = 0;
  CRED_TIERS.forEach((t, i) => {
    if (cred >= t.at) index = i;
  });
  return { tier: CRED_TIERS[index], index, next: CRED_TIERS[index + 1] ?? null };
}

/** Disc dyes. `tier` is the Cred tier index that unlocks it. null colour = each disc's stock colour. */
export const DYES: { id: string; name: string; color: string | null; tier: number }[] = [
  { id: 'stock', name: 'STOCK COLOURS', color: null, tier: 0 },
  { id: 'lantern', name: 'LANTERN ORANGE', color: '#ff8a3d', tier: 1 },
  { id: 'glow', name: 'GLOW GREEN', color: '#b6f26a', tier: 2 },
  { id: 'midnight', name: 'MIDNIGHT BLUE', color: '#5a7bd8', tier: 3 },
  { id: 'gold', name: 'CHAMPION GOLD', color: '#ffd23f', tier: 4 },
];

/** Chaser outfits: outfit i needs tier OUTFIT_TIERS[i]. */
export const OUTFIT_TIERS = [0, 2, 4];

export interface CredLine { label: string; cred: number }

/** Cred for a finished round. */
export function roundCred(card: HoleRecord[], opts: { full: boolean }): CredLine[] {
  const lines: CredLine[] = [{ label: opts.full ? 'FINISHED A ROUND' : 'FINISHED A QUICK ONE', cred: opts.full ? 20 : 8 }];
  let birdies = 0;
  let eagles = 0;
  let aces = 0;
  for (const h of card) {
    const d = h.strokes - h.par;
    if (h.strokes === 1) aces++;
    else if (d <= -2) eagles++;
    else if (d === -1) birdies++;
  }
  if (birdies) lines.push({ label: `BIRDIES X${birdies}`, cred: birdies * 5 });
  if (eagles) lines.push({ label: `EAGLES X${eagles}`, cred: eagles * 15 });
  if (aces) lines.push({ label: `ACES X${aces}`, cred: aces * 40 });
  const toPar = card.reduce((a, h) => a + h.strokes - h.par, 0);
  if (toPar < 0) lines.push({ label: 'UNDER PAR', cred: 15 });
  return lines;
}

export const sumCred = (lines: CredLine[]) => lines.reduce((a, l) => a + l.cred, 0);
