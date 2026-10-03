import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  mergeRetry,
  runThinkingAnalysis,
  summarizeRun,
  type ThinkingRunResult,
} from '@/lib/thinking-analysis-client';

// ─── test helpers ─────────────────────────────────────────────────────────────

type Reply =
  | { status?: number; body: unknown }
  | { status: number; html: string } // a platform error page: not JSON
  | Error;

/** A fetch that answers from a script, in order, and records every request. */
function scriptedFetch(replies: Reply[]) {
  const queue = [...replies];
  const calls: { entryIndex: number; init: RequestInit }[] = [];
  const fn = vi.fn(async (_url: unknown, init?: RequestInit) => {
    calls.push({ entryIndex: JSON.parse(String(init?.body)).entryIndex, init: init! });
    const reply = queue.shift();
    if (!reply) throw new Error('scriptedFetch ran out of replies');
    if (reply instanceof Error) throw reply;
    const status = reply.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if ('html' in reply) throw new SyntaxError('Unexpected token < in JSON');
        return reply.body;
      },
    } as Response;
  });
  return { fetchFn: fn as unknown as typeof fetch, calls, remaining: () => queue.length };
}

/** The server’s answer for entry `i` of `total`. */
const entry = (i: number, total: number, over: Record<string, unknown> = {}): Reply => ({
  body: {
    success: true,
    entryStatus: 'analyzed',
    completed: i + 1 >= total,
    nextEntryIndex: i + 1,
    entriesAnalyzed: i + 1,
    totalEntries: total,
    ...over,
  },
});

const aiFailed = (i: number, total: number, over: Record<string, unknown> = {}): Reply =>
  entry(i, total, { entryStatus: 'failed', error: 'AI service returned 529: Overloaded', retryable: true, ...over });

const serverError = (status = 503): Reply => ({ status, body: { error: 'Failed to analyze thinking' } });

const sleepFn = vi.fn(async (_ms: number) => {});

beforeEach(() => sleepFn.mockClear());

const run = (replies: Reply[], extra: Record<string, unknown> = {}) => {
  const fetchMock = scriptedFetch(replies);
  const promise = runThinkingAnalysis({ gameId: 'g1', fetchFn: fetchMock.fetchFn, sleepFn, ...extra });
  return { ...fetchMock, promise };
};

// ─── the happy path ───────────────────────────────────────────────────────────

describe('runThinkingAnalysis — whole game', () => {
  it('analyses every entry in order and reports progress', async () => {
    const onProgress = vi.fn();
    const { promise, calls } = run([entry(0, 3), entry(1, 3), entry(2, 3)], { onProgress });
    const result = await promise;

    expect(calls.map(c => c.entryIndex)).toEqual([0, 1, 2]);
    expect(result).toEqual({ total: 3, analyzed: 3, skipped: 0, failures: [] });
    expect(onProgress.mock.calls).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it('sends the game id, the entry index and an abort signal with each request', async () => {
    const { promise, calls } = run([entry(0, 1)]);
    await promise;

    expect(JSON.parse(String(calls[0].init.body))).toEqual({ gameId: 'g1', reanalyzeEngine: false, entryIndex: 0 });
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it('counts entries with no text as skipped, not as failures', async () => {
    const { promise } = run([entry(0, 2), entry(1, 2, { entryStatus: 'skipped' })]);
    const result = await promise;

    expect(result.analyzed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.failures).toEqual([]);
  });

  it('treats a server that does not report entryStatus as analyzed', async () => {
    const { promise } = run([{ body: { success: true, completed: true, nextEntryIndex: 1, totalEntries: 1 } }]);
    expect((await promise).analyzed).toBe(1);
  });
});

// ─── transient failures are retried ───────────────────────────────────────────

describe('runThinkingAnalysis — retries', () => {
  it('retries a server error and then succeeds', async () => {
    const { promise, calls } = run([serverError(503), entry(0, 1)]);
    const result = await promise;

    expect(calls.map(c => c.entryIndex)).toEqual([0, 0]);
    expect(result.analyzed).toBe(1);
    expect(result.failures).toEqual([]);
  });

  it('retries when the AI call failed but could work next time (overload, rate limit)', async () => {
    const { promise, calls } = run([aiFailed(0, 1), entry(0, 1)]);
    const result = await promise;

    expect(calls).toHaveLength(2);
    expect(result.analyzed).toBe(1);
    expect(result.failures).toEqual([]);
  });

  it('waits a little longer before each retry', async () => {
    const { promise } = run([serverError(), serverError(), entry(0, 1)]);
    await promise;

    expect(sleepFn.mock.calls.map(c => c[0])).toEqual([2_000, 6_000]);
  });

  it('retries a 429 rate limit from the server', async () => {
    const { promise, calls } = run([{ status: 429, body: { error: 'slow down' } }, entry(0, 1)]);
    await promise;
    expect(calls).toHaveLength(2);
  });

  it('retries network errors', async () => {
    const { promise, calls } = run([new TypeError('Failed to fetch'), entry(0, 1)]);
    const result = await promise;

    expect(calls).toHaveLength(2);
    expect(result.analyzed).toBe(1);
  });

  it('treats an unreadable (non-JSON) reply as a timeout and retries it', async () => {
    const { promise, calls } = run([{ status: 504, html: 'An error occurred with your deployment' }, entry(0, 1)]);
    const result = await promise;

    expect(calls).toHaveLength(2);
    expect(result.analyzed).toBe(1);
  });

  it('does not retry an AI failure the server says cannot succeed (bad model, bad key)', async () => {
    const bad = aiFailed(0, 1, { retryable: false, error: 'AI service returned 404: model: nope' });
    const { promise, calls } = run([bad]);
    const result = await promise;

    expect(calls).toHaveLength(1);
    expect(sleepFn).not.toHaveBeenCalled();
    expect(result.failures).toEqual([{ index: 0, error: 'AI service returned 404: model: nope' }]);
  });

  it('gives up on one entry after 3 attempts and says why', async () => {
    const { promise, calls } = run([entry(0, 3), serverError(), serverError(), serverError(), entry(2, 3)]);
    const result = await promise;

    expect(calls.map(c => c.entryIndex)).toEqual([0, 1, 1, 1, 2]);
    expect(result.failures).toEqual([{ index: 1, error: 'Failed to analyze thinking' }]);
  });
});

// ─── one bad entry must not take the rest down with it ────────────────────────

describe('runThinkingAnalysis — carrying on past a failure', () => {
  it('keeps analysing the entries after one that fails', async () => {
    const { promise, calls } = run([entry(0, 3), serverError(), serverError(), serverError(), entry(2, 3)]);
    const result = await promise;

    expect(calls.at(-1)!.entryIndex).toBe(2);
    expect(result.analyzed).toBe(2);
    expect(result.failures).toHaveLength(1);
    expect(result.fatal).toBeUndefined();
  });

  it('records an AI failure and still moves on to the next entry', async () => {
    const { promise } = run([aiFailed(0, 2, { retryable: false }), entry(1, 2)]);
    const result = await promise;

    expect(result.analyzed).toBe(1);
    expect(result.failures.map(f => f.index)).toEqual([0]);
  });

  it('stops after a failing last entry instead of looping past the end', async () => {
    const { promise, calls } = run([entry(0, 2), serverError(), serverError(), serverError()]);
    const result = await promise;

    expect(calls.map(c => c.entryIndex)).toEqual([0, 1, 1, 1]);
    expect(result.failures.map(f => f.index)).toEqual([1]);
  });

  it('cannot skip past a failing first entry because it does not know the total yet', async () => {
    const { promise, calls } = run([serverError(), serverError(), serverError()]);
    const result = await promise;

    expect(calls).toHaveLength(3);
    expect(result.fatal).toBe('Failed to analyze thinking');
    expect(result.analyzed).toBe(0);
  });
});

// ─── problems retrying cannot fix ─────────────────────────────────────────────

describe('runThinkingAnalysis — fatal problems', () => {
  it('stops at once on a 4xx that means the request is wrong', async () => {
    const { promise, calls } = run([{ status: 404, body: { error: 'Game not found' } }]);
    const result = await promise;

    expect(calls).toHaveLength(1);
    expect(sleepFn).not.toHaveBeenCalled();
    expect(result.fatal).toBe('Game not found');
  });

  it('stops when engine analysis has not been run yet', async () => {
    const { promise, calls } = run([
      { body: { needsEngineAnalysis: true, message: 'Engine analysis required before AI analysis' } },
    ]);
    const result = await promise;

    expect(calls).toHaveLength(1);
    expect(result.fatal).toBe('Engine analysis required before AI analysis');
  });

  it('keeps what it had finished before a fatal error', async () => {
    const { promise } = run([entry(0, 3), { status: 404, body: { error: 'Game not found' } }]);
    const result = await promise;

    expect(result.analyzed).toBe(1);
    expect(result.fatal).toBe('Game not found');
  });
});

// ─── retry pass ───────────────────────────────────────────────────────────────

describe('runThinkingAnalysis — retry pass over specific entries', () => {
  it('runs only the given entries and reports progress against them', async () => {
    const onProgress = vi.fn();
    const { promise, calls } = run([entry(1, 5), entry(3, 5)], { indices: [1, 3], onProgress });
    const result = await promise;

    expect(calls.map(c => c.entryIndex)).toEqual([1, 3]);
    expect(result.analyzed).toBe(2);
    expect(onProgress.mock.calls).toEqual([[1, 2], [2, 2]]);
  });

  it('does not stop at the first entry the server says is the last', async () => {
    // Entry 1 is not the last of the game, but entry 4 is — `completed` must not end a retry pass early.
    const { promise, calls } = run([entry(4, 5), entry(1, 5)], { indices: [4, 1] });
    await promise;
    expect(calls.map(c => c.entryIndex)).toEqual([4, 1]);
  });

  it('reports the entries that still fail', async () => {
    const { promise } = run([entry(1, 5), serverError(), serverError(), serverError()], { indices: [1, 3] });
    const result = await promise;

    expect(result.analyzed).toBe(1);
    expect(result.failures.map(f => f.index)).toEqual([3]);
  });

  it('counts the entries it never reached as still failing after a fatal error', async () => {
    const { promise } = run([{ status: 404, body: { error: 'Game not found' } }], { indices: [1, 2, 3] });
    const result = await promise;

    expect(result.fatal).toBe('Game not found');
    expect(result.failures.map(f => f.index)).toEqual([1, 2, 3]);
  });
});

// ─── merging and summarising ──────────────────────────────────────────────────

const result = (over: Partial<ThinkingRunResult> = {}): ThinkingRunResult => ({
  total: 5,
  analyzed: 5,
  skipped: 0,
  failures: [],
  ...over,
});

describe('mergeRetry', () => {
  it('adds the retry pass’s successes and replaces the failure list with what is still failing', () => {
    const first = result({ analyzed: 3, failures: [{ index: 1, error: 'x' }, { index: 3, error: 'y' }] });
    const retry = result({ total: null, analyzed: 1, failures: [{ index: 3, error: 'y' }] });

    expect(mergeRetry(first, retry)).toEqual({
      total: 5,
      analyzed: 4,
      skipped: 0,
      failures: [{ index: 3, error: 'y' }],
      fatal: undefined,
    });
  });

  it('carries a fatal error from the retry pass', () => {
    const merged = mergeRetry(result({ failures: [{ index: 1, error: 'x' }] }), result({ fatal: 'boom' }));
    expect(merged.fatal).toBe('boom');
  });
});

describe('summarizeRun', () => {
  it('reports success when nothing failed', () => {
    expect(summarizeRun(result())).toEqual({ ok: true, message: '🧠 AI analysis complete!' });
  });

  it('still reports success when some entries were merely skipped', () => {
    expect(summarizeRun(result({ analyzed: 3, skipped: 2 })).ok).toBe(true);
  });

  it('says how many entries have no comment and why', () => {
    const summary = summarizeRun(result({ analyzed: 3, failures: [{ index: 1, error: 'AI service returned 529' }, { index: 4, error: 'z' }] }));

    expect(summary.ok).toBe(false);
    expect(summary.message).toContain('2 of 5 entries have no AI comment');
    expect(summary.message).toContain('AI service returned 529');
    expect(summary.message).toContain('Run "Analyze thinking" again');
  });

  it('uses the singular for one entry', () => {
    const summary = summarizeRun(result({ analyzed: 4, failures: [{ index: 2, error: 'boom' }] }));
    expect(summary.message).toContain('1 of 5 entry has no AI comment');
    expect(summary.message).toContain('fill it in');
  });

  it('explains a fatal stop and mentions the progress made', () => {
    const summary = summarizeRun(result({ analyzed: 2, fatal: 'Game not found' }));

    expect(summary.ok).toBe(false);
    expect(summary.message).toContain('AI analysis stopped: Game not found');
    expect(summary.message).toContain('2 entries were analysed');
  });
});
