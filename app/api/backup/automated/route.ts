import { NextRequest, NextResponse } from 'next/server';
import getDb from '@/lib/db';
import { put, list, del } from '@vercel/blob';

// Allow up to 60 seconds for backup
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  // Security: Verify this is a legitimate cron job
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.error('[BACKUP] Unauthorized access attempt');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('[BACKUP] Starting automated backup...');
    
    // Get entire database
    const db = await getDb() as any;
    
    // Create backup with timestamp
    const timestamp = new Date().toISOString();
    const backupData = {
      timestamp,
      version: '1.0',
      data: {
        games: db.games,
        journal_entries: db.journal_entries,
        game_analyses: db.game_analyses || {},
        settings: db.settings,
      },
      stats: {
        gamesCount: Object.keys(db.games || {}).length,
        journalEntriesCount: db.journal_entries?.length || 0,
        analysesCount: Object.keys(db.game_analyses || {}).length,
      }
    };
    
    // Convert to JSON
    const backupJson = JSON.stringify(backupData, null, 2);
    const backupSize = backupJson.length;
    
    // Generate filename: backups/journal-2026-03-11.json
    const dateStr = timestamp.split('T')[0];
    const fileName = `backups/journal-${dateStr}.json`;
    
    console.log('[BACKUP] Uploading to blob storage:', fileName);
    
    // Upload to Vercel Blob Storage
    const blob = await put(fileName, backupJson, {
      access: 'public',
      contentType: 'application/json',
    });
    
    console.log('[BACKUP] Upload complete:', blob.url);
    
    // Clean up old backups (keep last 30 days)
    await cleanupOldBackups();
    
    return NextResponse.json({
      success: true,
      timestamp,
      fileName,
      url: blob.url,
      size: backupSize,
      sizeMB: (backupSize / 1024 / 1024).toFixed(2),
      stats: backupData.stats,
    });
    
  } catch (error) {
    console.error('[BACKUP] Error:', error);
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Backup failed',
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}

async function cleanupOldBackups() {
  try {
    console.log('[BACKUP] Cleaning up old backups...');
    
    // List all backups
    const { blobs } = await list({ prefix: 'backups/' });
    
    // Calculate cutoff date (30 days ago)
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    
    let deletedCount = 0;
    
    for (const blob of blobs) {
      const blobDate = new Date(blob.uploadedAt).getTime();
      
      if (blobDate < thirtyDaysAgo) {
        await del(blob.url);
        console.log('[BACKUP] Deleted old backup:', blob.pathname);
        deletedCount++;
      }
    }
    
    if (deletedCount > 0) {
      console.log(`[BACKUP] Cleaned up ${deletedCount} old backup(s)`);
    } else {
      console.log('[BACKUP] No old backups to clean up');
    }
    
  } catch (error) {
    console.error('[BACKUP] Cleanup error:', error);
    // Don't fail backup if cleanup fails
  }
}
