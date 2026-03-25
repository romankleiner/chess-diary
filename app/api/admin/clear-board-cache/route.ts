import { NextResponse } from 'next/server';
import getDb, { saveJournal } from '@/lib/db';

// One-off route to clear ALL cached board images from journal entries,
// whether stored as base64 data URLs or Vercel Blob URLs.
// Forces fresh re-fetch from chessvision.ai on next page load.
//
// Usage: GET /api/admin/clear-board-cache
// Delete this file after running it once.

export async function GET() {
  // Security: Only allow in local development
  if (process.env.VERCEL_ENV === 'production') {
    return NextResponse.json({ error: 'Not allowed in production' }, { status: 403 });
  }

  const db = await getDb() as any;
  let cleared = 0;

  for (const entry of db.journal_entries) {
    if (!entry.fen || !Array.isArray(entry.images) || entry.images.length === 0) continue;
    const img = entry.images[0];
    if (!img) continue;

    const isBase64Board = typeof img === 'string' && img.startsWith('data:image/png;base64,');
    const isBlobBoard = typeof img === 'string' && img.includes('vercel-storage.com') && img.includes('/boards/');

    if (isBase64Board || isBlobBoard) {
      entry.images[0] = null;
      cleared++;
    }
  }

  await saveJournal(db.journal_entries);

  return NextResponse.json({
    success: true,
    cleared,
    message: `Cleared cached board images from ${cleared} entries. Delete app/api/admin/clear-board-cache/route.ts now.`
  });
}
