/**
 * Tier 5 — POST /api/games/analyze
 *
 * IS_VERCEL is a module-level constant, so we need vi.doMock + vi.resetModules()
 * + a dynamic import inside beforeAll to force its value per describe block.
 * vi.doMock (unlike vi.mock) is NOT hoisted, so it can be called inside functions.
 *
 * @/lib/opening-book is mocked in every POST block. The real isBookMove() reads
 * public/books/opening-book.bin, and any real book lists 1. e4 e5 — so without
 * the mock these tests would silently depend on whatever book file is on disk.
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
  const isBookMove        = vi.fn();

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
    vi.doMock('@/lib/opening-book', () => ({ isBookMove }));

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
    vi.doUnmock('@/lib/opening-book');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    isBookMove.mockResolvedValue(false); // out of book unless a test says otherwise
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
  //
  // The "before" responses name an engine best move that is NOT the move played
  // (d2d4 for White, g8f6 for Black). The route zeroes the loss of any move that
  // matches the engine's best move, so reusing the played move here (as an
  // earlier version of this mock did with e2e4) would hide the 200 cp loss.

  const makeEval = (evalPawns: number, move: string) => ({
    ok: true,
    json: async () => ({ eval: evalPawns, move, continuationArr: [] }),
    text: async () => '',
  });

  function queueChessApiResponses() {
    fetchMock
      .mockResolvedValueOnce(makeEval(0.0, 'd2d4'))    // before e4 — engine prefers d4
      .mockResolvedValueOnce(makeEval(-2.0, 'e7e5'))   // after e4
      .mockResolvedValueOnce(makeEval(-2.0, 'g8f6'))   // before e5 — engine prefers Nf6
      .mockResolvedValueOnce(makeEval(-2.5, 'd2d4'));  // after e5
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
    // The route sizes batches by depth to fit the 60 s limit:
    //   depth ≤ 10 → 12 moves, ≤ 14 → 8, ≤ 18 → 5, deeper → 3.
    // At depth 25 a batch is 3 moves, so a 4-move game is NOT finished by the
    // first batch (the old 2-move PGN always fit in a single batch).
    getSetting.mockImplementation(async (key: string) => {
      if (key === 'analysis_depth') return '25';
      if (key === 'chesscom_username') return 'testuser';
      return null;
    });
    getGame.mockResolvedValue({ ...gameWithPgn, pgn: '1. e4 e5 2. Nf3 Nc6' }); // 4 plies
    // 3 moves in the batch × 2 evaluations each (before and after the move)
    for (let i = 0; i < 6; i++) fetchMock.mockResolvedValueOnce(makeEval(0.3, 'd2d4'));

    const res = await POST(makeAnalyzeReq({ gameId: gameA.id, startMoveIndex: 0 }));
    const body = await res.json();

    expect(body.completed).toBe(false);
    expect(body.nextMoveIndex).toBe(3);
    expect(body.analysis.moves).toHaveLength(3);
    expect(saveAnalysis).toHaveBeenCalledOnce();
    expect(saveGame).not.toHaveBeenCalled();    // game NOT yet marked complete
    expect(clearGameProgress).not.toHaveBeenCalled();
  });

  it('finishes the game on the following batch', async () => {
    getSetting.mockImplementation(async (key: string) => {
      if (key === 'analysis_depth') return '25';
      if (key === 'chesscom_username') return 'testuser';
      return null;
    });
    getGame.mockResolvedValue({ ...gameWithPgn, pgn: '1. e4 e5 2. Nf3 Nc6' });
    // The first batch's moves are already stored; the second batch adds the last ply.
    getAnalysis.mockResolvedValue({
      moves: [
        { moveNumber: 1, color: 'white', move: 'e4', centipawnLoss: 0 },
        { moveNumber: 1, color: 'black', move: 'e5', centipawnLoss: 0 },
        { moveNumber: 2, color: 'white', move: 'Nf3', centipawnLoss: 0 },
      ],
    });
    fetchMock.mockResolvedValueOnce(makeEval(0.3, 'd2d4')).mockResolvedValueOnce(makeEval(0.3, 'd2d4'));

    const body = await (await POST(makeAnalyzeReq({ gameId: gameA.id, startMoveIndex: 3 }))).json();

    expect(body.completed).toBe(true);
    expect(body.analysis.moves).toHaveLength(4);
    expect(saveGame).toHaveBeenCalledOnce();
    expect(clearGameProgress).toHaveBeenCalledOnce();
  });

  it('analysis includes engine: chess-api.com', async () => {
    getGame.mockResolvedValue(gameWithPgn);
    queueChessApiResponses();

    const { analysis } = await (await POST(makeAnalyzeReq({ gameId: gameA.id }))).json();
    expect(analysis.engine).toBe('chess-api.com');
  });

  it('zeroes the loss when the player played the engine’s best move', async () => {
    getGame.mockResolvedValue(gameWithPgn);
    // Same evals as the mistake scenario, but the engine's pick for White IS e2e4,
    // so the two independent evaluations disagreeing is treated as noise.
    fetchMock
      .mockResolvedValueOnce(makeEval(0.0, 'e2e4'))
      .mockResolvedValueOnce(makeEval(-2.0, 'e7e5'))
      .mockResolvedValueOnce(makeEval(-2.0, 'g8f6'))
      .mockResolvedValueOnce(makeEval(-2.5, 'd2d4'));

    const { analysis } = await (await POST(makeAnalyzeReq({ gameId: gameA.id }))).json();
    const white = analysis.moves.find((m: any) => m.color === 'white');
    expect(white.centipawnLoss).toBe(0);
    expect(white.moveQuality).toBe('excellent');
  });

  // ── Opening book ────────────────────────────────────────────────────────────

  describe('opening book moves', () => {
    it('are labelled "book" with zero loss, keep their evaluation, and count as perfect moves in accuracy', async () => {
      getGame.mockResolvedValue(gameWithPgn);
      queueChessApiResponses(); // White's e4 would be a 200 cp mistake if it counted
      isBookMove.mockImplementation(async (_fen: string, uci: string) => uci === 'e2e4');

      const { analysis } = await (await POST(makeAnalyzeReq({ gameId: gameA.id }))).json();
      const white = analysis.moves.find((m: any) => m.color === 'white');
      const black = analysis.moves.find((m: any) => m.color === 'black');

      expect(white.moveQuality).toBe('book');
      expect(white.centipawnLoss).toBe(0);
      expect(white.evaluation).toBe(-2); // still stored, so the eval chart has no gap
      expect(black.moveQuality).toBe('excellent'); // not in book → graded normally

      // White's only move is a book move → nothing counts against White's accuracy.
      expect(analysis.whiteAccuracy).toBe(100);
    });

    it('count in the average as perfect moves: a book move softens a later slip rather than being ignored', async () => {
      // 1. e4 e5 2. Nf3 Nc6. White: e4 (book, would have been a 200 cp loss) then Nf3 losing 100 cp.
      getGame.mockResolvedValue({ ...gameWithPgn, pgn: '1. e4 e5 2. Nf3 Nc6' });
      fetchMock
        .mockResolvedValueOnce(makeEval(0.0, 'd2d4'))    // before e4
        .mockResolvedValueOnce(makeEval(-2.0, 'e7e5'))   // after e4
        .mockResolvedValueOnce(makeEval(-2.0, 'g8f6'))   // before e5
        .mockResolvedValueOnce(makeEval(-2.0, 'd2d4'))   // after e5   (Black loses nothing)
        .mockResolvedValueOnce(makeEval(-2.0, 'd2d4'))   // before Nf3
        .mockResolvedValueOnce(makeEval(-3.0, 'b8c6'))   // after Nf3  (White loses 100 cp)
        .mockResolvedValueOnce(makeEval(-3.0, 'g8f6'))   // before Nc6
        .mockResolvedValueOnce(makeEval(-3.0, 'd2d4'));  // after Nc6
      isBookMove.mockImplementation(async (_fen: string, uci: string) => uci === 'e2e4');

      const { analysis } = await (await POST(makeAnalyzeReq({ gameId: gameA.id }))).json();
      const [book, slip] = analysis.moves.filter((m: { color: string }) => m.color === 'white');

      expect(book.moveQuality).toBe('book');
      expect(slip.centipawnLoss).toBe(100);
      // mean of a perfect move (100) and a 100 cp slip (36.8), not the slip on its own
      expect(analysis.whiteAccuracy).toBe(68.4);
      expect(analysis.blackAccuracy).toBe(100);
    });

    it('do not shield later moves: a non-book mistake still lowers accuracy', async () => {
      getGame.mockResolvedValue(gameWithPgn);
      queueChessApiResponses();
      isBookMove.mockResolvedValue(false);

      const { analysis } = await (await POST(makeAnalyzeReq({ gameId: gameA.id }))).json();
      expect(analysis.whiteAccuracy).toBeLessThan(100);
    });

    it('are looked up by the position before the move, with the move in UCI', async () => {
      getGame.mockResolvedValue(gameWithPgn);
      queueChessApiResponses();

      await POST(makeAnalyzeReq({ gameId: gameA.id }));

      expect(isBookMove).toHaveBeenCalledTimes(2);
      expect(isBookMove).toHaveBeenNthCalledWith(
        1,
        'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        'e2e4',
      );
      expect(isBookMove).toHaveBeenNthCalledWith(
        2,
        'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
        'e7e5',
      );
    });
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
  const isBookMove        = vi.fn();

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

    vi.doMock('@/lib/opening-book', () => ({ isBookMove }));

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
    vi.doUnmock('@/lib/opening-book');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    isBookMove.mockResolvedValue(false); // out of book unless a test says otherwise
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
    // Out of book (isBookMove is mocked false), so every move is graded by loss.
    const validQualities = ['excellent', 'good', 'inaccuracy', 'mistake', 'blunder'];
    for (const move of analysis.moves) {
      expect(validQualities).toContain(move.moveQuality);
    }
  });

  it('labels book moves "book" with zero loss and counts them as perfect moves in accuracy', async () => {
    getGame.mockResolvedValue(gameWithPgn);
    isBookMove.mockResolvedValue(true);

    const { analysis } = await (await POST(makeAnalyzeReq({ gameId: gameA.id }))).json();
    expect(analysis.moves).toHaveLength(2);
    for (const move of analysis.moves) {
      expect(move.moveQuality).toBe('book');
      expect(move.centipawnLoss).toBe(0);
    }
    // Nothing but book moves → every move is perfect.
    expect(analysis.whiteAccuracy).toBe(100);
    expect(analysis.blackAccuracy).toBe(100);
  });

  it('counts a book move in the average as a perfect move, softening a later slip', async () => {
    // 1. e4 e5 2. Nf3 Nc6, scores as the engine reports them (side to move's point of view).
    // White: e4 (book, would have been a 200 cp loss), then Nf3 losing 100 cp.
    getGame.mockResolvedValue({ ...gameWithPgn, pgn: '1. e4 e5 2. Nf3 Nc6' });
    isBookMove.mockImplementation(async (_fen: string, uci: string) => uci === 'e2e4');
    const score = (value: number) => ({ lines: [{ score: { type: 'cp', value }, pv: 'd2d4' }], bestmove: 'd2d4' });
    mockAnalyze.mockReset();
    mockAnalyze
      .mockResolvedValueOnce(score(0))      // before e4        (White to move)
      .mockResolvedValueOnce(score(200))    // after e4         (Black to move: Black +200)
      .mockResolvedValueOnce(score(200))    // before e5        (Black to move)
      .mockResolvedValueOnce(score(-200))   // after e5         (White to move: White -200)
      .mockResolvedValueOnce(score(-200))   // before Nf3
      .mockResolvedValueOnce(score(300))    // after Nf3        (Black +300: White lost 100 cp)
      .mockResolvedValueOnce(score(300))    // before Nc6
      .mockResolvedValueOnce(score(-300));  // after Nc6

    const { analysis } = await (await POST(makeAnalyzeReq({ gameId: gameA.id }))).json();
    const [book, slip] = analysis.moves.filter((m: { color: string }) => m.color === 'white');

    expect(book.moveQuality).toBe('book');
    expect(slip.centipawnLoss).toBe(100);
    expect(analysis.whiteAccuracy).toBe(68.4);
    expect(analysis.blackAccuracy).toBe(100);
  });

  it('asks the book about the position before each move, with the move in UCI', async () => {
    getGame.mockResolvedValue(gameWithPgn);

    await POST(makeAnalyzeReq({ gameId: gameA.id }));

    expect(isBookMove).toHaveBeenCalledTimes(2);
    expect(isBookMove).toHaveBeenNthCalledWith(
      1,
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      'e2e4',
    );
    expect(isBookMove).toHaveBeenNthCalledWith(
      2,
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
      'e7e5',
    );
  });
});
