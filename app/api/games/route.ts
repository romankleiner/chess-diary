import { NextRequest, NextResponse } from 'next/server';
import { getGames } from '@/lib/db';

// GET /api/games - List all games
export async function GET(request: NextRequest) {
  try {
    const games = await getGames();

    // Strip the per-move analysis array (tens of KB per analyzed game); it's the
    // dominant payload cost and no list consumer renders it. Everything else —
    // pgn/fen/turn/move_by/url/timeControl — is kept because the journal page
    // uses them to render active games and filter "my turn".
    const gamesList = Object.values(games || {}).map((game: any) => {
      const { moves, ...rest } = game;
      return rest;
    });
    
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
