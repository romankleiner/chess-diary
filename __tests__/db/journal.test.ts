import { vi, describe, it, expect, beforeEach } from 'vitest';
import { thoughtEntry, moveEntry, summaryEntry } from '../helpers/fixtures';

// ─── In-memory Redis store ────────────────────────────────────────────────────

const { store } = vi.hoisted(() => {
  const hashes = new Map<string, Map<string, string>>();
  const strings = new Map<string, string>();
  return { store: { hashes, strings, clear() { hashes.clear(); strings.clear(); } } };
});

vi.mock('ioredis', () => {
  const hash = (key: string) => {
    if (!store.hashes.has(key)) store.hashes.set(key, new Map());
    return store.hashes.get(key)!;
  };
  const ops = {
    async hget(key: string, field: string) { return store.hashes.get(key)?.get(field) ?? null; },
    async hset(key: string, field: string, value: string) { hash(key).set(field, value); return 0; },
    async hdel(key: string, ...fields: string[]) {
      const h = store.hashes.get(key); if (!h) return 0;
      let n = 0; for (const f of fields) if (h.delete(f)) n++; return n;
    },
    async hgetall(key: string) { const h = store.hashes.get(key); return h ? Object.fromEntries(h) : {}; },
    async hlen(key: string) { return store.hashes.get(key)?.size ?? 0; },
    async hvals(key: string) { return [...(store.hashes.get(key)?.values() ?? [])]; },
    async get(key: string) { return store.strings.get(key) ?? null; },
    async set(key: string, value: string, ...args: unknown[]) {
      if (args.includes('NX') && store.strings.has(key)) return null;
      store.strings.set(key, value); return 'OK';
    },
    async setex(key: string, _: number, value: string) { store.strings.set(key, value); return 'OK'; },
    async del(key: string) { store.strings.delete(key); store.hashes.delete(key); return 1; },
  };
  // multi() and pipeline() queue the same commands and run them in order on exec()
  const batch = () => {
    const queued: Array<() => Promise<unknown>> = [];
    const b: Record<string, unknown> = {
      exec: async () => { const out: Array<[null, unknown]> = []; for (const op of queued) out.push([null, await op()]); return out; },
    };
    for (const name of Object.keys(ops) as Array<keyof typeof ops>) {
      b[name] = (...args: unknown[]) => { queued.push(() => (ops[name] as (...a: unknown[]) => Promise<unknown>)(...args)); return b; };
    }
    return b;
  };
  return {
    default: class MockRedis {
      hget = ops.hget; hset = ops.hset; hdel = ops.hdel; hgetall = ops.hgetall; hlen = ops.hlen; hvals = ops.hvals;
      get = ops.get; set = ops.set; setex = ops.setex; del = ops.del;
      multi = batch;
      pipeline = batch;
    },
  };
});

process.env.REDIS_URL = 'redis://test';

import {
  getJournalEntry, saveJournalEntry, deleteJournalEntry, getJournal, saveJournal,
} from '@/lib/db';

beforeEach(() => store.clear());

// ─── saveJournalEntry / getJournalEntry ───────────────────────────────────────

describe('saveJournalEntry / getJournalEntry', () => {
  it('round-trips an entry by numeric id', async () => {
    await saveJournalEntry(thoughtEntry);
    expect(await getJournalEntry(thoughtEntry.id)).toEqual(thoughtEntry);
  });

  it('returns null for an unknown entry id', async () => {
    expect(await getJournalEntry(9999)).toBeNull();
  });

  it('preserves nested objects (postGameSummary)', async () => {
    await saveJournalEntry(summaryEntry);
    const result = await getJournalEntry(summaryEntry.id);
    expect(result.postGameSummary.reflections.lessonsLearned).toBe('Knight outposts are powerful');
  });

  it('overwrites an existing entry', async () => {
    await saveJournalEntry(thoughtEntry);
    const updated = { ...thoughtEntry, content: 'Updated thought' };
    await saveJournalEntry(updated);
    expect((await getJournalEntry(thoughtEntry.id)).content).toBe('Updated thought');
  });
});

// ─── deleteJournalEntry ───────────────────────────────────────────────────────

describe('deleteJournalEntry', () => {
  it('removes the entry so getJournalEntry returns null', async () => {
    await saveJournalEntry(thoughtEntry);
    await deleteJournalEntry(thoughtEntry.id);
    expect(await getJournalEntry(thoughtEntry.id)).toBeNull();
  });

  it('deleting a non-existent entry does not throw', async () => {
    await expect(deleteJournalEntry(9999)).resolves.not.toThrow();
  });
});

// ─── getJournal ───────────────────────────────────────────────────────────────

describe('getJournal', () => {
  it('returns an empty array (not null/undefined) when no entries exist', async () => {
    const result = await getJournal();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  it('returns all saved entries as an array', async () => {
    await saveJournalEntry(thoughtEntry);
    await saveJournalEntry(moveEntry);
    const result = await getJournal();
    expect(result).toHaveLength(2);
    const ids = result.map((e: any) => e.id);
    expect(ids).toContain(thoughtEntry.id);
    expect(ids).toContain(moveEntry.id);
  });
});

// ─── saveJournal (bulk) ───────────────────────────────────────────────────────

describe('saveJournal', () => {
  it('replaces all entries atomically', async () => {
    await saveJournalEntry(thoughtEntry);
    // Bulk-save only moveEntry — thoughtEntry should be gone
    await saveJournal([moveEntry]);
    const result = await getJournal();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(moveEntry.id);
  });

  it('accepts an empty array, clearing all entries', async () => {
    await saveJournalEntry(thoughtEntry);
    await saveJournal([]);
    expect(await getJournal()).toHaveLength(0);
  });
});
