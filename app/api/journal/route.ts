import { NextRequest, NextResponse } from 'next/server';
import getDb, { saveDb } from '@/lib/db';

// Get journal entries for a specific date, date range, or game
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const date = searchParams.get('date');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const gameId = searchParams.get('gameId');
    
    const db = await getDb();
    let entries = db.journal_entries;
    
    // Filter by date or date range
    if (date) {
      // Single date query (legacy support)
      entries = entries.filter(e => e.date === date);
    } else if (startDate && endDate) {
      // Date range query
      entries = entries.filter(e => e.date >= startDate && e.date <= endDate);
    } else if (startDate) {
      // From startDate onwards
      entries = entries.filter(e => e.date >= startDate);
    } else if (endDate) {
      // Up to endDate
      entries = entries.filter(e => e.date <= endDate);
    }
    
    // Filter by game ID if specified
    if (gameId && gameId !== 'all') {
      if (gameId === 'general') {
        entries = entries.filter(e => !e.gameId);
      } else {
        entries = entries.filter(e => e.gameId === gameId);
      }
    }
    
    // Sort by timestamp
    entries = entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    
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
    const { date, gameId, entryType, content, moveNumber, moveNotation, fen, myMove, image } = body;
    
    if (!date || !entryType || !content) {
      return NextResponse.json(
        { error: 'Missing required fields: date, entryType, content' },
        { status: 400 }
      );
    }
    
    const db = await getDb();
    
    // Generate ID based on max existing ID, not array length (to avoid duplicates after deletions)
    const maxId = db.journal_entries.length > 0 
      ? Math.max(...db.journal_entries.map(e => e.id))
      : 0;
    
    const entry = {
      id: maxId + 1,
      date,
      gameId: gameId || null,
      entryType,
      content,
      moveNumber: moveNumber || null,
      moveNotation: moveNotation || null,
      timestamp: new Date().toISOString(),
      fen: fen || null,
      myMove: myMove || null,
      image: image || null
    };
    
    db.journal_entries.push(entry);
    await saveDb(db);
    
    return NextResponse.json({ success: true, entry });
  } catch (error) {
    console.error('Error saving journal entry:', error);
    return NextResponse.json(
      { error: 'Failed to save journal entry' },
      { status: 500 }
    );
  }
}