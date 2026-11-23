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
import { calculateAccuracy, gradedCpLoss } from '@/lib/analysis-utils';

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
  // Forgets, between tests, that chess-api.com failed (the route's copy of the module)
  let resetEngines: () => void;

  beforeAll(async () => {
    process.env.VERCEL = '1';
    process.env.ENGINE_RETRY_PAUSE_MS = '0'; // no real pause before asking the engine again
    process.env.STOCKFISH_ONLINE_SPACING_MS = '0'; // nor between calls to stockfish.online
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
    resetEngines = (await import('@/lib/position-eval-server')).resetPositionEvalCache;
  });

  afterAll(() => {
    delete process.env.VERCEL;
    delete process.env.ENGINE_RETRY_PAUSE_MS;
    delete process.env.STOCKFISH_ONLINE_SPACING_MS;
    vi.unstubAllGlobals();
    vi.doUnmock('@/lib/db');
    vi.doUnmock('@se-oss/stockfish');
    vi.doUnmock('@/lib/opening-book');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    resetEngines();
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
  // PGN: "1. e4 e5" — 2 moves, 3 chess-api.com calls: the start position, then the
  // position after each move (which is also the one the next move is played from).
  //
  // chess-api.com returns eval in pawn units (white-POV, positive = white ahead).
  // Route converts: cpScore = data.eval * 100
  //
  // Call sequence (mocked):
  //   1. Starting pos before e4    → eval: 0.0   → 0cp
  //   2. After e4 (= before e5)    → eval: -2.0  → -200cp   (white blundered)
  //   3. After e5                  → eval: -2.5  → -250cp
  //
  // White move (e4): cpLoss = max(0, 0 − (−200)) = 200 → 'mistake'
  // Black move (e5): cpLoss = max(0, −250 − (−200)) = max(0, −50) = 0 → 'excellent'
  //
  // The positions before each move name an engine best move that is NOT the move
  // played (d2d4 for White, g8f6 for Black). The route zeroes the loss of any move
  // that matches the engine's best move, so reusing the played move here (as an
  // earlier version of this mock did with e2e4) would hide the 200 cp loss.

  const makeEval = (evalPawns: number, move: string) => ({
    ok: true,
    json: async () => ({ eval: evalPawns, move, continuationArr: [] }),
    text: async () => '',
  });

  function queueChessApiResponses() {
    fetchMock
      .mockResolvedValueOnce(makeEval(0.0, 'd2d4'))    // before e4 — engine prefers d4
      .mockResolvedValueOnce(makeEval(-2.0, 'g8f6'))   // after e4, before e5 — engine prefers Nf6
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
    // 4 plies, not yet analysed (other tests mark the shared game analysed)
    getGame.mockResolvedValue({ ...gameWithPgn, pgn: '1. e4 e5 2. Nf3 Nc6', analysisCompleted: false });
    // 3 moves in the batch: the start position, then the position after each move
    for (let i = 0; i < 4; i++) fetchMock.mockResolvedValueOnce(makeEval(0.3, 'd2d4'));

    const res = await POST(makeAnalyzeReq({ gameId: gameA.id, startMoveIndex: 0 }));
    const body = await res.json();

    expect(body.completed).toBe(false);
    expect(body.nextMoveIndex).toBe(3);
    expect(body.analysis.moves).toHaveLength(3);
    expect(saveAnalysis).toHaveBeenCalledOnce();
    expect(saveGame).not.toHaveBeenCalled();    // game NOT yet marked complete
    expect(clearGameProgress).not.toHaveBeenCalled();
  });

  // ── The engine not answering ────────────────────────────────────────────────

  describe('when chess-api.com fails to answer', () => {
    const failure = { ok: false, status: 429, statusText: 'Too Many Requests', json: async () => ({}), text: async () => '' };
    const fourPlies = { ...gameWithPgn, pgn: '1. e4 e5 2. Nf3 Nc6', analysisCompleted: false };

    /** What stockfish.online sends back */
    const sfEval = (evalPawns: number, move: string) => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, evaluation: evalPawns, mate: null, bestmove: `bestmove ${move}`, continuation: move }),
    });
    /** Answers each engine API from its own queue of replies, in turn; an empty queue is a network error */
    function engines(chessApi: object[], stockfishOnline: object[] = []) {
      fetchMock.mockImplementation(async (url: string) => {
        const next = (String(url).includes('stockfish.online') ? stockfishOnline : chessApi).shift();
        if (!next) throw new TypeError('fetch failed');
        return next;
      });
    }
    const asked = () => fetchMock.mock.calls.map(([url]) => new URL(String(url)).hostname);

    beforeEach(() => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('asks stockfish.online instead, and carries on with it', async () => {
      getGame.mockResolvedValue({ ...fourPlies, pgn: '1. e4 e5' });
      engines([failure], [sfEval(0.3, 'd2d4'), sfEval(0.3, 'g8f6'), sfEval(0.3, 'd2d4')]);

      const body = await (await POST(makeAnalyzeReq({ gameId: gameA.id }))).json();

      expect(body).toMatchObject({ completed: true, stalled: false });
      expect(body.analysis.moves.map((m: { move: string }) => m.move)).toEqual(['e4', 'e5']);
      expect(body.analysis.moves.map((m: { bestMove: string }) => m.bestMove)).toEqual(['d2d4', 'g8f6']);
      // chess-api.com once; after that it is passed over rather than waited on for every position
      expect(asked()).toEqual(['chess-api.com', 'stockfish.online', 'stockfish.online', 'stockfish.online']);
      expect(body.analysis.engine).toBe('stockfish.online');
      expect(saveGame.mock.calls[0][1].analysisEngine).toBe('stockfish.online');
    });

    it('asks again once when neither engine answers, and carries on when the second try does', async () => {
      getGame.mockResolvedValue({ ...fourPlies, pgn: '1. e4 e5' });
      engines([failure], [failure, sfEval(0.3, 'd2d4'), sfEval(0.3, 'g8f6'), sfEval(0.3, 'd2d4')]);

      const body = await (await POST(makeAnalyzeReq({ gameId: gameA.id }))).json();

      expect(body).toMatchObject({ completed: true, stalled: false });
      expect(body.analysis.moves.map((m: { move: string }) => m.move)).toEqual(['e4', 'e5']);
    });

    it('measures a move with one engine: when chess-api.com fails between its two positions, the one before is asked of stockfish.online too', async () => {
      getGame.mockResolvedValue({ ...fourPlies, pgn: '1. e4 e5' });
      engines(
        [makeEval(1.0, 'd2d4'), failure],     // e4 before: +1.0 says chess-api.com; e4 after: refused
        [
          sfEval(0.2, 'e7e5'),                 // e4 after (and e5 before)
          sfEval(0.2, 'g1f3'),                 // e4 before, again: +0.2 says stockfish.online
          sfEval(0.2, 'd2d4'),                 // e5 after
        ],
      );

      const body = await (await POST(makeAnalyzeReq({ gameId: gameA.id }))).json();

      // Not the 80 cp that +1.0 from one engine and +0.2 from the other would make it
      expect(body.analysis.moves[0]).toMatchObject({ move: 'e4', centipawnLoss: 0, bestMove: 'g1f3' });
      expect(body.analysis.engine).toBe('stockfish.online');
    });

    it('stops at that move if stockfish.online can’t evaluate the position before it', async () => {
      getGame.mockResolvedValue(fourPlies);
      engines([makeEval(1.0, 'd2d4'), failure], [sfEval(0.2, 'e7e5'), failure, failure]);

      const body = await (await POST(makeAnalyzeReq({ gameId: gameA.id }))).json();

      expect(body).toMatchObject({ completed: false, stalled: true, nextMoveIndex: 0 });
    });

    it('names both engines when they shared the game, across batches', async () => {
      getGame.mockResolvedValue({ ...fourPlies, pgn: '1. e4 e5' });
      getAnalysis.mockResolvedValue({
        engine: 'chess-api.com',
        moves: [{ moveNumber: 1, color: 'white', move: 'e4', centipawnLoss: 0, gradedLoss: 0 }],
      });
      engines([failure], [sfEval(0.3, 'g8f6'), sfEval(0.3, 'd2d4')]);

      const body = await (await POST(makeAnalyzeReq({ gameId: gameA.id, startMoveIndex: 1 }))).json();

      expect(body).toMatchObject({ completed: true, stalled: false });
      expect(body.analysis.engine).toBe('chess-api.com + stockfish.online');
      expect(saveGame.mock.calls[0][1].analysisEngine).toBe('chess-api.com + stockfish.online');
    });

    it('stops at a move it still can’t evaluate, never skipping it, and says where to resume', async () => {
      getGame.mockResolvedValue(fourPlies);
      engines(
        [makeEval(0.3, 'd2d4'), makeEval(0.3, 'e7e5'), failure], // e4 before and after; e5 after: refused
        [failure, failure],                                     // …and by stockfish.online, twice
      );
      // (anything after would be Nf3 — it must not be reached)

      const body = await (await POST(makeAnalyzeReq({ gameId: gameA.id }))).json();

      expect(body).toMatchObject({ success: true, completed: false, stalled: true, nextMoveIndex: 1 });
      expect(body.analysis.moves.map((m: { move: string }) => m.move)).toEqual(['e4']);
      expect(asked()).toEqual(['chess-api.com', 'chess-api.com', 'chess-api.com', 'stockfish.online', 'stockfish.online']);
      expect(saveAnalysis).toHaveBeenCalledOnce();         // e4 is kept
      expect(saveGame).not.toHaveBeenCalled();             // and the game is not marked analysed
    });

    it('stops on the position after a move too', async () => {
      getGame.mockResolvedValue(fourPlies);
      engines([makeEval(0.3, 'd2d4'), failure], [failure, failure]); // e4 before; e4 after: refused by both

      const body = await (await POST(makeAnalyzeReq({ gameId: gameA.id }))).json();

      expect(body).toMatchObject({ completed: false, stalled: true, nextMoveIndex: 0 });
    });

    it('resumes from that move, keeping the moves already done', async () => {
      getGame.mockResolvedValue({ ...fourPlies, pgn: '1. e4 e5' });
      getAnalysis.mockResolvedValue({ moves: [{ moveNumber: 1, color: 'white', move: 'e4', centipawnLoss: 0, gradedLoss: 0 }] });
      fetchMock.mockResolvedValueOnce(makeEval(0.3, 'g8f6')).mockResolvedValueOnce(makeEval(0.3, 'd2d4'));

      const body = await (await POST(makeAnalyzeReq({ gameId: gameA.id, startMoveIndex: 1 }))).json();

      expect(body).toMatchObject({ completed: true, stalled: false });
      expect(body.analysis.moves.map((m: { move: string }) => m.move)).toEqual(['e4', 'e5']);
    });

    it('writes nothing when it stops before evaluating a single move, so a finished analysis survives a failed re-run', async () => {
      getGame.mockResolvedValue({ ...fourPlies, analysisCompleted: true });
      fetchMock.mockResolvedValue(failure);

      const body = await (await POST(makeAnalyzeReq({ gameId: gameA.id, startMoveIndex: 0 }))).json();

      expect(body).toMatchObject({ success: true, completed: false, stalled: true, nextMoveIndex: 0 });
      expect(saveAnalysis).not.toHaveBeenCalled();
      expect(saveGame).not.toHaveBeenCalled();
    });

    it('works out a final checkmate itself, which chess-api.com won’t evaluate, so the last move isn’t lost', async () => {
      getGame.mockResolvedValue({ ...fourPlies, pgn: '1. f3 e5 2. g4 Qh4#' });
      // Four positions go to the engine; the mate after 2...Qh4# does not
      for (let i = 0; i < 4; i++) fetchMock.mockResolvedValueOnce(makeEval(-0.5, 'a2a3'));

      const body = await (await POST(makeAnalyzeReq({ gameId: gameA.id }))).json();

      expect(body).toMatchObject({ completed: true, stalled: false });
      expect(fetchMock).toHaveBeenCalledTimes(4);
      const mate = body.analysis.moves.at(-1);
      expect(mate).toMatchObject({ move: 'Qh4#', evaluation: -100, centipawnLoss: 0 });
    });

    it('sends the engine positions without an en passant square, which it rejects', async () => {
      // 1. e4 c5 2. e5 d5: exd6 e.p. is possible, so chess.js writes "d6" after 2...d5
      getGame.mockResolvedValue({ ...fourPlies, pgn: '1. e4 c5 2. e5 d5' });
      for (let i = 0; i < 5; i++) fetchMock.mockResolvedValueOnce(makeEval(0.3, 'a2a3'));

      const body = await (await POST(makeAnalyzeReq({ gameId: gameA.id }))).json();

      expect(body).toMatchObject({ completed: true, stalled: false });
      const sent = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).fen.split(' ')[3]);
      expect(sent).toHaveLength(5); // the last one is the position after 2...d5
      expect(sent.every((ep: string) => ep === '-')).toBe(true);
    });

    it('stops at a move whose evaluation throws, rather than skipping it', async () => {
      getGame.mockResolvedValue({ ...fourPlies, pgn: '1. e4 e5' });
      isBookMove.mockRejectedValueOnce(new Error('book unreadable'));

      const body = await (await POST(makeAnalyzeReq({ gameId: gameA.id }))).json();

      expect(body).toMatchObject({ completed: false, stalled: true, nextMoveIndex: 0 });
    });
  });

  it('marks a game analysed before as not analysed while a re-run is still unfinished', async () => {
    getSetting.mockImplementation(async (key: string) => {
      if (key === 'analysis_depth') return '25';
      if (key === 'chesscom_username') return 'testuser';
      return null;
    });
    getGame.mockResolvedValue({ ...gameWithPgn, pgn: '1. e4 e5 2. Nf3 Nc6', analysisCompleted: true });
    for (let i = 0; i < 4; i++) fetchMock.mockResolvedValueOnce(makeEval(0.3, 'd2d4'));

    const body = await (await POST(makeAnalyzeReq({ gameId: gameA.id, startMoveIndex: 0 }))).json();

    expect(body.completed).toBe(false);
    expect(saveGame).toHaveBeenCalledOnce();
    expect(saveGame.mock.calls[0][1]).toMatchObject({ analysisCompleted: false });
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

  it('counts the moves of earlier batches by their graded loss, as getAnalysis read them', async () => {
    getGame.mockResolvedValue({ ...gameWithPgn, pgn: '1. e4 e5 2. Nf3 Nc6' });
    getAnalysis.mockResolvedValue({
      moves: [
        { moveNumber: 1, color: 'white', move: 'e4', centipawnLoss: 0, gradedLoss: 0 },
        { moveNumber: 1, color: 'black', move: 'e5', centipawnLoss: 0, gradedLoss: 0 },
        // A pawn given away in a won game: graded 35
        { moveNumber: 2, color: 'white', move: 'Nf3', evaluation: 4, centipawnLoss: 100, gradedLoss: 35 },
      ],
    });
    fetchMock.mockResolvedValueOnce(makeEval(4.0, 'b8c6')).mockResolvedValueOnce(makeEval(4.0, 'd2d4'));

    const body = await (await POST(makeAnalyzeReq({ gameId: gameA.id, startMoveIndex: 3 }))).json();

    expect(body.analysis.whiteAccuracy).toBe(calculateAccuracy([0, 35]));
  });

  it('evaluates each position once: the one after a move is the one the next move is played from', async () => {
    getGame.mockResolvedValue({ ...gameWithPgn, pgn: '1. e4 e5 2. Nf3 Nc6' });
    fetchMock
      .mockResolvedValueOnce(makeEval(0.3, 'd2d4'))    // the start
      .mockResolvedValueOnce(makeEval(0.3, 'c7c5'))    // after e4
      .mockResolvedValueOnce(makeEval(0.3, 'd2d4'))    // after e5
      .mockResolvedValueOnce(makeEval(0.3, 'b8c6'))    // after Nf3
      .mockResolvedValueOnce(makeEval(0.3, 'd2d4'));   // after Nc6

    const { analysis, completed } = await (await POST(makeAnalyzeReq({ gameId: gameA.id }))).json();

    expect(completed).toBe(true);
    const fens = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).fen);
    expect(fens).toHaveLength(5);
    expect(new Set(fens).size).toBe(5);
    // Each move's best move comes from the evaluation after the move before it
    expect(analysis.moves.map((m: { bestMove: string }) => m.bestMove)).toEqual(['d2d4', 'c7c5', 'd2d4', 'b8c6']);
  });

  it('begins no move once the batch’s time is up, leaving the rest to the next batch', async () => {
    process.env.ANALYSIS_BATCH_BUDGET_MS = '-1'; // already out of time once the first move is done
    try {
      getGame.mockResolvedValue({ ...gameWithPgn, pgn: '1. e4 e5 2. Nf3 Nc6', analysisCompleted: false });
      fetchMock.mockResolvedValue(makeEval(0.3, 'd2d4'));

      const body = await (await POST(makeAnalyzeReq({ gameId: gameA.id }))).json();

      // One move is always made, so every batch gets somewhere
      expect(body).toMatchObject({ success: true, completed: false, stalled: false, nextMoveIndex: 1 });
      expect(body.analysis.moves.map((m: { move: string }) => m.move)).toEqual(['e4']);
      expect(saveAnalysis).toHaveBeenCalledOnce();
      expect(saveGame).not.toHaveBeenCalled();
    } finally {
      delete process.env.ANALYSIS_BATCH_BUDGET_MS;
    }
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
    // so the two searches disagreeing is treated as noise.
    fetchMock
      .mockResolvedValueOnce(makeEval(0.0, 'e2e4'))
      .mockResolvedValueOnce(makeEval(-2.0, 'g8f6'))
      .mockResolvedValueOnce(makeEval(-2.5, 'd2d4'));

    const { analysis } = await (await POST(makeAnalyzeReq({ gameId: gameA.id }))).json();
    const white = analysis.moves.find((m: any) => m.color === 'white');
    expect(white.centipawnLoss).toBe(0);
    expect(white.moveQuality).toBe('excellent');
  });

  it('grades a pawn given away in a won game for less, keeping what was actually lost', async () => {
    // 1. e4 e5 2. Nf3 Nc6 with White already +5; Nf3 drops it to +4
    getGame.mockResolvedValue({ ...gameWithPgn, pgn: '1. e4 e5 2. Nf3 Nc6' });
    fetchMock
      .mockResolvedValueOnce(makeEval(5.0, 'e2e4'))   // before e4 (e4 is the best move)
      .mockResolvedValueOnce(makeEval(5.0, 'e7e5'))   // after e4, before e5 (e5 is the best move)
      .mockResolvedValueOnce(makeEval(5.0, 'd2d4'))   // after e5, before Nf3
      .mockResolvedValueOnce(makeEval(4.0, 'b8c6'))   // after Nf3: White gave a pawn away (Nc6 is the best move)
      .mockResolvedValueOnce(makeEval(4.0, 'd2d4'));  // after Nc6

    const { analysis } = await (await POST(makeAnalyzeReq({ gameId: gameA.id }))).json();
    const nf3 = analysis.moves.find((m: { move: string }) => m.move === 'Nf3');

    expect(nf3).toMatchObject({ centipawnLoss: 100, gradedLoss: 35, moveQuality: 'good' }); // not an inaccuracy
    expect(analysis.whiteAccuracy).toBe(calculateAccuracy([0, 35]));
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
        .mockResolvedValueOnce(makeEval(-2.0, 'g8f6'))   // after e4, before e5
        .mockResolvedValueOnce(makeEval(-2.0, 'd2d4'))   // after e5, before Nf3   (Black loses nothing)
        .mockResolvedValueOnce(makeEval(-3.0, 'g8f6'))   // after Nf3, before Nc6  (White loses 100 cp)
        .mockResolvedValueOnce(makeEval(-3.0, 'd2d4'));  // after Nc6
      isBookMove.mockImplementation(async (_fen: string, uci: string) => uci === 'e2e4');

      const { analysis } = await (await POST(makeAnalyzeReq({ gameId: gameA.id }))).json();
      const [book, slip] = analysis.moves.filter((m: { color: string }) => m.color === 'white');

      expect(book.moveQuality).toBe('book');
      expect(slip.centipawnLoss).toBe(100);
      // The slip goes from -2 to -3, with the game already going badly, so the grade
      // counts it as 69, not 100
      expect(slip.gradedLoss).toBe(gradedCpLoss(100, -300));
      expect(slip.gradedLoss).toBe(69);
      // mean of a perfect move and the slip, not the slip on its own
      expect(analysis.whiteAccuracy).toBe(calculateAccuracy([0, 69]));
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
    expect(slip.gradedLoss).toBe(69); // -2 → -3: counted for less, the game already going badly
    expect(analysis.whiteAccuracy).toBe(calculateAccuracy([0, 69]));
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
