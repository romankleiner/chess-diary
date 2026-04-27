import { describe, it, expect, vi, afterEach } from 'vitest';
import { getLocalTimestamp, filterEntriesByDate } from '@/lib/timestamps';

// ─── fixtures ────────────────────────────────────────────────────────────────

const entries = [
  { id: 1, date: '2026-01-01' },
  { id: 2, date: '2026-02-15' },
  { id: 3, date: '2026-03-29' },
];

// ─── filterEntriesByDate ──────────────────────────────────────────────────────

describe('filterEntriesByDate', () => {
  it('returns all entries when both bounds are null', () => {
    expect(filterEntriesByDate(entries, null, null)).toHaveLength(3);
  });

  it('returns all entries when startDate is null', () => {
    expect(filterEntriesByDate(entries, null, '2026-03-29')).toHaveLength(3);
  });

  it('returns all entries when endDate is null', () => {
    expect(filterEntriesByDate(entries, '2026-01-01', null)).toHaveLength(3);
  });

  it('returns all entries when both bounds are undefined', () => {
    expect(filterEntriesByDate(entries, undefined, undefined)).toHaveLength(3);
  });

  it('filters entries within the date range', () => {
    const result = filterEntriesByDate(entries, '2026-02-01', '2026-03-01');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(2);
  });

  it('includes entries on the startDate boundary (inclusive)', () => {
    const result = filterEntriesByDate(entries, '2026-01-01', '2026-01-31');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it('includes entries on the endDate boundary (inclusive)', () => {
    const result = filterEntriesByDate(entries, '2026-03-01', '2026-03-29');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(3);
  });

  it('returns all entries when range spans the full set', () => {
    const result = filterEntriesByDate(entries, '2026-01-01', '2026-03-29');
    expect(result).toHaveLength(3);
  });

  it('returns an empty array when no entries fall in the range', () => {
    const result = filterEntriesByDate(entries, '2025-01-01', '2025-12-31');
    expect(result).toHaveLength(0);
  });

  it('returns an empty array when input is empty', () => {
    expect(filterEntriesByDate([], '2026-01-01', '2026-12-31')).toHaveLength(0);
  });

  it('does not mutate the original array', () => {
    const original = [...entries];
    filterEntriesByDate(entries, '2026-02-01', '2026-02-28');
    expect(entries).toEqual(original);
  });
});

// ─── getLocalTimestamp ────────────────────────────────────────────────────────

describe('getLocalTimestamp', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a string', () => {
    expect(typeof getLocalTimestamp()).toBe('string');
  });

  it('ends with Z (UTC, parsed correctly by clients in any timezone)', () => {
    expect(getLocalTimestamp()).toMatch(/Z$/);
  });

  it('matches ISO datetime format with trailing Z', () => {
    // e.g. "2026-03-29T14:30:00.000Z"
    expect(getLocalTimestamp()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('reflects the current time within a 5-second window', () => {
    const before = Date.now();
    const ts = getLocalTimestamp();
    const after = Date.now();
    const parsed = new Date(ts).getTime();
    expect(parsed).toBeGreaterThanOrEqual(before - 100);
    expect(parsed).toBeLessThanOrEqual(after + 100);
  });
});
