import { describe, it, expect } from 'vitest';
import {
  ACCURACY_SCALE_CP,
  ACCURACY_SHAPE,
  accuracyFromMoves,
  calculateAccuracy,
  getMoveQuality,
  moveAccuracy,
  normalizeCpLoss,
  withCurrentAccuracy,
} from '@/lib/analysis-utils';

// ─── accuracy ─────────────────────────────────────────────────────────────────

describe('moveAccuracy', () => {
  it('is 100 for a move that loses nothing', () => {
    expect(moveAccuracy(0)).toBe(100);
  });

  it('is 100 for a loss that is negative or not a number, which cannot cost anything', () => {
    expect(moveAccuracy(-50)).toBe(100);
    expect(moveAccuracy(NaN)).toBe(100);
  });

  it('falls steadily as the loss grows', () => {
    const losses = [1, 5, 10, 25, 50, 100, 150, 200, 300, 500];
    const accuracies = losses.map(moveAccuracy);
    for (let i = 1; i < accuracies.length; i++) expect(accuracies[i]).toBeLessThan(accuracies[i - 1]);
  });

  it('gives almost nothing away for the first few centipawns', () => {
    expect(moveAccuracy(5)).toBeGreaterThan(97);
    expect(moveAccuracy(10)).toBeGreaterThan(94);
  });

  it('is 100/e at the scale constant, whatever the shape', () => {
    expect(moveAccuracy(ACCURACY_SCALE_CP)).toBeCloseTo(100 / Math.E, 6);
  });

  it('matches the values the formula was fitted with', () => {
    // 100 * exp(-(loss / 100) ^ 1.3)
    expect(moveAccuracy(10)).toBeCloseTo(95.1, 1);
    expect(moveAccuracy(25)).toBeCloseTo(84.8, 1);
    expect(moveAccuracy(50)).toBeCloseTo(66.6, 1);
    expect(moveAccuracy(100)).toBeCloseTo(36.8, 1);
    expect(moveAccuracy(200)).toBeCloseTo(8.5, 1);
  });

  it('keeps the constants it was fitted with', () => {
    expect(ACCURACY_SCALE_CP).toBe(100);
    expect(ACCURACY_SHAPE).toBe(1.3);
  });

  it('stays within [0, 100], even for an absurd loss', () => {
    for (const loss of [0, 1, 1000, 10000, 1e9, Number.MAX_VALUE]) {
      expect(moveAccuracy(loss)).toBeGreaterThanOrEqual(0);
      expect(moveAccuracy(loss)).toBeLessThanOrEqual(100);
    }
  });
});

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

  it('gives a single 100 cp loss the move accuracy of 100/e', () => {
    expect(calculateAccuracy([100])).toBe(36.8);
  });

  it('is the plain average of the moves’ accuracies', () => {
    const expected = (moveAccuracy(0) + moveAccuracy(50) + moveAccuracy(200)) / 3;
    expect(calculateAccuracy([0, 50, 200])).toBeCloseTo(expected, 1);
  });

  it('averages across moves: a mix is between its best and worst', () => {
    const accLow = calculateAccuracy([500]);
    const accHigh = calculateAccuracy([0]);
    const accMixed = calculateAccuracy([500, 0]);
    expect(accMixed).toBeGreaterThan(accLow);
    expect(accMixed).toBeLessThan(accHigh);
  });

  it('does not depend on the order of the moves', () => {
    expect(calculateAccuracy([0, 80, 10, 300])).toBe(calculateAccuracy([300, 10, 80, 0]));
  });

  it('counts a book move, which loses nothing, as a perfect move', () => {
    // Two book moves and two 100 cp slips: the book moves lift the average
    expect(calculateAccuracy([0, 0, 100, 100])).toBeGreaterThan(calculateAccuracy([100, 100]));
    expect(calculateAccuracy([0, 0, 100, 100])).toBe(68.4);
  });

  it('always returns a value in [0, 100]', () => {
    expect(calculateAccuracy([9999])).toBeGreaterThanOrEqual(0);
    expect(calculateAccuracy([9999])).toBeLessThanOrEqual(100);
    expect(calculateAccuracy([1e9, 1e9])).toBe(0);
  });

  it('rounds to one decimal place', () => {
    for (const losses of [[100], [37, 12, 0, 88], [13, 14, 15]]) {
      const str = calculateAccuracy(losses).toString();
      const decimals = str.includes('.') ? str.split('.')[1].length : 0;
      expect(decimals).toBeLessThanOrEqual(1);
    }
  });

  it('leaves out a loss that is not a number rather than letting it spoil the whole figure', () => {
    expect(calculateAccuracy([0, NaN, 100])).toBe(calculateAccuracy([0, 100]));
    expect(calculateAccuracy([Infinity, 0])).toBe(100);
    expect(calculateAccuracy([NaN])).toBe(100);
    expect(Number.isNaN(calculateAccuracy([NaN, NaN, 50]))).toBe(false);
  });

  it('is no longer lenient: a game with a few inaccuracies does not read as 99%', () => {
    // 30 moves, most losing a few centipawns, three losing 80 cp
    const game = [...Array(27).fill(8), ...Array(3).fill(80)];
    const oldFormula = (losses: number[]) =>
      losses.reduce((sum, l) => sum + 100 - Math.abs(50 * (2 / (1 + Math.exp(0.00368208 * l)) - 1)), 0) / losses.length;

    expect(oldFormula(game)).toBeGreaterThan(98); // what the app used to show
    expect(calculateAccuracy(game)).toBeLessThan(93);
    expect(calculateAccuracy(game)).toBeGreaterThan(88);
  });

  it('puts a clean game in the high nineties and a rough one in the seventies', () => {
    const clean = [0, 3, 0, 8, 5, 0, 12, 0, 6, 0, 4, 9, 0, 0, 7, 2, 0, 10, 0, 5];
    const rough = [0, 10, 40, 150, 0, 25, 300, 20, 90, 0, 60, 15, 200, 35, 0, 120, 45, 10, 80, 30];
    expect(calculateAccuracy(clean)).toBeGreaterThan(95);
    expect(calculateAccuracy(rough)).toBeLessThan(70);
  });

  it('is much stricter than the old formula at every level of play', () => {
    const oldFormula = (l: number) => 100 - Math.abs(50 * (2 / (1 + Math.exp(0.00368208 * l)) - 1));
    for (const loss of [10, 25, 50, 100, 200]) expect(moveAccuracy(loss)).toBeLessThan(oldFormula(loss));
  });
});

describe('accuracyFromMoves', () => {
  const moves = [
    { color: 'white', centipawnLoss: 0 },
    { color: 'black', centipawnLoss: 100 },
    { color: 'white', centipawnLoss: 100 },
    { color: 'black', centipawnLoss: 0 },
  ];

  it('works out each player’s accuracy from their own moves', () => {
    expect(accuracyFromMoves(moves, 'white')).toBe(calculateAccuracy([0, 100]));
    expect(accuracyFromMoves(moves, 'black')).toBe(calculateAccuracy([100, 0]));
  });

  it('counts book moves, which are stored with no loss, as perfect', () => {
    const withBook = [{ color: 'white', centipawnLoss: 0, moveQuality: 'book' }, { color: 'white', centipawnLoss: 100 }];
    expect(accuracyFromMoves(withBook, 'white')).toBe(calculateAccuracy([0, 100]));
  });

  it('skips a move that has no numeric loss', () => {
    const odd = [{ color: 'white' }, { color: 'white', centipawnLoss: '50' }, { color: 'white', centipawnLoss: null }, { color: 'white', centipawnLoss: 100 }];
    expect(accuracyFromMoves(odd, 'white')).toBe(calculateAccuracy([100]));
  });

  it('is null when the player has no move with a loss', () => {
    expect(accuracyFromMoves(moves.filter(m => m.color === 'white'), 'black')).toBeNull();
    expect(accuracyFromMoves([], 'white')).toBeNull();
    expect(accuracyFromMoves([{ color: 'white' }], 'white')).toBeNull();
  });

  it.each([[null], [undefined], ['moves'], [{}], [42]])('is null when moves is %s', value => {
    expect(accuracyFromMoves(value, 'white')).toBeNull();
  });

  it('ignores entries that are not objects', () => {
    expect(accuracyFromMoves([null, undefined, 5, 'x', { color: 'white', centipawnLoss: 0 }], 'white')).toBe(100);
  });
});

describe('withCurrentAccuracy', () => {
  const stored = {
    gameId: 'g', engine: 'x', whiteAccuracy: 98.8, blackAccuracy: 99.1,
    moves: [
      { color: 'white', centipawnLoss: 0 }, { color: 'black', centipawnLoss: 100 },
      { color: 'white', centipawnLoss: 100 }, { color: 'black', centipawnLoss: 0 },
    ],
  };

  it('replaces a stored accuracy with the one worked out from the moves', () => {
    const current = withCurrentAccuracy(stored)!;
    expect(current.whiteAccuracy).toBe(68.4);
    expect(current.blackAccuracy).toBe(68.4);
  });

  it('keeps everything else on the analysis', () => {
    expect(withCurrentAccuracy(stored)).toMatchObject({ gameId: 'g', engine: 'x', moves: stored.moves });
  });

  it('does not change the analysis it is given', () => {
    const copy = JSON.parse(JSON.stringify(stored));
    const current = withCurrentAccuracy(stored);

    expect(stored).toEqual(copy);
    expect(current).not.toBe(stored);
  });

  it('gives the same answer when applied twice', () => {
    const once = withCurrentAccuracy(stored)!;
    expect(withCurrentAccuracy(once)).toEqual(once);
  });

  it('keeps a stored figure for a side that has no usable moves', () => {
    const oneSide = { whiteAccuracy: 90, blackAccuracy: 77.7, moves: [{ color: 'white', centipawnLoss: 0 }] };
    const current = withCurrentAccuracy(oneSide)!;

    expect(current.whiteAccuracy).toBe(100);
    expect(current.blackAccuracy).toBe(77.7);
  });

  it('keeps the stored figures when there are no moves to work from', () => {
    const bare = { whiteAccuracy: 90, blackAccuracy: 80 };
    expect(withCurrentAccuracy(bare)).toEqual(bare);
    expect(withCurrentAccuracy({ ...bare, moves: [] })).toMatchObject({ whiteAccuracy: 90, blackAccuracy: 80 });
  });

  it('adds an accuracy to an analysis that was saved without one', () => {
    const none = withCurrentAccuracy({ moves: stored.moves })!;
    expect(none.whiteAccuracy).toBe(68.4);
  });

  it.each([[null], [undefined]])('gives null for %s', value => {
    expect(withCurrentAccuracy(value)).toBeNull();
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
