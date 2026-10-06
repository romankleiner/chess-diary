import { NextRequest, NextResponse } from 'next/server';
import { getJournal, saveJournalEntry, deleteJournalEntry, getGame, getAnalysis } from '@/lib/db';
import { getLocalTimestamp, filterEntriesByDate } from '@/lib/timestamps';
import { addMissingReviewEvals } from '@/lib/review-eval';
import type { JournalEntryLike } from '@/lib/review-eval';
import { refreshSummaryAccuracy } from '@/lib/summary-accuracy';
import type { SummaryEntryLike } from '@/lib/summary-accuracy';

// Two things shown with a journal entry are worked out from the game's analysis rather
// than trusted from what was saved with the entry, since the saved copy goes stale:
//  - a post-game review's engine eval (often missing: the game wasn't analysed yet when
//    the review was written, or the review was edited since), and
//  - the accuracy on a post-game summary (a snapshot, taken under whatever formula was
//    in use when it was written).
// Nothing is written back, only the games that entries on this page need are read (each
// once), and a failure here must never cost the reader their journal, so on any error
// the entries are returned as stored.
type LoadedGame = {
  pgn?: string | null;
  analysis: { moves?: unknown; whiteAccuracy?: unknown; blackAccuracy?: unknown } | null;
};

async function withDerivedFields<T extends JournalEntryLike & SummaryEntryLike>(entries: T[]): Promise<T[]> {
  const games = new Map<string, Promise<LoadedGame | null>>();
  const loadGame = (gameId: string) => {
    if (!games.has(gameId)) {
      games.set(gameId, (async () => {
        const [game, analysis] = await Promise.all([getGame(gameId), getAnalysis(gameId)]);
        return game || analysis ? { pgn: game?.pgn, analysis } : null;
      })());
    }
    return games.get(gameId)!;
  };

  let result = entries;
  try {
    result = await addMissingReviewEvals(result, loadGame);
  } catch (error) {
    console.error('[JOURNAL] Could not add review evals:', error instanceof Error ? error.message : error);
  }
  try {
    result = await refreshSummaryAccuracy(result, async gameId => (await loadGame(gameId))?.analysis ?? null);
  } catch (error) {
    console.error('[JOURNAL] Could not refresh summary accuracy:', error instanceof Error ? error.message : error);
  }
  return result;
}

export async function GET(request: NextRequest) {
  try {
    const entries = await getJournal();

    const { searchParams } = new URL(request.url);
    const gameId = searchParams.get('gameId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    // A gameId filter is inherently all-time — filtering server-side avoids
    // shipping the full journal (with inline base64 images) just to render a
    // handful of entries for one game.
    const filteredEntries = gameId
      ? entries.filter((e: any) => e.gameId === gameId)
      : filterEntriesByDate(entries, startDate, endDate);

    return NextResponse.json({ entries: await withDerivedFields(filteredEntries) });
  } catch (error) {
    console.error('Error fetching journal entries:', error);
    return NextResponse.json(
      { error: 'Failed to fetch entries' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const newEntry = {
      id: Date.now(),
      timestamp: getLocalTimestamp(),
      ...body,
    };
    
    await saveJournalEntry(newEntry);
    
    return NextResponse.json({ entry: newEntry });
  } catch (error) {
    console.error('Error creating journal entry:', error);
    return NextResponse.json(
      { error: 'Failed to create entry' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json(
        { error: 'Entry ID required' },
        { status: 400 }
      );
    }
    
    const entryId = parseInt(id);
    
    await deleteJournalEntry(entryId);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting journal entry:', error);
    return NextResponse.json(
      { error: 'Failed to delete entry' },
      { status: 500 }
    );
  }
}
