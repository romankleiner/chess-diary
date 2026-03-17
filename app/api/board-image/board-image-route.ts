import { NextRequest, NextResponse } from 'next/server';
import { getCachedBoardImage } from '@/lib/board-image-storage';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const fen = searchParams.get('fen');
    const pov = (searchParams.get('pov') || 'white') as 'white' | 'black';

    if (!fen) {
      return NextResponse.json({ error: 'Missing FEN parameter' }, { status: 400 });
    }

    const imageUrl = await getCachedBoardImage(fen, pov);
    return NextResponse.redirect(imageUrl);

  } catch (error) {
    console.error('[BOARD-IMAGE] Error:', error);
    return NextResponse.json({ error: 'Failed to generate board image' }, { status: 500 });
  }
}
