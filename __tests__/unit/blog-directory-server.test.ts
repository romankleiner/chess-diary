import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  listPublishedBlogs: vi.fn(),
  getGamesById: vi.fn(),
  getJournal: vi.fn(),
  getSetting: vi.fn(),
}));

import { DIRECTORY_CACHE_MS, clearBlogDirectoryCache, loadBlogDirectory } from '@/lib/blog-directory-server';
import { getGamesById, getJournal, getSetting, listPublishedBlogs } from '@/lib/db';

const mockPublished = vi.mocked(listPublishedBlogs);
const mockGames     = vi.mocked(getGamesById);
const mockJournal   = vi.mocked(getJournal);
const mockSetting   = vi.mocked(getSetting);

const PGN = '[Date "2026.07.10"]\n\n1. e4 e5';
const game = (id: string, over: Record<string, unknown> = {}) => ({
  id, white: 'romank66', black: `opp_${id}`, opponent: `opp_${id}`, result: 'win', date: '2026-07-24',
  pgn: PGN, timeControl: '1/86400', ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  clearBlogDirectoryCache();
  mockPublished.mockResolvedValue([]);
  mockGames.mockResolvedValue({});
  mockJournal.mockResolvedValue([]);
  mockSetting.mockResolvedValue('romank66');
});

describe('loadBlogDirectory', () => {
  it('lists nothing when nothing is shared, and reads no journal', async () => {
    expect(await loadBlogDirectory()).toEqual([]);
    expect(mockJournal).not.toHaveBeenCalled();
    expect(mockGames).not.toHaveBeenCalled();
  });

  it('describes each shared game: its players, result, dates and how much was written', async () => {
    mockPublished.mockResolvedValue([{ gameId: '111', ownerId: 'alice' }, { gameId: '222', ownerId: 'alice' }]);
    mockGames.mockResolvedValue({ '111': game('111') as never, '222': game('222', { result: 'draw' }) as never });
    mockJournal.mockResolvedValue([
      { gameId: '111', entryType: 'thought', content: 'a' },
      { gameId: '111', entryType: 'thought', content: 'b' },
      { gameId: '111', entryType: 'post_game_summary', content: 's' },
      { gameId: '222', entryType: 'thought', content: 'c' },
    ]);

    const entries = await loadBlogDirectory();
    const byId = Object.fromEntries(entries.map(e => [e.gameId, e]));

    expect(entries).toHaveLength(2);
    expect(byId['111']).toMatchObject({
      white: 'romank66', black: 'opp_111', authorColor: 'white', result: 'win', startDate: '2026-07-10', endDate: '2026-07-24',
      timeControl: '1 day per move', commentedMoves: 2, hasSummary: true,
    });
    expect(byId['222']).toMatchObject({ result: 'draw', commentedMoves: 1, hasSummary: false });
  });

  it('reads only the owner’s own games and the shared ones', async () => {
    mockPublished.mockResolvedValue([{ gameId: '111', ownerId: 'alice' }, { gameId: '222', ownerId: 'alice' }]);
    await loadBlogDirectory();
    expect(mockGames).toHaveBeenCalledWith(['111', '222'], 'alice');
    expect(mockJournal).toHaveBeenCalledWith('alice');
    expect(mockSetting).toHaveBeenCalledWith('chesscom_username', 'alice');
  });

  it('counts the writing at shared games only', async () => {
    mockPublished.mockResolvedValue([{ gameId: '111', ownerId: 'alice' }]);
    mockGames.mockResolvedValue({ '111': game('111') as never });
    mockJournal.mockResolvedValue([
      { gameId: '111', entryType: 'thought', content: 'a' },
      { gameId: '999', entryType: 'thought', content: 'an unshared game' },
    ]);
    const [entry] = await loadBlogDirectory();
    expect(entry.commentedMoves).toBe(1);
  });

  it('reads each author on their own, each with their own name for telling which side they played', async () => {
    mockPublished.mockResolvedValue([{ gameId: '111', ownerId: 'alice' }, { gameId: '222', ownerId: 'bob' }]);
    mockGames.mockImplementation(async (_ids, owner): Promise<Record<string, never>> =>
      owner === 'alice'
        ? { '111': game('111', { white: 'alice_cc', black: 'x' }) as never }
        : { '222': game('222', { white: 'y', black: 'bob_cc' }) as never });
    mockSetting.mockImplementation(async (_key, owner) => (owner === 'alice' ? 'alice_cc' : 'bob_cc'));

    const entries = await loadBlogDirectory();
    const byId = Object.fromEntries(entries.map(e => [e.gameId, e]));
    expect(byId['111'].authorColor).toBe('white');
    expect(byId['222'].authorColor).toBe('black');
    expect(mockGames).toHaveBeenCalledWith(['111'], 'alice');
    expect(mockGames).toHaveBeenCalledWith(['222'], 'bob');
  });

  it('skips a shared game whose record has gone, rather than list a link to nothing', async () => {
    mockPublished.mockResolvedValue([{ gameId: '111', ownerId: 'alice' }, { gameId: 'gone', ownerId: 'alice' }]);
    mockGames.mockResolvedValue({ '111': game('111') as never });
    expect((await loadBlogDirectory()).map(e => e.gameId)).toEqual(['111']);
  });

  it('lists a shared game nobody has written about, with no commentary', async () => {
    mockPublished.mockResolvedValue([{ gameId: '111', ownerId: 'alice' }]);
    mockGames.mockResolvedValue({ '111': game('111') as never });
    expect((await loadBlogDirectory())[0]).toMatchObject({ commentedMoves: 0, hasSummary: false });
  });

  it('does not say which side the author played when it does not know their name', async () => {
    mockPublished.mockResolvedValue([{ gameId: '111', ownerId: 'alice' }]);
    mockGames.mockResolvedValue({ '111': game('111') as never });
    mockSetting.mockResolvedValue(null);
    expect((await loadBlogDirectory())[0].authorColor).toBeNull();
  });
});

describe('the directory is remembered briefly', () => {
  const share = () => {
    mockPublished.mockResolvedValue([{ gameId: '111', ownerId: 'alice' }]);
    mockGames.mockResolvedValue({ '111': game('111') as never });
  };

  it('answers a second visit from memory', async () => {
    share();
    const t = 1_000_000;
    const first = await loadBlogDirectory(t);
    const second = await loadBlogDirectory(t + DIRECTORY_CACHE_MS - 1);
    expect(second).toBe(first);
    expect(mockPublished).toHaveBeenCalledTimes(1);
    expect(mockJournal).toHaveBeenCalledTimes(1);
  });

  it('reads it afresh once the time is up', async () => {
    share();
    const t = 1_000_000;
    await loadBlogDirectory(t);
    await loadBlogDirectory(t + DIRECTORY_CACHE_MS);
    expect(mockPublished).toHaveBeenCalledTimes(2);
  });

  it('shows a newly shared game once it is read afresh', async () => {
    share();
    const t = 1_000_000;
    expect(await loadBlogDirectory(t)).toHaveLength(1);

    mockPublished.mockResolvedValue([{ gameId: '111', ownerId: 'alice' }, { gameId: '222', ownerId: 'alice' }]);
    mockGames.mockResolvedValue({ '111': game('111') as never, '222': game('222') as never });
    expect(await loadBlogDirectory(t + 1)).toHaveLength(1);              // still the remembered one
    expect(await loadBlogDirectory(t + DIRECTORY_CACHE_MS)).toHaveLength(2);
  });

  it('can be told to forget, so a game shared or un-shared shows at once', async () => {
    share();
    const t = 1_000_000;
    await loadBlogDirectory(t);
    clearBlogDirectoryCache();
    await loadBlogDirectory(t + 1);
    expect(mockPublished).toHaveBeenCalledTimes(2);
  });

  it('does not remember a read that failed', async () => {
    mockPublished.mockRejectedValueOnce(new Error('redis down'));
    await expect(loadBlogDirectory(1_000_000)).rejects.toThrow('redis down');

    share();
    expect(await loadBlogDirectory(1_000_001)).toHaveLength(1);
  });
});
