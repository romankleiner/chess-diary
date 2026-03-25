import { NextRequest, NextResponse } from 'next/server';
import getDb, { saveGames, saveJournal } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { gameUrl } = body;
    
    if (!gameUrl) {
      return NextResponse.json(
        { error: 'Game URL is required' },
        { status: 400 }
      );
    }

    const db = await getDb();
    
    // Get username from settings
    const username = db.settings.chesscom_username;
    
    if (!username) {
      return NextResponse.json({ error: 'Chess.com username not configured' }, { status: 400 });
    }

    // Game URL format: https://www.chess.com/game/daily/123456789
    const gameId = gameUrl.split('/').pop();
    
    if (!gameId) {
      return NextResponse.json({ error: 'Invalid game URL' }, { status: 400 });
    }
    
    const today = new Date().toISOString().split('T')[0];
    
    // Create a game entry (will be updated when game completes)
    db.games[gameId] = {
      id: gameId,
      opponent: 'TBD',
      date: today,
      result: null,
      pgn: '',
      url: gameUrl,
      white: username,
      black: 'TBD',
      analysisCompleted: false,
      createdAt: new Date().toISOString()
    };
    
    // Add journal entry for game start
    db.journal_entries.push({
      id: db.journal_entries.length + 1,
      date: today,
      gameId,
      entryType: 'game_start',
      content: `Started tracking game: ${gameUrl}`,
      moveNumber: null,
      moveNotation: null,
      timestamp: new Date().toISOString()
    });
    
    await Promise.all([
      saveGames(db.games),
      saveJournal(db.journal_entries),
    ]);
    
    return NextResponse.json({ 
      success: true, 
      gameId,
      message: 'Game tracking started. Add your thoughts as you play!'
    });
  } catch (error) {
    console.error('Error starting game tracking:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start game tracking' },
      { status: 500 }
    );
  }
}
