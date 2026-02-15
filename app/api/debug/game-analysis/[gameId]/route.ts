import { NextRequest, NextResponse } from 'next/server';
import getDb from '@/lib/db-redis';

// GET /api/debug/game-analysis/[gameId] - Check analysis data for a specific game
// PROTECTED: Only accessible in development or to authenticated users
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ gameId: string }> }
) {
  // Security check: only allow in development mode
  if (process.env.NODE_ENV === 'production' && process.env.VERCEL_ENV) {
    return NextResponse.json(
      { error: 'Debug endpoints are disabled in production' },
      { status: 403 }
    );
  }
  
  try {
    const { gameId } = await params;
    const db = await getDb();
    
    const game = db.games?.[gameId];
    const analysis = db.game_analyses?.[gameId];
    
    return NextResponse.json({
      gameId,
      gameExists: !!game,
      analysisExists: !!analysis,
      game: game ? {
        id: game.id,
        white: game.white,
        black: game.black,
        analysisCompleted: game.analysisCompleted,
      } : null,
      analysis: analysis ? {
        analyzedAt: analysis.analyzedAt,
        depth: analysis.depth,
        engine: analysis.engine,
        whiteAccuracy: analysis.whiteAccuracy,
        blackAccuracy: analysis.blackAccuracy,
        moveCount: analysis.moves?.length,
      } : null,
      rawAnalysis: analysis, // Full raw data
    });
  } catch (error) {
    console.error('[DEBUG] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to check analysis' },
      { status: 500 }
    );
  }
}