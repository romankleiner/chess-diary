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

    // Get cached image URL from blob storage (or generate and cache)
    const imageUrl = await getCachedBoardImage(fen, pov);
    
    // Redirect to the blob storage URL
    return NextResponse.redirect(imageUrl);

  } catch (error) {
    console.error('[BOARD-IMAGE] Error:', error);
    
    // Fallback: return error or generate on-the-fly without caching
    const { searchParams } = new URL(request.url);
    const fen = searchParams.get('fen');
    const pov = searchParams.get('pov') || 'white';
    
    // Direct link to chess-api.com as fallback
    const fallbackUrl = `https://chess-api.com/v1/render/board/${encodeURIComponent(fen || '')}?size=400&perspective=${pov}`;
    
    return NextResponse.redirect(fallbackUrl);
  }
}
