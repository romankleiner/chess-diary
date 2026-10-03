import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// Only fetch is stubbed — the real route drives the real cache and parser.
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { GET } from '@/app/api/models/route';
import { resetModelCatalogCache } from '@/lib/model-catalog-server';
import { FALLBACK_MODELS } from '@/lib/model-catalog';

const makeReq = (query = '') => new NextRequest(`http://localhost/api/models${query}`);

const listOf = (...ids: string[]) => ({
  ok: true,
  status: 200,
  json: async () => ({
    data: ids.map(id => ({ type: 'model', id, display_name: id, created_at: '2026-01-01T00:00:00Z' })),
    has_more: false,
  }),
});

const originalKey = process.env.ANTHROPIC_API_KEY;
beforeEach(() => {
  resetModelCatalogCache();
  fetchMock.mockReset();
  process.env.ANTHROPIC_API_KEY = 'test-key';
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalKey;
});

describe('GET /api/models', () => {
  it('returns the list from Anthropic with its source and fetch time', async () => {
    fetchMock.mockResolvedValueOnce(listOf('claude-opus-4-8', 'claude-sonnet-5'));
    const res = await GET(makeReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.source).toBe('api');
    expect(body.models.map((m: any) => m.id)).toEqual(['claude-opus-4-8', 'claude-sonnet-5']);
    expect(body.models[0]).toMatchObject({ displayName: 'claude-opus-4-8', family: 'opus' });
    expect(typeof body.fetchedAt).toBe('string');
  });

  it('serves repeat requests from the cache', async () => {
    fetchMock.mockResolvedValueOnce(listOf('claude-opus-4-8'));
    await GET(makeReq());
    await GET(makeReq());
    await GET(makeReq());

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('bypasses the cache with ?refresh=1', async () => {
    fetchMock.mockResolvedValueOnce(listOf('claude-opus-4-8')).mockResolvedValueOnce(listOf('claude-opus-4-8', 'claude-sonnet-6'));
    await GET(makeReq());
    const body = await (await GET(makeReq('?refresh=1'))).json();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(body.models.map((m: any) => m.id)).toContain('claude-sonnet-6');
  });

  it('ignores other values of the refresh parameter', async () => {
    fetchMock.mockResolvedValueOnce(listOf('claude-opus-4-8'));
    await GET(makeReq());
    await GET(makeReq('?refresh=0'));
    await GET(makeReq('?refresh=true'));

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('still answers 200 with the built-in list when Anthropic cannot be reached', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const res = await GET(makeReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.source).toBe('fallback');
    expect(body.models.map((m: any) => m.id)).toEqual(FALLBACK_MODELS.map(m => m.id));
    expect(body.fetchedAt).toBeNull();
  });
});
