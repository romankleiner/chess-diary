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

import { getSetting, saveSetting, getSettings, saveSettings } from '@/lib/db';

beforeEach(() => store.clear());

// ─── getSetting / saveSetting ─────────────────────────────────────────────────

describe('saveSetting / getSetting', () => {
  it('round-trips a string value', async () => {
    await saveSetting('chesscom_username', 'testplayer');
    expect(await getSetting('chesscom_username')).toBe('testplayer');
  });

  it('returns null (not the string "null") for a missing key', async () => {
    const value = await getSetting('nonexistent_key');
    expect(value).toBeNull();
    expect(value).not.toBe('null');
  });

  it('overwrites an existing setting', async () => {
    await saveSetting('ai_model', 'claude-3-haiku');
    await saveSetting('ai_model', 'claude-sonnet-4-6');
    expect(await getSetting('ai_model')).toBe('claude-sonnet-4-6');
  });

  it('stores multiple independent settings', async () => {
    await saveSetting('chesscom_username', 'user1');
    await saveSetting('ai_model', 'model1');
    expect(await getSetting('chesscom_username')).toBe('user1');
    expect(await getSetting('ai_model')).toBe('model1');
  });
});

// ─── getSettings ─────────────────────────────────────────────────────────────

describe('getSettings', () => {
  it('returns an empty object when no settings are stored', async () => {
    const result = await getSettings();
    // ioredis hgetall returns {} for missing key; the route layer normalises to {}
    expect(result).toEqual({});
  });

  it('returns all key/value pairs as plain strings', async () => {
    await saveSetting('chesscom_username', 'player');
    await saveSetting('ai_model', 'model');
    const result = await getSettings();
    expect(result['chesscom_username']).toBe('player');
    expect(result['ai_model']).toBe('model');
  });
});

// ─── saveSettings (bulk) ──────────────────────────────────────────────────────

describe('saveSettings', () => {
  it('replaces all settings atomically', async () => {
    await saveSetting('chesscom_username', 'old_user');
    await saveSettings({ ai_model: 'new_model' });
    const result = await getSettings();
    expect(result['ai_model']).toBe('new_model');
    expect(result['chesscom_username']).toBeUndefined();
  });

  it('accepts an empty object, clearing all settings', async () => {
    await saveSetting('chesscom_username', 'user');
    await saveSettings({});
    expect(await getSettings()).toEqual({});
  });
});
