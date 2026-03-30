/**
 * Timestamp and date-filter utilities — no I/O, no framework deps.
 */

/**
 * Returns the current time as an ISO string in local timezone (no trailing 'Z').
 */
export function getLocalTimestamp(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  const localTime = new Date(now.getTime() - offset);
  return localTime.toISOString().slice(0, -1);
}

/**
 * Filter journal entries by date range (inclusive).
 * If either bound is null / undefined, all entries are returned unchanged.
 */
export function filterEntriesByDate(
  entries: any[],
  startDate: string | null | undefined,
  endDate: string | null | undefined
): any[] {
  if (!startDate || !endDate) return entries;
  return entries.filter(e => e.date >= startDate && e.date <= endDate);
}
