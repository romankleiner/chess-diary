import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TEST_USER } from '../helpers/fixtures';

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
  },
}));

process.env.REDIS_URL = 'redis://test';

import { getAnalysis, getAnalyses, saveAnalysis } from '@/lib/db';

const KEY = `chess-diary:${TEST_USER}:analyses`;
const rawStored = (gameId: string) => JSON.parse(store.hashes.get(KEY)!.get(gameId)!);

// What an older version of the app saved: a generous accuracy next to the moves it came from.
const oldAnalysis = {
  gameId: 'g1',
  engine: 'chess-api.com',
  depth: 18,
  whiteAccuracy: 98.8,
  blackAccuracy: 99.1,
  moves: [
    { moveNumber: 1, color: 'white', move: 'e4', evaluation: 0.3, centipawnLoss: 0, moveQuality: 'book' },
    { moveNumber: 1, color: 'black', move: 'e5', evaluation: 0.2, centipawnLoss: 100, moveQuality: 'inaccuracy' },
    { moveNumber: 2, color: 'white', move: 'Nf3', evaluation: 0.3, centipawnLoss: 100, moveQuality: 'inaccuracy' },
    { moveNumber: 2, color: 'black', move: 'Nc6', evaluation: 0.2, centipawnLoss: 0, moveQuality: 'excellent' },
  ],
};

beforeEach(() => store.clear());

describe('getAnalysis — accuracy', () => {
  it('works the accuracy out from the moves, not from the figure that was saved', async () => {
    await saveAnalysis('g1', oldAnalysis);

    const analysis = await getAnalysis('g1');

    expect(analysis.whiteAccuracy).toBe(68.4); // one perfect move, one 100 cp slip
    expect(analysis.blackAccuracy).toBe(68.4);
    expect(analysis.whiteAccuracy).not.toBe(98.8);
  });

  it('returns the rest of the analysis as it was saved', async () => {
    await saveAnalysis('g1', oldAnalysis);

    expect(await getAnalysis('g1')).toMatchObject({ gameId: 'g1', engine: 'chess-api.com', depth: 18, moves: oldAnalysis.moves });
  });

  it('does not write the new figure back: reading changes nothing in storage', async () => {
    await saveAnalysis('g1', oldAnalysis);
    const before = store.hashes.get(KEY)!.get('g1');

    await getAnalysis('g1');
    await getAnalysis('g1');

    expect(store.hashes.get(KEY)!.get('g1')).toBe(before);
    expect(rawStored('g1').whiteAccuracy).toBe(98.8);
  });

  it('gives the same figure however many times it is read', async () => {
    await saveAnalysis('g1', oldAnalysis);
    expect((await getAnalysis('g1')).whiteAccuracy).toBe((await getAnalysis('g1')).whiteAccuracy);
  });

  it('keeps the saved figures for an analysis with no moves to work from', async () => {
    await saveAnalysis('g2', { gameId: 'g2', whiteAccuracy: 90, blackAccuracy: 80, moves: [] });

    expect(await getAnalysis('g2')).toMatchObject({ whiteAccuracy: 90, blackAccuracy: 80 });
  });

  it('agrees with the figure a new analysis saves, so analysing again changes nothing', async () => {
    const { calculateAccuracy } = await import('@/lib/analysis-utils');
    await saveAnalysis('g3', {
      ...oldAnalysis,
      whiteAccuracy: calculateAccuracy([0, 100]),
      blackAccuracy: calculateAccuracy([100, 0]),
    });

    const analysis = await getAnalysis('g3');

    expect(analysis.whiteAccuracy).toBe(calculateAccuracy([0, 100]));
    expect(analysis.blackAccuracy).toBe(calculateAccuracy([100, 0]));
  });

  it('is null for a game that has not been analysed', async () => {
    expect(await getAnalysis('nope')).toBeNull();
  });
});

describe('getAnalyses — as stored, for backups', () => {
  it('returns the figure that was saved, not a re-derived one', async () => {
    await saveAnalysis('g1', oldAnalysis);

    const all = await getAnalyses();

    expect(all.g1.whiteAccuracy).toBe(98.8);
    expect(all.g1.blackAccuracy).toBe(99.1);
  });
});
