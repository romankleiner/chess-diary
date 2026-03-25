import { NextRequest, NextResponse } from 'next/server';
import { getJournal, saveJournal } from '@/lib/db';

// POST /api/debug/migrate-images - Convert legacy single images to arrays
// PROTECTED: Only accessible in development mode
export async function POST(request: NextRequest) {
  // Security check: only allow in development mode
  if (process.env.NODE_ENV === 'production' && process.env.VERCEL_ENV) {
    return NextResponse.json(
      { error: 'Debug endpoints are disabled in production' },
      { status: 403 }
    );
  }
  
  try {
    const journalEntries = await getJournal();
    
    let migratedCount = 0;
    const migrated: number[] = [];
    
    // Convert single image field to images array
    for (const entry of journalEntries) {
      if (entry.image) {
        if (!entry.images) {
          // No images array yet - create it with the single image
          entry.images = [entry.image];
          delete entry.image;
          migratedCount++;
          migrated.push(entry.id);
          console.log(`[MIGRATE] Converted entry ${entry.id} from image to images array`);
        } else if (!entry.images.includes(entry.image)) {
          // Has images array but doesn't include the old image - add it
          entry.images.unshift(entry.image); // Add to beginning
          delete entry.image;
          migratedCount++;
          migrated.push(entry.id);
          console.log(`[MIGRATE] Added legacy image to existing images array for entry ${entry.id}`);
        } else {
          // Image already in array - just delete old field
          delete entry.image;
          console.log(`[MIGRATE] Removed redundant image field from entry ${entry.id}`);
        }
      }
    }
    
    if (migratedCount > 0 || migrated.length > 0) {
      console.log(`[MIGRATE] Saving ${migratedCount} migrated entries...`);
      await saveJournal(journalEntries);
      console.log('[MIGRATE] Migration complete');
    }
    
    return NextResponse.json({
      success: true,
      migratedCount,
      migratedEntries: migrated,
      message: `Migrated ${migratedCount} entry/entries to multi-image format`
    });
  } catch (error) {
    console.error('[MIGRATE] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to migrate images' },
      { status: 500 }
    );
  }
}