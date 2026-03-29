import { NextRequest, NextResponse } from 'next/server';
import { getSetting, saveGame, saveJournalEntry } from '@/lib/db';

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

    // Get username from settings
    const username = await getSetting('chesscom_username');
    
    if (!username) {
      return NextResponse.json({ error: 'Chess.com username not configured' }, { status: 400 });
    }

    // Game URL format: https://www.chess.com/game/daily/123456789
    const gameId = gameUrl.split('/').pop();
    
    if (!gameId) {
      return NextResponse.json({ error: 'Invalid game URL' }, { status: 400 });
    }
    
    const today = new Date().toISOString().split('T')[0];
    
    const newGame = {
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
    
    const newEntry = {
      id: Date.now(),
      date: today,
      gameId,
      entryType: 'game_start',
      content: `Started tracking game: ${gameUrl}`,
      moveNumber: null,
      moveNotation: null,
      timestamp: new Date().toISOString()
    };
    
    await Promise.all([
      saveGame(gameId, newGame),
      saveJournalEntry(newEntry),
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
