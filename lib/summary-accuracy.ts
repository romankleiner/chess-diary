/**
 * Keeping the accuracy on a saved post-game summary in step with the analysis.
 *
 * A post-game summary copies the player's accuracy into its statistics when it
 * is written. The analysis's accuracy is derived from its moves and so follows
 * the current formula (see withCurrentAccuracy), which leaves older summaries
 * showing a different figure for the same game, from the formula in use then.
 * So where summaries are read, the saved figure is replaced by the analysis's
 * current one. Nothing is written back. Pure, apart from the loader it is given.
 *
 * The summary is about the author's own play, so it takes the side the
 * opponent did not play, read from the game snapshot saved with the summary.
 */

export interface GameSnapshotLike {
  opponent?: unknown;
  white?: unknown;
  black?: unknown;
}

/** The side the player was on: whichever of white/black the opponent was not. */
export function playerColorFromSnapshot(snapshot: GameSnapshotLike | null | undefined): 'white' | 'black' | null {
  if (!snapshot) return null;
  const name = (value: unknown) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
  const opponent = name(snapshot.opponent);
  if (!opponent) return null;

  const white = name(snapshot.white);
  const black = name(snapshot.black);
  if (opponent === white && opponent !== black) return 'black';
  if (opponent === black && opponent !== white) return 'white';
  return null;
}

/** A journal entry, as far as refreshing a summary's accuracy needs it. */
export interface SummaryEntryLike {
  gameId?: string | null;
  entryType?: string;
  gameSnapshot?: GameSnapshotLike | null;
  postGameSummary?: { statistics?: Record<string, unknown> | null } | null;
}

interface AnalysisAccuracy {
  whiteAccuracy?: unknown;
  blackAccuracy?: unknown;
}

const hasSavedAccuracy = (entry: SummaryEntryLike): boolean =>
  entry.entryType === 'post_game_summary'
  && !!entry.gameId
  && typeof entry.postGameSummary?.statistics?.accuracy === 'number';

/**
 * Replace the accuracy saved on each post-game summary with the analysis's
 * current one for the player's side. Only a summary that has an accuracy is
 * touched, and one whose side or analysis can't be determined keeps what it has.
 * Each game is loaded once; a game that can't be loaded costs only its own
 * summaries. Returns new entries where something changed, not altering the input.
 */
export async function refreshSummaryAccuracy<T extends SummaryEntryLike>(
  entries: T[],
  loadAnalysis: (gameId: string) => Promise<AnalysisAccuracy | null | undefined>,
): Promise<T[]> {
  const needing = entries.filter(hasSavedAccuracy);
  if (needing.length === 0) return entries;

  const analyses = new Map<string, AnalysisAccuracy | null>();
  await Promise.all(
    [...new Set(needing.map(e => e.gameId as string))].map(async gameId => {
      try {
        analyses.set(gameId, (await loadAnalysis(gameId)) ?? null);
      } catch (error) {
        console.error(`[SUMMARY-ACCURACY] Could not load analysis ${gameId}:`, error instanceof Error ? error.message : error);
        analyses.set(gameId, null);
      }
    }),
  );

  return entries.map(entry => {
    if (!hasSavedAccuracy(entry)) return entry;

    const color = playerColorFromSnapshot(entry.gameSnapshot);
    const analysis = analyses.get(entry.gameId as string);
    const current = color && analysis ? analysis[`${color}Accuracy`] : undefined;
    if (typeof current !== 'number' || !Number.isFinite(current)) return entry;

    return {
      ...entry,
      postGameSummary: {
        ...entry.postGameSummary,
        statistics: { ...entry.postGameSummary?.statistics, accuracy: current },
      },
    };
  });
}
