import { describe, it, expect } from 'vitest';
import { calculateAccuracy, getMoveQuality, normalizeCpLoss } from '@/lib/analysis-utils';

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

// ─── normalizeCpLoss ─────────────────────────────────────────────────────────

describe('normalizeCpLoss', () => {
  it('leaves cp loss unchanged when within the global ceiling and no extreme evals', () => {
    expect(normalizeCpLoss(300, 100, -50)).toBe(300);  // slight edge both sides
    expect(normalizeCpLoss(500, 0, 100)).toBe(500);    // equal → slight loss, under ceiling
    expect(normalizeCpLoss(600, -100, 200)).toBe(600); // exactly at ceiling
  });

  it('applies the global ceiling (600 cp) when neither side was extreme', () => {
    // Blundered from equal into forced mate — genuine blunder, but capped at 600
    expect(normalizeCpLoss(10000, -10000, 0)).toBe(600);
    expect(getMoveQuality(normalizeCpLoss(10000, -10000, 0))).toBe('blunder');
  });

  it('caps at 50 (good) when playerEvalAfter is 500+ cp — "played a slower win"', () => {
    expect(normalizeCpLoss(9200, 500, 10000)).toBe(50);
    expect(normalizeCpLoss(9200, 10000, 10000)).toBe(50);
    expect(normalizeCpLoss(20, 800, 9000)).toBe(20);   // already under cap
  });

  it('caps at 100 (inaccuracy) when playerEvalAfter is 300–499 cp', () => {
    expect(normalizeCpLoss(9200, 300, 10000)).toBe(100);
    expect(normalizeCpLoss(9200, 499, 10000)).toBe(100);
    expect(normalizeCpLoss(50, 400, 500)).toBe(50);    // already under cap
  });

  it('caps at 50 (good) when playerEvalBefore is ≤ −500 cp — "natural move in lost position"', () => {
    // e.g. opponent was already down 10 pawns; allowing mate is not a new blunder
    expect(normalizeCpLoss(9500, -10000, -1000)).toBe(50);
    expect(normalizeCpLoss(9200, -10000, -600)).toBe(50);
    expect(getMoveQuality(normalizeCpLoss(9200, -10000, -600))).toBe('good');
  });

  it('caps at 100 (inaccuracy) when playerEvalBefore is −300 to −499 cp', () => {
    expect(normalizeCpLoss(9200, -10000, -300)).toBe(100);
    expect(normalizeCpLoss(9200, -10000, -499)).toBe(100);
  });

  it('handles the "played a slower mate" scenario correctly', () => {
    const rawLoss = 10000 - 800; // 9200 — best was forced mate, played keeps +800 cp
    expect(normalizeCpLoss(rawLoss, 800, 10000)).toBe(50);
    expect(getMoveQuality(normalizeCpLoss(rawLoss, 800, 10000))).toBe('good');
  });

  it('handles the "allowed forced mate from a lost position" scenario correctly', () => {
    // Opponent was already at −1000 cp (down 10 pawns); their move allows forced mate.
    // This is not a meaningful new blunder.
    const rawLoss = 10000 - 1000; // 9000
    expect(normalizeCpLoss(rawLoss, -10000, -1000)).toBe(50);
    expect(getMoveQuality(normalizeCpLoss(rawLoss, -10000, -1000))).toBe('good');
  });
});
