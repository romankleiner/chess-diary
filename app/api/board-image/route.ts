import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { findCachedBoardImage, generateBoardImage } from '@/lib/board-image-storage';
import { chessvisionUrl, parseBoardImageRequest } from '@/lib/board-image-request';
import { createRateLimiter } from '@/lib/rate-limit';
import { clientIp } from '@/lib/access-log';

// GET /api/board-image?fen=<FEN>&pov=<white|black>
// A board diagram, by redirect to the stored image. Public: the blog's copied HTML
// embeds these addresses, so readers elsewhere load them without signing in. So:
//   - the position is checked to be a real one, and the side to be white or black;
//   - only the signed-in author's requests make new images (a fetch from the image
//     service and a write to the store). Anyone else gets a stored image if there
//     is one, or else is sent to the image service itself, which their browser
//     fetches from -- never a new image on this account;
//   - anonymous requests are rate limited, and a stored image's redirect is cached
//     at the CDN, so repeat views of a page cost nothing here.

const limiter = createRateLimiter({ limit: 120, windowMs: 60_000 });

/** A stored image's address never changes for a position (the store keeps images 90 days). */
const STORED = { 'Cache-Control': 'public, max-age=3600, s-maxage=3600' };
/** Anything else must not be cached: the author's next request should make the real image. */
const NOT_STORED = { 'Cache-Control': 'no-store' };

const redirectTo = (url: string, headers: Record<string, string>) => {
  const response = NextResponse.redirect(url);
  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  return response;
};

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const board = parseBoardImageRequest(searchParams.get('fen'), searchParams.get('pov'));
  if ('error' in board) {
    return NextResponse.json({ error: board.error }, { status: 400, headers: NOT_STORED });
  }

  const { userId } = await auth();
  if (!userId) {
    const gate = limiter.check(clientIp(request.headers) ?? 'unknown');
    if (!gate.allowed) {
      return NextResponse.json(
        { error: 'Too many board images in a short time — try again in a moment.' },
        { status: 429, headers: { ...NOT_STORED, 'Retry-After': String(gate.retryAfterSeconds) } },
      );
    }
  }

  try {
    const stored = await findCachedBoardImage(board);
    if (stored) return redirectTo(stored, STORED);
    if (!userId) return redirectTo(chessvisionUrl(board), NOT_STORED);
    return redirectTo(await generateBoardImage(board), STORED);
  } catch (error) {
    console.error('[BOARD-IMAGE] Error:', error instanceof Error ? error.message : error);
    return redirectTo(chessvisionUrl(board), NOT_STORED);
  }
}
