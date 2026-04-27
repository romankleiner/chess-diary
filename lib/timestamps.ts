/**
 * Timestamp and date-filter utilities — no I/O, no framework deps.
 */

/**
 * Returns the current time as a UTC ISO string (with trailing 'Z').
 * Storing UTC on the server avoids timezone-offset confusion when the
 * server runs in UTC (the norm for hosted environments). The client
 * display layer converts to local time via toLocaleTimeString().
 */
export function getLocalTimestamp(): string {
  return new Date().toISOString();
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
