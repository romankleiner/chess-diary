import { vi, describe, it, expect, beforeEach } from 'vitest';

// ─── In-memory Redis store, recording every command ───────────────────────────

const { store, calls, failures } = vi.hoisted(() => {
  const hashes = new Map<string, Map<string, string>>();
  const strings = new Map<string, string>();
  const calls: Array<{ name: string; key: string; args: unknown[] }> = [];
  const failures: { hgetall: string | null } = { hgetall: null };
  return { store: { hashes, strings, clear() { hashes.clear(); strings.clear(); calls.length = 0; failures.hgetall = null; } }, calls, failures };
});

vi.mock('ioredis', () => {
  const hash = (key: string) => {
    if (!store.hashes.has(key)) store.hashes.set(key, new Map());
    return store.hashes.get(key)!;
  };
  const ops = {
    async hget(key: string, field: string) { return store.hashes.get(key)?.get(field) ?? null; },
    async hset(key: string, field: string, value: string) { hash(key).set(field, value); return 1; },
    async hdel(key: string, ...fields: string[]) { let n = 0; for (const f of fields) if (store.hashes.get(key)?.delete(f)) n++; return n; },
    async hgetall(key: string) {
      if (failures.hgetall && key === failures.hgetall) { failures.hgetall = null; throw new Error('redis down'); }
      const h = store.hashes.get(key); return h ? Object.fromEntries(h) : {};
    },
    async hlen(key: string) { return store.hashes.get(key)?.size ?? 0; },
    async hvals(key: string) { return [...(store.hashes.get(key)?.values() ?? [])]; },
    async get(key: string) { return store.strings.get(key) ?? null; },
    async set(key: string, value: string, ...args: unknown[]) {
      if (args.includes('NX') && store.strings.has(key)) return null;
      store.strings.set(key, value); return 'OK';
    },
    async del(key: string) { store.strings.delete(key); store.hashes.delete(key); return 1; },
  };
  const recorded = Object.fromEntries(Object.entries(ops).map(([name, fn]) => [name, (key: string, ...args: unknown[]) => {
    calls.push({ name, key, args });
    return (fn as (k: string, ...a: unknown[]) => Promise<unknown>)(key, ...args);
  }])) as typeof ops;
  const batch = () => {
    const queued: Array<() => Promise<unknown>> = [];
    const b: Record<string, unknown> = {
      exec: async () => { const out: Array<[unknown, unknown]> = []; for (const op of queued) { try { out.push([null, await op()]); } catch (e) { out.push([e, null]); } } return out; },
    };
    for (const name of Object.keys(recorded) as Array<keyof typeof ops>) {
      b[name] = (...args: unknown[]) => { queued.push(() => (recorded[name] as (...a: unknown[]) => Promise<unknown>)(...args)); return b; };
    }
    return b;
  };
  return { default: class MockRedis { constructor() { Object.assign(this, recorded); } multi = batch; pipeline = batch; } };
});

process.env.REDIS_URL = 'redis://test';

import {
  JOURNAL_COPIES_REBUILD_SECONDS, deleteJournalEntry, getGamesJournal, getJournal, getJournalEntry, saveJournal, saveJournalEntry,
} from '@/lib/db';
import { IMAGE_FIELDS, entryGameId, withoutImages } from '@/lib/journal-copies';

const UID = 'alice';
const JOURNAL = `chess-diary:${UID}:journal`;
const FILED = `chess-diary:${UID}:journal-games`;
const copiesOf = (gameId: string) => `chess-diary:${UID}:journal-by-game:${gameId}`;
const REBUILT = `chess-diary:${UID}:journal-copies-rebuilt`;

const IMAGE = 'data:image/png;base64,' + 'A'.repeat(5000);
const entry = (id: number, gameId: string | null, over: Record<string, unknown> = {}) => ({
  id, date: '2026-10-08', gameId, entryType: 'thought', content: `thought ${id}`, timestamp: '2026-10-08T10:00:00.000Z',
  images: [IMAGE], image: IMAGE, ...over,
});

/** What is filed under a game, by entry id. */
const copies = (gameId: string) => Object.fromEntries([...(store.hashes.get(copiesOf(gameId)) ?? new Map())].map(([id, v]) => [id, JSON.parse(v)]));
/** Whether the whole journal was read. */
const readWholeJournal = () => calls.some(c => c.name === 'hgetall' && c.key === JOURNAL);

beforeEach(() => store.clear());

// ─── what a copy is ───────────────────────────────────────────────────────────

describe('withoutImages', () => {
  it('drops the pasted images and keeps everything else', () => {
    const e = entry(1, '111', { aiReview: 'ai', postReview: 'post', fen: 'x' });
    const copy = withoutImages(e);
    expect(copy).toEqual({ id: 1, date: '2026-10-08', gameId: '111', entryType: 'thought', content: 'thought 1', timestamp: '2026-10-08T10:00:00.000Z', aiReview: 'ai', postReview: 'post', fen: 'x' });
    for (const field of IMAGE_FIELDS) expect(copy).not.toHaveProperty(field);
  });

  it('leaves the entry itself as it was', () => {
    const e = entry(1, '111');
    withoutImages(e);
    expect(e.images).toEqual([IMAGE]);
    expect(e.image).toBe(IMAGE);
  });

  it('copes with an entry that has no images', () => {
    expect(withoutImages({ id: 1, content: 'x' })).toEqual({ id: 1, content: 'x' });
  });
});

describe('entryGameId', () => {
  it('files an entry under its game, as text', () => {
    expect(entryGameId({ gameId: '952794945' })).toBe('952794945');
    expect(entryGameId({ gameId: 952794945 })).toBe('952794945');
    expect(entryGameId({ gameId: ' 111 ' })).toBe('111');
  });

  it('files an entry with no game under nothing', () => {
    expect(entryGameId({ gameId: null })).toBe('');
    expect(entryGameId({ gameId: undefined })).toBe('');
    expect(entryGameId({})).toBe('');
    expect(entryGameId({ gameId: '' })).toBe('');
  });
});

// ─── keeping the copies in step ───────────────────────────────────────────────

describe('saving and deleting entries keeps the copies in step', () => {
  it('files an image-free copy under the entry’s game, and keeps the entry whole in the journal', async () => {
    await saveJournalEntry(entry(1, '111'), UID);
    expect(copies('111')).toEqual({ '1': withoutImages(entry(1, '111')) });
    expect(await getJournalEntry(1, UID)).toEqual(entry(1, '111'));
  });

  it('notes an entry with no game without filing a copy', async () => {
    await saveJournalEntry(entry(1, null), UID);
    expect(store.hashes.get(FILED)!.get('1')).toBe('');
    expect([...store.hashes.keys()].filter(k => k.includes('journal-by-game'))).toEqual([]);
  });

  it('updates the copy when the entry is edited', async () => {
    await saveJournalEntry(entry(1, '111'), UID);
    await saveJournalEntry(entry(1, '111', { content: 'second thoughts' }), UID);
    expect(copies('111')['1'].content).toBe('second thoughts');
  });

  it('moves the copy when the entry moves to another game, leaving nothing behind', async () => {
    await saveJournalEntry(entry(1, '111'), UID);
    await saveJournalEntry(entry(1, '222'), UID);
    expect(copies('111')).toEqual({});
    expect(Object.keys(copies('222'))).toEqual(['1']);
    expect(store.hashes.get(FILED)!.get('1')).toBe('222');
  });

  it('drops the copy when the entry is taken off its game', async () => {
    await saveJournalEntry(entry(1, '111'), UID);
    await saveJournalEntry(entry(1, null), UID);
    expect(copies('111')).toEqual({});
    expect(store.hashes.get(FILED)!.get('1')).toBe('');
  });

  it('removes the entry, its copy and its filing when it is deleted', async () => {
    await saveJournalEntry(entry(1, '111'), UID);
    await saveJournalEntry(entry(2, '111'), UID);
    await deleteJournalEntry(1, UID);
    expect(await getJournalEntry(1, UID)).toBeNull();
    expect(Object.keys(copies('111'))).toEqual(['2']);
    expect(store.hashes.get(FILED)!.has('1')).toBe(false);
  });

  it('copes with deleting an entry that is not there', async () => {
    await expect(deleteJournalEntry(99, UID)).resolves.toBeUndefined();
  });

  it('rebuilds every copy when the whole journal is replaced, dropping games no longer in it', async () => {
    await saveJournalEntry(entry(1, '111'), UID);
    await saveJournalEntry(entry(2, '222'), UID);
    await saveJournal([entry(3, '222'), entry(4, '333'), entry(5, null)], UID);

    expect(copies('111')).toEqual({});
    expect(Object.keys(copies('222'))).toEqual(['3']);
    expect(Object.keys(copies('333'))).toEqual(['4']);
    expect(Object.fromEntries(store.hashes.get(FILED)!)).toEqual({ '3': '222', '4': '333', '5': '' });
    expect((await getJournal(UID)).map(e => e.id).sort()).toEqual([3, 4, 5]);
  });

  it('keeps each author’s copies to themselves', async () => {
    await saveJournalEntry(entry(1, '111'), 'alice');
    await saveJournalEntry(entry(2, '111'), 'bob');
    expect(Object.keys(copies('111'))).toEqual(['1']);
    expect((await getGamesJournal(['111'], 'bob')).map(e => e.id)).toEqual([2]);
  });
});

// ─── reading them ─────────────────────────────────────────────────────────────

describe('getGamesJournal', () => {
  beforeEach(async () => {
    await saveJournalEntry(entry(1, '111'), UID);
    await saveJournalEntry(entry(2, '111'), UID);
    await saveJournalEntry(entry(3, '222'), UID);
    await saveJournalEntry(entry(4, null), UID);
    calls.length = 0;
  });

  it('gives a game’s entries, without their images', async () => {
    const entries = await getGamesJournal(['111'], UID);
    expect(entries.map(e => e.id).sort()).toEqual([1, 2]);
    for (const e of entries) for (const field of IMAGE_FIELDS) expect(e).not.toHaveProperty(field);
    expect(entries[0].content).toMatch(/^thought/);
  });

  it('gives several games’ entries at once', async () => {
    expect((await getGamesJournal(['111', '222'], UID)).map(e => e.id).sort()).toEqual([1, 2, 3]);
  });

  it('gives nothing for a game with no entries, or for no games', async () => {
    expect(await getGamesJournal(['999'], UID)).toEqual([]);
    calls.length = 0;
    expect(await getGamesJournal([], UID)).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('fails when a game’s copies cannot be read, rather than giving a blog with no commentary', async () => {
    failures.hgetall = copiesOf('111');
    await expect(getGamesJournal(['111'], UID)).rejects.toThrow('redis down');
  });

  it('never reads the whole journal while the copies are in step', async () => {
    await getGamesJournal(['111'], UID);
    await getGamesJournal(['111', '222'], UID);
    expect(readWholeJournal()).toBe(false);
    // just the two counts and the one game's copies per read
    expect(calls.filter(c => c.name === 'hgetall').map(c => c.key)).toEqual([copiesOf('111'), copiesOf('111'), copiesOf('222')]);
  });
});

// ─── building them the first time, and mending them ───────────────────────────

describe('getGamesJournal — copies out of step', () => {
  /** A journal written before there were copies. */
  const legacyJournal = (...entries: Array<ReturnType<typeof entry>>) => {
    for (const e of entries) store.hashes.set(JOURNAL, new Map([...(store.hashes.get(JOURNAL) ?? new Map()), [String(e.id), JSON.stringify(e)]]));
  };

  it('builds the copies from the whole journal the first time, then reads only the copies', async () => {
    legacyJournal(entry(1, '111'), entry(2, '111'), entry(3, '222'), entry(4, null));

    expect((await getGamesJournal(['111'], UID)).map(e => e.id).sort()).toEqual([1, 2]);
    expect(readWholeJournal()).toBe(true);
    expect(Object.keys(copies('222'))).toEqual(['3']);
    expect(store.hashes.get(FILED)!.size).toBe(4);

    calls.length = 0;
    await getGamesJournal(['111'], UID);
    expect(readWholeJournal()).toBe(false);
  });

  it('notes that it rebuilt, for an hour', async () => {
    legacyJournal(entry(1, '111'));
    await getGamesJournal(['111'], UID);
    const claim = calls.find(c => c.name === 'set' && c.key === REBUILT)!;
    expect(claim.args).toEqual(['1', 'EX', JOURNAL_COPIES_REBUILD_SECONDS, 'NX']);
    expect(JOURNAL_COPIES_REBUILD_SECONDS).toBe(3600);
  });

  it('does not rebuild again within the hour, however out of step the copies are', async () => {
    legacyJournal(entry(1, '111'));
    await getGamesJournal(['111'], UID);
    legacyJournal(entry(2, '111'));     // changed some other way
    calls.length = 0;

    expect((await getGamesJournal(['111'], UID)).map(e => e.id)).toEqual([1]);  // what is there
    expect(readWholeJournal()).toBe(false);
  });

  it('rebuilds again once the hour is up', async () => {
    legacyJournal(entry(1, '111'));
    await getGamesJournal(['111'], UID);
    legacyJournal(entry(2, '111'));
    store.strings.delete(REBUILT);      // the hour has passed

    expect((await getGamesJournal(['111'], UID)).map(e => e.id).sort()).toEqual([1, 2]);
  });

  it('mends a journal changed some other way: an entry removed', async () => {
    await saveJournalEntry(entry(1, '111'), UID);
    await saveJournalEntry(entry(2, '111'), UID);
    store.hashes.get(JOURNAL)!.delete('2');

    expect((await getGamesJournal(['111'], UID)).map(e => e.id)).toEqual([1]);
  });

  it('lets the next reader try again if building fails, rather than wait an hour', async () => {
    legacyJournal(entry(1, '111'));
    failures.hgetall = JOURNAL;
    await expect(getGamesJournal(['111'], UID)).rejects.toThrow('redis down');
    expect(store.strings.has(REBUILT)).toBe(false);

    expect((await getGamesJournal(['111'], UID)).map(e => e.id)).toEqual([1]);
  });
});
