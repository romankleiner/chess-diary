import { describe, it, expect } from 'vitest';
import { computeStatistics } from '@/lib/analysis-utils';

// ─── fixtures ────────────────────────────────────────────────────────────────

const analysis = {
  whitePlayer: 'alice',
  blackPlayer: 'bob',
  whiteAccuracy: 85,
  blackAccuracy: 72,
  moves: [
    { color: 'white', centipawnLoss: 10,  moveQuality: 'excellent'  },
    { color: 'black', centipawnLoss: 120, moveQuality: 'mistake'    },
    { color: 'white', centipawnLoss: 60,  moveQuality: 'inaccuracy' },
    { color: 'black', centipawnLoss: 300, moveQuality: 'blunder'    },
    { color: 'white', centipawnLoss: 30,  moveQuality: 'good'       },
    { color: 'black', centipawnLoss: 40,  moveQuality: 'good'       },
  ],
};

// ─── null / missing data ──────────────────────────────────────────────────────

describe('computeStatistics — null cases', () => {
  it('returns null when gameAnalysis is null', () => {
    expect(computeStatistics(null, 'alice')).toBeNull();
  });

  it('returns null when gameAnalysis is undefined', () => {
    expect(computeStatistics(undefined, 'alice')).toBeNull();
  });

  it('returns null when moves array is missing', () => {
    expect(computeStatistics({}, 'alice')).toBeNull();
    expect(computeStatistics({ whitePlayer: 'alice' }, 'alice')).toBeNull();
  });

  it('returns null when moves is null', () => {
    expect(computeStatistics({ moves: null }, 'alice')).toBeNull();
  });
});

// ─── user is white ────────────────────────────────────────────────────────────

describe('computeStatistics — user plays white', () => {
  const stats = computeStatistics(analysis, 'alice')!;

  it('uses whiteAccuracy', () => {
    expect(stats.accuracy).toBe(85);
  });

  it('counts only white moves', () => {
    expect(stats.totalMoves).toBe(3);
  });

  it('counts inaccuracies correctly', () => {
    expect(stats.inaccuracies).toBe(1);
  });

  it('counts blunders and mistakes as zero', () => {
    expect(stats.blunders).toBe(0);
    expect(stats.mistakes).toBe(0);
  });

  it('calculates average centipawn loss for white moves', () => {
    // (10 + 60 + 30) / 3 = 33.33 → rounded to 33
    expect(stats.averageCentipawnLoss).toBe(33);
  });
});

// ─── user is black ────────────────────────────────────────────────────────────

describe('computeStatistics — user plays black', () => {
  const stats = computeStatistics(analysis, 'bob')!;

  it('uses blackAccuracy', () => {
    expect(stats.accuracy).toBe(72);
  });

  it('counts only black moves', () => {
    expect(stats.totalMoves).toBe(3);
  });

  it('counts blunders and mistakes correctly', () => {
    expect(stats.blunders).toBe(1);
    expect(stats.mistakes).toBe(1);
    expect(stats.inaccuracies).toBe(0);
  });

  it('calculates average centipawn loss for black moves', () => {
    // (120 + 300 + 40) / 3 = 153.33 → rounded to 153
    expect(stats.averageCentipawnLoss).toBe(153);
  });
});

// ─── edge cases ───────────────────────────────────────────────────────────────

describe('computeStatistics — edge cases', () => {
  it('returns null for averageCentipawnLoss when no moves have a centipawnLoss field', () => {
    const noLossAnalysis = {
      whitePlayer: 'alice',
      blackPlayer: 'bob',
      whiteAccuracy: 90,
      blackAccuracy: 88,
      moves: [
        { color: 'white', moveQuality: 'excellent' },
        { color: 'white', moveQuality: 'good' },
      ],
    };
    const stats = computeStatistics(noLossAnalysis, 'alice')!;
    expect(stats.averageCentipawnLoss).toBeNull();
  });

  it('returns null accuracy when whiteAccuracy is undefined', () => {
    const noAccuracy = { ...analysis, whiteAccuracy: undefined };
    const stats = computeStatistics(noAccuracy, 'alice')!;
    expect(stats.accuracy).toBeNull();
  });

  it('defaults to black when username does not match whitePlayer', () => {
    const stats = computeStatistics(analysis, 'unknown')!;
    // Should fall back to black, using blackAccuracy
    expect(stats.accuracy).toBe(72);
  });

  it('username matching is case-sensitive (already lowercased upstream)', () => {
    // whitePlayer is 'alice' (lowercase); 'Alice' (capital) does not match
    const stats = computeStatistics(analysis, 'Alice')!;
    expect(stats.accuracy).toBe(72); // falls back to black
  });

  it('handles legacy quality field name (move.quality)', () => {
    const legacyAnalysis = {
      whitePlayer: 'alice',
      blackPlayer: 'bob',
      whiteAccuracy: 80,
      blackAccuracy: 75,
      moves: [
        { color: 'white', centipawnLoss: 250, quality: 'blunder' },
      ],
    };
    const stats = computeStatistics(legacyAnalysis, 'alice')!;
    expect(stats.blunders).toBe(1);
  });
});
