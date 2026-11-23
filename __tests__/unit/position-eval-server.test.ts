import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CHESS_API_REST_MS,
  EVAL_CACHE_MAX_ENTRIES,
  EVAL_CACHE_TTL_MS,
  fetchChessApiEval,
  fetchEngineEval,
  fetchStockfishOnlineEval,
  getPositionEval,
  positionKey,
  resetPositionEvalCache,
} from '@/lib/position-eval-server';

// ─── helpers ──────────────────────────────────────────────────────────────────

process.env.STOCKFISH_ONLINE_SPACING_MS = '0'; // no real wait between calls to stockfish.online, unless a test sets one

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const WHITE_MATED = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';

const reply = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as unknown as Response;
/** What chess-api.com sends back, trimmed to the fields that matter. */
const evalReply = (pawns: number, over: Record<string, unknown> = {}) =>
  reply({ type: 'bestmove', eval: pawns, mate: null, depth: 12, ...over });
/** What stockfish.online sends back. */
const sfReply = (pawns: number, over: Record<string, unknown> = {}) =>
  reply({ success: true, evaluation: pawns, mate: null, bestmove: 'bestmove g1f3 ponder g8f6', continuation: 'g1f3 g8f6', ...over });

type Reply = Response | Error;

/** Answers each engine API from its own queue of replies; an empty queue is a network error. */
function fakeEngines(chessApi: Reply[], stockfishOnline: Reply[] = []) {
  const queues: Record<string, Reply[]> = { 'chess-api.com': [...chessApi], 'stockfish.online': [...stockfishOnline] };
  return vi.fn<typeof fetch>(async input => {
    const host = new URL(String(input)).hostname;
    const next = queues[host]?.shift();
    if (!next) throw new TypeError(`fetch failed (no more ${host} replies)`);
    if (next instanceof Error) throw next;
    return next;
  });
}
/** chess-api.com only (stockfish.online, if asked, fails). */
const fakeFetch = (...replies: Reply[]) => fakeEngines(replies);
const hosts = (fn: ReturnType<typeof fakeEngines>) => fn.mock.calls.map(([input]) => new URL(String(input)).hostname);

/** A distinct, valid position per (knight, bishop) square pair. */
function uniqueFen(n: number): string {
  const squares = [...Array(64).keys()].filter(s => s !== 0 && s !== 63); // not a1/h8: the kings live there
  const knight = squares[n % squares.length];
  const bishop = squares[(Math.floor(n / squares.length) + 7 + n) % squares.length] === knight
    ? squares[(n + 1) % squares.length]
    : squares[(Math.floor(n / squares.length) + 7 + n) % squares.length];
  const board = Array<string>(64).fill('');
  board[0] = 'K'; // a1
  board[63] = 'k'; // h8
  board[knight] = 'n';
  if (board[bishop] === '') board[bishop] = 'B';
  const ranks: string[] = [];
  for (let r = 7; r >= 0; r--) {
    let row = '';
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const piece = board[r * 8 + f];
      if (piece) { if (empty) row += empty; empty = 0; row += piece; } else empty++;
    }
    ranks.push(row + (empty || ''));
  }
  return `${ranks.join('/')} w - - 0 1`;
}

beforeEach(() => resetPositionEvalCache());

// ─── positionKey ──────────────────────────────────────────────────────────────

describe('positionKey', () => {
  it('ignores the move counters, which do not change the position', () => {
    expect(positionKey('8/8/8/4k3/8/8/4K3/R7 w - - 0 1', 12)).toBe(positionKey('8/8/8/4k3/8/8/4K3/R7 w - - 37 60', 12));
  });

  it('tells apart different positions, sides to move and depths', () => {
    const base = positionKey('8/8/8/4k3/8/8/4K3/R7 w - - 0 1', 12);
    expect(positionKey('8/8/8/4k3/8/8/4K3/R7 b - - 0 1', 12)).not.toBe(base);
    expect(positionKey('8/8/8/4k3/8/8/4K3/7R w - - 0 1', 12)).not.toBe(base);
    expect(positionKey('8/8/8/4k3/8/8/4K3/R7 w - - 0 1', 14)).not.toBe(base);
  });
});

// ─── fetchChessApiEval ────────────────────────────────────────────────────────

describe('fetchChessApiEval', () => {
  it('posts the position and depth to chess-api.com and returns the evaluation', async () => {
    const fetchFn = fakeFetch(evalReply(0.3));
    const result = await fetchChessApiEval(START_FEN, 12, fetchFn);

    expect(result).toEqual({ pawns: 0.3, mate: null, depth: 12, bestMove: '', pv: [], engine: 'chess-api.com' });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://chess-api.com/v1');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ fen: START_FEN, depth: 12 });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns its best move and line, the line as an array or a string', async () => {
    const asArray = await fetchChessApiEval(START_FEN, 12, fakeFetch(evalReply(0.3, { move: 'e2e4', continuationArr: ['e2e4', 'e7e5'] })));
    const asString = await fetchChessApiEval(START_FEN, 12, fakeFetch(evalReply(0.3, { move: 'e2e4', continuationArr: 'e2e4 e7e5' })));

    expect(asArray).toMatchObject({ bestMove: 'e2e4', pv: ['e2e4', 'e7e5'] });
    expect(asString).toMatchObject({ bestMove: 'e2e4', pv: ['e2e4', 'e7e5'] });
  });

  it('sends a position without its en passant square, which the engine would reject', async () => {
    const fetchFn = fakeFetch(evalReply(-0.34));
    await fetchChessApiEval('r1bqkb1r/pp2pppp/1nn5/2ppP3/8/1BP2N2/PP1P1PPP/RNBQK2R w KQkq d6 0 7', 12, fetchFn);
    expect(JSON.parse(fetchFn.mock.calls[0][1]?.body as string).fen)
      .toBe('r1bqkb1r/pp2pppp/1nn5/2ppP3/8/1BP2N2/PP1P1PPP/RNBQK2R w KQkq - 0 7');
  });

  it('fails on an error status', async () => {
    await expect(fetchChessApiEval(START_FEN, 12, fakeFetch(reply({}, false, 503)))).rejects.toThrow('returned 503');
  });

  it('fails on the HTTP-200 error replies, saying why', async () => {
    const bad = reply({ type: 'error', error: 'INVALID_FEN', text: 'Invalid FEN' });
    await expect(fetchChessApiEval(START_FEN, 12, fakeFetch(bad))).rejects.toThrow('INVALID_FEN');
  });

  it('fails on a reply with no evaluation', async () => {
    await expect(fetchChessApiEval(START_FEN, 12, fakeFetch(reply({ type: 'bestmove' })))).rejects.toThrow('no evaluation');
  });

  it('passes a network error through', async () => {
    await expect(fetchChessApiEval(START_FEN, 12, fakeFetch(new TypeError('fetch failed')))).rejects.toThrow('fetch failed');
  });
});

// ─── fetchStockfishOnlineEval ─────────────────────────────────────────────────

describe('fetchStockfishOnlineEval', () => {
  it('asks stockfish.online for the position and depth, and returns its evaluation, best move and line', async () => {
    const fetchFn = fakeEngines([], [sfReply(0.46)]);
    const result = await fetchStockfishOnlineEval(START_FEN, 12, fetchFn);

    expect(result).toEqual({ pawns: 0.46, mate: null, depth: 12, bestMove: 'g1f3', pv: ['g1f3', 'g8f6'], engine: 'stockfish.online' });
    const [url, init] = fetchFn.mock.calls[0];
    const asked = new URL(String(url));
    expect(asked.origin + asked.pathname).toBe('https://stockfish.online/api/s/v2.php');
    expect(asked.searchParams.get('fen')).toBe(START_FEN);
    expect(asked.searchParams.get('depth')).toBe('12');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('searches no deeper than the 15 it allows, and says so', async () => {
    const fetchFn = fakeEngines([], [sfReply(0.3)]);
    const result = await fetchStockfishOnlineEval(START_FEN, 20, fetchFn);

    expect(new URL(String(fetchFn.mock.calls[0][0])).searchParams.get('depth')).toBe('15');
    expect(result.depth).toBe(15);
  });

  it('keeps the en passant square, which it takes', async () => {
    const fen = 'r1bqkb1r/pp2pppp/1nn5/2ppP3/8/1BP2N2/PP1P1PPP/RNBQK2R w KQkq d6 0 7';
    const fetchFn = fakeEngines([], [sfReply(0.3)]);
    await fetchStockfishOnlineEval(fen, 12, fetchFn);

    expect(new URL(String(fetchFn.mock.calls[0][0])).searchParams.get('fen')).toBe(fen);
  });

  it('spaces its calls out, keeping under the rate limit, even when they are asked for at once', async () => {
    process.env.STOCKFISH_ONLINE_SPACING_MS = '80';
    try {
      const sentAt: number[] = [];
      const fetchFn = vi.fn<typeof fetch>(async () => { sentAt.push(Date.now()); return sfReply(0.3); });
      const started = Date.now();
      await Promise.all([1, 2, 3].map(() => fetchStockfishOnlineEval(START_FEN, 12, fetchFn)));

      expect(sentAt[0] - started).toBeLessThan(40); // the first goes at once
      expect(sentAt[1] - sentAt[0]).toBeGreaterThanOrEqual(75);
      expect(sentAt[2] - sentAt[1]).toBeGreaterThanOrEqual(75);
    } finally {
      process.env.STOCKFISH_ONLINE_SPACING_MS = '0';
    }
  });

  it('waits as long as it says when it turns a call away for asking too often', async () => {
    const tooMany = { ok: false, status: 429, headers: new Headers({ 'Retry-After': '0.1' }), json: async () => ({}) } as unknown as Response;
    const sentAt: number[] = [];
    const replies = [tooMany, sfReply(0.3)];
    const fetchFn = vi.fn<typeof fetch>(async () => { sentAt.push(Date.now()); return replies.shift()!; });

    await expect(fetchStockfishOnlineEval(START_FEN, 12, fetchFn)).rejects.toThrow('returned 429');
    await expect(fetchStockfishOnlineEval(START_FEN, 12, fetchFn)).resolves.toMatchObject({ pawns: 0.3 });
    expect(sentAt[1] - sentAt[0]).toBeGreaterThanOrEqual(95);
  });

  it('fails on an error status, and on its HTTP-200 failures, saying why', async () => {
    await expect(fetchStockfishOnlineEval(START_FEN, 12, fakeEngines([], [reply({}, false, 502)]))).rejects.toThrow('returned 502');
    const bad = reply({ success: false, error: 'Depth must be less than 16' });
    await expect(fetchStockfishOnlineEval(START_FEN, 12, fakeEngines([], [bad]))).rejects.toThrow('Depth must be less than 16');
  });
});

// ─── fetchEngineEval: chess-api.com, or stockfish.online when it fails ────────

describe('fetchEngineEval', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));

  it('asks chess-api.com while it answers', async () => {
    const fetchFn = fakeEngines([evalReply(0.3), evalReply(0.4)]);
    await fetchEngineEval(START_FEN, 12, { fetchFn });
    const second = await fetchEngineEval(START_FEN, 12, { fetchFn });

    expect(second).toMatchObject({ pawns: 0.4, engine: 'chess-api.com' });
    expect(hosts(fetchFn)).toEqual(['chess-api.com', 'chess-api.com']);
  });

  it('asks stockfish.online when chess-api.com fails to answer', async () => {
    for (const failure of [new DOMException('The operation timed out.', 'TimeoutError'), reply({}, false, 429), reply({ type: 'error', error: 'X' })]) {
      resetPositionEvalCache();
      const fetchFn = fakeEngines([failure], [sfReply(0.46)]);
      const result = await fetchEngineEval(START_FEN, 12, { fetchFn });

      expect(result).toMatchObject({ pawns: 0.46, bestMove: 'g1f3', engine: 'stockfish.online' });
      expect(hosts(fetchFn)).toEqual(['chess-api.com', 'stockfish.online']);
    }
  });

  it('then asks stockfish.online first for a while, not waiting on chess-api.com for every position', async () => {
    let clock = 0;
    const now = () => clock;
    const fetchFn = fakeEngines([new TypeError('fetch failed'), evalReply(0.3)], [sfReply(0.1), sfReply(0.2)]);

    await fetchEngineEval(START_FEN, 12, { fetchFn, now });
    clock = CHESS_API_REST_MS - 1;
    expect(await fetchEngineEval(START_FEN, 12, { fetchFn, now })).toMatchObject({ engine: 'stockfish.online' });
    clock = CHESS_API_REST_MS;
    expect(await fetchEngineEval(START_FEN, 12, { fetchFn, now })).toMatchObject({ engine: 'chess-api.com' });

    expect(hosts(fetchFn)).toEqual(['chess-api.com', 'stockfish.online', 'stockfish.online', 'chess-api.com']);
  });

  it('fails, naming both, when neither answers', async () => {
    const fetchFn = fakeEngines([reply({}, false, 503)], [reply({ success: false, error: 'busy' })]);
    await expect(fetchEngineEval(START_FEN, 12, { fetchFn })).rejects.toThrow(/No engine answered: chess-api\.com returned 503; .*busy/);
  });

  it('asks only the engine named, so a move can be measured with one engine throughout', async () => {
    const fetchFn = fakeEngines([evalReply(0.3)], [sfReply(0.2)]);

    expect(await fetchEngineEval(START_FEN, 12, { fetchFn, engine: 'stockfish.online' })).toMatchObject({ engine: 'stockfish.online' });
    expect(await fetchEngineEval(START_FEN, 12, { fetchFn, engine: 'chess-api.com' })).toMatchObject({ engine: 'chess-api.com' });
    await expect(fetchEngineEval(START_FEN, 12, { fetchFn, engine: 'chess-api.com' })).rejects.toThrow('fetch failed');
    expect(hosts(fetchFn)).toEqual(['stockfish.online', 'chess-api.com', 'chess-api.com']); // no fallback when one is named
  });
});

// ─── getPositionEval ──────────────────────────────────────────────────────────

describe('getPositionEval', () => {
  it('answers finished games itself, without calling the engine', async () => {
    const fetchFn = fakeFetch();
    const result = await getPositionEval(WHITE_MATED, 12, { fetchFn });

    expect(result).toEqual({ pawns: -100, mate: 0, depth: null });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('remembers an evaluation, so a repeat does not call the engine again', async () => {
    const fetchFn = fakeFetch(evalReply(0.3));
    const first = await getPositionEval(START_FEN, 12, { fetchFn, now: () => 0 });
    const second = await getPositionEval(START_FEN, 12, { fetchFn, now: () => 1_000 });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it('treats the same position with different move counters as the same', async () => {
    const fetchFn = fakeFetch(evalReply(0.3));
    await getPositionEval('8/8/8/4k3/8/8/4K3/R7 w - - 0 1', 12, { fetchFn });
    await getPositionEval('8/8/8/4k3/8/8/4K3/R7 w - - 25 40', 12, { fetchFn });

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('keeps different search depths apart', async () => {
    const fetchFn = fakeFetch(evalReply(0.3), evalReply(0.5));
    const shallow = await getPositionEval(START_FEN, 8, { fetchFn });
    const deep = await getPositionEval(START_FEN, 16, { fetchFn });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect([shallow.pawns, deep.pawns]).toEqual([0.3, 0.5]);
  });

  it('asks again once a day has passed', async () => {
    const fetchFn = fakeFetch(evalReply(0.3), evalReply(0.4));
    await getPositionEval(START_FEN, 12, { fetchFn, now: () => 0 });
    const later = await getPositionEval(START_FEN, 12, { fetchFn, now: () => EVAL_CACHE_TTL_MS });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(later.pawns).toBe(0.4);
  });

  it('still uses the cache just before the day is up', async () => {
    const fetchFn = fakeFetch(evalReply(0.3));
    await getPositionEval(START_FEN, 12, { fetchFn, now: () => 0 });
    await getPositionEval(START_FEN, 12, { fetchFn, now: () => EVAL_CACHE_TTL_MS - 1 });

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('shares one engine call between requests for the same position at the same moment', async () => {
    const fetchFn = fakeFetch(evalReply(0.3));
    const results = await Promise.all([
      getPositionEval(START_FEN, 12, { fetchFn }),
      getPositionEval(START_FEN, 12, { fetchFn }),
      getPositionEval(START_FEN, 12, { fetchFn }),
    ]);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(results.map(r => r.pawns)).toEqual([0.3, 0.3, 0.3]);
  });

  it('answers with stockfish.online when chess-api.com fails, in the same shape', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchFn = fakeEngines([new TypeError('fetch failed')], [sfReply(0.46)]);

    expect(await getPositionEval(START_FEN, 18, { fetchFn })).toEqual({ pawns: 0.46, mate: null, depth: 15 });
  });

  it('does not remember a failure: the next request asks again', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchFn = fakeEngines([new TypeError('fetch failed')], [new TypeError('fetch failed'), sfReply(0.3)]);

    await expect(getPositionEval(START_FEN, 12, { fetchFn })).rejects.toThrow('No engine answered');
    await expect(getPositionEval(START_FEN, 12, { fetchFn })).resolves.toMatchObject({ pawns: 0.3 });
    expect(hosts(fetchFn)).toEqual(['chess-api.com', 'stockfish.online', 'stockfish.online']);
  });

  it('fails every request waiting on a call that fails, then recovers', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchFn = fakeEngines([new TypeError('fetch failed')], [new TypeError('fetch failed'), sfReply(0.3)]);
    const settled = await Promise.allSettled([
      getPositionEval(START_FEN, 12, { fetchFn }),
      getPositionEval(START_FEN, 12, { fetchFn }),
    ]);

    expect(settled.map(s => s.status)).toEqual(['rejected', 'rejected']);
    expect(fetchFn).toHaveBeenCalledTimes(2); // one call to each engine, shared by both requests
    await expect(getPositionEval(START_FEN, 12, { fetchFn })).resolves.toMatchObject({ pawns: 0.3 });
  });

  it('keeps the cache bounded, forgetting the oldest positions first', async () => {
    const fens = Array.from({ length: EVAL_CACHE_MAX_ENTRIES + 1 }, (_, i) => uniqueFen(i));
    expect(new Set(fens.map(f => positionKey(f, 12))).size).toBe(fens.length); // the test fixtures really are distinct

    const fetchFn = fakeFetch(...fens.map(() => evalReply(0.1)), evalReply(0.1), evalReply(0.1));
    for (const fen of fens) await getPositionEval(fen, 12, { fetchFn });
    const callsAfterFilling = fetchFn.mock.calls.length;

    await getPositionEval(fens[fens.length - 1], 12, { fetchFn }); // newest: still cached
    expect(fetchFn.mock.calls.length).toBe(callsAfterFilling);

    await getPositionEval(fens[0], 12, { fetchFn }); // oldest: was evicted, asks again
    expect(fetchFn.mock.calls.length).toBe(callsAfterFilling + 1);
  });
});
