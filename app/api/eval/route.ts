import { NextRequest, NextResponse } from 'next/server';
import { Chess } from 'chess.js';
import { getPositionEval } from '@/lib/position-eval-server';
import { createRateLimiter } from '@/lib/rate-limit';

// GET /api/eval?fen=<FEN>&depth=<6-18>
// Engine evaluation of one position, used by the public blog to rate a reader's
// guess. Public (readers aren't signed in), so it is validated, cached, and rate
// limited -- every miss spends a third party's free engine API.

const DEFAULT_DEPTH = 12;
const MIN_DEPTH = 6;
const MAX_DEPTH = 18;
const MAX_FEN_LENGTH = 100;

const limiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

export async function GET(request: NextRequest) {
  const caller = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const gate = limiter.check(caller);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'Too many evaluations in a short time — try again in a moment.' },
      { status: 429, headers: { 'Retry-After': String(gate.retryAfterSeconds), 'Cache-Control': 'no-store' } }
    );
  }

  const { searchParams } = request.nextUrl;
  const fen = searchParams.get('fen')?.trim() ?? '';
  if (!fen || fen.length > MAX_FEN_LENGTH) {
    return NextResponse.json({ error: 'A valid fen is required' }, { status: 400 });
  }
  try {
    new Chess(fen);
  } catch {
    return NextResponse.json({ error: 'That is not a valid position' }, { status: 400 });
  }

  const requested = parseInt(searchParams.get('depth') ?? '', 10);
  const depth = Number.isFinite(requested) ? Math.min(MAX_DEPTH, Math.max(MIN_DEPTH, requested)) : DEFAULT_DEPTH;

  try {
    const result = await getPositionEval(fen, depth);
    // An evaluation never changes for a given position and depth, so let the CDN keep it.
    return NextResponse.json(result, { headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400' } });
  } catch (error) {
    console.error('[EVAL] Could not evaluate position:', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: 'Could not evaluate that position right now.' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
