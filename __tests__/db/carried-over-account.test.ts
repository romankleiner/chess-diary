import { vi, describe, it, expect, beforeEach } from 'vitest';

// The author's account moved from Clerk's Development instance to Production and
// got a new id; its data stays under the old one (lib/user-id.ts). Signed in with
// the new id, the data layer and the admin check must reach the old id's data.

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
      store.hashes.get(key)!.set(field, value); return 1;
    }
    async hgetall(key: string) { const h = store.hashes.get(key); return h ? Object.fromEntries(h) : {}; }
    async get(key: string) { return store.strings.get(key) ?? null; }
    async set(key: string, value: string) { store.strings.set(key, value); return 'OK'; }
  },
}));

process.env.REDIS_URL = 'redis://test';

import { auth } from '@clerk/nextjs/server';
import { getAnalysis, getSetting, saveSetting } from '@/lib/db';
import { isAdmin } from '@/lib/admin';

const PROD = 'user_3KgYiYzMxX8zUjN4dBbv55hfT1T';
const DEV = 'user_395GdJ9fMuBbALA4mvYzpEUQrNI';
const mockAuth = vi.mocked(auth);
const signedInAs = (userId: string | null) => mockAuth.mockResolvedValue({ userId } as never);

beforeEach(() => {
  store.clear();
  // The data as the Development id left it
  store.hashes.set(`chess-diary:${DEV}:settings`, new Map([['chesscom_username', 'romank66']]));
  store.hashes.set(`chess-diary:${DEV}:analyses`, new Map([['g1', JSON.stringify({ gameId: 'g1', moves: [] })]]));
  store.strings.set('chess-diary:admin', DEV);
});

describe('signed in with the Production id', () => {
  beforeEach(() => signedInAs(PROD));

  it('reads the data the Development id left', async () => {
    expect(await getSetting('chesscom_username')).toBe('romank66');
    expect(await getAnalysis('g1')).toMatchObject({ gameId: 'g1' });
  });

  it('writes under the Development id, never starting a second store under the new one', async () => {
    await saveSetting('theme', 'dark');
    expect(store.hashes.get(`chess-diary:${DEV}:settings`)?.has('theme')).toBe(true);
    expect([...store.hashes.keys()].some(key => key.includes(PROD))).toBe(false);
  });

  it('is still the admin', async () => {
    expect(await isAdmin()).toEqual({ isAdmin: true, userId: DEV });
    expect(store.strings.get('chess-diary:admin')).toBe(DEV);
  });
});

describe('signed in with the Development id (local development)', () => {
  beforeEach(() => signedInAs(DEV));

  it('reaches the same data, and is the admin', async () => {
    expect(await getSetting('chesscom_username')).toBe('romank66');
    expect((await isAdmin()).isAdmin).toBe(true);
  });
});

describe('anyone else', () => {
  it('reaches none of it, and is not the admin', async () => {
    signedInAs('user_someoneElse');
    expect(await getSetting('chesscom_username')).toBeNull();
    expect(await isAdmin()).toEqual({ isAdmin: false, userId: 'user_someoneElse' });
  });

  it('reaches nothing when nobody is signed in', async () => {
    signedInAs(null);
    await expect(getSetting('chesscom_username')).rejects.toThrow('User not authenticated');
    expect(await isAdmin()).toEqual({ isAdmin: false, userId: null });
  });
});
