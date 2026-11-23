/**
 * Evaluates positions with a free public engine API (no key): chess-api.com,
 * and stockfish.online when chess-api.com doesn't answer. Used by game analysis
 * on Vercel and by the public blog. Server-side; the pure parsing lives in
 * lib/position-eval.ts.
 *
 * chess-api.com can stop answering altogether -- it accepts the request, then
 * never replies -- so once it fails, stockfish.online is asked first for a few
 * minutes, rather than every position waiting out chess-api.com's timeout.
 *
 * Blog readers trigger these calls (the blog is public), so they are cheap on
 * the third party by design: results are cached for a day per position and
 * search depth, and simultaneous requests for the same position share one call.
 * The cache is per server instance, which is plenty for a personal blog.
 */
import { engineFen, parseChessApiEval, parseStockfishOnlineEval, terminalEval } from './position-eval';
import type { PositionEval, PositionEvalWithLine } from './position-eval';

const CHESS_API_URL = 'https://chess-api.com/v1';
const STOCKFISH_ONLINE_URL = 'https://stockfish.online/api/s/v2.php';
const REQUEST_TIMEOUT_MS = 8_000;

/** stockfish.online refuses a depth of 16 or more. */
export const STOCKFISH_ONLINE_MAX_DEPTH = 15;
/** How long stockfish.online is asked first after chess-api.com fails to answer. */
export const CHESS_API_REST_MS = 5 * 60 * 1000;

export const EVAL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const EVAL_CACHE_MAX_ENTRIES = 500;

export type EngineName = 'chess-api.com' | 'stockfish.online';

/** An evaluation with the engine's best move and line, and which engine gave it. */
export interface EngineEval extends PositionEvalWithLine {
  engine: EngineName;
}

/** Positions are the same whatever the move counters say, so key on the first four FEN fields. */
export function positionKey(fen: string, depth: number): string {
  return `${fen.trim().split(/\s+/).slice(0, 4).join(' ')}|${depth}`;
}

/** One call to chess-api.com. Throws if it can't produce an evaluation. */
export async function fetchChessApiEval(
  fen: string,
  depth: number,
  fetchFn: typeof fetch = fetch,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<EngineEval> {
  const response = await fetchFn(CHESS_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Without an en passant square, which the engine rejects (see engineFen)
    body: JSON.stringify({ fen: engineFen(fen), depth }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`chess-api.com returned ${response.status}`);

  const body = await response.json();
  const result = parseChessApiEval(body);
  if (!result) {
    const reason = typeof body?.error === 'string' ? `: ${body.error}` : '';
    throw new Error(`chess-api.com gave no evaluation${reason}`);
  }
  const line: unknown = body.continuationArr;
  const pv = typeof line === 'string'
    ? line.split(/\s+/).filter(Boolean)
    : Array.isArray(line) ? line.filter((m): m is string => typeof m === 'string') : [];
  return { ...result, bestMove: typeof body.move === 'string' ? body.move : '', pv, engine: 'chess-api.com' };
}

/**
 * stockfish.online sits behind Cloudflare, which turns away more than about five
 * requests in ten seconds (HTTP 429, "Retry-After: 10"), so calls to it are spaced
 * this far apart, per server instance: 2 s apart still drew 429s in a long run,
 * 2.5 s didn't. Read when called, so tests can set it.
 */
const stockfishOnlineSpacingMs = () => Number(process.env.STOCKFISH_ONLINE_SPACING_MS ?? 2_500);
/** The longest a "Retry-After" it sends back holds up the next call, in seconds. */
const STOCKFISH_ONLINE_MAX_WAIT_S = 15;
/** When the next call to stockfish.online may go out. */
let stockfishOnlineNextAt = 0;

/** Wait for this call's turn. Turns are handed out as they are asked for, so callers at the same moment queue up. */
async function stockfishOnlineTurn(): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, stockfishOnlineNextAt);
  stockfishOnlineNextAt = at + stockfishOnlineSpacingMs();
  if (at > now) await new Promise(resolve => setTimeout(resolve, at - now));
}

/**
 * One call to stockfish.online, searching no deeper than it allows, and no
 * sooner than its rate limit allows. Throws if it can't produce an evaluation.
 * Unlike chess-api.com, it takes an en passant square.
 */
export async function fetchStockfishOnlineEval(
  fen: string,
  depth: number,
  fetchFn: typeof fetch = fetch,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<EngineEval> {
  const searched = Math.min(depth, STOCKFISH_ONLINE_MAX_DEPTH);
  const url = new URL(STOCKFISH_ONLINE_URL);
  url.searchParams.set('fen', fen.trim());
  url.searchParams.set('depth', String(searched));

  await stockfishOnlineTurn();
  const response = await fetchFn(url.toString(), { signal: AbortSignal.timeout(timeoutMs) });
  if (response.status === 429) {
    // Turned away for asking too often: no call goes out until it says to try again
    const seconds = Number(response.headers?.get?.('retry-after'));
    if (Number.isFinite(seconds) && seconds > 0) {
      stockfishOnlineNextAt = Math.max(stockfishOnlineNextAt, Date.now() + Math.min(seconds, STOCKFISH_ONLINE_MAX_WAIT_S) * 1000);
    }
  }
  if (!response.ok) throw new Error(`stockfish.online returned ${response.status}`);

  const body = await response.json();
  const result = parseStockfishOnlineEval(body);
  if (!result) {
    const reason = typeof body?.error === 'string' ? `: ${body.error}` : '';
    throw new Error(`stockfish.online gave no evaluation${reason}`);
  }
  return { ...result, depth: searched, engine: 'stockfish.online' };
}

/** Until when chess-api.com is passed over, after failing to answer (per server instance). */
let chessApiRestingUntil = 0;

export interface EngineOptions {
  fetchFn?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  /** Ask only this engine -- to evaluate a position with the same engine as another. */
  engine?: EngineName;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * One evaluation from chess-api.com, or from stockfish.online when chess-api.com
 * fails to answer -- and for CHESS_API_REST_MS after that, when stockfish.online
 * is asked instead. Throws if no engine produced an evaluation.
 */
export async function fetchEngineEval(fen: string, depth: number, options: EngineOptions = {}): Promise<EngineEval> {
  const { fetchFn = fetch, now = Date.now, timeoutMs = REQUEST_TIMEOUT_MS, engine } = options;

  if (engine === 'chess-api.com') return fetchChessApiEval(fen, depth, fetchFn, timeoutMs);
  if (engine === 'stockfish.online' || now() < chessApiRestingUntil) {
    return fetchStockfishOnlineEval(fen, depth, fetchFn, timeoutMs);
  }

  try {
    return await fetchChessApiEval(fen, depth, fetchFn, timeoutMs);
  } catch (chessApiError) {
    chessApiRestingUntil = now() + CHESS_API_REST_MS;
    console.warn(`[ENGINE] chess-api.com failed (${message(chessApiError)}); asking stockfish.online for the next ${CHESS_API_REST_MS / 60_000} minutes`);
    try {
      return await fetchStockfishOnlineEval(fen, depth, fetchFn, timeoutMs);
    } catch (fallbackError) {
      throw new Error(`No engine answered: ${message(chessApiError)}; ${message(fallbackError)}`);
    }
  }
}

interface CacheEntry {
  value: PositionEval;
  at: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<PositionEval>>();

export interface EvalOptions {
  fetchFn?: typeof fetch;
  now?: () => number;
}

/**
 * Evaluate a position: finished games are answered directly, repeats come from
 * the cache, and everything else asks the engines. Throws if none can be reached.
 */
export async function getPositionEval(fen: string, depth: number, options: EvalOptions = {}): Promise<PositionEval> {
  const finished = terminalEval(fen);
  if (finished) return finished;

  const now = options.now ?? Date.now;
  const key = positionKey(fen, depth);

  const hit = cache.get(key);
  if (hit && now() - hit.at < EVAL_CACHE_TTL_MS) return hit.value;

  const pending = inflight.get(key);
  if (pending) return pending;

  const run = fetchEngineEval(fen, depth, { fetchFn: options.fetchFn, now }).then(({ pawns, mate, depth: searched }) => {
    const value: PositionEval = { pawns, mate, depth: searched };
    cache.delete(key); // re-insert so the oldest-first eviction below sees it as newest
    cache.set(key, { value, at: now() });
    while (cache.size > EVAL_CACHE_MAX_ENTRIES) {
      cache.delete(cache.keys().next().value as string);
    }
    return value;
  });

  inflight.set(key, run);
  try {
    return await run;
  } finally {
    if (inflight.get(key) === run) inflight.delete(key);
  }
}

/** Forget everything cached, that chess-api.com failed, and when stockfish.online was last asked — for tests. */
export function resetPositionEvalCache(): void {
  cache.clear();
  inflight.clear();
  chessApiRestingUntil = 0;
  stockfishOnlineNextAt = 0;
}
