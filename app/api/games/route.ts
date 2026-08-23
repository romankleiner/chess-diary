import { NextRequest, NextResponse } from 'next/server';
import { getGames } from '@/lib/db';

// GET /api/games - List all games
export async function GET(request: NextRequest) {
  try {
    const games = await getGames();

    // Project to summary fields only. The list page never renders pgn/moves/fen,
    // and shipping them all makes the payload big enough to time out on slow
    // (e.g. travel wifi) connections. Detail pages fetch the full game separately.
    const gamesList = Object.values(games || {}).map((game: any) => ({
      id: game.id,
      opponent: game.opponent,
      date: game.date,
      result: game.result,
      white: game.white,
      black: game.black,
      analysisCompleted: game.analysisCompleted,
      analysisDepth: game.analysisDepth,
      analysisEngine: game.analysisEngine,
    }));
    
    // Sort by date descending
    gamesList.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    return NextResponse.json({ games: gamesList });
  } catch (error) {
    console.error('Error loading games:', error);
    return NextResponse.json(
      { error: 'Failed to load games' },
      { status: 500 }
    );
  }
}
