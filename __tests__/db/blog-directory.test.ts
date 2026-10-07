import { vi, describe, it, expect, beforeEach } from 'vitest';
import { gameA, gameB } from '../helpers/fixtures';

// ─── In-memory Redis store ────────────────────────────────────────────────────

const { store, calls } = vi.hoisted(() => {
  const hashes = new Map<string, Map<string, string>>();
  const calls: string[] = [];
  return { store: { hashes, clear() { hashes.clear(); calls.length = 0; } }, calls };
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
    async hmget(key: string, ...fields: string[]) {
      calls.push(`hmget ${key} ${fields.join(',')}`);
      const h = store.hashes.get(key); return fields.map(f => h?.get(f) ?? null);
    }
  },
}));

process.env.REDIS_URL = 'redis://test';

import { getGamesById, listPublishedBlogs, publishBlog, saveGame, unpublishBlog } from '@/lib/db';

beforeEach(() => store.clear());

describe('listPublishedBlogs', () => {
  it('is empty when nothing has been shared', async () => {
    expect(await listPublishedBlogs()).toEqual([]);
  });

  it('lists every shared game with its owner', async () => {
    await publishBlog('g1', 'alice');
    await publishBlog('g2', 'alice');
    await publishBlog('g3', 'bob');
    const listed = await listPublishedBlogs();
    expect(listed).toHaveLength(3);
    expect(listed).toEqual(expect.arrayContaining([
      { gameId: 'g1', ownerId: 'alice' },
      { gameId: 'g2', ownerId: 'alice' },
      { gameId: 'g3', ownerId: 'bob' },
    ]));
  });

  it('drops a game once its owner un-shares it, but not when someone else tries', async () => {
    await publishBlog('g1', 'alice');
    await publishBlog('g2', 'alice');
    await unpublishBlog('g1', 'alice');
    await unpublishBlog('g2', 'mallory');
    expect(await listPublishedBlogs()).toEqual([{ gameId: 'g2', ownerId: 'alice' }]);
  });

  it('lists a game once, under whoever shared it last', async () => {
    await publishBlog('g1', 'alice');
    await publishBlog('g1', 'bob');
    expect(await listPublishedBlogs()).toEqual([{ gameId: 'g1', ownerId: 'bob' }]);
  });
});

describe('getGamesById', () => {
  beforeEach(async () => {
    await saveGame(gameA.id, gameA, 'alice');
    await saveGame(gameB.id, gameB, 'alice');
    await saveGame('someone-elses', { ...gameA, id: 'someone-elses' }, 'bob');
  });

  it('returns just the games asked for', async () => {
    const games = await getGamesById([gameA.id], 'alice');
    expect(Object.keys(games)).toEqual([gameA.id]);
    expect(games[gameA.id]).toEqual(gameA);
  });

  it('returns several at once, by id', async () => {
    const games = await getGamesById([gameB.id, gameA.id], 'alice');
    expect(games[gameA.id].opponent).toBe('opponent_a');
    expect(games[gameB.id].opponent).toBe('opponent_b');
  });

  it('leaves out a game that is not there', async () => {
    const games = await getGamesById([gameA.id, 'ghost'], 'alice');
    expect(Object.keys(games)).toEqual([gameA.id]);
  });

  it('reads only the named owner’s games', async () => {
    expect(await getGamesById(['someone-elses'], 'alice')).toEqual({});
    expect(Object.keys(await getGamesById(['someone-elses'], 'bob'))).toEqual(['someone-elses']);
  });

  it('asks for nothing at all when it is given nothing', async () => {
    expect(await getGamesById([], 'alice')).toEqual({});
    expect(calls).toEqual([]);
  });

  it('asks for the named games in one request, not the whole collection', async () => {
    await getGamesById([gameA.id, gameB.id], 'alice');
    expect(calls).toEqual([`hmget chess-diary:alice:games ${gameA.id},${gameB.id}`]);
  });
});
