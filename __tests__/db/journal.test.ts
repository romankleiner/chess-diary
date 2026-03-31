import { vi, describe, it, expect, beforeEach } from 'vitest';
import { thoughtEntry, moveEntry, summaryEntry } from '../helpers/fixtures';

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
