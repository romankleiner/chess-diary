import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import Redis from 'ioredis';
import { isAdmin } from '@/lib/admin';

export const maxDuration = 60;

/**
 * Admin-only endpoint to trigger a Redis database backup immediately.
 * Uses the same logic as the nightly cron but is authenticated via
 * Clerk (admin check) rather than CRON_SECRET, so it works as a
 * diagnostic tool when the cron itself may be failing.
 */
export async function POST() {
  try {
    const { isAdmin: admin } = await isAdmin();
    if (!admin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    if (!process.env.REDIS_URL) {
      return NextResponse.json({ error: 'REDIS_URL not configured' }, { status: 500 });
    }

    const redis = new Redis(process.env.REDIS_URL);
    const allKeys = await redis.keys('chess-diary:*');

    const allData: Record<string, any> = {};
    for (const key of allKeys) {
      try {
        const type = await redis.type(key);
        if (type === 'hash') {
          const raw = await redis.hgetall(key);
          const parsed: Record<string, any> = {};
          for (const [field, value] of Object.entries(raw)) {
            try { parsed[field] = JSON.parse(value); } catch { parsed[field] = value; }
          }
          allData[key] = parsed;
        } else if (type === 'string') {
          const value = await redis.get(key);
          if (value) {
            try { allData[key] = JSON.parse(value); } catch { allData[key] = value; }
          }
        }
      } catch (err) {
        console.warn(`[BACKUP] Failed to read key ${key}:`, err);
      }
    }

    await redis.quit();

    const userKeys = allKeys.filter(k => k.match(/^chess-diary:user_[^:]+:games$/));
    let totalGames = 0, totalJournalEntries = 0, totalAnalyses = 0;
    for (const key of allKeys) {
      if (key.includes(':games'))    totalGames          += Object.keys(allData[key] ?? {}).length;
      if (key.includes(':journal'))  totalJournalEntries += Object.keys(allData[key] ?? {}).length;
      if (key.includes(':analyses')) totalAnalyses       += Object.keys(allData[key] ?? {}).length;
    }

    const timestamp = new Date().toISOString();
    const backupData = {
      timestamp,
      version: '1.0',
      backupType: 'full-database',
      data: allData,
      stats: {
        totalKeys: allKeys.length,
        totalUsers: userKeys.length,
        totalGames,
        totalJournalEntries,
        totalAnalyses,
      },
    };

    const backupJson = JSON.stringify(backupData, null, 2);
    const fileName = `backups/journal-${timestamp.split('T')[0]}.json`;

    const blob = await put(fileName, backupJson, {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
    });

    return NextResponse.json({
      success: true,
      fileName,
      sizeMB: (backupJson.length / 1024 / 1024).toFixed(2),
      stats: backupData.stats,
      url: blob.url,
    });
  } catch (error) {
    console.error('[BACKUP] Manual backup error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Backup failed' },
      { status: 500 }
    );
  }
}
