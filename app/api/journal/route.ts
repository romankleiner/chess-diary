import { NextRequest, NextResponse } from 'next/server';
import { getJournal, saveJournalEntry, deleteJournalEntry } from '@/lib/db';
import { getLocalTimestamp, filterEntriesByDate } from '@/lib/timestamps';

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

    return NextResponse.json({ entries: filteredEntries });
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
