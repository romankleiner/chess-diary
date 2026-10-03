import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// Only fetch is stubbed -- the real route drives the real validation, cache and parser.
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { GET } from '@/app/api/eval/route';
import { resetPositionEvalCache } from '@/lib/position-eval-server';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const WHITE_MATED = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';

// The route's rate limiter lives for the whole test file, so each test uses its own caller.
let caller = 0;
const makeReq = (query: string, ip = `10.0.0.${++caller}`) =>
  new NextRequest(`http://localhost/api/eval${query}`, { headers: { 'x-forwarded-for': ip } });
const q = (fen: string, extra = '') => `?fen=${encodeURIComponent(fen)}${extra}`;

const engineReply = (pawns: number, over: Record<string, unknown> = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({ type: 'bestmove', eval: pawns, mate: null, depth: 12, ...over }),
});

beforeEach(() => {
  resetPositionEvalCache();
  fetchMock.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('GET /api/eval — validation', () => {
  it('requires a fen', async () => {
    const res = await GET(makeReq(''));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/fen/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects something that is not a position', async () => {
    const res = await GET(makeReq(q('not a fen')));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an absurdly long fen without parsing it', async () => {
    const res = await GET(makeReq(q('x'.repeat(500))));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/eval — evaluating', () => {
  it('returns the engine’s evaluation', async () => {
    fetchMock.mockResolvedValueOnce(engineReply(0.3));
    const res = await GET(makeReq(q(START_FEN)));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pawns: 0.3, mate: null, depth: 12 });
  });

  it('returns a forced mate with its length', async () => {
    fetchMock.mockResolvedValueOnce(engineReply(-100, { mate: '-2' }));
    const body = await (await GET(makeReq(q(START_FEN)))).json();

    expect(body).toMatchObject({ pawns: -100, mate: -2 });
  });

  it('uses a sensible default search depth, and passes a requested one through', async () => {
    fetchMock.mockResolvedValue(engineReply(0.3));
    await GET(makeReq(q(START_FEN)));
    resetPositionEvalCache();
    await GET(makeReq(q(START_FEN, '&depth=15')));

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).depth).toBe(12);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).depth).toBe(15);
  });

  it.each([
    ['1', 6],
    ['999', 18],
    ['-4', 6],
    ['abc', 12],
    ['', 12],
  ])('keeps an out-of-range depth (%s) inside what the engine API allows', async (requested, expected) => {
    fetchMock.mockResolvedValue(engineReply(0.3));
    await GET(makeReq(q(START_FEN, `&depth=${requested}`)));

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).depth).toBe(expected);
  });

  it('answers a finished game itself, without bothering the engine API', async () => {
    const res = await GET(makeReq(q(WHITE_MATED)));

    expect(await res.json()).toEqual({ pawns: -100, mate: 0, depth: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('serves a repeat of the same position from the cache', async () => {
    fetchMock.mockResolvedValueOnce(engineReply(0.3));
    await GET(makeReq(q(START_FEN)));
    const again = await GET(makeReq(q(START_FEN)));

    expect(await again.json()).toMatchObject({ pawns: 0.3 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('lets the CDN and browser keep a good answer', async () => {
    fetchMock.mockResolvedValueOnce(engineReply(0.3));
    const res = await GET(makeReq(q(START_FEN)));

    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600, s-maxage=86400');
  });
});

describe('GET /api/eval — when the engine API fails', () => {
  it('answers 502 and says not to cache it', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const res = await GET(makeReq(q(START_FEN)));

    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/could not evaluate/i);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('answers 502 for the engine API’s HTTP-200 error replies too', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ type: 'error', error: 'INVALID_INPUT' }) });
    expect((await GET(makeReq(q(START_FEN)))).status).toBe(502);
  });
});

describe('GET /api/eval — rate limiting', () => {
  it('stops a caller who asks too often, saying when to retry', async () => {
    fetchMock.mockResolvedValue(engineReply(0.3));
    const ip = '203.0.113.9';

    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await GET(makeReq(q(START_FEN), ip))).status);

    expect(statuses.slice(0, 30).every(s => s === 200)).toBe(true);
    expect(statuses[30]).toBe(429);

    const blocked = await GET(makeReq(q(START_FEN), ip));
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(blocked.headers.get('Cache-Control')).toBe('no-store');
  });

  it('does not penalise other callers for one caller’s excess', async () => {
    fetchMock.mockResolvedValue(engineReply(0.3));
    for (let i = 0; i < 35; i++) await GET(makeReq(q(START_FEN), '203.0.113.10'));

    expect((await GET(makeReq(q(START_FEN), '203.0.113.11'))).status).toBe(200);
  });

  it('counts the first address in x-forwarded-for, which is the visitor', async () => {
    fetchMock.mockResolvedValue(engineReply(0.3));
    for (let i = 0; i < 30; i++) await GET(makeReq(q(START_FEN), '203.0.113.12, 70.41.3.18'));

    expect((await GET(makeReq(q(START_FEN), '203.0.113.12, 10.9.9.9'))).status).toBe(429);
  });
});
