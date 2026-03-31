import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { thoughtEntry } from '../helpers/fixtures';

vi.mock('@/lib/db', () => ({
  getJournalEntry: vi.fn(),
  saveJournalEntry: vi.fn(),
  deleteJournalEntry: vi.fn(),
}));

import { PUT, DELETE } from '@/app/api/journal/[id]/route';
import { getJournalEntry, saveJournalEntry, deleteJournalEntry } from '@/lib/db';

const mockGet = vi.mocked(getJournalEntry);
const mockSave = vi.mocked(saveJournalEntry);
const mockDelete = vi.mocked(deleteJournalEntry);

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => vi.clearAllMocks());

// ─── PUT ──────────────────────────────────────────────────────────────────────

describe('PUT /api/journal/[id]', () => {
  it('returns 404 when the entry does not exist', async () => {
    mockGet.mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/journal/9999', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'updated' }),
    });
    expect((await PUT(req, params('9999'))).status).toBe(404);
  });

  it('updates content field', async () => {
    mockGet.mockResolvedValue({ ...thoughtEntry });
    mockSave.mockResolvedValue(undefined);
    const req = new NextRequest(`http://localhost/api/journal/${thoughtEntry.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'new content' }),
    });
    const { entry } = await (await PUT(req, params(String(thoughtEntry.id)))).json();
    expect(entry.content).toBe('new content');
  });

  it('updates aiReview field', async () => {
    mockGet.mockResolvedValue({ ...thoughtEntry });
    mockSave.mockResolvedValue(undefined);
    const aiReview = { content: 'Great move', timestamp: '2026-03-10T11:00:00Z' };
    const req = new NextRequest(`http://localhost/api/journal/${thoughtEntry.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aiReview }),
    });
    const { entry } = await (await PUT(req, params(String(thoughtEntry.id)))).json();
    expect(entry.aiReview).toEqual(aiReview);
  });

  it('does not overwrite unrelated fields with undefined', async () => {
    const original = { ...thoughtEntry, myMove: 'e4' };
    mockGet.mockResolvedValue(original);
    mockSave.mockResolvedValue(undefined);
    const req = new NextRequest(`http://localhost/api/journal/${thoughtEntry.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'updated' }),
    });
    const { entry } = await (await PUT(req, params(String(thoughtEntry.id)))).json();
    // myMove was not in the body, so it should be preserved
    expect(entry.myMove).toBe('e4');
  });

  it('calls saveJournalEntry once on success', async () => {
    mockGet.mockResolvedValue({ ...thoughtEntry });
    mockSave.mockResolvedValue(undefined);
    const req = new NextRequest(`http://localhost/api/journal/${thoughtEntry.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'x' }),
    });
    await PUT(req, params(String(thoughtEntry.id)));
    expect(mockSave).toHaveBeenCalledOnce();
  });
});

// ─── DELETE ───────────────────────────────────────────────────────────────────

describe('DELETE /api/journal/[id]', () => {
  it('returns 404 when the entry does not exist', async () => {
    mockGet.mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/journal/9999', { method: 'DELETE' });
    expect((await DELETE(req, params('9999'))).status).toBe(404);
  });

  it('returns success:true when the entry exists', async () => {
    mockGet.mockResolvedValue({ ...thoughtEntry });
    mockDelete.mockResolvedValue(undefined);
    const req = new NextRequest(`http://localhost/api/journal/${thoughtEntry.id}`, { method: 'DELETE' });
    const { success } = await (await DELETE(req, params(String(thoughtEntry.id)))).json();
    expect(success).toBe(true);
  });

  it('calls deleteJournalEntry with the numeric id', async () => {
    mockGet.mockResolvedValue({ ...thoughtEntry });
    mockDelete.mockResolvedValue(undefined);
    const req = new NextRequest(`http://localhost/api/journal/${thoughtEntry.id}`, { method: 'DELETE' });
    await DELETE(req, params(String(thoughtEntry.id)));
    expect(mockDelete).toHaveBeenCalledWith(thoughtEntry.id);
  });
});
