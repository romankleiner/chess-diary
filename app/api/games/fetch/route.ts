import { NextRequest, NextResponse } from 'next/server';
import { fetchPlayerGames, parseChessComGame } from '@/lib/chesscom';
import getDb, { saveDb } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const year = parseInt(searchParams.get('year') || new Date().getFullYear().toString());
    const month = parseInt(searchParams.get('month') || (new Date().getMonth() + 1).toString());
    
    const db = getDb();
    
    // Get username from settings
    const username = db.settings.chesscom_username;
    
    if (!username) {
      return NextResponse.json({ error: 'Chess.com username not configured' }, { status: 400 });
    }
    
    // Fetch games from Chess.com
    const data = await fetchPlayerGames(username, year, month);
    
    // Parse and store games
    const games = data.games
      .map((game: any) => parseChessComGame(game, username))
      .filter((game: any) => game !== null);
    
    // Store in database
    for (const game of games) {
      db.games[game.id] = {
        ...game,
        analysisCompleted: game.analysisCompleted || false
      };
    }
    
    saveDb(db);
    
    return NextResponse.json({ success: true, count: games.length, games });
  } catch (error) {
    console.error('Error fetching games:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch games' },
      { status: 500 }
    );
  }
}
