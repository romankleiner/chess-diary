import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import Redis from 'ioredis';
import { cleanupOldBoardImages } from '@/lib/board-image-storage';
import { pruneBackups } from '@/lib/backup-prune';

// Allow up to 60 seconds — backup + cleanup can be slow on large datasets
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.error('[CRON] Unauthorized access attempt');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const results = await runDailyMaintenance();
    return NextResponse.json({ success: true, ...results });
  } catch (error) {
    console.error('[CRON] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Daily maintenance failed' },
      { status: 500 }
    );
  }
}

// ─── Individual tasks ─────────────────────────────────────────────────────────

async function backupDatabase() {
  console.log('[CRON] Starting database backup...');

  if (!process.env.REDIS_URL) throw new Error('REDIS_URL not configured');

  const redis = new Redis(process.env.REDIS_URL);
  const allKeys = await redis.keys('chess-diary:*');
  console.log(`[CRON] Found ${allKeys.length} Redis keys`);

  // Since the March 2026 Redis redesign, data is stored in hash keys (HSET/HGETALL)
  // rather than plain string keys. We must check each key's type and use the right
  // command — GET on a hash throws WRONGTYPE and would abort the backup.
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
      } else {
        console.warn(`[CRON] Skipping key ${key} with unsupported type: ${type}`);
      }
    } catch (err) {
      console.warn(`[CRON] Failed to read key ${key}:`, err);
    }
  }

  await redis.quit();

  // Compute stats — journal is now a hash (object), not an array
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
    stats: { totalKeys: allKeys.length, totalUsers: userKeys.length, totalGames, totalJournalEntries, totalAnalyses },
  };

  const backupJson = JSON.stringify(backupData, null, 2);
  const fileName = `backups/journal-${timestamp.split('T')[0]}.json`;

  const blob = await put(fileName, backupJson, {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
  });

  console.log('[CRON] Backup uploaded:', blob.url);
  return { fileName, sizeMB: (backupJson.length / 1024 / 1024).toFixed(2), stats: backupData.stats };
}


// ─── Orchestrator ─────────────────────────────────────────────────────────────

async function runDailyMaintenance() {
  const backup = await backupDatabase();

  // Cleanups are best-effort — a failure here must not abort the backup response.
  let backupsDeleted = 0;
  let boardImagesDeleted = 0;

  let backupsPruned = { kept: 0, deleted: 0 };
  try { backupsPruned = await pruneBackups(); backupsDeleted = backupsPruned.deleted; }
  catch (e) { console.error('[CRON] Backup prune error:', e); }

  try { boardImagesDeleted = await cleanupOldBoardImages(90); }
  catch (e) { console.error('[CRON] Board-image cleanup error:', e); }

  return { backup, cleanup: { backupsDeleted, boardImagesDeleted } };
}
