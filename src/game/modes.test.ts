import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../config';
import { migrate } from '../core/save';
import { cupWinner, standings } from './championship';
import { chaptersUnlocked, chaserById, chaserConfig, CHASERS, isChaserUnlocked } from './chasers';
import { credTier, roundCred, sumCred } from './cred';
import type { HoleRecord } from './round';
import { tallySkins } from './skins';

const rec = (par: number, strokes: number): HoleRecord => ({ holeId: 1, par, strokes, penalties: 0, pickedUp: false, mulligans: 0, throws: [] });

describe('skins', () => {
  it('carries ties and pays the pot to the next outright winner', () => {
    const t = tallySkins([3, 3, 2], [3, 3, 4], 'carry', 9);
    expect(t.holes.map((h) => h.winner)).toEqual(['tie', 'tie', 'you']);
    expect(t.holes[2].pot).toBe(3);
    expect(t.you).toBe(3);
    expect(t.rival).toBe(0);
  });
  it('voids a pot carried into a tied final hole', () => {
    const t = tallySkins([3, 4, 3], [4, 4, 3], 'carry', 3);
    expect(t.you).toBe(1);
    expect(t.voided).toBe(2);
    expect(t.carry).toBe(0);
  });
  it('drops tied skins in sudden death', () => {
    const t = tallySkins([3, 3, 4], [3, 2, 5], 'sudden', 3);
    expect(t.you).toBe(1);
    expect(t.rival).toBe(1);
    expect(t.holes[2].pot).toBe(1);
  });
});

describe('the cup', () => {
  const pars = [3, 4, 3];
  it('ranks by score to par with shared places', () => {
    const s = standings(
      [
        { id: 'you', name: 'YOU', scores: [3, 4], you: true },
        { id: 'a', name: 'A', scores: [2, 4] },
        { id: 'b', name: 'B', scores: [3, 4] },
      ],
      pars,
    );
    expect(s.map((r) => r.id)).toEqual(['a', 'you', 'b']);
    expect(s[1].place).toBe(2);
    expect(s[2].place).toBe(2);
    expect(s[1].tied).toBe(true);
  });
  it('breaks a tie for first on countback', () => {
    const w = cupWinner(
      [
        { id: 'you', name: 'YOU', scores: [2, 4, 4], you: true },
        { id: 'a', name: 'A', scores: [3, 4, 3] },
      ],
      pars,
    );
    expect(w).toBe('a');
  });
});

describe('chasers', () => {
  const meta = { roundsFinished: 0, cred: 0, trophies: [] as string[], chaserProgress: {} };
  it('has four original chasers, two free to start', () => {
    expect(CHASERS).toHaveLength(4);
    expect(CHASERS.filter((c) => isChaserUnlocked(c, meta))).toHaveLength(2);
    for (const c of CHASERS) expect(c.story).toHaveLength(3);
  });
  it('unlocks by rounds, Cred or the cup', () => {
    expect(isChaserUnlocked(chaserById('june'), { ...meta, roundsFinished: 1 })).toBe(true);
    expect(isChaserUnlocked(chaserById('hal'), { ...meta, cred: 600 })).toBe(true);
    expect(isChaserUnlocked(chaserById('hal'), { ...meta, trophies: ['lantern-cup'] })).toBe(true);
    expect(chaptersUnlocked(chaserById('mae'), { ...meta, chaserProgress: { mae: { rounds: 2, wins: 1 } } })).toBe(3);
  });
  it('biases the config live without touching the base', () => {
    const base = { ...DEFAULT_CONFIG };
    const dez = chaserConfig(base, chaserById('dez'));
    expect(dez.armSpeed).toBeGreaterThan(base.armSpeed);
    base.armSpeed = 50;
    expect(dez.armSpeed).toBeCloseTo(50 * 1.06);
    expect(dez.lift).toBe(base.lift);
  });
});

describe('cred', () => {
  it('pays for rounds and birdies and names the tier', () => {
    const lines = roundCred([rec(3, 2), rec(4, 4), rec(3, 1)], { full: false });
    expect(sumCred(lines)).toBe(8 + 5 + 40 + 15);
    expect(credTier(0).tier.name).toBe('WALK-ON');
    expect(credTier(320).tier.name).toBe('CARD CAPTAIN');
    expect(credTier(320).next?.name).toBe('LEAGUE LEGEND');
  });
});

describe('save v2', () => {
  it('upgrades a v1 save and keeps its data', () => {
    const s = migrate({ v: 1, roundsFinished: 4, bestRounds: { 'x:9': -2 } });
    expect(s.v).toBe(2);
    expect(s.roundsFinished).toBe(4);
    expect(s.chaserId).toBe('mae');
    expect(s.cred).toBe(0);
    expect(s.pins).toEqual([]);
  });
  it('ignores junk in new fields', () => {
    const s = migrate({ v: 2, cred: 'lots', pins: [1, 'lantern-park'] });
    expect(s.cred).toBe(0);
    expect(s.pins).toEqual(['lantern-park']);
  });
});

import { pickHighlights } from './highlights';
import type { ThrowLog } from './round';

describe('highlights', () => {
  const log = (p: Partial<ThrowLog>): ThrowLog => ({
    kind: 'throw', n: 1, discId: 'carpool', discType: 'fairway', fromFt: 300, toFt: 40, distanceFt: 260, penalty: 0, made: false, surface: 'fairway',
    replay: { t: 'throw', input: { origin: { x: 0, y: 0 }, aim: 0, power: 1, release: 0, style: 'backhand', hand: 'right' }, seed: 1 },
    ...p,
  });
  it('puts aces first, then longest throw and putt', () => {
    const card = [
      { ...rec(3, 1), throws: [log({ made: true, fromFt: 240, distanceFt: 240 })] },
      { ...rec(4, 3), throws: [log({ distanceFt: 380 }), log({ n: 2, kind: 'putt', fromFt: 45, made: true, distanceFt: 45 })] },
    ];
    const h = pickHighlights(card);
    expect(h.map((x) => x.title)).toEqual(['ACE!', 'LONGEST THROW', 'LONGEST PUTT']);
    expect(h[1].holeIndex).toBe(1);
  });
  it('skips throws without replay data', () => {
    expect(pickHighlights([{ ...rec(3, 3), throws: [log({ replay: undefined })] }])).toEqual([]);
  });
});

import { skipsFor } from '../scenes/turn/SkipContest';

describe('skip contest', () => {
  it('rewards the sweet spot and punishes a bad angle', () => {
    expect(skipsFor(0.82, 0.3)).toBe(9);
    expect(skipsFor(0.82, 0.95)).toBe(0);
    expect(skipsFor(0.5, 0.3)).toBeLessThan(5);
  });
});
