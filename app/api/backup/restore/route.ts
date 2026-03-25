import { NextRequest, NextResponse } from 'next/server';
import getDb, { saveDb } from '@/lib/db';
import { isAdmin } from '@/lib/admin';

export async function POST(request: NextRequest) {
  try {
    const { isAdmin: admin } = await isAdmin();
    if (!admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const backup = await request.json();
    
    // Validate backup format
    if (!backup.version || !backup.data) {
      return NextResponse.json(
        { error: 'Invalid backup format' },
        { status: 400 }
      );
    }
    
    const db = await getDb();
    
    // Restore data (merge or replace based on preference)
    // For safety, we'll merge and keep newer data
    if (backup.data.settings) {
      db.settings = { ...db.settings, ...backup.data.settings };
    }
    
    if (backup.data.journal_entries) {
      // Merge entries, avoiding duplicates by ID
      const existingIds = new Set(db.journal_entries.map(e => e.id));
      const newEntries = backup.data.journal_entries.filter((e: any) => !existingIds.has(e.id));
      db.journal_entries = [...db.journal_entries, ...newEntries];
    }
    
    if (backup.data.games) {
      // Merge games (games is a Record/object, not an array)
      db.games = { ...db.games, ...backup.data.games };
    }
    
    await saveDb(db);
    
    return NextResponse.json({ 
      success: true,
      message: 'Backup restored successfully',
      stats: {
        entries: backup.data.journal_entries?.length || 0,
        games: Object.keys(backup.data.games || {}).length
      }
    });
  } catch (error) {
    console.error('Error restoring backup:', error);
    return NextResponse.json(
      { error: 'Failed to restore backup' },
      { status: 500 }
    );
  }
}