import { describe, it, expect } from 'vitest';
import {
  ACCURACY_SCALE_CP,
  ACCURACY_SHAPE,
  WIN_CURVE_STEEPNESS,
  accuracyFromMoves,
  calculateAccuracy,
  computeStatistics,
  getMoveQuality,
  gradedCpLoss,
  moveAccuracy,
  summarizeAnalysis,
  winningChances,
  withCurrentAccuracy,
  withCurrentGrading,
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

// ─── grading by winning chances ───────────────────────────────────────────────

describe('winningChances', () => {
  it('is even at 0.00 and rises with the evaluation', () => {
    expect(WIN_CURVE_STEEPNESS).toBe(0.005);
    expect(winningChances(0)).toBe(0.5);
    expect(winningChances(100)).toBeCloseTo(0.622, 3);
    expect(winningChances(500)).toBeCloseTo(0.924, 3);
    expect(winningChances(-500)).toBeCloseTo(0.076, 3);
  });

  it('is all but certain at a forced mate, however it is stored', () => {
    for (const mate of [10_000, 96_300]) {
      expect(winningChances(mate)).toBeCloseTo(1, 10);
      expect(winningChances(-mate)).toBeCloseTo(0, 10);
    }
  });
});

describe('gradedCpLoss', () => {
  // From `before` to `after`, both from the mover's side, in centipawns
  const fromTo = (before: number, after: number) => gradedCpLoss(before - after, after);

  it('counts a pawn given away at +5 at about a third of one given away at 0.00', () => {
    expect(fromTo(500, 400)).toBe(35);
    expect(getMoveQuality(fromTo(500, 400))).toBe('good');
    expect(fromTo(100, 0)).toBe(98);
    expect(getMoveQuality(fromTo(100, 0))).toBe('inaccuracy');
  });

  it('is the plain loss, near enough, in a level game', () => {
    for (const loss of [10, 25, 50, 100]) {
      expect(Math.abs(fromTo(loss / 2, -loss / 2) - loss)).toBeLessThanOrEqual(Math.ceil(loss * 0.03));
    }
  });

  it('still calls throwing a win away a blunder, and halving an advantage a mistake', () => {
    expect(fromTo(500, 0)).toBe(339);
    expect(getMoveQuality(fromTo(500, 0))).toBe('blunder');
    expect(fromTo(300, 100)).toBe(156);
    expect(getMoveQuality(fromTo(300, 100))).toBe('mistake');
  });

  it('counts a loss for less in a game already lost, just as in one already won', () => {
    expect(fromTo(-500, -600)).toBe(23);
    expect(fromTo(800, 600)).toBe(24);
    expect(fromTo(-500, -600)).toBe(fromTo(600, 500)); // the same stretch of the curve, mirrored
  });

  it('counts a loss for less the further the game is from level', () => {
    const atLevels = [0, 100, 200, 300, 500, 800].map(after => gradedCpLoss(100, after));
    for (let i = 1; i < atLevels.length; i++) expect(atLevels[i]).toBeLessThan(atLevels[i - 1]);
  });

  it('counts missing a mate while staying well ahead, or allowing one when long lost, as next to nothing', () => {
    expect(getMoveQuality(gradedCpLoss(10_000 - 800, 800))).toBe('excellent');      // a slower win
    expect(getMoveQuality(gradedCpLoss(10_000 - 1000, -10_000))).toBe('excellent'); // mated from -10
  });

  it('calls walking into a mate from a level game a blunder', () => {
    expect(gradedCpLoss(10_000, -10_000)).toBe(400);
    expect(getMoveQuality(gradedCpLoss(10_000, -10_000))).toBe('blunder');
  });

  it('is 0 for a move that lost nothing, and the plain loss without an evaluation to place it', () => {
    expect(gradedCpLoss(0, 300)).toBe(0);
    expect(gradedCpLoss(-20, 300)).toBe(0);
    expect(gradedCpLoss(80, Number.NaN)).toBe(80);
  });
});

// ─── grading a stored analysis ────────────────────────────────────────────────

type TestMove = {
  moveNumber: number; color: 'white' | 'black'; move: string; evaluation?: number;
  centipawnLoss?: number; gradedLoss?: number; moveQuality: string;
};
const mv = (moveNumber: number, color: 'white' | 'black', evaluation: number, centipawnLoss: number, extra: Partial<TestMove> = {}): TestMove =>
  ({ moveNumber, color, move: 'x', evaluation, centipawnLoss, moveQuality: getMoveQuality(centipawnLoss), ...extra });
const regrade = (moves: TestMove[]) => withCurrentGrading({ moves }).moves as TestMove[];

describe('withCurrentGrading — analyses saved before grading by winning chances', () => {
  it('grades a pawn given away at +5 as good, where it was an inaccuracy', () => {
    // At +5.00, White's 2nd move drops to +4.00: saved as a 100 cp inaccuracy (the cap at +4 being 100)
    const [, , white] = regrade([mv(1, 'white', 5, 0), mv(1, 'black', 5, 0), mv(2, 'white', 4, 100)]);
    expect(white).toMatchObject({ centipawnLoss: 100, gradedLoss: 35, moveQuality: 'good' });
  });

  it('recovers a loss the old caps cut short from the evaluations either side of it', () => {
    // +6.00 → +3.50 was saved as 100 (the cap once the position after is +3)
    const [, white] = regrade([mv(1, 'black', 6, 0), mv(2, 'white', 3.5, 100)]);
    expect(white.centipawnLoss).toBe(250);
    expect(white.gradedLoss).toBe(gradedCpLoss(250, 350));
    expect(white.moveQuality).toBe('inaccuracy'); // not the "excellent" the cut-short 100 would give
  });

  it('recovers a loss cut short by the cap in a game already lost', () => {
    // From -4.00 to -9.00, saved as 100 (the cap once the position before is -3)
    const [, white] = regrade([mv(1, 'black', -4, 0), mv(2, 'white', -9, 100)]);
    expect(white.centipawnLoss).toBe(500);
    expect(white.gradedLoss).toBe(gradedCpLoss(500, -900));
  });

  it('keeps a stored loss below its cap rather than the noisier drop between two readings', () => {
    // Stored 40 at +0.20; the readings either side differ by 90, which is engine noise here
    const [, white] = regrade([mv(1, 'black', 1.1, 0), mv(2, 'white', 0.2, 40)]);
    expect(white.centipawnLoss).toBe(40);
  });

  it('reads Black’s evaluations from Black’s side', () => {
    // Black at -5.00 (White's view) drops to -4.00: from Black's side, +5 → +4
    const [, black] = regrade([mv(1, 'white', -5, 0), mv(1, 'black', -4, 100)]);
    expect(black).toMatchObject({ gradedLoss: 35, moveQuality: 'good' });
  });

  it('keeps a move that lost nothing at nothing', () => {
    const [, white] = regrade([mv(1, 'black', 6, 0), mv(2, 'white', 6, 0)]);
    expect(white).toMatchObject({ centipawnLoss: 0, gradedLoss: 0, moveQuality: 'excellent' });
  });

  it('keeps a stored loss as it is where the move before is missing', () => {
    const [white] = regrade([mv(3, 'white', 3.5, 100)]);
    expect(white.centipawnLoss).toBe(100);
    expect(white.gradedLoss).toBe(gradedCpLoss(100, 350));
  });
});

describe('withCurrentGrading — analyses saved since', () => {
  it('takes the stored loss as it is, so grading again changes nothing', () => {
    const once = regrade([mv(1, 'black', 6, 0), mv(2, 'white', 3.5, 250, { gradedLoss: gradedCpLoss(250, 350) })]);
    expect(once[1].centipawnLoss).toBe(250);
    expect(regrade(once)).toEqual(once);
  });

  it('never second-guesses a loss saved since, even where an old cap would have applied', () => {
    // A true 100 cp loss at +3.50, the readings either side differing by 250
    const [, white] = regrade([mv(1, 'black', 6, 0), mv(2, 'white', 3.5, 100, { gradedLoss: 0 })]);
    expect(white.centipawnLoss).toBe(100);
    expect(white.gradedLoss).toBe(gradedCpLoss(100, 350));
  });

  it('grades again by the current rule whatever grade was saved', () => {
    const [, white] = regrade([mv(1, 'black', 5, 0), mv(2, 'white', 4, 100, { gradedLoss: 100, moveQuality: 'inaccuracy' })]);
    expect(white).toMatchObject({ centipawnLoss: 100, gradedLoss: 35, moveQuality: 'good' });
  });
});

describe('withCurrentGrading — what it leaves alone', () => {
  it('leaves book moves as they are', () => {
    const book = mv(1, 'white', 0.3, 0, { moveQuality: 'book' });
    expect(regrade([book])[0]).toEqual(book);
  });

  it('leaves a move without an evaluation or a loss as it is', () => {
    const noEval = { moveNumber: 1, color: 'white' as const, move: 'e4', centipawnLoss: 30, moveQuality: 'good' };
    const noLoss = { moveNumber: 1, color: 'black' as const, move: 'e5', evaluation: 0.2, moveQuality: 'good' };
    expect(regrade([noEval as TestMove, noLoss as TestMove])).toEqual([noEval, noLoss]);
  });

  it('leaves an analysis without moves, and the rest of an analysis, as they are', () => {
    const noMoves: { depth: number; moves?: unknown } = { depth: 18 };
    expect(withCurrentGrading(noMoves)).toEqual({ depth: 18 });
    expect(withCurrentGrading({ depth: 18, moves: [] })).toEqual({ depth: 18, moves: [] });
    const analysis = { gameId: 'g', depth: 18, moves: [mv(1, 'white', 0.3, 0)] };
    expect(withCurrentGrading(analysis)).toMatchObject({ gameId: 'g', depth: 18 });
  });

  it('does not change the analysis it is given', () => {
    const moves = [mv(1, 'white', 5, 0), mv(1, 'black', 5, 0), mv(2, 'white', 4, 100)];
    const before = JSON.stringify(moves);
    regrade(moves);
    expect(JSON.stringify(moves)).toBe(before);
  });
});

describe('the grade counts the graded loss', () => {
  const moves = [
    { color: 'white', centipawnLoss: 100, gradedLoss: 35, moveQuality: 'good' },
    { color: 'white', centipawnLoss: 0, gradedLoss: 0, moveQuality: 'excellent' },
  ];

  it('in the accuracy', () => {
    expect(accuracyFromMoves(moves, 'white')).toBe(calculateAccuracy([35, 0]));
  });

  it('in the average loss of the engine review', () => {
    expect(summarizeAnalysis({ moves })?.white.averageCentipawnLoss).toBe(18);
  });

  it('in the post-game summary’s statistics', () => {
    expect(computeStatistics({ whitePlayer: 'me', moves }, 'me')?.averageCentipawnLoss).toBe(18);
  });

  it('and in the plain loss where a move has no graded one', () => {
    expect(accuracyFromMoves([{ color: 'white', centipawnLoss: 100 }], 'white')).toBe(calculateAccuracy([100]));
  });
});
