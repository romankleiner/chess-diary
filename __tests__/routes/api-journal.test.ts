import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { thoughtEntry, moveEntry } from '../helpers/fixtures';

vi.mock('@/lib/db', () => ({
  getJournal: vi.fn(),
  saveJournalEntry: vi.fn(),
  deleteJournalEntry: vi.fn(),
}));

import { GET, POST, DELETE } from '@/app/api/journal/route';
import { getJournal, saveJournalEntry, deleteJournalEntry } from '@/lib/db';

const mockGetJournal = vi.mocked(getJournal);
const mockSaveEntry = vi.mocked(saveJournalEntry);
const mockDeleteEntry = vi.mocked(deleteJournalEntry);

beforeEach(() => vi.clearAllMocks());

// ─── GET — no filter ──────────────────────────────────────────────────────────

describe('GET /api/journal — no date filter', () => {
  it('returns all entries when no query params are supplied', async () => {
    mockGetJournal.mockResolvedValue([thoughtEntry, moveEntry]);
    const req = new NextRequest('http://localhost/api/journal');
    const res = await GET(req);
    const { entries } = await res.json();
    expect(entries).toHaveLength(2);
  });

  it('returns 200', async () => {
    mockGetJournal.mockResolvedValue([]);
    const res = await GET(new NextRequest('http://localhost/api/journal'));
    expect(res.status).toBe(200);
  });
});

// ─── GET — date filtering ─────────────────────────────────────────────────────

describe('GET /api/journal — date filter', () => {
  const entries = [
    { ...thoughtEntry, date: '2026-03-10' },
    { ...moveEntry,    date: '2026-03-20' },
  ];

  it('filters entries to startDate..endDate (inclusive)', async () => {
    mockGetJournal.mockResolvedValue(entries);
    const req = new NextRequest(
      'http://localhost/api/journal?startDate=2026-03-10&endDate=2026-03-10'
    );
    const { entries: result } = await (await GET(req)).json();
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2026-03-10');
  });

  it('returns nothing when date range excludes all entries', async () => {
    mockGetJournal.mockResolvedValue(entries);
    const req = new NextRequest(
      'http://localhost/api/journal?startDate=2026-01-01&endDate=2026-01-02'
    );
    const { entries: result } = await (await GET(req)).json();
    expect(result).toHaveLength(0);
  });

  it('returns all entries when startDate equals endDate of the range', async () => {
    mockGetJournal.mockResolvedValue(entries);
    const req = new NextRequest(
      'http://localhost/api/journal?startDate=2026-03-10&endDate=2026-03-20'
    );
    const { entries: result } = await (await GET(req)).json();
    expect(result).toHaveLength(2);
  });
});

// ─── POST ─────────────────────────────────────────────────────────────────────

describe('POST /api/journal', () => {
  it('assigns a numeric id', async () => {
    mockSaveEntry.mockResolvedValue(undefined);
    const req = new NextRequest('http://localhost/api/journal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'hello', entryType: 'thought', gameId: null, date: '2026-03-10' }),
    });
    const { entry } = await (await POST(req)).json();
    expect(typeof entry.id).toBe('number');
  });

  it('assigns a timestamp', async () => {
    mockSaveEntry.mockResolvedValue(undefined);
    const req = new NextRequest('http://localhost/api/journal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'hi', entryType: 'thought', date: '2026-03-10' }),
    });
    const { entry } = await (await POST(req)).json();
    expect(entry.timestamp).toBeTruthy();
  });

  it('body fields are preserved in the saved entry', async () => {
    mockSaveEntry.mockResolvedValue(undefined);
    const req = new NextRequest('http://localhost/api/journal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'my thought', entryType: 'thought', gameId: 'g1', date: '2026-03-15' }),
    });
    const { entry } = await (await POST(req)).json();
    expect(entry.content).toBe('my thought');
    expect(entry.gameId).toBe('g1');
  });

  it('calls saveJournalEntry once', async () => {
    mockSaveEntry.mockResolvedValue(undefined);
    const req = new NextRequest('http://localhost/api/journal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'x', date: '2026-03-10' }),
    });
    await POST(req);
    expect(mockSaveEntry).toHaveBeenCalledOnce();
  });
});

// ─── DELETE ───────────────────────────────────────────────────────────────────

describe('DELETE /api/journal', () => {
  it('returns 400 when id query param is missing', async () => {
    const req = new NextRequest('http://localhost/api/journal', { method: 'DELETE' });
    expect((await DELETE(req)).status).toBe(400);
  });

  it('calls deleteJournalEntry with the numeric id', async () => {
    mockDeleteEntry.mockResolvedValue(undefined);
    const req = new NextRequest('http://localhost/api/journal?id=1001', { method: 'DELETE' });
    await DELETE(req);
    expect(mockDeleteEntry).toHaveBeenCalledWith(1001);
  });

  it('returns success:true on valid delete', async () => {
    mockDeleteEntry.mockResolvedValue(undefined);
    const req = new NextRequest('http://localhost/api/journal?id=1001', { method: 'DELETE' });
    const { success } = await (await DELETE(req)).json();
    expect(success).toBe(true);
  });
});
