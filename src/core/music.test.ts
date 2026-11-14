import { describe, expect, it } from 'vitest';
import { noteFreq, SONGS } from './music';

describe('music', () => {
  it('turns note names into pitches', () => {
    expect(noteFreq('A4')).toBeCloseTo(440);
    expect(noteFreq('A5')).toBeCloseTo(880);
    expect(noteFreq('C4')).toBeCloseTo(261.63, 1);
  });

  it('every note in every song is playable and the loops fill whole bars', () => {
    for (const [name, s] of Object.entries(SONGS)) {
      const lead = s.lead.trim().split(/\s+/);
      expect(lead.length % 8, name).toBe(0);
      for (const n of lead) if (n !== '.' && n !== '-') expect(noteFreq(n), `${name} ${n}`).toBeGreaterThan(0);
      for (const n of s.bass.split(' ')) expect(noteFreq(n), `${name} bass ${n}`).toBeGreaterThan(0);
      expect(s.bassPat.split(' ')).toHaveLength(8);
    }
  });
});
