import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG as cfg } from '../config';
import discsJson from '../content/discs.json';
import type { Disc } from './discs';
import { type FlightEnv, type Hand, type Style, type ThrowInput, curveSign, simulateFlight } from './flight';
import { DEG, alongOffset, lateralOffset } from './math';
import { makeRng } from './rng';
import { flatTerrain, makeTerrain } from './terrain';
import { CALM, type Wind } from './wind';

const discs = discsJson as Disc[];
const byId = (id: string) => discs.find((d) => d.id === id)!;
const neutral: Disc = { id: 'neutral', name: 'NEUTRAL', type: 'midrange', speed: 5, glide: 5, turn: 0, fade: 0, color: '#fff' };
const fairway = byId('carpool'); // 7/5/0/2, a stable disc

const calm: FlightEnv = { terrain: flatTerrain(), wind: CALM };
const steady = (mph: number, dir: number): Wind => ({ mph, dir, gust: 0, phase: 0 });

function input(over: Partial<ThrowInput> = {}): ThrowInput {
  return { origin: { x: 0, y: 0 }, aim: 0, power: 0.9, release: 0, style: 'backhand', hand: 'right', ...over };
}

const fly = (i: ThrowInput, d: Disc = fairway, env: FlightEnv = calm, seed = 1) => simulateFlight(i, d, env, makeRng(seed), cfg);

describe('flight: straight lines', () => {
  it('a flat throw of a neutral disc in calm air lands on the aim line (within 2%)', () => {
    for (const aimDeg of [0, 30, -45, 120]) {
      const i = input({ aim: aimDeg * DEG, origin: { x: 12, y: -7 } });
      const r = fly(i, neutral);
      // Every disc gets a whisper of fade as it dies, so allow 2% of the distance.
      const along = alongOffset(i.origin, i.aim, r.landing);
      expect(along).toBeGreaterThan(150);
      expect(Math.abs(lateralOffset(i.origin, i.aim, r.landing))).toBeLessThan(along * 0.02);
    }
  });

  it('every catalog disc goes somewhere sensible at full power', () => {
    for (const d of discs) {
      const r = fly(input({ power: 1 }), d);
      expect(r.landing.y).toBeGreaterThan(200);
      expect(r.landing.y).toBeLessThan(450);
      expect(Math.abs(r.landing.x)).toBeLessThan(80);
    }
  });

  it('more power means more distance', () => {
    const d = [0.4, 0.6, 0.8, 1.0].map((p) => fly(input({ power: p })).landing.y);
    for (let k = 1; k < d.length; k++) expect(d[k]).toBeGreaterThan(d[k - 1]);
  });

  it('a fast driver beats a fairway with a big arm, but loses when underpowered', () => {
    const driver = byId('overtime');
    expect(fly(input({ power: 1 }), driver).landing.y).toBeGreaterThan(fly(input({ power: 1 }), fairway).landing.y);
    expect(fly(input({ power: 0.6 }), driver).landing.y).toBeLessThan(fly(input({ power: 0.6 }), fairway).landing.y);
  });

  it('an underpowered high-speed disc fades early and hard', () => {
    const driver = byId('overtime');
    const weak = fly(input({ power: 0.6 }), driver);
    const lateralPerFt = weak.landing.x / weak.landing.y;
    const strong = fly(input({ power: 1 }), driver);
    expect(lateralPerFt).toBeLessThan(strong.landing.x / strong.landing.y);
    expect(weak.landing.x).toBeLessThan(-3); // right-hand backhand fades left
  });
});

describe('flight: curve directions', () => {
  // Expected side the disc finishes on for a hyzer release, by hand + style.
  // Right-hand backhand hyzer finishes left; forehand and left hand each mirror it.
  const cases: [Hand, Style, -1 | 1][] = [
    ['right', 'backhand', -1],
    ['right', 'forehand', 1],
    ['left', 'backhand', 1],
    ['left', 'forehand', -1],
  ];

  for (const [hand, style, side] of cases) {
    it(`${hand}-hand ${style}: hyzer curves ${side < 0 ? 'left' : 'right'}, anhyzer curves the other way`, () => {
      const hyzer = fly(input({ hand, style, release: -1 }), neutral);
      const anhyzer = fly(input({ hand, style, release: 1 }), neutral);
      expect(Math.sign(hyzer.landing.x)).toBe(side);
      expect(Math.abs(hyzer.landing.x)).toBeGreaterThan(5);
      expect(Math.sign(anhyzer.landing.x)).toBe(-side);
      expect(Math.abs(anhyzer.landing.x)).toBeGreaterThan(5);
    });
  }

  it('curveSign mirrors for forehand and for lefties', () => {
    expect(curveSign('right', 'backhand')).toBe(1);
    expect(curveSign('right', 'forehand')).toBe(-1);
    expect(curveSign('left', 'backhand')).toBe(-1);
    expect(curveSign('left', 'forehand')).toBe(1);
  });

  it('a stable disc thrown flat fades toward the fade side at the end', () => {
    expect(fly(input({ power: 1 }), fairway).landing.x).toBeLessThan(-5);
    expect(fly(input({ power: 1, hand: 'left' }), fairway).landing.x).toBeGreaterThan(5);
  });

  it('an understable disc turns toward the turn side when thrown hard', () => {
    expect(fly(input({ power: 1 }), byId('floodlight')).landing.x).toBeGreaterThan(5);
  });

  it('hyzer adds fade and anhyzer adds turn', () => {
    const flat = fly(input({ power: 1 })).landing.x;
    expect(fly(input({ power: 1, release: -1 })).landing.x).toBeLessThan(flat);
    expect(fly(input({ power: 1, release: 1 })).landing.x).toBeGreaterThan(flat);
  });

  it('a hammer goes high and short', () => {
    const bh = fly(input({ power: 1 }));
    const ham = fly(input({ power: 1, style: 'hammer' }));
    const peak = (r: typeof bh) => Math.max(...r.path.map((p) => p.z));
    expect(peak(ham)).toBeGreaterThan(peak(bh));
    expect(ham.landing.y).toBeLessThan(bh.landing.y * 0.75);
    expect(ham.upsideDown).toBe(true);
  });
});

describe('flight: wind', () => {
  it('tailwind > calm > headwind for a stable disc', () => {
    const tail = fly(input(), fairway, { terrain: flatTerrain(), wind: steady(12, 0) }).landing.y;
    const none = fly(input(), fairway).landing.y;
    const head = fly(input(), fairway, { terrain: flatTerrain(), wind: steady(12, Math.PI) }).landing.y;
    expect(tail).toBeGreaterThan(none);
    expect(none).toBeGreaterThan(head);
  });

  it('a headwind makes an understable disc turn more', () => {
    const d = byId('night-owl');
    const none = fly(input({ power: 1 }), d).landing.x;
    const head = fly(input({ power: 1 }), d, { terrain: flatTerrain(), wind: steady(15, Math.PI) }).landing.x;
    expect(head).toBeGreaterThan(none);
  });

  it('a crosswind drifts the disc downwind', () => {
    const r = fly(input(), neutral, { terrain: flatTerrain(), wind: steady(12, Math.PI / 2) });
    expect(r.landing.x).toBeGreaterThan(5);
  });
});

describe('flight: terrain', () => {
  const slope = (rise: number) =>
    makeTerrain({
      defaultSurface: 'fairway',
      regions: [],
      trees: [],
      heightmap: { cellFt: 100, w: 2, h: 6, originX: -50, originY: 0, data: [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5].map((k) => (k * rise) / 5) },
    });

  it('uphill lands short and downhill carries', () => {
    const up = fly(input(), fairway, { terrain: slope(40), wind: CALM }).landing.y;
    const flat = fly(input(), fairway).landing.y;
    const down = fly(input(), fairway, { terrain: slope(-40), wind: CALM }).landing.y;
    expect(up).toBeLessThan(flat);
    expect(flat).toBeLessThan(down);
  });

  it('a tree in the line knocks the disc down', () => {
    const env: FlightEnv = { terrain: makeTerrain({ defaultSurface: 'fairway', regions: [], trees: [{ x: 0, y: 80, r: 6 }] }), wind: CALM };
    const r = fly(input({ power: 1 }), neutral, env);
    expect(r.treeHits).toBeGreaterThan(0);
    expect(r.landing.y).toBeLessThan(110);
  });

  it('a disc that flies into the chains is holed', () => {
    const open = fly(input({ power: 0.5 }), neutral);
    // Put the basket on the flight line where the disc is at catch height.
    const p = open.path.find((q, k) => k > 5 && q.z < 3.5 && q.z > 2.6)!;
    const env: FlightEnv = { terrain: flatTerrain(), wind: CALM, basket: { x: p.x, y: p.y } };
    expect(fly(input({ power: 0.5 }), neutral, env).holed).toBe(true);
  });
});

describe('flight: redline and determinism', () => {
  it('the same seed and inputs give the same path', () => {
    const a = fly(input({ power: 1.15 }), fairway, calm, 42);
    const b = fly(input({ power: 1.15 }), fairway, calm, 42);
    expect(b.path).toEqual(a.path);
  });

  it('under the redline the seed does not matter', () => {
    const a = fly(input({ power: 1 }), fairway, calm, 1);
    const b = fly(input({ power: 1 }), fairway, calm, 2);
    expect(b.landing).toEqual(a.landing);
  });

  it('redline adds distance on average but scatters the landing', () => {
    const base = fly(input({ power: 1 }));
    const xs: number[] = [];
    let far = 0;
    for (let s = 0; s < 40; s++) {
      const r = fly(input({ power: 1.15 }), fairway, calm, s);
      xs.push(r.landing.x);
      far += r.landing.y;
    }
    expect(far / 40).toBeGreaterThan(base.landing.y);
    const mean = xs.reduce((a, b) => a + b) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
    expect(sd).toBeGreaterThan(5);
  });

  it('matching the release angle to the disc adds a little distance', () => {
    // CARPOOL (stability 2) prefers a slight anhyzer; NEUTRAL prefers a slight hyzer. Check the bonus exists via launch speed.
    const flat = fly(input({ release: 0 }));
    const ideal = fly(input({ release: 0.25 }));
    expect(ideal.launchSpeed).toBeGreaterThan(flat.launchSpeed);
  });
});
