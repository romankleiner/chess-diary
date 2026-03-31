import { vi, describe, it, expect, beforeEach } from 'vitest';
import { gameA, gameB } from '../helpers/fixtures';

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
    async setex(key: string, _: number, value: string) { store.strings.set(key, value); return 'OK'; }
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

import { getGame, saveGame, deleteGame, getGames, saveGames } from '@/lib/db';

beforeEach(() => store.clear());

// ─── getGame / saveGame ───────────────────────────────────────────────────────

describe('saveGame / getGame', () => {
  it('round-trips a game object', async () => {
    await saveGame(gameA.id, gameA);
    const result = await getGame(gameA.id);
    expect(result).toEqual(gameA);
  });

  it('returns null for an unknown game id', async () => {
    expect(await getGame('nonexistent')).toBeNull();
  });

  it('overwrites an existing game', async () => {
    await saveGame(gameA.id, gameA);
    const updated = { ...gameA, result: '0-1' };
    await saveGame(gameA.id, updated);
    expect((await getGame(gameA.id)).result).toBe('0-1');
  });
});

// ─── deleteGame ───────────────────────────────────────────────────────────────

describe('deleteGame', () => {
  it('removes a saved game so getGame returns null', async () => {
    await saveGame(gameA.id, gameA);
    await deleteGame(gameA.id);
    expect(await getGame(gameA.id)).toBeNull();
  });

  it('deleting a non-existent game does not throw', async () => {
    await expect(deleteGame('ghost-id')).resolves.not.toThrow();
  });
});

// ─── getGames ─────────────────────────────────────────────────────────────────

describe('getGames', () => {
  it('returns an empty object when no games are stored', async () => {
    expect(await getGames()).toEqual({});
  });

  it('returns all saved games keyed by id', async () => {
    await saveGame(gameA.id, gameA);
    await saveGame(gameB.id, gameB);
    const result = await getGames();
    expect(Object.keys(result)).toHaveLength(2);
    expect(result[gameA.id]).toEqual(gameA);
    expect(result[gameB.id]).toEqual(gameB);
  });
});

// ─── saveGames (bulk / pipeline) ──────────────────────────────────────────────

describe('saveGames', () => {
  it('replaces all games atomically', async () => {
    await saveGame(gameA.id, gameA);
    // Bulk-save only gameB — gameA should be gone
    await saveGames({ [gameB.id]: gameB });
    const result = await getGames();
    expect(Object.keys(result)).toHaveLength(1);
    expect(result[gameB.id]).toEqual(gameB);
    expect(result[gameA.id]).toBeUndefined();
  });

  it('accepts an empty object, clearing all games', async () => {
    await saveGame(gameA.id, gameA);
    await saveGames({});
    expect(await getGames()).toEqual({});
  });
});
