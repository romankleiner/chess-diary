/**
 * A small fixed-window rate limiter, keyed by caller (e.g. IP address).
 *
 * State lives in memory, so on a serverless host each instance counts for
 * itself and the limit is approximate. That is enough to stop one visitor
 * hammering a public endpoint that spends a third party's goodwill; it is not
 * a security boundary.
 */

export interface RateLimiter {
  check(key: string): { allowed: boolean; retryAfterSeconds: number };
}

export function createRateLimiter({
  limit,
  windowMs,
  now = Date.now,
  maxKeys = 1_000,
}: {
  limit: number;
  windowMs: number;
  now?: () => number;
  /** Bound on remembered callers, so the map can't grow without limit. */
  maxKeys?: number;
}): RateLimiter {
  const windows = new Map<string, { count: number; resetAt: number }>();

  return {
    check(key) {
      const time = now();

      let window = windows.get(key);
      if (!window || window.resetAt <= time) {
        // Only a caller we aren't tracking yet needs room made for it. Doing this
        // on every request would let a full table evict a caller mid-window and
        // hand them a fresh allowance.
        if (!window && windows.size >= maxKeys) {
          for (const [k, w] of windows) if (w.resetAt <= time) windows.delete(k);
          // Still full of live windows: drop the oldest rather than refuse everyone.
          if (windows.size >= maxKeys) windows.delete(windows.keys().next().value as string);
        }
        window = { count: 0, resetAt: time + windowMs };
        windows.set(key, window);
      }

      window.count++;
      return window.count <= limit
        ? { allowed: true, retryAfterSeconds: 0 }
        : { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - time) / 1000)) };
    },
  };
}
