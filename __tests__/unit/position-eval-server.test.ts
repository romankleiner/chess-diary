import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  EVAL_CACHE_MAX_ENTRIES,
  EVAL_CACHE_TTL_MS,
  fetchPositionEval,
  getPositionEval,
  positionKey,
  resetPositionEvalCache,
} from '@/lib/position-eval-server';

// ─── helpers ──────────────────────────────────────────────────────────────────

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const WHITE_MATED = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';

/** What chess-api.com sends back, trimmed to the fields that matter. */
const reply = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as unknown as Response;
const evalReply = (pawns: number, over: Record<string, unknown> = {}) =>
  reply({ type: 'bestmove', eval: pawns, mate: null, depth: 12, ...over });

function fakeFetch(...replies: Array<Response | Error>) {
  const queue = [...replies];
  const fn = vi.fn<typeof fetch>(async () => {
    const next = queue.shift();
    if (!next) throw new Error('fakeFetch ran out of replies');
    if (next instanceof Error) throw next;
    return next;
  });
  return fn;
}

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

// ─── fetchPositionEval ────────────────────────────────────────────────────────

describe('fetchPositionEval', () => {
  it('posts the position and depth to chess-api.com and returns the evaluation', async () => {
    const fetchFn = fakeFetch(evalReply(0.3));
    const result = await fetchPositionEval(START_FEN, 12, fetchFn);

    expect(result).toEqual({ pawns: 0.3, mate: null, depth: 12 });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://chess-api.com/v1');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ fen: START_FEN, depth: 12 });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('fails on an error status', async () => {
    await expect(fetchPositionEval(START_FEN, 12, fakeFetch(reply({}, false, 503)))).rejects.toThrow('returned 503');
  });

  it('fails on the HTTP-200 error replies, saying why', async () => {
    const bad = reply({ type: 'error', error: 'INVALID_FEN', text: 'Invalid FEN' });
    await expect(fetchPositionEval(START_FEN, 12, fakeFetch(bad))).rejects.toThrow('INVALID_FEN');
  });

  it('fails on a reply with no evaluation', async () => {
    await expect(fetchPositionEval(START_FEN, 12, fakeFetch(reply({ type: 'bestmove' })))).rejects.toThrow('no evaluation');
  });

  it('passes a network error through', async () => {
    await expect(fetchPositionEval(START_FEN, 12, fakeFetch(new TypeError('fetch failed')))).rejects.toThrow('fetch failed');
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

  it('does not remember a failure: the next request tries the engine again', async () => {
    const fetchFn = fakeFetch(new TypeError('fetch failed'), evalReply(0.3));

    await expect(getPositionEval(START_FEN, 12, { fetchFn })).rejects.toThrow('fetch failed');
    await expect(getPositionEval(START_FEN, 12, { fetchFn })).resolves.toMatchObject({ pawns: 0.3 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('fails every request waiting on a call that fails, then recovers', async () => {
    const fetchFn = fakeFetch(new TypeError('fetch failed'), evalReply(0.3));
    const settled = await Promise.allSettled([
      getPositionEval(START_FEN, 12, { fetchFn }),
      getPositionEval(START_FEN, 12, { fetchFn }),
    ]);

    expect(settled.map(s => s.status)).toEqual(['rejected', 'rejected']);
    expect(fetchFn).toHaveBeenCalledTimes(1);
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
