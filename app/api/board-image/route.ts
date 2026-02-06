import { NextRequest, NextResponse } from 'next/server';
import { getCachedBoardImage } from '@/lib/board-image-cache';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const fen = searchParams.get('fen');
  const pov = searchParams.get('pov') || 'white';
  
  if (!fen) {
    return NextResponse.json({ error: 'Missing FEN parameter' }, { status: 400 });
  }
  
  try {
    const buffer = await getCachedBoardImage(fen, pov as 'white' | 'black');
    
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400', // Cache in browser for 24 hours
      },
    });
  } catch (error) {
    console.error('Error fetching board image:', error);
    return NextResponse.json({ error: 'Failed to fetch board image' }, { status: 500 });
  }
}