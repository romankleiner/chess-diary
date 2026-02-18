import { NextRequest, NextResponse } from 'next/server';
import getDb, { saveDb } from '@/lib/db';

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
    const db = await getDb();
    
    let migratedCount = 0;
    const migrated: number[] = [];
    
    // Convert single image field to images array
    for (const entry of db.journal_entries || []) {
      if (entry.image && !entry.images) {
        entry.images = [entry.image];
        delete entry.image; // Remove old field
        migratedCount++;
        migrated.push(entry.id);
        console.log(`[MIGRATE] Converted entry ${entry.id} from image to images array`);
      } else if (entry.image && entry.images) {
        // Both exist - delete old field
        delete entry.image;
        console.log(`[MIGRATE] Removed redundant image field from entry ${entry.id}`);
      }
    }
    
    if (migratedCount > 0 || migrated.length > 0) {
      console.log(`[MIGRATE] Saving ${migratedCount} migrated entries...`);
      await saveDb(db);
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
