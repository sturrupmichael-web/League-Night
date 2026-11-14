/** Per-hole conditions that every player on a card shares, derived from the hole's seed. */
import { makeRng, mixSeed } from '../sim/rng';
import { rollWind, type Wind } from '../sim/wind';
import type { HoleDef } from './hole';

/** Wind for a hole. Player, rivals and replays all call this, so they see the same wind. */
export function holeWind(holeSeed: number, hole: HoleDef): Wind {
  return rollWind(makeRng(mixSeed(holeSeed, hole.id * 31 + 7)), hole.windRange);
}
