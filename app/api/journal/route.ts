import { NextRequest, NextResponse } from 'next/server';
import { getJournal, saveJournalEntry, deleteJournalEntry } from '@/lib/db';

// Helper function to get current time in local timezone
function getLocalTimestamp(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  const localTime = new Date(now.getTime() - offset);
  return localTime.toISOString().slice(0, -1); // Remove 'Z'
}

export async function GET(request: NextRequest) {
  try {
    const entries = await getJournal();
    
    // Get date filters from query params
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    
    let filteredEntries = entries;
    
    if (startDate && endDate) {
      filteredEntries = entries.filter((entry: any) => {
        return entry.date >= startDate && entry.date <= endDate;
      });
    }
    
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
