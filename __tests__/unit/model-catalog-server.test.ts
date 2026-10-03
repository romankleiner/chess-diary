import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CATALOG_TTL_MS,
  fetchModelList,
  getModelCatalog,
  resetModelCatalogCache,
} from '@/lib/model-catalog-server';
import { FALLBACK_MODELS } from '@/lib/model-catalog';

// ─── helpers ──────────────────────────────────────────────────────────────────

const apiModel = (id: string, display_name = id) => ({ type: 'model', id, display_name, created_at: '2026-01-01T00:00:00Z' });

const page = (data: unknown[], extra: Record<string, unknown> = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({ data, has_more: false, ...extra }),
});

/** A fetch that answers from a script, in order, and records each request. */
function scriptedFetch(replies: Array<ReturnType<typeof page> | { ok: false; status: number } | Error>) {
  const queue = [...replies];
  const requests: { url: URL; init: RequestInit }[] = [];
  const fn = vi.fn(async (url: unknown, init?: RequestInit) => {
    requests.push({ url: new URL(String(url)), init: init! });
    const reply = queue.shift();
    if (!reply) throw new Error('scriptedFetch ran out of replies');
    if (reply instanceof Error) throw reply;
    return reply as unknown as Response;
  });
  return { fetchFn: fn as unknown as typeof fetch, requests, calls: () => fn.mock.calls.length };
}

const OPUS = apiModel('claude-opus-4-8', 'Claude Opus 4.8');
const SONNET = apiModel('claude-sonnet-5', 'Claude Sonnet 5');

const originalKey = process.env.ANTHROPIC_API_KEY;
beforeEach(() => {
  resetModelCatalogCache();
  process.env.ANTHROPIC_API_KEY = 'test-key';
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalKey;
});

// ─── fetchModelList ───────────────────────────────────────────────────────────

describe('fetchModelList', () => {
  it('asks the Models API with the key and version headers and returns the parsed models', async () => {
    const { fetchFn, requests } = scriptedFetch([page([OPUS, SONNET])]);
    const models = await fetchModelList(fetchFn);

    expect(models.map(m => m.id)).toEqual(['claude-opus-4-8', 'claude-sonnet-5']);
    expect(requests[0].url.origin + requests[0].url.pathname).toBe('https://api.anthropic.com/v1/models');
    expect(requests[0].url.searchParams.get('limit')).toBe('100');
    expect(requests[0].init.headers).toEqual({ 'x-api-key': 'test-key', 'anthropic-version': '2023-06-01' });
    expect(requests[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it('follows the cursor through every page', async () => {
    const { fetchFn, requests } = scriptedFetch([
      page([OPUS], { has_more: true, last_id: 'claude-opus-4-8' }),
      page([SONNET], { has_more: false }),
    ]);
    const models = await fetchModelList(fetchFn);

    expect(models.map(m => m.id)).toEqual(['claude-opus-4-8', 'claude-sonnet-5']);
    expect(requests).toHaveLength(2);
    expect(requests[0].url.searchParams.get('after_id')).toBeNull();
    expect(requests[1].url.searchParams.get('after_id')).toBe('claude-opus-4-8');
  });

  it('stops after a handful of pages even if the API keeps saying there are more', async () => {
    const endless = Array.from({ length: 20 }, (_, i) =>
      page([apiModel(`claude-opus-${i}`)], { has_more: true, last_id: `claude-opus-${i}` })
    );
    const { fetchFn, calls } = scriptedFetch(endless);
    await fetchModelList(fetchFn);

    expect(calls()).toBe(5);
  });

  it('stops if the API says there are more pages but gives no cursor', async () => {
    const { fetchFn, calls } = scriptedFetch([page([OPUS], { has_more: true })]);
    await fetchModelList(fetchFn);
    expect(calls()).toBe(1);
  });

  it('fails on an error status, naming it', async () => {
    const { fetchFn } = scriptedFetch([{ ok: false, status: 401 }]);
    await expect(fetchModelList(fetchFn)).rejects.toThrow('Models API returned 401');
  });

  it('fails when the response holds no usable models', async () => {
    const { fetchFn } = scriptedFetch([page([{ id: 'gpt-4o' }])]);
    await expect(fetchModelList(fetchFn)).rejects.toThrow('no usable models');
  });

  it('fails without making a request when there is no API key', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { fetchFn, calls } = scriptedFetch([]);

    await expect(fetchModelList(fetchFn)).rejects.toThrow('ANTHROPIC_API_KEY');
    expect(calls()).toBe(0);
  });

  it('passes a network error through', async () => {
    const { fetchFn } = scriptedFetch([new TypeError('fetch failed')]);
    await expect(fetchModelList(fetchFn)).rejects.toThrow('fetch failed');
  });
});

// ─── getModelCatalog: freshness ───────────────────────────────────────────────

describe('getModelCatalog — keeping the list fresh', () => {
  it('fetches on first use and reports the time it was fetched', async () => {
    const { fetchFn } = scriptedFetch([page([OPUS])]);
    const catalog = await getModelCatalog({ fetchFn, now: () => 1_000_000 });

    expect(catalog.source).toBe('api');
    expect(catalog.models.map(m => m.id)).toEqual(['claude-opus-4-8']);
    expect(catalog.fetchedAt).toBe(new Date(1_000_000).toISOString());
  });

  it('reuses the list until it is older than the TTL', async () => {
    const { fetchFn, calls } = scriptedFetch([page([OPUS])]);
    await getModelCatalog({ fetchFn, now: () => 0 });
    const again = await getModelCatalog({ fetchFn, now: () => CATALOG_TTL_MS - 1 });

    expect(calls()).toBe(1);
    expect(again.source).toBe('api');
    expect(again.fetchedAt).toBe(new Date(0).toISOString()); // still the original fetch time
  });

  it('fetches again once the TTL has passed, picking up a newly released model', async () => {
    const { fetchFn, calls } = scriptedFetch([page([OPUS]), page([OPUS, SONNET])]);
    await getModelCatalog({ fetchFn, now: () => 0 });
    const later = await getModelCatalog({ fetchFn, now: () => CATALOG_TTL_MS });

    expect(calls()).toBe(2);
    expect(later.models.map(m => m.id)).toEqual(['claude-opus-4-8', 'claude-sonnet-5']);
    expect(later.fetchedAt).toBe(new Date(CATALOG_TTL_MS).toISOString());
  });

  it('fetches immediately when asked to refresh, even within the TTL', async () => {
    const { fetchFn, calls } = scriptedFetch([page([OPUS]), page([OPUS, SONNET])]);
    await getModelCatalog({ fetchFn, now: () => 0 });
    const refreshed = await getModelCatalog({ fetchFn, now: () => 1_000, forceRefresh: true });

    expect(calls()).toBe(2);
    expect(refreshed.models).toHaveLength(2);
  });

  it('refreshes about every six hours', () => {
    expect(CATALOG_TTL_MS).toBe(6 * 60 * 60 * 1000);
  });
});

// ─── getModelCatalog: when Anthropic cannot be reached ────────────────────────

describe('getModelCatalog — when Anthropic cannot be reached', () => {
  it('serves the last good list, marked stale, rather than the built-in one', async () => {
    const { fetchFn } = scriptedFetch([page([OPUS, SONNET]), new TypeError('fetch failed')]);
    await getModelCatalog({ fetchFn, now: () => 0 });
    const stale = await getModelCatalog({ fetchFn, now: () => CATALOG_TTL_MS + 1 });

    expect(stale.source).toBe('stale');
    expect(stale.models.map(m => m.id)).toEqual(['claude-opus-4-8', 'claude-sonnet-5']);
    expect(stale.fetchedAt).toBe(new Date(0).toISOString()); // honest about how old it is
  });

  it('falls back to the built-in list only when nothing has ever been fetched', async () => {
    const { fetchFn } = scriptedFetch([{ ok: false, status: 500 }]);
    const catalog = await getModelCatalog({ fetchFn });

    expect(catalog.source).toBe('fallback');
    expect(catalog.models).toBe(FALLBACK_MODELS);
    expect(catalog.fetchedAt).toBeNull();
  });

  it('falls back when there is no API key', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { fetchFn, calls } = scriptedFetch([]);
    const catalog = await getModelCatalog({ fetchFn });

    expect(catalog.source).toBe('fallback');
    expect(calls()).toBe(0);
  });

  it('tries again on the next request instead of remembering the failure', async () => {
    const { fetchFn, calls } = scriptedFetch([new TypeError('fetch failed'), page([OPUS])]);
    const first = await getModelCatalog({ fetchFn, now: () => 0 });
    const second = await getModelCatalog({ fetchFn, now: () => 1 });

    expect(first.source).toBe('fallback');
    expect(second.source).toBe('api');
    expect(calls()).toBe(2);
  });

  it('keeps serving the last good list when a forced refresh fails', async () => {
    const { fetchFn } = scriptedFetch([page([OPUS]), { ok: false, status: 529 }]);
    await getModelCatalog({ fetchFn, now: () => 0 });
    const refreshed = await getModelCatalog({ fetchFn, now: () => 10, forceRefresh: true });

    expect(refreshed.source).toBe('stale');
    expect(refreshed.models.map(m => m.id)).toEqual(['claude-opus-4-8']);
  });
});

// ─── getModelCatalog: simultaneous requests ───────────────────────────────────

describe('getModelCatalog — simultaneous requests', () => {
  it('shares one fetch between requests that arrive together', async () => {
    const { fetchFn, calls } = scriptedFetch([page([OPUS])]);
    const [a, b, c] = await Promise.all([
      getModelCatalog({ fetchFn }),
      getModelCatalog({ fetchFn }),
      getModelCatalog({ fetchFn }),
    ]);

    expect(calls()).toBe(1);
    expect(a.models).toEqual(b.models);
    expect(b.models).toEqual(c.models);
  });

  it('lets a later request fetch again once the shared one has finished', async () => {
    const { fetchFn, calls } = scriptedFetch([page([OPUS]), page([OPUS, SONNET])]);
    await getModelCatalog({ fetchFn, now: () => 0 });
    await getModelCatalog({ fetchFn, now: () => 1, forceRefresh: true });

    expect(calls()).toBe(2);
  });
});
