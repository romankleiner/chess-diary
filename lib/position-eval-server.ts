/**
 * Evaluates positions with chess-api.com — the free public engine API this app
 * already uses for analysis on Vercel (no key). Server-side; the pure parsing
 * lives in lib/position-eval.ts.
 *
 * Blog readers trigger these calls (the blog is public), so they are cheap on
 * the third party by design: results are cached for a day per position and
 * search depth, and simultaneous requests for the same position share one call.
 * The cache is per server instance, which is plenty for a personal blog.
 */
import { parseChessApiEval, terminalEval } from './position-eval';
import type { PositionEval } from './position-eval';

const CHESS_API_URL = 'https://chess-api.com/v1';
const REQUEST_TIMEOUT_MS = 8_000;

export const EVAL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const EVAL_CACHE_MAX_ENTRIES = 500;

/** Positions are the same whatever the move counters say, so key on the first four FEN fields. */
export function positionKey(fen: string, depth: number): string {
  return `${fen.trim().split(/\s+/).slice(0, 4).join(' ')}|${depth}`;
}

/** One call to the engine API. Throws if it can't produce an evaluation. */
export async function fetchPositionEval(
  fen: string,
  depth: number,
  fetchFn: typeof fetch = fetch,
): Promise<PositionEval> {
  const response = await fetchFn(CHESS_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fen, depth }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`chess-api.com returned ${response.status}`);

  const body = await response.json();
  const result = parseChessApiEval(body);
  if (!result) {
    const reason = typeof body?.error === 'string' ? `: ${body.error}` : '';
    throw new Error(`chess-api.com gave no evaluation${reason}`);
  }
  return result;
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
 * the cache, and everything else asks the engine. Throws if the engine can't be
 * reached.
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

  const run = fetchPositionEval(fen, depth, options.fetchFn).then(value => {
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

/** Forget everything cached — for tests. */
export function resetPositionEvalCache(): void {
  cache.clear();
  inflight.clear();
}
