import { NextRequest, NextResponse } from 'next/server';
import { getAnalysis } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: gameId } = await params;
    const analysis = await getAnalysis(gameId);
    
    if (!analysis) {
      return NextResponse.json(
        { error: 'Analysis not found for this game' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({ analysis });
  } catch (error) {
    console.error('Error fetching analysis:', error);
    return NextResponse.json(
      { error: 'Failed to fetch analysis' },
      { status: 500 }
    );
  }
}
