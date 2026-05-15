import { NextRequest, NextResponse } from 'next/server';
import { getGames } from '@/lib/db';

// GET /api/games - List all games
export async function GET(request: NextRequest) {
  try {
    const games = await getGames();

    // analysisCompleted / analysisDepth / analysisEngine are written directly onto
    // the game object by the analyze route when analysis finishes, so no need to
    // load the full analyses hash just to derive these flags.
    const gamesList = Object.values(games || {}).map((game: any) => ({ ...game }));
    
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
