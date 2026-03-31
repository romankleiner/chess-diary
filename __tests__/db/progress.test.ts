import { vi, describe, it, expect, beforeEach } from 'vitest';

// ─── In-memory Redis store ────────────────────────────────────────────────────

const { store } = vi.hoisted(() => {
  const hashes = new Map<string, Map<string, string>>();
  const strings = new Map<string, string>();
  return { store: { hashes, strings, clear() { hashes.clear(); strings.clear(); } } };
});

vi.mock('ioredis', () => ({
  default: class MockRedis {
    async hget(key: string, field: string) { return store.hashes.get(key)?.get(field) ?? null; }
    async hset(key: string, field: string, value: string) {
      if (!store.hashes.has(key)) store.hashes.set(key, new Map());
      store.hashes.get(key)!.set(field, value); return 0;
    }
    async hdel(key: string, ...fields: string[]) {
      const h = store.hashes.get(key); if (!h) return 0;
      let n = 0; for (const f of fields) if (h.delete(f)) n++; return n;
    }
    async hgetall(key: string) {
      const h = store.hashes.get(key); return h ? Object.fromEntries(h) : {};
    }
    async get(key: string) { return store.strings.get(key) ?? null; }
    async set(key: string, value: string) { store.strings.set(key, value); return 'OK'; }
    // Track TTL values so tests can assert they were set
    async setex(key: string, ttl: number, value: string) {
      store.strings.set(key, value);
      store.strings.set(`${key}:ttl`, String(ttl));
      return 'OK';
    }
    async del(key: string) { store.strings.delete(key); store.hashes.delete(key); return 1; }
    pipeline() {
      const ops: (() => void)[] = [];
      const p: any = {
        del: (k: string) => { ops.push(() => { store.strings.delete(k); store.hashes.delete(k); }); return p; },
        hset: (k: string, f: string, v: string) => {
          ops.push(() => { if (!store.hashes.has(k)) store.hashes.set(k, new Map()); store.hashes.get(k)!.set(f, v); });
          return p;
        },
        exec: async () => { ops.forEach(op => op()); return []; },
      };
      return p;
    }
  },
}));

process.env.REDIS_URL = 'redis://test';

import { setGameProgress, getGameProgress, clearGameProgress } from '@/lib/db';

beforeEach(() => store.clear());

// ─── setGameProgress / getGameProgress ────────────────────────────────────────

describe('setGameProgress / getGameProgress', () => {
  it('round-trips current and total values', async () => {
    await setGameProgress('game-abc', 5, 40);
    const result = await getGameProgress('game-abc');
    expect(result).toEqual({ current: 5, total: 40 });
  });

  it('returns null for a game with no progress set', async () => {
    expect(await getGameProgress('no-such-game')).toBeNull();
  });

  it('updates progress for an existing game', async () => {
    await setGameProgress('game-abc', 5, 40);
    await setGameProgress('game-abc', 20, 40);
    expect((await getGameProgress('game-abc'))?.current).toBe(20);
  });

  it('stores different progress for different games independently', async () => {
    await setGameProgress('game-1', 2, 10);
    await setGameProgress('game-2', 7, 10);
    expect((await getGameProgress('game-1'))?.current).toBe(2);
    expect((await getGameProgress('game-2'))?.current).toBe(7);
  });

  it('sets a TTL (key expires after the configured period)', async () => {
    await setGameProgress('game-ttl', 1, 10);
    // The mock records the TTL as a side-channel key
    const ttl = store.strings.get('chess-diary:test-user-123:progress:game-ttl:ttl');
    expect(ttl).toBeDefined();
    expect(Number(ttl)).toBeGreaterThan(0);
  });
});

// ─── clearGameProgress ────────────────────────────────────────────────────────

describe('clearGameProgress', () => {
  it('removes progress so getGameProgress returns null', async () => {
    await setGameProgress('game-abc', 10, 40);
    await clearGameProgress('game-abc');
    expect(await getGameProgress('game-abc')).toBeNull();
  });

  it('clearing a non-existent game does not throw', async () => {
    await expect(clearGameProgress('ghost-game')).resolves.not.toThrow();
  });

  it('only removes the targeted game, leaving others intact', async () => {
    await setGameProgress('keep-me', 5, 20);
    await setGameProgress('remove-me', 3, 20);
    await clearGameProgress('remove-me');
    expect(await getGameProgress('keep-me')).not.toBeNull();
    expect(await getGameProgress('remove-me')).toBeNull();
  });
});
