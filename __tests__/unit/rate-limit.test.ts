import { describe, it, expect } from 'vitest';
import { createRateLimiter } from '@/lib/rate-limit';

const clock = (start = 0) => {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
};

describe('createRateLimiter', () => {
  it('allows up to the limit, then refuses', () => {
    const c = clock();
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, now: c.now });

    expect([1, 2, 3].map(() => limiter.check('a').allowed)).toEqual([true, true, true]);
    expect(limiter.check('a').allowed).toBe(false);
    expect(limiter.check('a').allowed).toBe(false);
  });

  it('says how long to wait, rounded up to whole seconds', () => {
    const c = clock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: c.now });
    limiter.check('a');
    c.advance(20_500);

    expect(limiter.check('a')).toEqual({ allowed: false, retryAfterSeconds: 40 });
  });

  it('never tells a caller to wait zero seconds', () => {
    const c = clock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: c.now });
    limiter.check('a');
    c.advance(59_999);

    expect(limiter.check('a').retryAfterSeconds).toBe(1);
  });

  it('starts a fresh window once the old one has passed', () => {
    const c = clock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: c.now });
    limiter.check('a');
    expect(limiter.check('a').allowed).toBe(false);

    c.advance(60_000);
    expect(limiter.check('a').allowed).toBe(true);
  });

  it('counts each caller separately', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: clock().now });

    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('b').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(false);
    expect(limiter.check('b').allowed).toBe(false);
  });

  it('does not let the number of remembered callers grow without limit', () => {
    const c = clock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: c.now, maxKeys: 3 });
    for (const key of ['a', 'b', 'c']) limiter.check(key);

    // 'a' is still inside its window, so it is the oldest live entry and gets dropped
    // to make room, rather than refusing the newcomer.
    expect(limiter.check('d').allowed).toBe(true);
    expect(limiter.check('a').allowed).toBe(true);
  });

  it('does not let a full table reset a caller who is still inside their window', () => {
    // Regression: capacity handling used to run on every request, so a caller
    // already being tracked could be evicted by their own lookup.
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, now: clock().now, maxKeys: 2 });
    limiter.check('a');
    limiter.check('b'); // table is now full

    expect(limiter.check('a').allowed).toBe(true); // 2nd of 2
    expect(limiter.check('a').allowed).toBe(false); // over the limit, however full the table is
    expect(limiter.check('a').allowed).toBe(false);
  });

  it('prefers to forget callers whose window has already ended', () => {
    const c = clock();
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: c.now, maxKeys: 2 });
    limiter.check('old');
    c.advance(61_000);
    limiter.check('recent');

    limiter.check('newcomer'); // full: the expired 'old' goes, 'recent' stays

    expect(limiter.check('recent').allowed).toBe(false); // still remembered and still limited
  });
});
