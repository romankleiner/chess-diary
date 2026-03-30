import { describe, it, expect } from 'vitest';
import { calculateAccuracy, getMoveQuality } from '@/lib/analysis-utils';

// ─── calculateAccuracy ────────────────────────────────────────────────────────

describe('calculateAccuracy', () => {
  it('returns 100 for an empty array', () => {
    expect(calculateAccuracy([])).toBe(100);
  });

  it('returns 100 when every move has zero centipawn loss', () => {
    expect(calculateAccuracy([0])).toBe(100);
    expect(calculateAccuracy([0, 0, 0])).toBe(100);
  });

  it('returns a value below 100 for any positive centipawn loss', () => {
    expect(calculateAccuracy([1])).toBeLessThan(100);
    expect(calculateAccuracy([25])).toBeLessThan(100);
  });

  it('decreases as centipawn loss increases', () => {
    const acc100 = calculateAccuracy([100]);
    const acc200 = calculateAccuracy([200]);
    const acc500 = calculateAccuracy([500]);
    expect(acc100).toBeGreaterThan(acc200);
    expect(acc200).toBeGreaterThan(acc500);
  });

  it('returns approximately 90.9 for a single 100 cp loss', () => {
    // Formula: 100 - |50 * (2/(1+exp(0.368208)) - 1)|
    expect(calculateAccuracy([100])).toBeCloseTo(90.9, 0);
  });

  it('averages accuracy across multiple moves', () => {
    // Average of [0, 0] should still be 100
    expect(calculateAccuracy([0, 0])).toBe(100);
    // Mixed: average should be between the two individual values
    const accLow = calculateAccuracy([500]);
    const accHigh = calculateAccuracy([0]);
    const accMixed = calculateAccuracy([500, 0]);
    expect(accMixed).toBeGreaterThan(accLow);
    expect(accMixed).toBeLessThan(accHigh);
  });

  it('always returns a value in [0, 100]', () => {
    expect(calculateAccuracy([9999])).toBeGreaterThanOrEqual(0);
    expect(calculateAccuracy([9999])).toBeLessThanOrEqual(100);
  });

  it('rounds to one decimal place', () => {
    const result = calculateAccuracy([100]);
    // 90.9 has exactly one decimal place
    const str = result.toString();
    const decimals = str.includes('.') ? str.split('.')[1].length : 0;
    expect(decimals).toBeLessThanOrEqual(1);
  });
});

// ─── getMoveQuality ───────────────────────────────────────────────────────────

describe('getMoveQuality', () => {
  it('returns excellent for loss ≤ 25 cp', () => {
    expect(getMoveQuality(0)).toBe('excellent');
    expect(getMoveQuality(1)).toBe('excellent');
    expect(getMoveQuality(25)).toBe('excellent');
  });

  it('returns good for loss 26–50 cp', () => {
    expect(getMoveQuality(26)).toBe('good');
    expect(getMoveQuality(50)).toBe('good');
  });

  it('returns inaccuracy for loss 51–100 cp', () => {
    expect(getMoveQuality(51)).toBe('inaccuracy');
    expect(getMoveQuality(100)).toBe('inaccuracy');
  });

  it('returns mistake for loss 101–200 cp', () => {
    expect(getMoveQuality(101)).toBe('mistake');
    expect(getMoveQuality(200)).toBe('mistake');
  });

  it('returns blunder for loss > 200 cp', () => {
    expect(getMoveQuality(201)).toBe('blunder');
    expect(getMoveQuality(500)).toBe('blunder');
    expect(getMoveQuality(9999)).toBe('blunder');
  });

  it('uses inclusive upper bounds (boundary values)', () => {
    // Each threshold value belongs to the lower bracket
    expect(getMoveQuality(25)).toBe('excellent');  // not 'good'
    expect(getMoveQuality(50)).toBe('good');        // not 'inaccuracy'
    expect(getMoveQuality(100)).toBe('inaccuracy'); // not 'mistake'
    expect(getMoveQuality(200)).toBe('mistake');    // not 'blunder'
  });
});
