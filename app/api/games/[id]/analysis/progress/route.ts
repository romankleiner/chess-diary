import { NextRequest, NextResponse } from 'next/server';

// In-memory progress tracking (will be lost on server restart, but that's okay)
const analysisProgress: Record<string, { current: number; total: number }> = {};

export function setProgress(gameId: string, current: number, total: number) {
  analysisProgress[gameId] = { current, total };
}

export function clearProgress(gameId: string) {
  delete analysisProgress[gameId];
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: gameId } = await params;
    
    if (analysisProgress[gameId]) {
      return NextResponse.json({
        progress: analysisProgress[gameId],
      });
    }
    
    return NextResponse.json({ progress: null });
  } catch (error) {
    console.error('Error fetching progress:', error);
    return NextResponse.json({ progress: null });
  }
}
