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
    async hsetnx(key: string, field: string, value: string) {
      if (store.hashes.get(key)?.has(field)) return 0;
      await this.hset(key, field, value); return 1;
    }
    async hexists(key: string, field: string) { return store.hashes.get(key)?.has(field) ? 1 : 0; }
    multi() {
      const queued: Array<() => Promise<unknown>> = [];
      const tx = {
        hdel: (key: string, ...fields: string[]) => { queued.push(() => this.hdel(key, ...fields)); return tx; },
        exec: async () => { for (const op of queued) await op(); return []; },
      };
      return tx;
    }
  },
}));

process.env.REDIS_URL = 'redis://test';

import {
  getBlogByToken, getGamesById, getSharedBlogLink, listPublishedBlogs, publishBlog, saveGame, unpublishBlog,
} from '@/lib/db';
import { isBlogToken } from '@/lib/blog-link';

const INDEX = 'chess-diary:public:blog';
const LINKS = 'chess-diary:public:blog-links';
const TOKENS = 'chess-diary:public:blog-tokens';
const size = (key: string) => store.hashes.get(key)?.size ?? 0;

beforeEach(() => store.clear());

describe('private links to shared blogs', () => {
  it('gives a shared game a random link that opens it, and only it', async () => {
    const link = await publishBlog('g1', 'alice');
    expect(isBlogToken(link.token)).toBe(true);
    expect(link.byId).toBe(false);
    expect(await getBlogByToken(link.token)).toEqual({ gameId: 'g1', ownerId: 'alice' });
  });

  it('gives each game its own link, unrelated to its id', async () => {
    const a = await publishBlog('g1', 'alice');
    const b = await publishBlog('g2', 'alice');
    expect(a.token).not.toBe(b.token);
    expect(a.token).not.toContain('g1');
    expect((await getBlogByToken(b.token))?.gameId).toBe('g2');
  });

  it('keeps the link when a shared game is shared again', async () => {
    const first = await publishBlog('g1', 'alice');
    expect(await publishBlog('g1', 'alice')).toEqual(first);
    expect(await getSharedBlogLink('g1')).toEqual(first);
    expect(size(TOKENS)).toBe(1);
  });

  it('retires the link when the game is un-shared, and gives a fresh one if it is shared again', async () => {
    const old = await publishBlog('g1', 'alice');
    await unpublishBlog('g1', 'alice');
    expect(await getBlogByToken(old.token)).toBeNull();
    expect(await getSharedBlogLink('g1')).toBeNull();
    expect(size(LINKS) + size(TOKENS)).toBe(0); // nothing left behind

    const fresh = await publishBlog('g1', 'alice');
    expect(fresh.token).not.toBe(old.token);
    expect(fresh.byId).toBe(false);
    expect(await getBlogByToken(old.token)).toBeNull();
    expect(await getBlogByToken(fresh.token)).toEqual({ gameId: 'g1', ownerId: 'alice' });
  });

  it('keeps the link when someone other than the owner tries to un-share', async () => {
    const link = await publishBlog('g1', 'alice');
    await unpublishBlog('g1', 'mallory');
    expect(await getBlogByToken(link.token)).toEqual({ gameId: 'g1', ownerId: 'alice' });
  });

  it('opens nothing for a token it never made, or one that is not the game’s link', async () => {
    await publishBlog('g1', 'alice');
    expect(await getBlogByToken('AbCdEfGhIjKlMnOp')).toBeNull();
    store.hashes.get(TOKENS)!.set('StrayTokenXYZ123', 'g1'); // say, left by a crash
    expect(await getBlogByToken('StrayTokenXYZ123')).toBeNull();
  });

  it('has no link for a game that is not shared, and makes none', async () => {
    expect(await getSharedBlogLink('g1')).toBeNull();
    expect(size(LINKS) + size(TOKENS)).toBe(0);
  });

  describe('a game shared before links existed', () => {
    beforeEach(() => { store.hashes.set(INDEX, new Map([['old', 'alice']])); });

    it('gets its link the first time one is asked for, marked as opening by id too', async () => {
      const link = await getSharedBlogLink('old');
      expect(link).toEqual({ token: expect.any(String), byId: true });
      expect(isBlogToken(link!.token)).toBe(true);
      expect(await getSharedBlogLink('old')).toEqual(link);
      expect(await getBlogByToken(link!.token)).toEqual({ gameId: 'old', ownerId: 'alice' });
    });

    it('agrees on one link when asked twice at once', async () => {
      const [a, b] = await Promise.all([getSharedBlogLink('old'), getSharedBlogLink('old')]);
      expect(a).toEqual(b);
      expect(size(TOKENS)).toBe(1); // the losing token is cleared away
    });

    it('stays open by id when its owner shares it again', async () => {
      expect((await publishBlog('old', 'alice')).byId).toBe(true);
    });

    it('loses the old link once un-shared: shared again, it is like any new share', async () => {
      await getSharedBlogLink('old');
      await unpublishBlog('old', 'alice');
      expect((await publishBlog('old', 'alice')).byId).toBe(false);
    });

    it('can be un-shared before it ever had a link', async () => {
      await unpublishBlog('old', 'alice');
      expect(await listPublishedBlogs()).toEqual([]);
      expect((await publishBlog('old', 'alice')).byId).toBe(false);
    });
  });
});

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
