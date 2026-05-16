import { list, del } from '@vercel/blob';

/**
 * Tiered backup retention:
 *   - Last 7 days  → keep every daily backup
 *   - Days 8–35    → keep the newest backup per calendar week
 *   - Older        → keep the newest backup per calendar month
 */
export async function pruneBackups(): Promise<{ kept: number; deleted: number }> {
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
      keepUrls.add(blob.url);
    } else if (ageDays <= 35) {
      const weekKey = `${uploadedAt.getFullYear()}-W${weekOfYear(uploadedAt)}`;
      if (!seenWeeks.has(weekKey)) {
        seenWeeks.add(weekKey);
        keepUrls.add(blob.url);
      }
    } else {
      const monthKey = `${uploadedAt.getFullYear()}-${uploadedAt.getMonth()}`;
      if (!seenMonths.has(monthKey)) {
        seenMonths.add(monthKey);
        keepUrls.add(blob.url);
      }
    }
  }

  const toDelete = sorted.filter(b => !keepUrls.has(b.url));
  if (toDelete.length > 0) {
    await Promise.all(toDelete.map(b => del(b.url)));
  }

  return { kept: keepUrls.size, deleted: toDelete.length };
}

function weekOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - start.getTime()) / MS_PER_DAY + start.getDay() + 1) / 7);
}

const MS_PER_DAY = 86_400_000;
