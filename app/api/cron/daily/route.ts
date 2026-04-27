import { NextRequest, NextResponse } from 'next/server';
import { put, list, del } from '@vercel/blob';
import Redis from 'ioredis';
import { cleanupOldBoardImages } from '@/lib/board-image-storage';

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

  const allData: Record<string, any> = {};
  for (const key of allKeys) {
    const value = await redis.get(key);
    if (value) {
      try { allData[key] = JSON.parse(value); }
      catch { allData[key] = value; }
    }
  }

  await redis.quit();

  // Compute stats
  const userKeys = allKeys.filter(k => k.match(/^chess-diary:user_[^:]+:games$/));
  let totalGames = 0, totalJournalEntries = 0, totalAnalyses = 0;
  for (const key of allKeys) {
    if (key.includes(':games'))    totalGames           += Object.keys(allData[key] ?? {}).length;
    if (key.includes(':journal'))  totalJournalEntries  += Array.isArray(allData[key]) ? allData[key].length : 0;
    if (key.includes(':analyses')) totalAnalyses        += Object.keys(allData[key] ?? {}).length;
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

async function cleanupOldBackups(maxAgeDays = 30) {
  console.log(`[CRON] Deleting backups older than ${maxAgeDays} days...`);
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const { blobs } = await list({ prefix: 'backups/' });
  let deleted = 0;
  for (const blob of blobs) {
    if (new Date(blob.uploadedAt).getTime() < cutoff) {
      await del(blob.url);
      console.log('[CRON] Deleted old backup:', blob.pathname);
      deleted++;
    }
  }
  console.log(`[CRON] Backup cleanup: ${deleted} file(s) removed`);
  return deleted;
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

async function runDailyMaintenance() {
  const backup = await backupDatabase();

  // Cleanups are best-effort — a failure here must not abort the backup response.
  let backupsDeleted = 0;
  let boardImagesDeleted = 0;

  try { backupsDeleted    = await cleanupOldBackups(30); }
  catch (e) { console.error('[CRON] Backup cleanup error:', e); }

  try { boardImagesDeleted = await cleanupOldBoardImages(90); }
  catch (e) { console.error('[CRON] Board-image cleanup error:', e); }

  return { backup, cleanup: { backupsDeleted, boardImagesDeleted } };
}
