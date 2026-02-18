import { NextRequest, NextResponse } from 'next/server';
import getDb, { saveDb } from '@/lib/db';

// POST /api/journal - Create new journal entry
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const db = await getDb();
    
    const newEntry = {
      id: Date.now(),
      date: body.date,
      gameId: body.gameId || null,
      entryType: body.entryType,
      content: body.content,
      moveNumber: body.moveNumber || null,
      moveNotation: body.moveNotation || null,
      timestamp: new Date().toISOString(),
      fen: body.fen || null,
      myMove: body.myMove || null,
      images: body.images || null,  // Support images array
    };
    
    db.journal_entries.push(newEntry);
    await saveDb(db);
    
    return NextResponse.json({
      success: true,
      entry: newEntry
    });
  } catch (error) {
    console.error('Error creating journal entry:', error);
    return NextResponse.json(
      { error: 'Failed to create entry' },
      { status: 500 }
    );
  }
}

// GET /api/journal - Get journal entries (with optional date range and game filter)
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const gameId = searchParams.get('gameId');
    
    const db = await getDb();
    let entries = db.journal_entries || [];
    
    // Filter by date range if provided
    if (startDate && endDate) {
      entries = entries.filter(e => 
        e.date >= startDate && e.date <= endDate
      );
    }
    
    // Filter by game if provided
    if (gameId && gameId !== 'all' && gameId !== 'general') {
      entries = entries.filter(e => e.gameId === gameId);
    } else if (gameId === 'general') {
      entries = entries.filter(e => !e.gameId);
    }
    
    return NextResponse.json({ entries });
  } catch (error) {
    console.error('Error fetching journal entries:', error);
    return NextResponse.json(
      { error: 'Failed to fetch entries' },
      { status: 500 }
    );
  }
}
