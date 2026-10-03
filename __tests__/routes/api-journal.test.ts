import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { thoughtEntry, moveEntry } from '../helpers/fixtures';

vi.mock('@/lib/db', () => ({
  getJournal: vi.fn(),
  saveJournalEntry: vi.fn(),
  deleteJournalEntry: vi.fn(),
  getGame: vi.fn(),
  getAnalysis: vi.fn(),
}));

// The real function, wrapped so one test can make it throw
vi.mock('@/lib/review-eval', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/review-eval')>();
  return { ...actual, addMissingReviewEvals: vi.fn(actual.addMissingReviewEvals) };
});

import { GET, POST, DELETE } from '@/app/api/journal/route';
import { getJournal, saveJournalEntry, deleteJournalEntry, getGame, getAnalysis } from '@/lib/db';
import { addMissingReviewEvals } from '@/lib/review-eval';
import { Chess } from 'chess.js';

const mockGetJournal = vi.mocked(getJournal);
const mockSaveEntry = vi.mocked(saveJournalEntry);
const mockDeleteEntry = vi.mocked(deleteJournalEntry);
const mockGetGame = vi.mocked(getGame);
const mockGetAnalysis = vi.mocked(getAnalysis);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetGame.mockResolvedValue(null);
  mockGetAnalysis.mockResolvedValue(null);
});

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

// ─── GET — the eval on post-game reviews ──────────────────────────────────────

describe('GET /api/journal — post-game review evals', () => {
  const PGN = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6';
  const chess = new Chess();
  chess.loadPgn(PGN);
  const plies = chess.history({ verbose: true });

  // One analysis entry per ply; the evaluation of ply i is i / 4.
  const analysis = {
    moves: plies.map((m, i) => ({
      moveNumber: Math.floor(i / 2) + 1, color: i % 2 === 0 ? 'white' : 'black', move: m.san,
      evaluation: i / 4, centipawnLoss: 10, moveQuality: 'good',
    })),
  };

  const reviewed = (over: object = {}) => ({
    id: 5, date: '2026-03-10', gameId: 'game-111', entryType: 'move', content: 'x',
    timestamp: '2026-03-10T10:00:00.000Z', fen: plies[4].before,
    postReview: { content: 'Looking back', timestamp: '2026-05-10T10:00:00.000Z', type: 'manual' },
    ...over,
  });

  const get = async (url = 'http://localhost/api/journal') => (await (await GET(new NextRequest(url))).json()).entries;

  it('adds the eval to a review that was saved without one', async () => {
    mockGetJournal.mockResolvedValue([reviewed()]);
    mockGetGame.mockResolvedValue({ id: 'game-111', pgn: PGN });
    mockGetAnalysis.mockResolvedValue(analysis);

    const [entry] = await get();

    expect(entry.postReview).toMatchObject({
      content: 'Looking back', type: 'manual',
      evalBefore: 0.75, evalAfter: 1, moveQuality: 'good', centipawnLoss: 10,
    });
  });

  it('works for a review on an entry that recorded its move as "0-0" or without a move at all', async () => {
    const castle = '1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O Nf6';
    const c = new Chess(); c.loadPgn(castle);
    const p = c.history({ verbose: true });
    mockGetJournal.mockResolvedValue([
      reviewed({ id: 1, fen: p[6].before, myMove: '0-0' }),
      reviewed({ id: 2, fen: p[6].before, myMove: null }),
    ]);
    mockGetGame.mockResolvedValue({ id: 'game-111', pgn: castle });
    mockGetAnalysis.mockResolvedValue({ moves: p.map((m, i) => ({ moveNumber: Math.floor(i / 2) + 1, color: i % 2 ? 'black' : 'white', move: m.san, evaluation: i })) });

    const entries = await get();

    expect(entries.map((e: { postReview: { evalAfter: number } }) => e.postReview.evalAfter)).toEqual([6, 6]);
  });

  it('leaves an eval that was saved with the review alone', async () => {
    mockGetJournal.mockResolvedValue([reviewed({ postReview: { content: 'x', timestamp: 't', type: 'manual', evalAfter: 7.7 } })]);

    const [entry] = await get();

    expect(entry.postReview.evalAfter).toBe(7.7);
    expect(mockGetGame).not.toHaveBeenCalled();
    expect(mockGetAnalysis).not.toHaveBeenCalled();
  });

  it('reads no game at all when no review on the page needs an eval', async () => {
    mockGetJournal.mockResolvedValue([thoughtEntry, moveEntry]);

    await get();

    expect(mockGetGame).not.toHaveBeenCalled();
    expect(mockGetAnalysis).not.toHaveBeenCalled();
  });

  it('reads each game once, however many of its reviews are on the page', async () => {
    mockGetJournal.mockResolvedValue([reviewed({ id: 1 }), reviewed({ id: 2 }), reviewed({ id: 3 })]);
    mockGetGame.mockResolvedValue({ id: 'game-111', pgn: PGN });
    mockGetAnalysis.mockResolvedValue(analysis);

    await get();

    expect(mockGetGame).toHaveBeenCalledTimes(1);
    expect(mockGetAnalysis).toHaveBeenCalledTimes(1);
    expect(mockGetGame).toHaveBeenCalledWith('game-111');
  });

  it('reads only the games of the entries it returns', async () => {
    mockGetJournal.mockResolvedValue([
      reviewed({ id: 1, date: '2026-03-10' }),
      reviewed({ id: 2, date: '2026-04-20', gameId: 'game-222' }),
    ]);
    mockGetGame.mockResolvedValue({ id: 'game-111', pgn: PGN });
    mockGetAnalysis.mockResolvedValue(analysis);

    await get('http://localhost/api/journal?startDate=2026-03-01&endDate=2026-03-31');

    expect(mockGetGame).toHaveBeenCalledTimes(1);
    expect(mockGetGame).toHaveBeenCalledWith('game-111');
  });

  it('also fills in the evals when the journal is filtered to one game', async () => {
    mockGetJournal.mockResolvedValue([reviewed()]);
    mockGetGame.mockResolvedValue({ id: 'game-111', pgn: PGN });
    mockGetAnalysis.mockResolvedValue(analysis);

    const [entry] = await get('http://localhost/api/journal?gameId=game-111');

    expect(entry.postReview.evalAfter).toBe(1);
  });

  it('leaves the review as it was when the game has not been analysed', async () => {
    mockGetJournal.mockResolvedValue([reviewed()]);
    mockGetGame.mockResolvedValue({ id: 'game-111', pgn: PGN });
    mockGetAnalysis.mockResolvedValue(null);

    const [entry] = await get();

    expect(entry.postReview).toEqual({ content: 'Looking back', timestamp: '2026-05-10T10:00:00.000Z', type: 'manual' });
  });

  it('still returns the journal, as stored, when a game cannot be read', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetJournal.mockResolvedValue([reviewed(), thoughtEntry]);
    mockGetGame.mockRejectedValue(new Error('redis went away'));

    const res = await GET(new NextRequest('http://localhost/api/journal'));
    const { entries } = await res.json();

    expect(res.status).toBe(200);
    expect(entries).toHaveLength(2);
    expect(entries[0].postReview.evalAfter).toBeUndefined();
    quiet.mockRestore();
  });

  it('does not stop at an entry whose stored data is malformed', async () => {
    mockGetJournal.mockResolvedValue([reviewed({ id: 1, fen: 12345 }), reviewed({ id: 2 })]);
    mockGetGame.mockResolvedValue({ id: 'game-111', pgn: PGN });
    mockGetAnalysis.mockResolvedValue(analysis);

    const res = await GET(new NextRequest('http://localhost/api/journal'));
    const { entries } = await res.json();

    expect(res.status).toBe(200);
    expect(entries[0].postReview.evalAfter).toBeUndefined();
    expect(entries[1].postReview.evalAfter).toBe(1);
  });

  it('returns the journal as stored, rather than failing, if filling in evals goes wrong in any way at all', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(addMissingReviewEvals).mockRejectedValueOnce(new Error('something unforeseen'));
    mockGetJournal.mockResolvedValue([reviewed(), thoughtEntry]);

    const res = await GET(new NextRequest('http://localhost/api/journal'));
    const { entries } = await res.json();

    expect(res.status).toBe(200);
    expect(entries).toHaveLength(2);
    expect(entries[0].postReview.evalAfter).toBeUndefined();
    expect(quiet).toHaveBeenCalledWith('[JOURNAL] Could not add review evals:', 'something unforeseen');
    quiet.mockRestore();
  });

  it('never writes anything back to the journal', async () => {
    mockGetJournal.mockResolvedValue([reviewed()]);
    mockGetGame.mockResolvedValue({ id: 'game-111', pgn: PGN });
    mockGetAnalysis.mockResolvedValue(analysis);

    await get();

    expect(mockSaveEntry).not.toHaveBeenCalled();
    expect(mockDeleteEntry).not.toHaveBeenCalled();
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
