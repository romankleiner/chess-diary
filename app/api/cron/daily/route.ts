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

/**
 * Tiered backup retention:
 *   - Last 7 days  → keep every daily backup
 *   - Days 8–35    → keep the newest backup per calendar week
 *   - Older        → keep the newest backup per calendar month
 *
 * Blobs are already sorted newest-first so the first one seen for a
 * given week/month bucket is automatically the one to keep.
 */
async function pruneBackups() {
  const { blobs } = await list({ prefix: 'backups/' });
  if (blobs.length === 0) return { kept: 0, deleted: 0 };

  // Newest first
  const sorted = [...blobs].sort(
    (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
  );

  const now        = Date.now();
  const MS_PER_DAY = 86_400_000;
  const keepUrls   = new Set<string>();
  const seenWeeks  = new Set<string>();
  const seenMonths = new Set<string>();

  for (const blob of sorted) {
    const uploadedAt = new Date(blob.uploadedAt);
    const ageDays    = (now - uploadedAt.getTime()) / MS_PER_DAY;

    if (ageDays <= 7) {
      // Daily window — keep everything
      keepUrls.add(blob.url);
    } else if (ageDays <= 35) {
      // Weekly window — keep first (newest) seen for this week
      const weekKey = `${uploadedAt.getFullYear()}-W${weekOfYear(uploadedAt)}`;
      if (!seenWeeks.has(weekKey)) {
        seenWeeks.add(weekKey);
        keepUrls.add(blob.url);
      }
    } else {
      // Monthly window — keep first (newest) seen for this month
      const monthKey = `${uploadedAt.getFullYear()}-${uploadedAt.getMonth()}`;
      if (!seenMonths.has(monthKey)) {
        seenMonths.add(monthKey);
        keepUrls.add(blob.url);
      }
    }
  }

  const toDelete = sorted.filter(b => !keepUrls.has(b.url));
  if (toDelete.length > 0) {
    await Promise.all(toDelete.map(b => {
      console.log('[CRON] Pruning backup:', b.pathname);
      return del(b.url);
    }));
  }

  console.log(`[CRON] Backup prune: kept ${keepUrls.size}, deleted ${toDelete.length}`);
  return { kept: keepUrls.size, deleted: toDelete.length };
}

/** Simple week-of-year (1-based) — good enough for bucketing purposes. */
function weekOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - start.getTime()) / 86_400_000 + start.getDay() + 1) / 7);
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
