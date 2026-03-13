import { NextRequest, NextResponse } from 'next/server';
import { put, list, del } from '@vercel/blob';
import Redis from 'ioredis';

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
    
    // Connect to Redis directly
    if (!process.env.REDIS_URL) {
      throw new Error('REDIS_URL not configured');
    }
    
    const redis = new Redis(process.env.REDIS_URL);
    
    // Get all keys in Redis
    const allKeys = await redis.keys('chess-diary:*');
    console.log(`[BACKUP] Found ${allKeys.length} keys in Redis`);
    
    // Fetch all data from Redis
    const allData: Record<string, any> = {};
    
    for (const key of allKeys) {
      const value = await redis.get(key);
      if (value) {
        try {
          allData[key] = JSON.parse(value);
        } catch (error) {
          // If not JSON, store as string
          allData[key] = value;
        }
      }
    }
    
    // Count stats
    let totalUsers = 0;
    let totalGames = 0;
    let totalJournalEntries = 0;
    let totalAnalyses = 0;
    
    // Count from individual user keys
    const userKeys = allKeys.filter(k => k.match(/^chess-diary:user_[^:]+:games$/));
    totalUsers = userKeys.length;
    
    for (const key of allKeys) {
      if (key.includes(':games')) {
        const games = allData[key];
        if (games && typeof games === 'object') {
          totalGames += Object.keys(games).length;
        }
      }
      if (key.includes(':journal')) {
        const entries = allData[key];
        if (Array.isArray(entries)) {
          totalJournalEntries += entries.length;
        }
      }
      if (key.includes(':analyses')) {
        const analyses = allData[key];
        if (analyses && typeof analyses === 'object') {
          totalAnalyses += Object.keys(analyses).length;
        }
      }
    }
    
    // Close Redis connection
    await redis.quit();
    
    // Create backup with timestamp
    const timestamp = new Date().toISOString();
    const backupData = {
      timestamp,
      version: '1.0',
      backupType: 'full-database',
      data: allData,
      stats: {
        totalKeys: allKeys.length,
        totalUsers,
        totalGames,
        totalJournalEntries,
        totalAnalyses,
      }
    };
    
    // Convert to JSON
    const backupJson = JSON.stringify(backupData, null, 2);
    const backupSize = backupJson.length;
    
    // Generate filename: backups/journal-2026-03-11.json
    const dateStr = timestamp.split('T')[0];
    const fileName = `backups/journal-${dateStr}.json`;
    
    console.log('[BACKUP] Uploading to blob storage:', fileName);
    
    // Upload to Vercel Blob Storage (uses store's default access level)
    const blob = await put(fileName, backupJson, {
      contentType: 'application/json',
      addRandomSuffix: false,
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
