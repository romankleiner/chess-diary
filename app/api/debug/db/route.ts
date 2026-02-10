import { NextResponse } from 'next/server';
import getDb from '@/lib/db';

export async function GET() {
  // Only allow in development
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 404 });
  }
  
  try {
    const db = await getDb();
    
    return NextResponse.json({
      gamesCount: Object.keys(db.games || {}).length,
      analysesCount: Object.keys(db.game_analyses || {}).length,
      games: Object.entries(db.games || {}).map(([id, game]: [string, any]) => ({
        id,
        opponent: game.opponent,
        date: game.date,
        analysisCompleted: game.analysisCompleted,
        hasAnalysisData: !!db.game_analyses?.[id]
      })),
      analysisIds: db.game_analyses ? Object.keys(db.game_analyses) : []
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
