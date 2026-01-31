import { NextRequest, NextResponse } from 'next/server';
import getDb, { saveDb } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { gameId, moveNumber, moveNotation, thought } = body;
    
    if (!gameId || moveNumber === undefined || !moveNotation || !thought) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }
    
    const db = await getDb();
    db.run(
      `INSERT INTO diary_entries (game_id, move_number, move_notation, thought)
       VALUES (?, ?, ?, ?)`,
      [gameId, moveNumber, moveNotation, thought]
    );
    
    saveDb(db);
    
    return NextResponse.json({ 
      success: true
    });
  } catch (error) {
    console.error('Error saving diary entry:', error);
    return NextResponse.json(
      { error: 'Failed to save diary entry' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const gameId = searchParams.get('gameId');
    
    if (!gameId) {
      return NextResponse.json(
        { error: 'gameId parameter required' },
        { status: 400 }
      );
    }
    
    const db = await getDb();
    const result = db.exec(
      'SELECT * FROM diary_entries WHERE game_id = ? ORDER BY move_number ASC',
      [gameId]
    );
    
    const entries = result.length ? result[0].values.map(row => ({
      id: row[0],
      game_id: row[1],
      move_number: row[2],
      move_notation: row[3],
      thought: row[4],
      timestamp: row[5]
    })) : [];
    
    return NextResponse.json({ entries });
  } catch (error) {
    console.error('Error fetching diary entries:', error);
    return NextResponse.json(
      { error: 'Failed to fetch diary entries' },
      { status: 500 }
    );
  }
}
