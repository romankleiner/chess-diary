import { NextRequest, NextResponse } from 'next/server';
import getDb, { saveDb } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const { backupUrl } = await request.json();
    
    if (!backupUrl) {
      return NextResponse.json({ error: 'backupUrl required' }, { status: 400 });
    }
    
    console.log('[RESTORE] Fetching backup from:', backupUrl);
    
    // Fetch backup from blob storage
    const response = await fetch(backupUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch backup: ${response.statusText}`);
    }
    
    const backupData = await response.json();
    
    // Validate backup format
    if (!backupData.data || !backupData.timestamp) {
      throw new Error('Invalid backup format');
    }
    
    console.log('[RESTORE] Backup from:', backupData.timestamp);
    console.log('[RESTORE] Restoring to Redis...');
    
    // Get current database
    const db = await getDb() as any;
    
    // Replace with backup data
    db.games = backupData.data.games;
    db.journal_entries = backupData.data.journal_entries;
    db.game_analyses = backupData.data.game_analyses || {};
    db.settings = backupData.data.settings;
    
    // Save to Redis
    await saveDb(db);
    
    console.log('[RESTORE] Restore complete!');
    
    return NextResponse.json({
      success: true,
      restoredFrom: backupData.timestamp,
      stats: backupData.stats,
    });
    
  } catch (error) {
    console.error('[RESTORE] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Restore failed' },
      { status: 500 }
    );
  }
}
