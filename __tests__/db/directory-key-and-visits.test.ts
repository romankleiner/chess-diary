import { vi, describe, it, expect, beforeEach } from 'vitest';

// ─── In-memory Redis store ────────────────────────────────────────────────────

const { store } = vi.hoisted(() => {
  const hashes = new Map<string, Map<string, string>>();
  const strings = new Map<string, string>();
  const lists = new Map<string, string[]>();
  return { store: { hashes, strings, lists, clear() { hashes.clear(); strings.clear(); lists.clear(); } } };
});

vi.mock('ioredis', () => {
  const hash = (key: string) => {
    if (!store.hashes.has(key)) store.hashes.set(key, new Map());
    return store.hashes.get(key)!;
  };
  const list = (key: string) => {
    if (!store.lists.has(key)) store.lists.set(key, []);
    return store.lists.get(key)!;
  };
  const ops = {
    async get(key: string) { return store.strings.get(key) ?? null; },
    async set(key: string, value: string, mode?: string) {
      if (mode === 'NX' && store.strings.has(key)) return null;
      store.strings.set(key, value); return 'OK';
    },
    async hget(key: string, field: string) { return store.hashes.get(key)?.get(field) ?? null; },
    async hset(key: string, field: string, value: string) { hash(key).set(field, value); return 1; },
    async hdel(key: string, ...fields: string[]) { let n = 0; for (const f of fields) if (hash(key).delete(f)) n++; return n; },
    async lpush(key: string, value: string) { list(key).unshift(value); return list(key).length; },
    async ltrim(key: string, start: number, stop: number) { store.lists.set(key, list(key).slice(start, stop + 1)); return 'OK'; },
    async lrange(key: string, start: number, stop: number) { return list(key).slice(start, stop < 0 ? undefined : stop + 1); },
  };
  return {
    default: class MockRedis {
      get = ops.get; set = ops.set; hget = ops.hget; hset = ops.hset; hdel = ops.hdel;
      lpush = ops.lpush; ltrim = ops.ltrim; lrange = ops.lrange;
      pipeline() {
        const queued: Array<() => Promise<unknown>> = [];
        const p: Record<string, unknown> = {
          exec: async () => { for (const op of queued) await op(); return []; },
        };
        for (const name of Object.keys(ops) as Array<keyof typeof ops>) {
          p[name] = (...args: unknown[]) => { queued.push(() => (ops[name] as (...a: unknown[]) => Promise<unknown>)(...args)); return p; };
        }
        return p;
      }
    },
  };
});

process.env.REDIS_URL = 'redis://test';

import {
  getBlogVisits, getDirectoryOwner, getOrCreateDirectoryKey, recordBlogVisit, rotateDirectoryKey,
} from '@/lib/db';
import { BLOG_VISITS_KEPT } from '@/lib/access-log';
import { isDirectoryKey } from '@/lib/directory-key';

beforeEach(() => store.clear());

// ─── the directory key ────────────────────────────────────────────────────────

describe('getOrCreateDirectoryKey', () => {
  it('makes a well-formed key the first time it is asked', async () => {
    const key = await getOrCreateDirectoryKey('alice');
    expect(isDirectoryKey(key)).toBe(true);
  });

  it('gives the same key after that', async () => {
    const first = await getOrCreateDirectoryKey('alice');
    expect(await getOrCreateDirectoryKey('alice')).toBe(first);
  });

  it('gives each author their own key', async () => {
    expect(await getOrCreateDirectoryKey('alice')).not.toBe(await getOrCreateDirectoryKey('bob'));
  });

  it('makes keys that are not guessable from one another', async () => {
    const keys = new Set<string>();
    for (let i = 0; i < 50; i++) { store.clear(); keys.add(await getOrCreateDirectoryKey('alice')); }
    expect(keys.size).toBe(50);
  });

  it('makes every character of a key random, not a few random ones padded out', async () => {
    const keys: string[] = [];
    for (let i = 0; i < 64; i++) { store.clear(); keys.push(await getOrCreateDirectoryKey('alice')); }
    for (let position = 0; position < 22; position++) {
      const seen = new Set(keys.map(k => k[position]));
      expect(seen.size, `position ${position}`).toBeGreaterThan(1);
    }
  });

  it('agrees on one key when two first visits arrive together', async () => {
    const [a, b] = await Promise.all([getOrCreateDirectoryKey('alice'), getOrCreateDirectoryKey('alice')]);
    expect(a).toBe(b);
    expect(await getDirectoryOwner(a)).toBe('alice');
  });

  it('mends a lookup that went missing, so the author’s link works again', async () => {
    const key = await getOrCreateDirectoryKey('alice');
    store.hashes.get('chess-diary:public:directory-keys')!.delete(key);
    expect(await getDirectoryOwner(key)).toBeNull();
    await getOrCreateDirectoryKey('alice');
    expect(await getDirectoryOwner(key)).toBe('alice');
  });

  it('keeps the key apart from the settings, which the Settings page rewrites whole', async () => {
    await getOrCreateDirectoryKey('alice');
    expect([...store.hashes.keys()]).not.toContain('chess-diary:alice:settings');
    expect(store.strings.has('chess-diary:alice:directory-key')).toBe(true);
  });
});

describe('getDirectoryOwner', () => {
  it('finds whose directory a key opens', async () => {
    const alice = await getOrCreateDirectoryKey('alice');
    const bob = await getOrCreateDirectoryKey('bob');
    expect(await getDirectoryOwner(alice)).toBe('alice');
    expect(await getDirectoryOwner(bob)).toBe('bob');
  });

  it('opens nothing for a key nobody has', async () => {
    await getOrCreateDirectoryKey('alice');
    expect(await getDirectoryOwner('AbCdEfGhIjKlMnOpQrStUv')).toBeNull();
  });

  it('opens nothing for a key that is no longer its author’s, even if the lookup still lists it', async () => {
    const old = await getOrCreateDirectoryKey('alice');
    store.strings.set('chess-diary:alice:directory-key', 'SomethingElseEntirely_');
    expect(await getDirectoryOwner(old)).toBeNull();
  });
});

describe('rotateDirectoryKey', () => {
  it('gives the author a new key that opens their directory', async () => {
    const old = await getOrCreateDirectoryKey('alice');
    const fresh = await rotateDirectoryKey('alice');
    expect(isDirectoryKey(fresh)).toBe(true);
    expect(fresh).not.toBe(old);
    expect(await getDirectoryOwner(fresh)).toBe('alice');
    expect(await getOrCreateDirectoryKey('alice')).toBe(fresh);
  });

  it('stops the old key working at once', async () => {
    const old = await getOrCreateDirectoryKey('alice');
    await rotateDirectoryKey('alice');
    expect(await getDirectoryOwner(old)).toBeNull();
    expect(store.hashes.get('chess-diary:public:directory-keys')!.has(old)).toBe(false);
  });

  it('works for an author who never had a key', async () => {
    const fresh = await rotateDirectoryKey('alice');
    expect(await getDirectoryOwner(fresh)).toBe('alice');
  });

  it('leaves other authors’ keys alone', async () => {
    const bob = await getOrCreateDirectoryKey('bob');
    await getOrCreateDirectoryKey('alice');
    await rotateDirectoryKey('alice');
    expect(await getDirectoryOwner(bob)).toBe('bob');
  });
});

// ─── the visit log ────────────────────────────────────────────────────────────

describe('recordBlogVisit and getBlogVisits', () => {
  const visit = (n: number) => ({ at: `2026-10-08T00:00:${String(n % 60).padStart(2, '0')}.000Z`, page: 'game', n });

  it('keeps an author’s visits, newest first', async () => {
    await recordBlogVisit('alice', visit(1));
    await recordBlogVisit('alice', visit(2));
    await recordBlogVisit('alice', visit(3));
    expect((await getBlogVisits('alice')).map(v => (v as { n: number }).n)).toEqual([3, 2, 1]);
  });

  it('keeps each author’s log to themselves', async () => {
    await recordBlogVisit('alice', visit(1));
    await recordBlogVisit('bob', visit(2));
    expect(await getBlogVisits('alice')).toHaveLength(1);
    expect(await getBlogVisits('bob')).toHaveLength(1);
    expect(await getBlogVisits('carol')).toEqual([]);
  });

  it('keeps no more than the most recent visits, however many arrive', async () => {
    for (let i = 0; i < BLOG_VISITS_KEPT + 25; i++) await recordBlogVisit('alice', visit(i));
    const kept = await getBlogVisits('alice');
    expect(kept).toHaveLength(BLOG_VISITS_KEPT);
    expect((kept[0] as { n: number }).n).toBe(BLOG_VISITS_KEPT + 24);
    expect(store.lists.get('chess-diary:alice:blog-visits')).toHaveLength(BLOG_VISITS_KEPT);
  });

  it('reads back only as many as asked for', async () => {
    for (let i = 0; i < 10; i++) await recordBlogVisit('alice', visit(i));
    expect(await getBlogVisits('alice', 3)).toHaveLength(3);
    expect(await getBlogVisits('alice', 0)).toEqual([]);
  });

  it('skips a stored line that is not JSON', async () => {
    await recordBlogVisit('alice', visit(1));
    store.lists.get('chess-diary:alice:blog-visits')!.unshift('{not json');
    expect(await getBlogVisits('alice')).toEqual([visit(1)]);
  });
});
