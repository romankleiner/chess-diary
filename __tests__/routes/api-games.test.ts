import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// getAnalyses is mocked only so tests can assert the route never calls it.
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

// ─── analysis flags ───────────────────────────────────────────────────────────
//
// The analyze route writes analysisCompleted / analysisDepth / analysisEngine
// straight onto the game object when analysis finishes, so GET /api/games
// returns those stored values and does not load the analyses hash to derive
// them (that halved the Redis work per request).

describe('GET /api/games — analysis flags', () => {
  it('returns the analysis flags stored on each game', async () => {
    mockGetGames.mockResolvedValue({
      g1: { id: 'g1', date: '2026-03-10', analysisCompleted: true, analysisDepth: 18, analysisEngine: 'Stockfish' },
    });

    const { games } = await (await GET(makeReq())).json();
    expect(games[0].analysisCompleted).toBe(true);
    expect(games[0].analysisDepth).toBe(18);
    expect(games[0].analysisEngine).toBe('Stockfish');
  });

  it('does not load the analyses hash', async () => {
    mockGetGames.mockResolvedValue({ g1: { id: 'g1', date: '2026-03-10', analysisCompleted: true } });

    await GET(makeReq());
    expect(mockGetAnalyses).not.toHaveBeenCalled();
  });

  it('does not derive the flag from analyses — a game without the stored flag is not marked analyzed', async () => {
    mockGetGames.mockResolvedValue({ g1: { id: 'g1', date: '2026-03-10', analysisCompleted: false } });
    mockGetAnalyses.mockResolvedValue({ g1: { depth: 20, engine: 'stockfish' } });

    const { games } = await (await GET(makeReq())).json();
    expect(games[0].analysisCompleted).toBe(false);
    expect(games[0].analysisDepth).toBeUndefined();
  });

  it('leaves the analysis fields off games that were never analyzed', async () => {
    mockGetGames.mockResolvedValue({ g1: { id: 'g1', date: '2026-03-10' } });

    const { games } = await (await GET(makeReq())).json();
    expect(games[0].analysisCompleted).toBeUndefined();
    expect(games[0].analysisDepth).toBeUndefined();
    expect(games[0].analysisEngine).toBeUndefined();
  });
});

// ─── payload shape ────────────────────────────────────────────────────────────
//
// The per-move `moves` array (tens of KB per analyzed game) is what makes the
// list slow on a bad connection. Everything else must be passed through: the
// journal page reads turn / move_by to find "games where it's my turn", and
// fen / pgn to draw the board.

describe('GET /api/games — payload shape', () => {
  const analyzedGame = {
    id: 'g1',
    date: '2026-03-10',
    white: 'me',
    black: 'them',
    result: null,
    url: 'https://www.chess.com/game/daily/1',
    timeControl: 'daily',
    turn: 'white',
    move_by: 1790000000,
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    pgn: '1. e4 e5',
    analysisCompleted: true,
    moves: [{ moveNumber: 1, color: 'white', centipawnLoss: 10 }],
  };

  it('drops the bulky per-move analysis array', async () => {
    mockGetGames.mockResolvedValue({ g1: analyzedGame });

    const { games } = await (await GET(makeReq())).json();
    expect(games[0]).not.toHaveProperty('moves');
  });

  it('keeps every other field, including the ones the journal page depends on', async () => {
    mockGetGames.mockResolvedValue({ g1: analyzedGame });

    const { games } = await (await GET(makeReq())).json();
    const { moves, ...expected } = analyzedGame;
    expect(games[0]).toEqual(expected);
    expect(games[0].turn).toBe('white');
    expect(games[0].move_by).toBe(1790000000);
    expect(games[0].fen).toBe(analyzedGame.fen);
    expect(games[0].pgn).toBe('1. e4 e5');
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

    const res = await GET(makeReq());
    const { games } = await res.json();
    expect(games.map((g: any) => g.id)).toEqual(['new', 'mid', 'old']);
  });
});

// ─── edge cases ───────────────────────────────────────────────────────────────

describe('GET /api/games — edge cases', () => {
  it('returns an empty array when no games are stored', async () => {
    mockGetGames.mockResolvedValue({});

    const res = await GET(makeReq());
    const { games } = await res.json();
    expect(games).toEqual([]);
  });

  it('returns 200 status', async () => {
    mockGetGames.mockResolvedValue({});
    expect((await GET(makeReq())).status).toBe(200);
  });

  it('returns 500 when db throws', async () => {
    mockGetGames.mockRejectedValue(new Error('db down'));
    expect((await GET(makeReq())).status).toBe(500);
  });
});
