/**
 * Legacy endpoint — the daily cron job has moved to /api/cron/daily.
 * This redirect keeps any existing external triggers working.
 */
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const url = new URL('/api/cron/daily', request.url);
  return NextResponse.redirect(url, { status: 308 }); // 308 Permanent Redirect
}
