import { NextRequest, NextResponse } from 'next/server';
import { getJournal, saveJournalEntry, deleteJournalEntry, getGame, getAnalysis } from '@/lib/db';
import { getLocalTimestamp, filterEntriesByDate } from '@/lib/timestamps';
import { addMissingReviewEvals } from '@/lib/review-eval';
import type { JournalEntryLike } from '@/lib/review-eval';

// A post-game review shows the engine's eval of the move it is about. The copy
// saved with the review is often missing (the game wasn't analysed yet when it was
// written, or it was edited since), so any review without one gets it worked out
// from the game and its analysis. Nothing is written back, only the games that
// reviews on this page need are read, and a failure here must never cost the reader
// their journal, so on any error the entries are returned as stored.
async function withReviewEvals<T extends JournalEntryLike>(entries: T[]): Promise<T[]> {
  try {
    return await addMissingReviewEvals(entries, async gameId => {
      const [game, analysis] = await Promise.all([getGame(gameId), getAnalysis(gameId)]);
      return game ? { pgn: game.pgn, analysis } : null;
    });
  } catch (error) {
    console.error('[JOURNAL] Could not add review evals:', error instanceof Error ? error.message : error);
    return entries;
  }
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

    return NextResponse.json({ entries: await withReviewEvals(filteredEntries) });
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
