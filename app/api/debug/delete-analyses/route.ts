import { NextRequest, NextResponse } from 'next/server';
import getDb, { saveDb } from '@/lib/db';

// POST /api/debug/delete-analyses - Delete ALL game analyses
// PROTECTED: Only accessible in development mode
export async function POST(request: NextRequest) {
  // Security check: only allow in development mode
  if (process.env.NODE_ENV === 'production' && process.env.VERCEL_ENV) {
    return NextResponse.json(
      { error: 'Debug endpoints are disabled in production' },
      { status: 403 }
    );
  }
  
  try {
    const db = await getDb();
    
    const analysisCount = Object.keys(db.game_analyses || {}).length;
    
    // Wipe all analyses
    db.game_analyses = {};
    
    // Also clear all analysisCompleted flags
    let flagsCleared = 0;
    for (const gameId in db.games) {
      if (db.games[gameId].analysisCompleted) {
        db.games[gameId].analysisCompleted = false;
        flagsCleared++;
      }
    }
    
    await saveDb(db);
    
    console.log(`[DELETE] Deleted ${analysisCount} analyses and cleared ${flagsCleared} flags`);
    
    return NextResponse.json({
      success: true,
      deletedCount: analysisCount,
      flagsCleared: flagsCleared,
      message: `Deleted ${analysisCount} analysis/analyses. You can now re-analyze your games.`
    });
  } catch (error) {
    console.error('[DELETE] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete analyses' },
      { status: 500 }
    );
  }
}