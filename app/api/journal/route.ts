import { NextRequest, NextResponse } from 'next/server';
import getDb, { saveDb } from '@/lib/db';

// Get journal entries for a specific date
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0];
    
    const db = getDb();
    const entries = db.journal_entries.filter(e => e.date === date)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    
    return NextResponse.json({ entries });
  } catch (error) {
    console.error('Error fetching journal entries:', error);
    return NextResponse.json(
      { error: 'Failed to fetch journal entries' },
      { status: 500 }
    );
  }
}

// Add a new journal entry
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date, gameId, entryType, content, moveNumber, moveNotation } = body;
    
    if (!date || !entryType || !content) {
      return NextResponse.json(
        { error: 'Missing required fields: date, entryType, content' },
        { status: 400 }
      );
    }
    
    const db = getDb();
    const entry = {
      id: db.journal_entries.length + 1,
      date,
      gameId: gameId || null,
      entryType,
      content,
      moveNumber: moveNumber || null,
      moveNotation: moveNotation || null,
      timestamp: new Date().toISOString()
    };
    
    db.journal_entries.push(entry);
    saveDb(db);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving journal entry:', error);
    return NextResponse.json(
      { error: 'Failed to save journal entry' },
      { status: 500 }
    );
  }
}
