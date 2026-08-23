import { NextResponse } from 'next/server';
import { getJournal } from '@/lib/db';

// Lightweight projection for callers that only need to know which games have
// entries / summaries (e.g. the games list page). The full journal payload
// carries inline base64 images and can be multi-MB — big enough to time out
// on slow networks.
export async function GET() {
  try {
    const entries = await getJournal();
    const projected = entries
      .filter((e: any) => e.gameId)
      .map((e: any) => ({ gameId: e.gameId, entryType: e.entryType }));
    return NextResponse.json({ entries: projected });
  } catch (error) {
    console.error('Error fetching journal summary:', error);
    return NextResponse.json({ error: 'Failed to fetch journal summary' }, { status: 500 });
  }
}
