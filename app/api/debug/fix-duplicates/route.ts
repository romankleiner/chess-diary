import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getJournal, saveJournal } from '@/lib/db';

export async function POST(request: NextRequest) {
  // Only allow in development
  if (process.env.NODE_ENV === 'production' && process.env.VERCEL_ENV) {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 });
  }

  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const journalEntries = await getJournal(userId);
    
    // Find duplicate entry IDs
    const idCounts: Record<number, number> = {};
    journalEntries.forEach(entry => {
      idCounts[entry.id] = (idCounts[entry.id] || 0) + 1;
    });
    
    const duplicateIds = Object.entries(idCounts)
      .filter(([_, count]) => count > 1)
      .map(([id, count]) => ({ id: parseInt(id), count }));
    
    if (duplicateIds.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No duplicate entries found',
        duplicates: []
      });
    }
    
    console.log('[FIX-DUPLICATES] Found duplicates:', duplicateIds);
    
    // For each duplicate ID, keep only the first occurrence
    const seen = new Set<number>();
    const fixedEntries = journalEntries.filter(entry => {
      if (seen.has(entry.id)) {
        console.log(`[FIX-DUPLICATES] Removing duplicate entry ${entry.id}`);
        return false; // Remove duplicate
      }
      seen.add(entry.id);
      return true; // Keep first occurrence
    });
    
    const removedCount = journalEntries.length - fixedEntries.length;
    
    await saveJournal(fixedEntries, userId);
    
    return NextResponse.json({
      success: true,
      message: `Fixed ${removedCount} duplicate entries`,
      duplicates: duplicateIds,
      removedCount
    });
    
  } catch (error) {
    console.error('[FIX-DUPLICATES] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fix duplicates' },
      { status: 500 }
    );
  }
}
