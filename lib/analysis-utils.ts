/**
 * Pure analysis utility functions — no I/O, no framework deps.
 * Extracted from route files so they can be unit-tested without mocks.
 */

/**
 * Calculate accuracy from an array of centipawn losses.
 * Uses the same win-percentage formula as chess.com.
 * Returns a value in [0, 100] rounded to 1 decimal place.
 */
export function calculateAccuracy(centipawnLosses: number[]): number {
  if (centipawnLosses.length === 0) return 100;

  let totalAccuracy = 0;

  for (const loss of centipawnLosses) {
    const winPercentageLost = 50 * (2 / (1 + Math.exp(0.00368208 * loss)) - 1);
    const moveAccuracy = 100 - Math.abs(winPercentageLost);
    totalAccuracy += moveAccuracy;
  }

  const accuracy = totalAccuracy / centipawnLosses.length;
  return Math.max(0, Math.min(100, Math.round(accuracy * 10) / 10));
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
