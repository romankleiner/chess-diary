import { NextRequest, NextResponse } from 'next/server';
import Redis from 'ioredis';
import { isAdmin } from '@/lib/admin';

export async function POST(request: NextRequest) {
  try {
    const { isAdmin: admin } = await isAdmin();
    if (!admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

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
    console.log('[RESTORE] Backup type:', backupData.backupType || 'legacy');
    console.log('[RESTORE] Restoring to Redis...');
    
    // Connect to Redis
    if (!process.env.REDIS_URL) {
      throw new Error('REDIS_URL not configured');
    }
    
    const redis = new Redis(process.env.REDIS_URL);
    
    // For full database backups, restore all keys
    if (backupData.backupType === 'full-database') {
      const keys = Object.keys(backupData.data);
      console.log(`[RESTORE] Restoring ${keys.length} keys...`);
      
      for (const key of keys) {
        const value = backupData.data[key];
        const jsonValue = typeof value === 'string' ? value : JSON.stringify(value);
        await redis.set(key, jsonValue);
      }
      
      console.log('[RESTORE] Full database restore complete!');
      
    } else {
      // Legacy format - single user backup
      // This won't work anymore since we don't know the user ID
      throw new Error('Legacy single-user backups are not supported. Please use full database backups.');
    }
    
    // Close Redis connection
    await redis.quit();
    
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
