/**
 * Fetches and caches the list of Claude models from Anthropic's Models API.
 * Server-only (it reads ANTHROPIC_API_KEY); the pure logic that turns the list
 * into a dropdown lives in lib/model-catalog.ts.
 *
 * Freshness: the list is re-fetched at most every CATALOG_TTL_MS, whenever it is
 * asked for after that. If Anthropic can't be reached, the last good copy is
 * served rather than the built-in fallback, which only appears when there has
 * never been a successful fetch.
 */
import { FALLBACK_MODELS, parseModelList } from './model-catalog';
import type { ModelInfo } from './model-catalog';

const MODELS_URL = 'https://api.anthropic.com/v1/models';
const PAGE_SIZE = 100;
const MAX_PAGES = 5; // a hard stop so a misbehaving cursor can never loop forever
const REQUEST_TIMEOUT_MS = 8_000;

export const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;

export interface ModelCatalog {
  models: ModelInfo[];
  /**
   * api      – fetched from Anthropic (now, or within the last CATALOG_TTL_MS)
   * stale    – Anthropic couldn't be reached; this is the last list we did get
   * fallback – never fetched successfully; this is the built-in list
   */
  source: 'api' | 'stale' | 'fallback';
  fetchedAt: string | null;
}

interface CacheEntry {
  models: ModelInfo[];
  at: number;
}

let cache: CacheEntry | null = null;
let inflight: Promise<ModelCatalog> | null = null;

/** Fetch every page of the Models API. Throws if it can't produce a usable list. */
export async function fetchModelList(fetchFn: typeof fetch = fetch): Promise<ModelInfo[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');

  const models: ModelInfo[] = [];
  let afterId: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(MODELS_URL);
    url.searchParams.set('limit', String(PAGE_SIZE));
    if (afterId) url.searchParams.set('after_id', afterId);

    const response = await fetchFn(url.toString(), {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Models API returned ${response.status}`);

    const body = await response.json();
    models.push(...parseModelList(body));

    if (!body?.has_more || !body?.last_id) break;
    afterId = body.last_id;
  }

  if (models.length === 0) throw new Error('Models API returned no usable models');
  return models;
}

export interface CatalogOptions {
  /** Skip the cache and fetch now (the "Refresh" button). */
  forceRefresh?: boolean;
  fetchFn?: typeof fetch;
  now?: () => number;
}

export async function getModelCatalog(options: CatalogOptions = {}): Promise<ModelCatalog> {
  const now = options.now ?? Date.now;

  if (cache && !options.forceRefresh && now() - cache.at < CATALOG_TTL_MS) {
    return { models: cache.models, source: 'api', fetchedAt: new Date(cache.at).toISOString() };
  }

  // Several requests arriving together share one fetch.
  if (inflight) return inflight;

  const run = (async (): Promise<ModelCatalog> => {
    try {
      const models = await fetchModelList(options.fetchFn);
      cache = { models, at: now() };
      return { models, source: 'api', fetchedAt: new Date(cache.at).toISOString() };
    } catch (error) {
      console.error('[MODELS] Could not refresh the model list:', error instanceof Error ? error.message : error);
      if (cache) {
        return { models: cache.models, source: 'stale', fetchedAt: new Date(cache.at).toISOString() };
      }
      return { models: FALLBACK_MODELS, source: 'fallback', fetchedAt: null };
    }
  })();

  inflight = run;
  try {
    return await run;
  } finally {
    if (inflight === run) inflight = null;
  }
}

/** Forget everything cached — for tests. */
export function resetModelCatalogCache(): void {
  cache = null;
  inflight = null;
}
