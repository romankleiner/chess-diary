import { NextRequest, NextResponse } from 'next/server';
import { getJournal, saveJournalEntry, deleteJournalEntry } from '@/lib/db';
import { getLocalTimestamp, filterEntriesByDate } from '@/lib/timestamps';

export async function GET(request: NextRequest) {
  try {
    const entries = await getJournal();
    
    // Get date filters from query params
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    
    const filteredEntries = filterEntriesByDate(entries, startDate, endDate);
    
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
