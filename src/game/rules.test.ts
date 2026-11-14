import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG as cfg } from '../config';
import { applyThrow, formatToPar, isHoleOver, maxStrokes, newHole, SCORE_LABEL, scoreKey } from './rules';

const tee = { x: 0, y: 0 };

describe('rules', () => {
  it('counts throws and adds penalties', () => {
    let s = newHole(3, tee);
    s = applyThrow(s, cfg, { penalty: 1, holed: false, lie: { x: 0, y: 100 } });
    expect(s.strokes).toBe(2);
    expect(s.throws).toBe(1);
    expect(s.penalties).toBe(1);
    expect(s.lie).toEqual({ x: 0, y: 100 });
    expect(s.history).toEqual([tee]);
    s = applyThrow(s, cfg, { penalty: 0, holed: true, lie: { x: 0, y: 200 } });
    expect(s.strokes).toBe(3);
    expect(s.holed).toBe(true);
    expect(isHoleOver(s)).toBe(true);
  });

  it('ignores throws after the hole is over', () => {
    let s = applyThrow(newHole(3, tee), cfg, { penalty: 0, holed: true, lie: tee });
    s = applyThrow(s, cfg, { penalty: 0, holed: false, lie: tee });
    expect(s.strokes).toBe(1);
  });

  it('picks up at the stroke cap', () => {
    let s = newHole(3, tee);
    for (let i = 0; i < 20 && !isHoleOver(s); i++) s = applyThrow(s, cfg, { penalty: 0, holed: false, lie: tee });
    expect(s.pickedUp).toBe(true);
    expect(s.holed).toBe(false);
    expect(s.strokes).toBe(maxStrokes(3, cfg));
  });

  it('a penalty that pushes past the cap still ends the hole at the cap', () => {
    let s = newHole(3, tee);
    for (let i = 0; i < maxStrokes(3, cfg) - 1; i++) s = applyThrow(s, cfg, { penalty: 0, holed: false, lie: tee });
    s = applyThrow(s, cfg, { penalty: 1, holed: false, lie: tee });
    expect(s.strokes).toBe(maxStrokes(3, cfg));
    expect(s.pickedUp).toBe(true);
  });

  it('names scores', () => {
    expect(scoreKey(1, 3)).toBe('ace');
    expect(scoreKey(2, 4)).toBe('eagle');
    expect(scoreKey(2, 3)).toBe('birdie');
    expect(scoreKey(3, 3)).toBe('par');
    expect(scoreKey(4, 3)).toBe('bogey');
    expect(scoreKey(5, 3)).toBe('double');
    expect(scoreKey(9, 3)).toBe('worse');
    expect(SCORE_LABEL[scoreKey(2, 3)]).toBe('BIRDIE!');
  });

  it('formats score to par', () => {
    expect(formatToPar(0)).toBe('E');
    expect(formatToPar(2)).toBe('+2');
    expect(formatToPar(-1)).toBe('-1');
  });
});
