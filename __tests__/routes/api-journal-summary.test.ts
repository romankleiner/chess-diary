import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { gameA, summaryEntry, analysisA } from '../helpers/fixtures';

vi.mock('@/lib/db', () => ({
  getJournal: vi.fn(),
  getGame: vi.fn(),
  getAnalysis: vi.fn(),
  getSetting: vi.fn(),
  saveJournalEntry: vi.fn(),
  getJournalEntry: vi.fn(),
  publishBlog: vi.fn(),
}));
vi.mock('@/lib/blog-directory-server', () => ({
  clearBlogDirectoryCache: vi.fn(),
}));

import { GET, POST, PUT } from '@/app/api/journal/post-game-summary/route';
import {
  getJournal, getGame, getAnalysis, getSetting, saveJournalEntry, getJournalEntry, publishBlog,
} from '@/lib/db';
import { clearBlogDirectoryCache } from '@/lib/blog-directory-server';

const mockGetJournal = vi.mocked(getJournal);
const mockGetGame = vi.mocked(getGame);
const mockGetAnalysis = vi.mocked(getAnalysis);
const mockGetSetting = vi.mocked(getSetting);
const mockSaveEntry = vi.mocked(saveJournalEntry);
const mockGetEntry = vi.mocked(getJournalEntry);
const mockPublishBlog = vi.mocked(publishBlog);
const mockClearDirectory = vi.mocked(clearBlogDirectoryCache);

beforeEach(() => {
  vi.clearAllMocks();
  mockSaveEntry.mockResolvedValue(undefined);
  mockPublishBlog.mockResolvedValue(undefined);
});

// ─── GET ──────────────────────────────────────────────────────────────────────

describe('GET /api/journal/post-game-summary', () => {
  it('returns 400 when gameId is missing', async () => {
    const req = new NextRequest('http://localhost/api/journal/post-game-summary');
    expect((await GET(req)).status).toBe(400);
  });

  it('returns the summary when one exists', async () => {
    mockGetJournal.mockResolvedValue([summaryEntry]);
    const req = new NextRequest(
      `http://localhost/api/journal/post-game-summary?gameId=${summaryEntry.gameId}`
    );
    const { summary } = await (await GET(req)).json();
    expect(summary.id).toBe(summaryEntry.id);
  });

  it('returns null when no summary exists for the game', async () => {
    mockGetJournal.mockResolvedValue([]);
    const req = new NextRequest(
      'http://localhost/api/journal/post-game-summary?gameId=game-999'
    );
    const { summary } = await (await GET(req)).json();
    expect(summary).toBeNull();
  });
});

// ─── POST — validation ────────────────────────────────────────────────────────

describe('POST /api/journal/post-game-summary — validation', () => {
  it('returns 400 when gameId is missing from the body', async () => {
    const req = new NextRequest('http://localhost/api/journal/post-game-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reflections: {} }),
    });
    expect((await POST(req)).status).toBe(400);
  });

  it('returns 409 when a summary already exists for the game', async () => {
    mockGetJournal.mockResolvedValue([summaryEntry]); // duplicate
    mockGetGame.mockResolvedValue(gameA);
    mockGetAnalysis.mockResolvedValue(null);
    mockGetSetting.mockResolvedValue('testuser');

    const req = new NextRequest('http://localhost/api/journal/post-game-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: summaryEntry.gameId, reflections: {} }),
    });
    expect((await POST(req)).status).toBe(409);
  });
});

// ─── POST — success with analysis ─────────────────────────────────────────────

describe('POST /api/journal/post-game-summary — success with analysis', () => {
  const reflections = {
    whatWentWell: 'Good king safety',
    mistakes: 'Missed a fork',
    lessonsLearned: 'Check for forks',
    nextSteps: 'Tactics puzzles',
  };

  beforeEach(() => {
    mockGetJournal.mockResolvedValue([]); // no duplicate
    mockGetGame.mockResolvedValue(gameA);
    mockGetAnalysis.mockResolvedValue(analysisA);
    mockGetSetting.mockResolvedValue('testuser'); // username for computeStatistics
  });

  it('returns 200 with success:true', async () => {
    const req = new NextRequest('http://localhost/api/journal/post-game-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: gameA.id, reflections }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it('includes computed statistics in the entry', async () => {
    const req = new NextRequest('http://localhost/api/journal/post-game-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: gameA.id, reflections }),
    });
    const { entry } = await (await POST(req)).json();
    expect(entry.postGameSummary.statistics).not.toBeNull();
    expect(typeof entry.postGameSummary.statistics.accuracy).toBe('number');
  });

  it('passes lowercased username to computeStatistics (setting value is already lowercase)', async () => {
    // If getSetting returns uppercase, the route lowercases it before passing to computeStatistics
    mockGetSetting.mockResolvedValue('TestUser'); // mixed case
    const req = new NextRequest('http://localhost/api/journal/post-game-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: gameA.id, reflections }),
    });
    // Should not throw and should produce a valid entry regardless of case
    const { entry } = await (await POST(req)).json();
    expect(entry.entryType).toBe('post_game_summary');
  });

  it('includes a gameSnapshot with opponent/result', async () => {
    const req = new NextRequest('http://localhost/api/journal/post-game-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: gameA.id, reflections }),
    });
    const { entry } = await (await POST(req)).json();
    expect(entry.gameSnapshot.opponent).toBe(gameA.opponent);
    expect(entry.gameSnapshot.result).toBe(gameA.result);
  });

  it('sets entryType to post_game_summary', async () => {
    const req = new NextRequest('http://localhost/api/journal/post-game-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: gameA.id, reflections }),
    });
    const { entry } = await (await POST(req)).json();
    expect(entry.entryType).toBe('post_game_summary');
  });
});

// ─── POST — success without analysis ─────────────────────────────────────────

describe('POST /api/journal/post-game-summary — no analysis', () => {
  it('sets statistics to null when no engine analysis exists', async () => {
    mockGetJournal.mockResolvedValue([]);
    mockGetGame.mockResolvedValue(gameA);
    mockGetAnalysis.mockResolvedValue(null);
    mockGetSetting.mockResolvedValue('testuser');

    const req = new NextRequest('http://localhost/api/journal/post-game-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: gameA.id, reflections: {} }),
    });
    const { entry } = await (await POST(req)).json();
    expect(entry.postGameSummary.statistics).toBeNull();
  });
});

// ─── PUT ──────────────────────────────────────────────────────────────────────

describe('PUT /api/journal/post-game-summary', () => {
  it('returns 400 when id is missing', async () => {
    const req = new NextRequest('http://localhost/api/journal/post-game-summary', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reflections: {} }),
    });
    expect((await PUT(req)).status).toBe(400);
  });

  it('returns 404 when the entry does not exist', async () => {
    mockGetEntry.mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/journal/post-game-summary', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 9999, reflections: { whatWentWell: 'x' } }),
    });
    expect((await PUT(req)).status).toBe(404);
  });

  it('merges new reflections with existing ones', async () => {
    mockGetEntry.mockResolvedValue({ ...summaryEntry });
    const req = new NextRequest('http://localhost/api/journal/post-game-summary', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: summaryEntry.id,
        reflections: { nextSteps: 'Study endgames' },
      }),
    });
    const { entry } = await (await PUT(req)).json();
    // Previously set fields should still be present
    expect(entry.postGameSummary.reflections.whatWentWell).toBe('Good opening play');
    // New field should be updated
    expect(entry.postGameSummary.reflections.nextSteps).toBe('Study endgames');
  });

  it('never shares the blog: editing a summary must not re-share a game its author un-shared', async () => {
    mockGetEntry.mockResolvedValue({ ...summaryEntry });
    const req = new NextRequest('http://localhost/api/journal/post-game-summary', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: summaryEntry.id, reflections: { nextSteps: 'Study endgames' } }),
    });
    expect((await PUT(req)).status).toBe(200);
    expect(mockPublishBlog).not.toHaveBeenCalled();
  });
});

// ─── POST — sharing the blog ──────────────────────────────────────────────────

describe('POST /api/journal/post-game-summary — sharing the blog', () => {
  const post = (gameId: string | null = gameA.id) => POST(new NextRequest('http://localhost/api/journal/post-game-summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, reflections: { lessonsLearned: 'Check for forks' } }),
  }));

  beforeEach(() => {
    mockGetJournal.mockResolvedValue([]);
    mockGetGame.mockResolvedValue(gameA);
    mockGetAnalysis.mockResolvedValue(null);
    mockGetSetting.mockResolvedValue('testuser');
  });

  it('shares a finished game’s blog once its summary is saved, and says so', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, published: true });
    expect(mockPublishBlog).toHaveBeenCalledTimes(1);
    expect(mockPublishBlog).toHaveBeenCalledWith(gameA.id);
  });

  it('saves the summary first, so the shared blog already ends with it', async () => {
    await post();
    expect(mockSaveEntry.mock.invocationCallOrder[0]).toBeLessThan(mockPublishBlog.mock.invocationCallOrder[0]);
  });

  it('has the directory read afresh, so the game is listed at once', async () => {
    await post();
    expect(mockClearDirectory).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['no result yet', null],
    ['an empty result', ''],
    ['the text "null"', 'null'],
    ['a result still in progress', 'in_progress'],
  ])('never shares a game still being played (%s) — the opponent could read the thinking', async (_name, result) => {
    mockGetGame.mockResolvedValue({ ...gameA, result });
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, published: false });
    expect(mockSaveEntry).toHaveBeenCalledTimes(1);
    expect(mockPublishBlog).not.toHaveBeenCalled();
    expect(mockClearDirectory).not.toHaveBeenCalled();
  });

  it('never shares a game that isn’t the caller’s', async () => {
    mockGetGame.mockResolvedValue(null);
    expect(await (await post('someone-elses-game')).json()).toMatchObject({ published: false });
    expect(mockPublishBlog).not.toHaveBeenCalled();
  });

  it('still saves the summary when sharing fails, and says it wasn’t shared', async () => {
    mockPublishBlog.mockRejectedValue(new Error('redis down'));
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, published: false });
    expect(mockSaveEntry).toHaveBeenCalledTimes(1);
    expect(mockClearDirectory).not.toHaveBeenCalled();
  });

  it('shares nothing when the summary can’t be saved', async () => {
    mockSaveEntry.mockRejectedValue(new Error('redis down'));
    expect((await post()).status).toBe(500);
    expect(mockPublishBlog).not.toHaveBeenCalled();
  });

  it('shares nothing when the game already has a summary', async () => {
    mockGetJournal.mockResolvedValue([summaryEntry]);
    expect((await post(summaryEntry.gameId)).status).toBe(409);
    expect(mockPublishBlog).not.toHaveBeenCalled();
  });
});
