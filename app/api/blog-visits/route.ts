import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getBlogVisits, getGamesById } from '@/lib/db';
import { asVisit } from '@/lib/access-log';
import type { BlogVisit } from '@/lib/access-log';
import { visitLoggingOn } from '@/lib/blog-visits-server';

// GET /api/blog-visits — the signed-in author's blog visit log, newest first,
// with a "white vs black" name for each game in it. Not a public route.
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  try {
    const visits = (await getBlogVisits(userId)).map(asVisit).filter((v): v is BlogVisit => v !== null);
    const gameIds = [...new Set(visits.map(v => v.gameId).filter((id): id is string => !!id))];
    const games = await getGamesById(gameIds, userId);
    const gameNames: Record<string, string> = {};
    for (const [id, game] of Object.entries(games)) gameNames[id] = `${game.white} vs ${game.black}`;
    return NextResponse.json({ visits, gameNames, recording: visitLoggingOn() });
  } catch (error) {
    console.error('[BLOG-VISITS] Error:', error);
    return NextResponse.json({ error: 'Could not read the visit log' }, { status: 500 });
  }
}
