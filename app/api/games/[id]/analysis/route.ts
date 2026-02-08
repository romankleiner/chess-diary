import { NextRequest, NextResponse } from 'next/server';
import getDb from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: gameId } = await params;
    const db = await getDb();
    
    if (!db.game_analyses || !db.game_analyses[gameId]) {
      return NextResponse.json(
        { error: 'Analysis not found for this game' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      analysis: db.game_analyses[gameId],
    });
  } catch (error) {
    console.error('Error fetching analysis:', error);
    return NextResponse.json(
      { error: 'Failed to fetch analysis' },
      { status: 500 }
    );
  }
}