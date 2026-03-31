import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/db', () => ({
  getGames: vi.fn(),
  getAnalyses: vi.fn(),
}));

import { GET } from '@/app/api/games/route';
import { getGames, getAnalyses } from '@/lib/db';

const mockGetGames = vi.mocked(getGames);
const mockGetAnalyses = vi.mocked(getAnalyses);

beforeEach(() => vi.clearAllMocks());

function makeReq() {
  return new NextRequest('http://localhost/api/games');
}

// ─── analysisCompleted flag ───────────────────────────────────────────────────

describe('GET /api/games — analysisCompleted merging', () => {
  it('is true when a matching analysis exists, regardless of the stored flag', async () => {
    mockGetGames.mockResolvedValue({
      'g1': { id: 'g1', date: '2026-03-10', analysisCompleted: false },
    });
    mockGetAnalyses.mockResolvedValue({ g1: { depth: 20, engine: 'stockfish' } });

    const res = await GET(makeReq());
    const { games } = await res.json();
    expect(games[0].analysisCompleted).toBe(true);
  });

  it('is false when no matching analysis exists', async () => {
    mockGetGames.mockResolvedValue({
      'g1': { id: 'g1', date: '2026-03-10', analysisCompleted: true }, // stale stored flag
    });
    mockGetAnalyses.mockResolvedValue({});

    const res = await GET(makeReq());
    const { games } = await res.json();
    expect(games[0].analysisCompleted).toBe(false);
  });

  it('includes analysisDepth and analysisEngine from the analysis record', async () => {
    mockGetGames.mockResolvedValue({
      'g1': { id: 'g1', date: '2026-03-10' },
    });
    mockGetAnalyses.mockResolvedValue({ g1: { depth: 18, engine: 'stockfish16' } });

    const res = await GET(makeReq());
    const { games } = await res.json();
    expect(games[0].analysisDepth).toBe(18);
    expect(games[0].analysisEngine).toBe('stockfish16');
  });
});

// ─── sorting ──────────────────────────────────────────────────────────────────

describe('GET /api/games — date sorting', () => {
  it('returns games sorted by date descending', async () => {
    mockGetGames.mockResolvedValue({
      'old': { id: 'old', date: '2026-01-01' },
      'new': { id: 'new', date: '2026-03-20' },
      'mid': { id: 'mid', date: '2026-02-15' },
    });
    mockGetAnalyses.mockResolvedValue({});

    const res = await GET(makeReq());
    const { games } = await res.json();
    expect(games.map((g: any) => g.id)).toEqual(['new', 'mid', 'old']);
  });
});

// ─── edge cases ───────────────────────────────────────────────────────────────

describe('GET /api/games — edge cases', () => {
  it('returns an empty array when no games are stored', async () => {
    mockGetGames.mockResolvedValue({});
    mockGetAnalyses.mockResolvedValue({});

    const res = await GET(makeReq());
    const { games } = await res.json();
    expect(games).toEqual([]);
  });

  it('returns 200 status', async () => {
    mockGetGames.mockResolvedValue({});
    mockGetAnalyses.mockResolvedValue({});
    expect((await GET(makeReq())).status).toBe(200);
  });

  it('returns 500 when db throws', async () => {
    mockGetGames.mockRejectedValue(new Error('db down'));
    mockGetAnalyses.mockResolvedValue({});
    expect((await GET(makeReq())).status).toBe(500);
  });
});
