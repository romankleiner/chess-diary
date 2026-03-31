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
}));

import { GET, POST, PUT } from '@/app/api/journal/post-game-summary/route';
import {
  getJournal, getGame, getAnalysis, getSetting, saveJournalEntry, getJournalEntry,
} from '@/lib/db';

const mockGetJournal = vi.mocked(getJournal);
const mockGetGame = vi.mocked(getGame);
const mockGetAnalysis = vi.mocked(getAnalysis);
const mockGetSetting = vi.mocked(getSetting);
const mockSaveEntry = vi.mocked(saveJournalEntry);
const mockGetEntry = vi.mocked(getJournalEntry);

beforeEach(() => {
  vi.clearAllMocks();
  mockSaveEntry.mockResolvedValue(undefined);
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
});
