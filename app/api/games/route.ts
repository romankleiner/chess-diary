import { NextRequest, NextResponse } from 'next/server';
import getDb from '@/lib/db';

// GET /api/games - List all games
export async function GET(request: NextRequest) {
  try {
    const db = await getDb();
    
    // Convert games object to array and derive analysisCompleted from actual data
    const games = Object.values(db.games || {}).map((game: any) => ({
      ...game,
      // Derive the flag from actual analysis data existence
      analysisCompleted: !!(db.game_analyses && db.game_analyses[game.id]),
      // Include analysis metadata if it exists
      analysisDepth: db.game_analyses?.[game.id]?.depth,
      analysisEngine: db.game_analyses?.[game.id]?.engine,
    }));
    
    // Sort by date descending
    games.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    return NextResponse.json({ games });
  } catch (error) {
    console.error('Error loading games:', error);
    return NextResponse.json(
      { error: 'Failed to load games' },
      { status: 500 }
    );
  }
}