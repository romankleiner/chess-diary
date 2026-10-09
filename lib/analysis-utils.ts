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
//    probability (rank correlation -0.83 against -0.64). The loss already has
//    the position built in: normalizeCpLoss caps it where a position is lopsided.
//  - Small losses cost almost nothing and large ones a great deal, hence a shape
//    steeper than a plain exponential (the exponent below is above 1).
//  - Opening-book moves count as perfect rather than being left out of the
//    average; leaving them out fitted worse.
//
// It was calibrated on analyses run at depth 15-18, so a much shallower
// analysis, whose losses are noisier, will read somewhat lower.

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
}

/** One player's accuracy from the moves of a stored analysis, or null if none has a loss. */
export function accuracyFromMoves(moves: unknown, color: 'white' | 'black'): number | null {
  if (!Array.isArray(moves)) return null;
  const losses = (moves as StoredMoveLoss[])
    .filter(move => move?.color === color && typeof move.centipawnLoss === 'number')
    .map(move => move.centipawnLoss as number);
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

/**
 * Normalise a raw centipawn loss, removing two categories of ceiling artifact
 * that arise from the ±10 000 sentinel used to represent forced mates:
 *
 * 1. "Played a slower win" — best move was a forced mate (10 000 cp sentinel)
 *    but the played move still leaves a large material advantage.  The raw
 *    delta looks enormous even though the position is objectively still winning.
 *    → cap based on how good the resulting position still is for the mover.
 *
 * 2. "Natural losing move in a lost position" — the mover was already clearly
 *    losing before their move (e.g. −1000 cp = down 10 pawns), and their move
 *    happens to allow a forced mate.  The raw delta is again huge, but the
 *    position was already effectively decided — this is not a new blunder.
 *    → cap based on how bad the position already was for the mover.
 *
 * Both cases are symmetric: the evaluation on the "stable" side of the move
 * (after for case 1, before for case 2) tells us whether the ±10 000 ceiling
 * is distorting the delta.
 *
 * @param cpLoss           Raw centipawn loss (>= 0).
 * @param playerEvalAfter  Eval after the move from the mover's perspective (positive = winning).
 * @param playerEvalBefore Eval before the move from the mover's perspective (positive = winning).
 */
export function normalizeCpLoss(
  cpLoss: number,
  playerEvalAfter: number,
  playerEvalBefore: number,
): number {
  // Case 1 — position still winning after the move (played a slower win)
  if (playerEvalAfter >= 500) return Math.min(cpLoss, 50);    // still very winning → at most "good"
  if (playerEvalAfter >= 300) return Math.min(cpLoss, 100);   // clearly winning    → at most "inaccuracy"

  // Case 2 — position already clearly lost before the move (natural losing continuation)
  if (playerEvalBefore <= -500) return Math.min(cpLoss, 50);  // already very losing → at most "good"
  if (playerEvalBefore <= -300) return Math.min(cpLoss, 100); // clearly losing      → at most "inaccuracy"

  // Global ceiling: prevents the ±10 000 sentinel from inflating any move
  // beyond firmly-blunder territory even in edge cases not covered above.
  return Math.min(cpLoss, 600);
}

/**
 * Classify a move's quality based on centipawn loss.
 */
export function getMoveQuality(cpLoss: number): string {
  if (cpLoss <= 25) return 'excellent';
  if (cpLoss <= 50) return 'good';
  if (cpLoss <= 100) return 'inaccuracy';
  if (cpLoss <= 200) return 'mistake';
  return 'blunder';
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
      if (quality !== 'book' && typeof move.centipawnLoss === 'number') {
        lossTotal += move.centipawnLoss;
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

    if (typeof move.centipawnLoss === 'number') {
      totalCentipawnLoss += move.centipawnLoss;
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
