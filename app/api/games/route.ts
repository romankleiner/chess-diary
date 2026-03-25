import { NextRequest, NextResponse } from 'next/server';
import { getGames, getAnalyses } from '@/lib/db';

// GET /api/games - List all games
export async function GET(request: NextRequest) {
  try {
    const [games, gameAnalyses] = await Promise.all([
      getGames(),
      getAnalyses(),
    ]);
    
    // Convert games object to array and derive analysisCompleted from actual data
    const gamesList = Object.values(games || {}).map((game: any) => ({
      ...game,
      // Derive the flag from actual analysis data existence
      analysisCompleted: !!(gameAnalyses && gameAnalyses[game.id]),
      // Include analysis metadata if it exists
      analysisDepth: gameAnalyses?.[game.id]?.depth,
      analysisEngine: gameAnalyses?.[game.id]?.engine,
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
