/**
 * One full throw: flight + ground, from a seed and inputs. This is the function replays,
 * AI and async matches call, so it must stay deterministic.
 */
import type { Config } from '../config';
import type { Disc } from './discs';
import { type FlightEnv, type FlightResult, type ThrowInput, simulateFlight } from './flight';
import { type GroundResult, resolveGround } from './ground';
import { dist, type PathPoint } from './math';
import { makeRng } from './rng';

export interface ThrowResult {
  input: ThrowInput;
  discId: string;
  seed: number;
  flight: FlightResult;
  ground: GroundResult;
  /** Flight path followed by the ground path. */
  path: PathPoint[];
  /** Straight-line distance from release to touchdown. */
  carry: number;
  /** Straight-line distance from release to where it stopped. */
  total: number;
  maxHeight: number;
}

export function simulateThrow(input: ThrowInput, disc: Disc, env: FlightEnv, seed: number, cfg: Config): ThrowResult {
  const rng = makeRng(seed);
  const flight = simulateFlight(input, disc, env, rng, cfg);
  const ground = resolveGround(flight, disc, input.origin, env.terrain, rng, cfg);
  const path = flight.path.concat(ground.path);
  const base = env.terrain.height(input.origin.x, input.origin.y);
  return {
    input,
    discId: disc.id,
    seed,
    flight,
    ground,
    path,
    carry: dist(input.origin, flight.landing),
    total: dist(input.origin, ground.rest),
    maxHeight: Math.max(...flight.path.map((p) => p.z)) - base,
  };
}
