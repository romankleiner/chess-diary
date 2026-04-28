import { NextRequest, NextResponse } from 'next/server';
import { getGameProgress } from '@/lib/db';

const IS_VERCEL = process.env.VERCEL === '1' || process.env.VERCEL_ENV !== undefined;

// In-memory progress store — lives in the Node.js process.
// Works perfectly in local dev (single persistent process).
// On Vercel, different lambda instances may not share this memory, so the
// GET handler also falls back to Redis when the in-memory entry is absent.
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
  const { id: gameId } = await params;

  try {
    // In-memory is always instant — populated by the analyze route in the same process.
    if (analysisProgress[gameId]) {
      const { current, total } = analysisProgress[gameId];
      return NextResponse.json({ current, total });
    }

    // On Vercel the analyze POST and this GET may land on different lambda instances,
    // so fall back to Redis as the shared store.
    if (IS_VERCEL) {
      const progress = await getGameProgress(gameId);
      if (progress) {
        return NextResponse.json({ current: progress.current, total: progress.total });
      }
    }

    return NextResponse.json({ current: 0, total: 0 });
  } catch (error) {
    console.error('[PROGRESS] GET error:', error);
    return NextResponse.json({ current: 0, total: 0 });
  }
}
