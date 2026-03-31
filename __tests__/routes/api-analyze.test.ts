/**
 * Tier 5 — POST /api/games/analyze
 *
 * IS_VERCEL is a module-level constant, so we need vi.doMock + vi.resetModules()
 * + a dynamic import inside beforeAll to force its value per describe block.
 * vi.doMock (unlike vi.mock) is NOT hoisted, so it can be called inside functions.
 */

import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { gameA } from '../helpers/fixtures';

// ─── Shared fixture ───────────────────────────────────────────────────────────

const SIMPLE_PGN = '1. e4 e5'; // 2 moves: white e4, black e5

const gameWithPgn = { ...gameA, pgn: SIMPLE_PGN, white: 'testuser', black: 'opponent_a' };

// ─── Helper to build NextRequest for POST /api/games/analyze ─────────────────

function makeAnalyzeReq(body: object) {
  return new NextRequest('http://localhost/api/games/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ─── GET progress endpoint ────────────────────────────────────────────────────
// Tested here rather than in a separate file — it uses the same route module.

describe('GET /api/games/analyze — progress', () => {
  // The GET handler doesn't use IS_VERCEL, so no env manipulation needed.
  // We use vi.doMock for the DB layer and import dynamically.
  const mockGetGameProgress = vi.fn();

  beforeAll(async () => {
    vi.resetModules();
    vi.doMock('@/lib/db', () => ({
      getGameProgress: mockGetGameProgress,
      getGame: vi.fn(), getSetting: vi.fn(), getAnalysis: vi.fn(),
      setGameProgress: vi.fn(), clearGameProgress: vi.fn(),
      saveAnalysis: vi.fn(), saveGame: vi.fn(),
    }));
    vi.doMock('@se-oss/stockfish', () => ({ Stockfish: vi.fn() }));
  });

  afterAll(() => vi.doUnmock('@/lib/db'));

  it('returns 400 when gameId is missing', async () => {
    const mod = await import('@/app/api/games/analyze/route');
    const req = new NextRequest('http://localhost/api/games/analyze');
    const res = await mod.GET(req);
    expect(res.status).toBe(400);
  });

  it('returns { current: 0, total: 0 } when no progress exists', async () => {
    mockGetGameProgress.mockResolvedValue(null);
    const mod = await import('@/app/api/games/analyze/route');
    const req = new NextRequest('http://localhost/api/games/analyze?gameId=g1');
    const body = await (await mod.GET(req)).json();
    expect(body).toEqual({ current: 0, total: 0 });
  });

  it('returns stored progress when it exists', async () => {
    mockGetGameProgress.mockResolvedValue({ current: 5, total: 20 });
    const mod = await import('@/app/api/games/analyze/route');
    const req = new NextRequest('http://localhost/api/games/analyze?gameId=g1');
    const body = await (await mod.GET(req)).json();
    expect(body).toEqual({ current: 5, total: 20 });
  });
});

// ─── POST — Vercel path (chess-api.com) ───────────────────────────────────────

describe('POST /api/games/analyze — Vercel path (chess-api.com)', () => {
  // Module-level vi.fn() instances — shared with vi.doMock factory via closure.
  const getGame      = vi.fn();
  const getSetting   = vi.fn();
  const getAnalysis  = vi.fn();
  const saveAnalysis = vi.fn();
  const saveGame     = vi.fn();
  const clearGameProgress = vi.fn();
  const setGameProgress   = vi.fn();

  // Persistent fetch mock — module-level so we can reset per test.
  const fetchMock = vi.fn();

  let POST: any;

  beforeAll(async () => {
    process.env.VERCEL = '1';
    vi.resetModules();

    vi.doMock('@/lib/db', () => ({
      getGame, getSetting, getAnalysis, saveAnalysis, saveGame,
      clearGameProgress, setGameProgress, getGameProgress: vi.fn(),
    }));
    vi.doMock('@se-oss/stockfish', () => ({ Stockfish: vi.fn() }));

    // Stub global fetch AFTER resetModules so the re-imported route sees it
    vi.stubGlobal('fetch', fetchMock);

    const mod = await import('@/app/api/games/analyze/route');
    POST = mod.POST;
  });

  afterAll(() => {
    delete process.env.VERCEL;
    vi.unstubAllGlobals();
    vi.doUnmock('@/lib/db');
    vi.doUnmock('@se-oss/stockfish');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    saveAnalysis.mockResolvedValue(undefined);
    saveGame.mockResolvedValue(undefined);
    clearGameProgress.mockResolvedValue(undefined);
    setGameProgress.mockResolvedValue(undefined);
    getAnalysis.mockResolvedValue(null);
    getSetting.mockImplementation(async (key: string) => {
      if (key === 'analysis_depth') return '10';
      if (key === 'chesscom_username') return 'testuser';
      return null;
    });
  });

  // ── Validation ──────────────────────────────────────────────────────────────

  it('returns 400 when gameId is missing', async () => {
    const res = await POST(makeAnalyzeReq({}));
    expect(res.status).toBe(400);
  });

  it('returns 404 when game does not exist', async () => {
    getGame.mockResolvedValue(null);
    const res = await POST(makeAnalyzeReq({ gameId: 'ghost' }));
    expect(res.status).toBe(404);
  });

  it('returns 400 when game has no PGN', async () => {
    getGame.mockResolvedValue({ ...gameWithPgn, pgn: '' });
    const res = await POST(makeAnalyzeReq({ gameId: gameA.id }));
    expect(res.status).toBe(400);
  });

  // ── Integration: calculateAccuracy + getMoveQuality through a batch ─────────
  //
  // PGN: "1. e4 e5" — 2 moves, 4 chess-api.com calls (before/after each move).
  //
  // chess-api.com returns eval in pawn units (white-POV, positive = white ahead).
  // Route converts: cpScore = data.eval * 100
  //
  // Call sequence (mocked):
  //   1. Starting pos before e4 → eval: 0.0   → 0cp
  //   2. After e4              → eval: -2.0   → -200cp   (white blundered)
  //   3. Before e5 (same pos)  → eval: -2.0   → -200cp
  //   4. After e5              → eval: -2.5   → -250cp
  //
  // White move (e4): cpLoss = max(0, 0 − (−200)) = 200 → 'mistake'
  // Black move (e5): cpLoss = max(0, −250 − (−200)) = max(0, −50) = 0 → 'excellent'

  function queueChessApiResponses() {
    const makeEval = (evalPawns: number, move = 'e2e4') => ({
      ok: true,
      json: async () => ({ eval: evalPawns, move, continuationArr: [] }),
      text: async () => '',
    });
    fetchMock
      .mockResolvedValueOnce(makeEval(0.0))    // before e4
      .mockResolvedValueOnce(makeEval(-2.0))   // after e4
      .mockResolvedValueOnce(makeEval(-2.0))   // before e5
      .mockResolvedValueOnce(makeEval(-2.5));  // after e5
  }

  it('moves get correct moveQuality labels from getMoveQuality', async () => {
    getGame.mockResolvedValue(gameWithPgn);
    queueChessApiResponses();

    const res = await POST(makeAnalyzeReq({ gameId: gameA.id }));
    const { analysis } = await res.json();

    const whiteMoves = analysis.moves.filter((m: any) => m.color === 'white');
    const blackMoves = analysis.moves.filter((m: any) => m.color === 'black');

    expect(whiteMoves[0].centipawnLoss).toBe(200);
    expect(whiteMoves[0].moveQuality).toBe('mistake');    // 200 cp ≤ 200 → mistake
    expect(blackMoves[0].centipawnLoss).toBe(0);
    expect(blackMoves[0].moveQuality).toBe('excellent');  // 0 cp ≤ 25 → excellent
  });

  it('calculateAccuracy feeds correct values: black accuracy = 100 when all moves are 0 cp loss', async () => {
    getGame.mockResolvedValue(gameWithPgn);
    queueChessApiResponses();

    const { analysis } = await (await POST(makeAnalyzeReq({ gameId: gameA.id }))).json();
    expect(analysis.blackAccuracy).toBe(100);
  });

  it('white accuracy is below 100 when a mistake is recorded', async () => {
    getGame.mockResolvedValue(gameWithPgn);
    queueChessApiResponses();

    const { analysis } = await (await POST(makeAnalyzeReq({ gameId: gameA.id }))).json();
    expect(analysis.whiteAccuracy).toBeLessThan(100);
  });

  // ── Batch completion mechanics ───────────────────────────────────────────────

  it('marks game as completed and calls saveGame + clearGameProgress on full batch', async () => {
    getGame.mockResolvedValue(gameWithPgn);
    queueChessApiResponses();

    const { completed } = await (await POST(makeAnalyzeReq({ gameId: gameA.id }))).json();

    expect(completed).toBe(true);
    expect(saveAnalysis).toHaveBeenCalledOnce();
    expect(saveGame).toHaveBeenCalledOnce();
    expect(clearGameProgress).toHaveBeenCalledOnce();

    const [, savedGame] = saveGame.mock.calls[0];
    expect(savedGame.analysisCompleted).toBe(true);
    expect(savedGame.analysisEngine).toBe('chess-api.com');
  });

  it('does NOT call saveGame or clearGameProgress when batch is incomplete', async () => {
    // Use depth=20 → batchSize=2; only 2 moves in PGN, so it should complete.
    // For an incomplete test, pass a startMoveIndex that exceeds the batch.
    // Easier: mock a longer PGN by providing a game with many moves but only
    // expose 2 api calls. We test incomplete by starting at a later index.
    //
    // Actually, with SIMPLE_PGN (2 moves) and depth=20 batchSize=2:
    //   startMoveIndex=0, endMoveIndex=min(2,2)=2 → completed.
    // Use depth=25 → batchSize=1; startMoveIndex=0, endMoveIndex=1 → not done.

    getSetting.mockImplementation(async (key: string) => {
      if (key === 'analysis_depth') return '25'; // depth > 18 → batchSize = 1
      if (key === 'chesscom_username') return 'testuser';
      return null;
    });
    getGame.mockResolvedValue(gameWithPgn);
    // Only 2 calls needed for batchSize=1 (1 move)
    const makeEval = (v: number) => ({ ok: true, json: async () => ({ eval: v, move: 'e2e4', continuationArr: [] }), text: async () => '' });
    fetchMock.mockResolvedValueOnce(makeEval(0.0)).mockResolvedValueOnce(makeEval(0.3));

    const res = await POST(makeAnalyzeReq({ gameId: gameA.id, startMoveIndex: 0 }));
    const body = await res.json();

    expect(body.completed).toBe(false);
    expect(body.nextMoveIndex).toBe(1);
    expect(saveAnalysis).toHaveBeenCalledOnce();
    expect(saveGame).not.toHaveBeenCalled();    // game NOT yet marked complete
    expect(clearGameProgress).not.toHaveBeenCalled();
  });

  it('analysis includes engine: chess-api.com', async () => {
    getGame.mockResolvedValue(gameWithPgn);
    queueChessApiResponses();

    const { analysis } = await (await POST(makeAnalyzeReq({ gameId: gameA.id }))).json();
    expect(analysis.engine).toBe('chess-api.com');
  });
});

// ─── POST — local Stockfish path ─────────────────────────────────────────────

describe('POST /api/games/analyze — local Stockfish path', () => {
  const getGame      = vi.fn();
  const getSetting   = vi.fn();
  const getAnalysis  = vi.fn();
  const saveAnalysis = vi.fn();
  const saveGame     = vi.fn();
  const clearGameProgress = vi.fn();
  const setGameProgress   = vi.fn();

  // Stockfish mock: constant score of 100cp regardless of position
  const mockAnalyze   = vi.fn();
  const mockTerminate = vi.fn();

  let POST: any;

  beforeAll(async () => {
    // Ensure VERCEL is not set → IS_VERCEL = false
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    vi.resetModules();

    vi.doMock('@/lib/db', () => ({
      getGame, getSetting, getAnalysis, saveAnalysis, saveGame,
      clearGameProgress, setGameProgress, getGameProgress: vi.fn(),
    }));

    vi.doMock('@se-oss/stockfish', () => ({
      Stockfish: vi.fn().mockImplementation(function () {
        return {
          waitReady:  vi.fn().mockResolvedValue(undefined),
          analyze:    mockAnalyze,
          terminate:  mockTerminate,
        };
      }),
    }));

    const mod = await import('@/app/api/games/analyze/route');
    POST = mod.POST;
  });

  afterAll(() => {
    vi.doUnmock('@/lib/db');
    vi.doUnmock('@se-oss/stockfish');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    saveAnalysis.mockResolvedValue(undefined);
    saveGame.mockResolvedValue(undefined);
    clearGameProgress.mockResolvedValue(undefined);
    setGameProgress.mockResolvedValue(undefined);
    getAnalysis.mockResolvedValue(null);
    getSetting.mockImplementation(async (key: string) => {
      if (key === 'analysis_depth') return '10';
      if (key === 'chesscom_username') return 'testuser';
      return null;
    });
    // Return a constant evaluation for every position
    mockAnalyze.mockResolvedValue({
      lines: [{ score: { type: 'cp', value: 50 }, pv: 'e2e4' }],
      bestmove: 'e2e4',
    });
  });

  it('returns 404 when game does not exist', async () => {
    getGame.mockResolvedValue(null);
    expect((await POST(makeAnalyzeReq({ gameId: 'ghost' }))).status).toBe(404);
  });

  it('always marks game as completed (no batching in local mode)', async () => {
    getGame.mockResolvedValue(gameWithPgn);
    const { completed } = await (await POST(makeAnalyzeReq({ gameId: gameA.id }))).json();
    expect(completed).toBe(true);
  });

  it('saves analysis with engine: Stockfish', async () => {
    getGame.mockResolvedValue(gameWithPgn);
    await POST(makeAnalyzeReq({ gameId: gameA.id }));
    const [, analysisData] = saveAnalysis.mock.calls[0];
    expect(analysisData.engine).toBe('Stockfish');
  });

  it('calls saveGame with analysisCompleted: true', async () => {
    getGame.mockResolvedValue(gameWithPgn);
    await POST(makeAnalyzeReq({ gameId: gameA.id }));
    const [, savedGame] = saveGame.mock.calls[0];
    expect(savedGame.analysisCompleted).toBe(true);
  });

  it('calls clearGameProgress after analysis completes', async () => {
    getGame.mockResolvedValue(gameWithPgn);
    await POST(makeAnalyzeReq({ gameId: gameA.id }));
    expect(clearGameProgress).toHaveBeenCalledOnce();
  });

  it('terminates the Stockfish engine when done', async () => {
    getGame.mockResolvedValue(gameWithPgn);
    await POST(makeAnalyzeReq({ gameId: gameA.id }));
    expect(mockTerminate).toHaveBeenCalledOnce();
  });

  it('analysis.moves has one entry per move in the PGN', async () => {
    getGame.mockResolvedValue(gameWithPgn);
    const { analysis } = await (await POST(makeAnalyzeReq({ gameId: gameA.id }))).json();
    // "1. e4 e5" = 2 moves
    expect(analysis.moves).toHaveLength(2);
  });

  it('each move has moveQuality derived from getMoveQuality', async () => {
    getGame.mockResolvedValue(gameWithPgn);
    const { analysis } = await (await POST(makeAnalyzeReq({ gameId: gameA.id }))).json();
    const validQualities = ['excellent', 'good', 'inaccuracy', 'mistake', 'blunder'];
    for (const move of analysis.moves) {
      expect(validQualities).toContain(move.moveQuality);
    }
  });
});
