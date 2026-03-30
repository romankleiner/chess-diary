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
