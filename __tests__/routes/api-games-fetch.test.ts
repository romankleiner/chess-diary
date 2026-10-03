import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { gameA, gameB } from '../helpers/fixtures';

vi.mock('@/lib/db', () => ({
  getSetting: vi.fn(),
  getGames: vi.fn(),
  saveGame: vi.fn(),
}));

vi.mock('@/lib/chesscom', () => ({
  fetchPlayerGames: vi.fn(),
  fetchActiveGames: vi.fn(),
  parseChessComGame: vi.fn(),
}));

import { POST } from '@/app/api/games/fetch/route';
import { getSetting, getGames, saveGame } from '@/lib/db';
import { fetchPlayerGames, fetchActiveGames, parseChessComGame } from '@/lib/chesscom';

const mockGetSetting = vi.mocked(getSetting);
const mockGetGames = vi.mocked(getGames);
const mockSaveGame = vi.mocked(saveGame);
const mockFetchArchived = vi.mocked(fetchPlayerGames);
const mockFetchActive = vi.mocked(fetchActiveGames);
const mockParse = vi.mocked(parseChessComGame);

function makeReq(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/games/fetch');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url, { method: 'POST' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSaveGame.mockResolvedValue(undefined);
  mockFetchActive.mockResolvedValue({ games: [] });
  mockGetGames.mockResolvedValue({}); // no games stored yet
});

// ─── validation ───────────────────────────────────────────────────────────────

describe('POST /api/games/fetch — validation', () => {
  it('returns 400 when chesscom_username is not configured', async () => {
    mockGetSetting.mockResolvedValue(null);
    mockFetchArchived.mockResolvedValue({ games: [] });
    const res = await POST(makeReq());
    expect(res.status).toBe(400);
  });
});

// ─── deduplication ────────────────────────────────────────────────────────────

describe('POST /api/games/fetch — deduplication', () => {
  it('removes games with duplicate IDs before saving', async () => {
    mockGetSetting.mockResolvedValue('testuser');
    const rawGame = { url: 'https://www.chess.com/game/daily/111' };
    // API returns the same raw game twice (e.g. from two months)
    mockFetchArchived.mockResolvedValue({ games: [rawGame, rawGame] });
    mockParse.mockReturnValue(gameA); // both parse to the same id

    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    // saveGame should only be called once for the deduplicated game
    expect(mockSaveGame).toHaveBeenCalledOnce();
  });
});

// ─── preserves analysisCompleted ─────────────────────────────────────────────

describe('POST /api/games/fetch — preserves analysisCompleted', () => {
  it('keeps analysisCompleted:true from an existing game even if new data says false', async () => {
    mockGetSetting.mockResolvedValue('testuser');
    mockFetchArchived.mockResolvedValue({ games: [{}] });
    mockParse.mockReturnValue({ ...gameA, analysisCompleted: false });
    // Existing game in DB already has analysis (existing games are read in one getGames() call)
    mockGetGames.mockResolvedValue({ [gameA.id]: { ...gameA, analysisCompleted: true } });

    await POST(makeReq());
    const [, savedGame] = mockSaveGame.mock.calls[0];
    expect(savedGame.analysisCompleted).toBe(true);
  });

  it('keeps analysisCompleted:false when neither existing nor new game has it', async () => {
    mockGetSetting.mockResolvedValue('testuser');
    mockFetchArchived.mockResolvedValue({ games: [{}] });
    mockParse.mockReturnValue({ ...gameA, analysisCompleted: false });
    mockGetGames.mockResolvedValue({});

    await POST(makeReq());
    const [, savedGame] = mockSaveGame.mock.calls[0];
    expect(savedGame.analysisCompleted).toBe(false);
  });

  it('keeps analysisDepth and analysisEngine from the existing game', async () => {
    mockGetSetting.mockResolvedValue('testuser');
    mockFetchArchived.mockResolvedValue({ games: [{}] });
    mockParse.mockReturnValue({ ...gameA, analysisCompleted: false });
    mockGetGames.mockResolvedValue({
      [gameA.id]: { ...gameA, analysisCompleted: true, analysisDepth: 18, analysisEngine: 'Stockfish' },
    });

    await POST(makeReq());
    const [, savedGame] = mockSaveGame.mock.calls[0];
    expect(savedGame.analysisDepth).toBe(18);
    expect(savedGame.analysisEngine).toBe('Stockfish');
  });

  it('saves the game under its own id', async () => {
    mockGetSetting.mockResolvedValue('testuser');
    mockFetchArchived.mockResolvedValue({ games: [{}] });
    mockParse.mockReturnValue(gameA);

    await POST(makeReq());
    const [savedId] = mockSaveGame.mock.calls[0];
    expect(savedId).toBe(gameA.id);
  });
});

// ─── batched read of existing games ───────────────────────────────────────────

describe('POST /api/games/fetch — existing games are read in one batch', () => {
  it('calls getGames once for the whole fetch rather than once per game', async () => {
    mockGetSetting.mockResolvedValue('testuser');
    mockFetchArchived.mockResolvedValue({ games: [{}, {}] });
    mockParse.mockReturnValueOnce(gameA).mockReturnValueOnce(gameB).mockReturnValue(gameA);

    await POST(makeReq());
    expect(mockSaveGame).toHaveBeenCalledTimes(2); // two distinct games saved…
    expect(mockGetGames).toHaveBeenCalledOnce();   // …from a single read of existing ones
  });
});

// ─── completed vs. active duplicates ──────────────────────────────────────────

describe('POST /api/games/fetch — completed beats active', () => {
  it('keeps the completed version when Chess.com lists a finished game as active too', async () => {
    mockGetSetting.mockResolvedValue('testuser');
    // Same game id from the monthly archive (finished) and the active-games endpoint (still listed).
    const finished = { ...gameA, result: '1-0' };
    const stillActive = { ...gameA, result: null };
    mockFetchArchived.mockResolvedValue({ games: [{ kind: 'archived' }] });
    mockFetchActive.mockResolvedValue({ games: [{ kind: 'active' }] });
    mockParse.mockImplementation((raw: any) => (raw.kind === 'active' ? stillActive : finished));

    await POST(makeReq());
    expect(mockSaveGame).toHaveBeenCalledOnce();
    const [, savedGame] = mockSaveGame.mock.calls[0];
    expect(savedGame.result).toBe('1-0');
  });
});

// ─── success response ─────────────────────────────────────────────────────────

describe('POST /api/games/fetch — response shape', () => {
  it('returns success:true and a games array', async () => {
    mockGetSetting.mockResolvedValue('testuser');
    mockFetchArchived.mockResolvedValue({ games: [{}] });
    mockParse.mockReturnValue(gameA);

    const { success, games, newGames } = await (await POST(makeReq())).json();
    expect(success).toBe(true);
    expect(Array.isArray(games)).toBe(true);
    expect(typeof newGames).toBe('number');
  });
});
