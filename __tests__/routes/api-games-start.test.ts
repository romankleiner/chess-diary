import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/db', () => ({
  getSetting: vi.fn(),
  saveGame: vi.fn(),
  saveJournalEntry: vi.fn(),
}));

import { POST } from '@/app/api/games/start/route';
import { getSetting, saveGame, saveJournalEntry } from '@/lib/db';

const mockGetSetting = vi.mocked(getSetting);
const mockSaveGame = vi.mocked(saveGame);
const mockSaveEntry = vi.mocked(saveJournalEntry);

function makeReq(body: object) {
  return new NextRequest('http://localhost/api/games/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSaveGame.mockResolvedValue(undefined);
  mockSaveEntry.mockResolvedValue(undefined);
});

// ─── validation ───────────────────────────────────────────────────────────────

describe('POST /api/games/start — validation', () => {
  it('returns 400 when gameUrl is missing', async () => {
    mockGetSetting.mockResolvedValue('testuser');
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/required/i);
  });

  it('returns 400 when chesscom_username is not configured', async () => {
    mockGetSetting.mockResolvedValue(null);
    const res = await POST(makeReq({ gameUrl: 'https://www.chess.com/game/daily/123' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/username/i);
  });

  it('returns 400 when gameUrl has no extractable id segment', async () => {
    mockGetSetting.mockResolvedValue('testuser');
    // URL ending in slash produces empty string from .pop()
    const res = await POST(makeReq({ gameUrl: 'https://www.chess.com/' }));
    expect(res.status).toBe(400);
  });
});

// ─── success ──────────────────────────────────────────────────────────────────

describe('POST /api/games/start — success', () => {
  const gameUrl = 'https://www.chess.com/game/daily/987654';

  beforeEach(() => mockGetSetting.mockResolvedValue('testuser'));

  it('returns 200 with success:true', async () => {
    const res = await POST(makeReq({ gameUrl }));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it('returns the extracted gameId', async () => {
    const { gameId } = await (await POST(makeReq({ gameUrl }))).json();
    expect(gameId).toBe('987654');
  });

  it('saves a game object with result:null and analysisCompleted:false', async () => {
    await POST(makeReq({ gameUrl }));
    const [id, game] = mockSaveGame.mock.calls[0];
    expect(id).toBe('987654');
    expect(game.result).toBeNull();
    expect(game.analysisCompleted).toBe(false);
  });

  it('saves a game_start journal entry with the correct gameId', async () => {
    await POST(makeReq({ gameUrl }));
    const [entry] = mockSaveEntry.mock.calls[0];
    expect(entry.entryType).toBe('game_start');
    expect(entry.gameId).toBe('987654');
  });

  it('calls both saveGame and saveJournalEntry', async () => {
    await POST(makeReq({ gameUrl }));
    expect(mockSaveGame).toHaveBeenCalledOnce();
    expect(mockSaveEntry).toHaveBeenCalledOnce();
  });
});
