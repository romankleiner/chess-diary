import { NextRequest, NextResponse } from 'next/server';
import { fetchPlayerGames, fetchActiveGames, parseChessComGame } from '@/lib/chesscom';
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
    
    let allGames: any[] = [];
    
    // Fetch archived games for the specified month
    try {
      const archivedData = await fetchPlayerGames(username, year, month);
      if (archivedData.games) {
        allGames = allGames.concat(archivedData.games);
      }
    } catch (error) {
      // No archived games for this period
    }
    
    // Also fetch active/ongoing games
    try {
      const activeData = await fetchActiveGames(username);
      if (activeData.games) {
        allGames = allGames.concat(activeData.games);
      }
    } catch (error) {
      // No active games found
    }
    
    // Parse and store games
    const games = allGames
      .map((game: any) => parseChessComGame(game, username))
      .filter((game: any) => game !== null);
    
    // Remove duplicates by game ID
    const uniqueGames = Array.from(
      new Map(games.map(game => [game.id, game])).values()
    );
    
    // Store in database
    for (const game of uniqueGames) {
      db.games[game.id] = {
        ...game,
        analysisCompleted: game.analysisCompleted || false
      };
    }
    
    saveDb(db);
    
    return NextResponse.json({ 
      success: true, 
      count: uniqueGames.length, 
      games: uniqueGames 
    });
  } catch (error) {
    console.error('Error fetching games:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch games' },
      { status: 500 }
    );
  }
}
