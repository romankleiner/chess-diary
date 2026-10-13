/**
 * Pure analysis utility functions — no I/O, no framework deps.
 * Extracted from route files so they can be unit-tested without mocks.
 */

// ─── Accuracy ─────────────────────────────────────────────────────────────────
//
// A move's accuracy falls from 100 as it gives away more centipawns, and a
// game's accuracy is the plain average over the player's moves. Chess.com's own
// formula is not published, so this one is fitted to its figures: the constants
// below were chosen on 144 sides of 72 of the author's real games that have both
// this app's analysis and the accuracy Chess.com published for them (its public
// game archive carries it). On those games it lands within 2.1 points on
// average and is unbiased overall (the old formula was 8.7 points too high on the
// same games: 98.4% where Chess.com said 89.7%). Fitted on one half of the games
// and tested on the other, the error was about 2.2 points. Three findings
// shaped it:
//
//  - Chess.com tracks the average centipawn LOSS, not the drop in win
//    probability (rank correlation -0.83 against -0.64). The loss it is given
//    now has the position built in, though: gradedCpLoss (below) counts a loss
//    for less where the game is already decided, and is the plain loss when level.
//  - Small losses cost almost nothing and large ones a great deal, hence a shape
//    steeper than a plain exponential (the exponent below is above 1).
//  - Opening-book moves count as perfect rather than being left out of the
//    average; leaving them out fitted worse.
//
// It was calibrated on analyses run at depth 15-18, so a much shallower
// analysis, whose losses are noisier, will read somewhat lower.
//
// Since then the losses it is given are graded (gradedCpLoss): a loss counts for
// less where the game was already decided. That is a deliberate departure from
// Chess.com, which does not do so: on 152 sides of 76 of the author's games the
// figure now lands within 4.5 points of Chess.com's on average, reading 3.9 points
// higher (it was 2.5 and 0.8). Refitting the two constants on graded losses gets
// no closer than 4.0, so they were left as they were.

/** Centipawns a move can lose before its accuracy has fallen to 100/e (about 37%). */
export const ACCURACY_SCALE_CP = 100;
/** Above 1: the first few centipawns are nearly free, larger losses fall away fast. */
export const ACCURACY_SHAPE = 1.3;

/** One move's accuracy, 0-100, from the centipawns it gave away. */
export function moveAccuracy(centipawnLoss: number): number {
  if (!(centipawnLoss > 0)) return 100;
  return 100 * Math.exp(-Math.pow(centipawnLoss / ACCURACY_SCALE_CP, ACCURACY_SHAPE));
}

/**
 * A game's accuracy from the centipawn loss of each of one player's moves,
 * opening-book moves included (they lose nothing). Returns a value in [0, 100]
 * rounded to 1 decimal place; 100 when there are no moves.
 */
export function calculateAccuracy(centipawnLosses: number[]): number {
  const losses = centipawnLosses.filter(Number.isFinite);
  if (losses.length === 0) return 100;

  const average = losses.reduce((sum, loss) => sum + moveAccuracy(loss), 0) / losses.length;
  return Math.max(0, Math.min(100, Math.round(average * 10) / 10));
}

interface StoredMoveLoss {
  color?: string;
  centipawnLoss?: unknown;
  gradedLoss?: unknown;
}

/** The loss a stored move is graded by: `gradedLoss` (see withCurrentGrading), else its plain loss. */
function lossGradedBy(move: StoredMoveLoss): number | null {
  if (typeof move.gradedLoss === 'number') return move.gradedLoss;
  return typeof move.centipawnLoss === 'number' ? move.centipawnLoss : null;
}

/** One player's accuracy from the moves of a stored analysis, or null if none has a loss. */
export function accuracyFromMoves(moves: unknown, color: 'white' | 'black'): number | null {
  if (!Array.isArray(moves)) return null;
  const losses = (moves as StoredMoveLoss[])
    .filter(move => move?.color === color)
    .map(lossGradedBy)
    .filter((loss): loss is number => loss !== null);
  return losses.length > 0 ? calculateAccuracy(losses) : null;
}

/**
 * The analysis with its accuracy worked out from its moves by the current
 * formula, whatever formula it was saved under. Accuracy is derived data: the
 * moves are what was measured, so a stored figure can only go stale. A side with
 * no usable moves keeps whatever was stored. Returns a copy; the input is not
 * changed.
 */
export function withCurrentAccuracy<T extends { moves?: unknown; whiteAccuracy?: unknown; blackAccuracy?: unknown }>(
  analysis: T | null | undefined,
): (T & { whiteAccuracy: unknown; blackAccuracy: unknown }) | null {
  if (!analysis) return null;
  return {
    ...analysis,
    whiteAccuracy: accuracyFromMoves(analysis.moves, 'white') ?? analysis.whiteAccuracy,
    blackAccuracy: accuracyFromMoves(analysis.moves, 'black') ?? analysis.blackAccuracy,
  };
}

// ─── Grading a move by the winning chances it gave away ───────────────────────
//
// A pawn given away costs far more in a level game than in one already won or
// lost: from +5 to +4 the game is still won, from +1 to 0.00 an advantage is
// gone. So a move is graded by the winning chances it gave away, read off the
// usual S-shaped curve from evaluation to expected score, and counted in the
// centipawns that would give away as much in a level position (dividing by the
// curve's slope at 0.00). Near equality that is the plain centipawn loss, so the
// accuracy formula above and the categories below hold there as before; the
// further the game is from level, the less a loss counts, smoothly:
//
//   +5 → +4: 35 (good)       +1 → 0.00: 98 (inaccuracy)    +3 → +1: 156 (mistake)
//   +5 → 0.00: 339 (blunder — throwing a win away still is one)
//   +8 → +6: 24 (excellent)  -5 → -6: 23 (excellent)
//
// Forced mates (stored as ±100 pawns or more) sit at the ends of the curve, so
// missing a mate while staying well ahead, or allowing one when long lost,
// counts for little. That replaces the stepped caps analyses were saved under
// before (see oldCap), which gave no relief at all to +5 → +4.

/** How steeply winning chances rise with the evaluation: the curve's k, per centipawn. */
export const WIN_CURVE_STEEPNESS = 0.005;

/** The mover's expected score, 0 to 1, where the engine has them `cp` centipawns ahead. */
export function winningChances(cp: number): number {
  return 1 / (1 + Math.exp(-WIN_CURVE_STEEPNESS * cp));
}

/**
 * A move's loss as the grade counts it: the winning chances it gave away, in the
 * centipawns that would give away as many in a level position. Rounded.
 *
 * @param rawLoss         Centipawns the move fell short of the engine's best (>= 0).
 * @param playerEvalAfter The evaluation after the move, in centipawns, from the mover's side.
 */
export function gradedCpLoss(rawLoss: number, playerEvalAfter: number): number {
  if (!(rawLoss > 0)) return 0;
  if (!Number.isFinite(playerEvalAfter)) return Math.round(rawLoss);
  const given = winningChances(playerEvalAfter + rawLoss) - winningChances(playerEvalAfter);
  return Math.round(given / (WIN_CURVE_STEEPNESS / 4));
}

/**
 * Classify a move's quality based on centipawn loss (the graded loss, see gradedCpLoss).
 */
export function getMoveQuality(cpLoss: number): string {
  if (cpLoss <= 25) return 'excellent';
  if (cpLoss <= 50) return 'good';
  if (cpLoss <= 100) return 'inaccuracy';
  if (cpLoss <= 200) return 'mistake';
  return 'blunder';
}

interface StoredGradedMove {
  moveNumber?: unknown;
  color?: unknown;
  evaluation?: unknown;
  centipawnLoss?: unknown;
  gradedLoss?: unknown;
  moveQuality?: unknown;
}

/** A move's ply (0-based) from its move number and colour, or null without a number. */
const plyOf = (move: StoredGradedMove): number | null =>
  typeof move.moveNumber === 'number' ? (move.moveNumber - 1) * 2 + (move.color === 'black' ? 1 : 0) : null;

/** A stored evaluation (pawns, White's view) in centipawns from one side's view, or null. */
const sideCp = (pawns: unknown, color: unknown): number | null =>
  typeof pawns === 'number' && Number.isFinite(pawns) ? Math.round(pawns * 100) * (color === 'black' ? -1 : 1) : null;

/**
 * The step caps on a move's loss that analyses were saved under before grading by
 * winning chances: half a pawn once the position after it was +5 (or the one before
 * it -5), a pawn at +3 (-3), and six pawns in all.
 */
function oldCap(after: number, before: number | null): number {
  if (after >= 500) return 50;
  if (after >= 300) return 100;
  if (before !== null && before <= -500) return 50;
  if (before !== null && before <= -300) return 100;
  return 600;
}

/**
 * How far a stored move fell short of the engine's best, in centipawns. Analyses
 * saved since grading by winning chances store exactly that (with `gradedLoss`
 * beside it). Older ones stored it cut by the step caps (oldCap): where a stored
 * loss is exactly at its cap the cap may have cut it, and the drop between the
 * stored evaluations before and after the move stands in, when larger. Elsewhere
 * the stored loss is kept, as the drop between two separate engine readings is
 * noisier (within 4 cp on a typical move, but over 3 pawns out on 1 in 100).
 */
function rawLossOf(move: StoredGradedMove, previous: StoredGradedMove | undefined, after: number): number | null {
  const stored = move.centipawnLoss;
  if (typeof stored !== 'number' || !Number.isFinite(stored)) return null;
  if (typeof move.gradedLoss === 'number' || stored <= 0) return Math.max(0, stored);
  const before = previous ? sideCp(previous.evaluation, move.color) : null;
  if (stored !== oldCap(after, before)) return stored;
  return before === null ? stored : Math.max(stored, before - after);
}

/**
 * The analysis with every move graded by the current rule, whenever it was saved:
 * `centipawnLoss` is how far the move fell short of the engine's best (for an
 * older analysis as near as can be told, see rawLossOf), `gradedLoss` what the
 * grade counts of it (gradedCpLoss), and `moveQuality` the category for that.
 * Like accuracy, the grade is derived from what was measured, so it is worked out
 * when an analysis is read rather than trusted from storage. Book moves, and moves
 * without an evaluation or loss, are left as they are. Returns a copy.
 */
export function withCurrentGrading<T extends { moves?: unknown }>(analysis: T): T {
  if (!Array.isArray(analysis.moves)) return analysis;
  const moves = analysis.moves as (StoredGradedMove | null)[];
  const byPly = new Map<number, StoredGradedMove>();
  for (const move of moves) {
    const ply = move && typeof move === 'object' ? plyOf(move) : null;
    if (ply !== null) byPly.set(ply, move as StoredGradedMove);
  }
  return {
    ...analysis,
    moves: moves.map(move => {
      if (!move || typeof move !== 'object' || move.moveQuality === 'book') return move;
      const ply = plyOf(move);
      const after = sideCp(move.evaluation, move.color);
      if (ply === null || after === null) return move;
      const raw = rawLossOf(move, byPly.get(ply - 1), after);
      if (raw === null) return move;
      const graded = gradedCpLoss(raw, after);
      return { ...move, centipawnLoss: raw, gradedLoss: graded, moveQuality: getMoveQuality(graded) };
    }),
  };
}

/** The move-quality categories, best to worst -- the legend on the game's analysis page. */
export const MOVE_QUALITIES = ['book', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'] as const;
export type MoveQualityKey = (typeof MOVE_QUALITIES)[number];

export interface SideSummary {
  /** Moves analysed for this side. */
  moves: number;
  accuracy: number | null;
  /** Mean centipawn loss over the non-book moves, like the accuracy figure. */
  averageCentipawnLoss: number | null;
  counts: Record<MoveQualityKey, number>;
}

export interface AnalysisSummary {
  white: SideSummary;
  black: SideSummary;
}

/** The parts of a stored analysis the summary reads; everything is optional because old analyses vary. */
interface StoredAnalysis {
  moves?: unknown;
  whiteAccuracy?: unknown;
  blackAccuracy?: unknown;
}

interface StoredMove {
  color?: string;
  moveQuality?: string;
  quality?: string;
  centipawnLoss?: unknown;
  gradedLoss?: unknown;
}

/**
 * Both players' accuracy and how many of their moves fall in each quality
 * category -- the overview shown at the end of the blog. Returns null when the
 * game has no analysed moves.
 */
export function summarizeAnalysis(analysis: StoredAnalysis | null | undefined): AnalysisSummary | null {
  if (!analysis || !Array.isArray(analysis.moves) || analysis.moves.length === 0) return null;
  const allMoves = analysis.moves as StoredMove[];

  const side = (color: 'white' | 'black'): SideSummary => {
    const counts = Object.fromEntries(MOVE_QUALITIES.map(q => [q, 0])) as Record<MoveQualityKey, number>;
    const moves = allMoves.filter(m => m?.color === color);

    let lossTotal = 0, lossCount = 0;
    for (const move of moves) {
      const quality: string = move.moveQuality || move.quality || '';
      if ((MOVE_QUALITIES as readonly string[]).includes(quality)) counts[quality as MoveQualityKey]++;
      // Book moves carry a loss of 0 and are left out of accuracy, so leave them out here too.
      // The loss the grade counts, like the accuracy beside it.
      const loss = lossGradedBy(move);
      if (quality !== 'book' && loss !== null) {
        lossTotal += loss;
        lossCount++;
      }
    }

    const accuracy = color === 'white' ? analysis.whiteAccuracy : analysis.blackAccuracy;
    return {
      moves: moves.length,
      accuracy: typeof accuracy === 'number' ? accuracy : null,
      averageCentipawnLoss: lossCount > 0 ? Math.round(lossTotal / lossCount) : null,
      counts,
    };
  };

  return { white: side('white'), black: side('black') };
}

const normSan = (s: string) => s.replace(/[+#?!]/g, '').trim().toLowerCase();

/**
 * The engine's verdict on each move of the game, in the game's order: `plies` is
 * the game's moves (as chess.js gives them), and entry i is the quality of ply i.
 * A move is found in the analysis by its move number and colour, and must be the
 * same move -- an analysis of another version of the game would colour the wrong
 * moves. A move the analysis doesn't cover (one that stopped short of the end) or
 * rates with no known category is null.
 */
export function qualitiesByPly(
  moves: unknown,
  plies: ReadonlyArray<{ san: string; color: 'w' | 'b' }>,
): (MoveQualityKey | null)[] {
  const stored = Array.isArray(moves) ? (moves as (StoredMove & { moveNumber?: unknown; move?: unknown })[]) : [];
  return plies.map((ply, i) => {
    const color = ply.color === 'w' ? 'white' : 'black';
    const hit = stored.find(m => m?.moveNumber === Math.floor(i / 2) + 1 && (!m.color || m.color === color));
    if (!hit) return null;
    if (typeof hit.move === 'string' && normSan(hit.move) !== normSan(ply.san)) return null;
    const quality = hit.moveQuality || hit.quality || '';
    return (MOVE_QUALITIES as readonly string[]).includes(quality) ? quality as MoveQualityKey : null;
  });
}

/**
 * Compute summary statistics for the user's moves in a completed game analysis.
 * Returns null if analysis data is missing.
 */
export function computeStatistics(gameAnalysis: any, username: string) {
  if (!gameAnalysis?.moves) return null;

  const userColor: 'white' | 'black' =
    gameAnalysis.whitePlayer?.toLowerCase() === username ? 'white' : 'black';

  const accuracy: number | null =
    userColor === 'white'
      ? gameAnalysis.whiteAccuracy ?? null
      : gameAnalysis.blackAccuracy ?? null;

  const userMoves: any[] = gameAnalysis.moves.filter(
    (m: any) => m.color === userColor
  );

  const totalMoves = userMoves.length;
  let blunders = 0, mistakes = 0, inaccuracies = 0;
  let totalCentipawnLoss = 0, movesWithEval = 0;

  for (const move of userMoves) {
    const quality: string = move.moveQuality || move.quality || '';
    if (quality === 'blunder') blunders++;
    else if (quality === 'mistake') mistakes++;
    else if (quality === 'inaccuracy') inaccuracies++;

    const loss = lossGradedBy(move);
    if (loss !== null) {
      totalCentipawnLoss += loss;
      movesWithEval++;
    }
  }

  const averageCentipawnLoss =
    movesWithEval > 0 ? Math.round(totalCentipawnLoss / movesWithEval) : null;

  return {
    totalMoves,
    accuracy,
    blunders,
    mistakes,
    inaccuracies,
    averageCentipawnLoss,
  };
}
