import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { gameA, thoughtEntry, moveEntry, analysisA } from '../helpers/fixtures';

vi.mock('@/lib/db', () => ({
  getGame: vi.fn(),
  getJournal: vi.fn(),
  getAnalysis: vi.fn(),
  getSetting: vi.fn(),
  saveJournalEntry: vi.fn(),
}));

// Stub fetch once at module level so resets are clean across tests.
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { POST } from '@/app/api/games/analyze-thinking/route';
import { getGame, getJournal, getAnalysis, getSetting, saveJournalEntry } from '@/lib/db';

const mockGetGame = vi.mocked(getGame);
const mockGetJournal = vi.mocked(getJournal);
const mockGetAnalysis = vi.mocked(getAnalysis);
const mockGetSetting = vi.mocked(getSetting);
const mockSaveEntry = vi.mocked(saveJournalEntry);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(body: object) {
  return new NextRequest('http://localhost/api/games/analyze-thinking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function stubFetchSuccess(text = 'AI analysis of the position.') {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ content: [{ text }] }),
    text: async () => '',
  });
}

function stubFetchFailure(status = 500) {
  fetchMock.mockResolvedValue({
    ok: false,
    status,
    text: async () => 'error',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  mockSaveEntry.mockResolvedValue(undefined);
  mockGetSetting.mockImplementation(async (key: string) => {
    if (key === 'chesscom_username') return 'testuser';
    if (key === 'ai_analysis_verbosity') return 'detailed';
    if (key === 'ai_model') return 'claude-sonnet-4-6';
    return null;
  });
});

// ─── Validation ───────────────────────────────────────────────────────────────

describe('POST /api/games/analyze-thinking — validation', () => {
  it('returns 400 when gameId is missing', async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/gameId/i);
  });

  it('returns 404 when the game does not exist', async () => {
    mockGetGame.mockResolvedValue(null);
    mockGetJournal.mockResolvedValue([]);
    mockGetAnalysis.mockResolvedValue(null);
    const res = await POST(makeReq({ gameId: 'ghost' }));
    expect(res.status).toBe(404);
  });

  it('returns 404 when no journal entries exist for the game', async () => {
    mockGetGame.mockResolvedValue(gameA);
    mockGetJournal.mockResolvedValue([]); // no entries for this game
    mockGetAnalysis.mockResolvedValue(analysisA);
    const res = await POST(makeReq({ gameId: gameA.id }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/no journal entries/i);
  });
});

// ─── needsEngineAnalysis ──────────────────────────────────────────────────────

describe('POST /api/games/analyze-thinking — needsEngineAnalysis', () => {
  it('returns needsEngineAnalysis:true when no engine analysis and reanalyzeEngine not set', async () => {
    mockGetGame.mockResolvedValue(gameA);
    mockGetJournal.mockResolvedValue([thoughtEntry]);
    mockGetAnalysis.mockResolvedValue(null);
    const res = await POST(makeReq({ gameId: gameA.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.needsEngineAnalysis).toBe(true);
  });

  it('does NOT return needsEngineAnalysis when engine analysis exists', async () => {
    mockGetGame.mockResolvedValue(gameA);
    mockGetJournal.mockResolvedValue([{ ...thoughtEntry }]);
    mockGetAnalysis.mockResolvedValue(analysisA);
    stubFetchSuccess();
    const res = await POST(makeReq({ gameId: gameA.id }));
    const body = await res.json();
    expect(body.needsEngineAnalysis).toBeUndefined();
  });
});

// ─── Empty-content skip ───────────────────────────────────────────────────────

describe('POST /api/games/analyze-thinking — empty content skip', () => {
  it('skips the entry and returns success without calling Anthropic', async () => {
    const emptyEntry = { ...thoughtEntry, content: '   ' };
    mockGetGame.mockResolvedValue(gameA);
    mockGetJournal.mockResolvedValue([emptyEntry]);
    mockGetAnalysis.mockResolvedValue(analysisA);
    stubFetchSuccess();

    const res = await POST(makeReq({ gameId: gameA.id, entryIndex: 0 }));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    // fetch should not have been called for the Anthropic API
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('does not call saveJournalEntry when skipping an empty entry (early return)', async () => {
    const emptyEntry = { ...thoughtEntry, content: '' };
    mockGetGame.mockResolvedValue(gameA);
    mockGetJournal.mockResolvedValue([emptyEntry]);
    mockGetAnalysis.mockResolvedValue(analysisA);

    await POST(makeReq({ gameId: gameA.id, entryIndex: 0 }));
    // Route returns early for empty content — saveJournalEntry is not reached
    expect(mockSaveEntry).not.toHaveBeenCalled();
  });
});

// ─── aiReview saved on success ────────────────────────────────────────────────

describe('POST /api/games/analyze-thinking — aiReview persistence', () => {
  // Use fresh spread copies each time to prevent the route's `entry.aiReview = ...`
  // mutation from leaking across tests via the shared fixture object.
  beforeEach(() => {
    mockGetGame.mockResolvedValue({ ...gameA });
    mockGetJournal.mockResolvedValue([{ ...thoughtEntry }]);
    mockGetAnalysis.mockResolvedValue({ ...analysisA });
  });

  it('saves aiReview.content on a successful Anthropic response', async () => {
    stubFetchSuccess('Knight on f3 controls key squares.');
    await POST(makeReq({ gameId: gameA.id, entryIndex: 0 }));

    const saved = mockSaveEntry.mock.calls[0][0];
    expect(saved.aiReview).toBeDefined();
    expect(saved.aiReview.content).toBe('Knight on f3 controls key squares.');
  });

  it('aiReview includes model and timestamp', async () => {
    stubFetchSuccess('Some analysis.');
    await POST(makeReq({ gameId: gameA.id, entryIndex: 0 }));

    const saved = mockSaveEntry.mock.calls[0][0];
    expect(saved.aiReview.model).toBe('claude-sonnet-4-6');
    expect(saved.aiReview.timestamp).toBeTruthy();
  });

  it('still calls saveJournalEntry when Anthropic returns an error (no aiReview added)', async () => {
    stubFetchFailure();
    await POST(makeReq({ gameId: gameA.id, entryIndex: 0 }));

    // Route catches the API error internally and still saves the entry
    expect(mockSaveEntry).toHaveBeenCalledOnce();
    const saved = mockSaveEntry.mock.calls[0][0];
    expect(saved.aiReview).toBeUndefined();
  });
});

// ─── maxTokens by verbosity ───────────────────────────────────────────────────

describe('POST /api/games/analyze-thinking — maxTokens by verbosity', () => {
  beforeEach(() => {
    mockGetGame.mockResolvedValue(gameA);
    mockGetJournal.mockResolvedValue([thoughtEntry]);
    mockGetAnalysis.mockResolvedValue(analysisA);
    stubFetchSuccess();
  });

  async function getMaxTokensFor(verbosity: string): Promise<number> {
    vi.clearAllMocks();
    fetchMock.mockReset();
    mockGetGame.mockResolvedValue(gameA);
    mockGetJournal.mockResolvedValue([{ ...thoughtEntry }]);
    mockGetAnalysis.mockResolvedValue(analysisA);
    mockSaveEntry.mockResolvedValue(undefined);
    mockGetSetting.mockImplementation(async (key: string) => {
      if (key === 'ai_analysis_verbosity') return verbosity;
      if (key === 'chesscom_username') return 'testuser';
      if (key === 'ai_model') return 'claude-sonnet-4-6';
      return null;
    });
    stubFetchSuccess();
    await POST(makeReq({ gameId: gameA.id, entryIndex: 0 }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    return body.max_tokens;
  }

  it('uses 300 tokens for brief verbosity', async () => {
    expect(await getMaxTokensFor('brief')).toBe(300);
  });

  it('uses 500 tokens for concise verbosity', async () => {
    expect(await getMaxTokensFor('concise')).toBe(500);
  });

  it('uses 1200 tokens for detailed verbosity', async () => {
    expect(await getMaxTokensFor('detailed')).toBe(1200);
  });

  it('uses 2000 tokens for extensive verbosity', async () => {
    expect(await getMaxTokensFor('extensive')).toBe(2000);
  });

  it('falls back to 500 tokens for an unknown verbosity value', async () => {
    expect(await getMaxTokensFor('turbo')).toBe(500);
  });

  it('uses 1200 tokens when verbosity setting is null (defaults to detailed)', async () => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    mockGetGame.mockResolvedValue(gameA);
    mockGetJournal.mockResolvedValue([{ ...thoughtEntry }]);
    mockGetAnalysis.mockResolvedValue(analysisA);
    mockSaveEntry.mockResolvedValue(undefined);
    mockGetSetting.mockImplementation(async (key: string) => {
      if (key === 'chesscom_username') return 'testuser';
      if (key === 'ai_model') return 'claude-sonnet-4-6';
      return null; // verbosity not set
    });
    stubFetchSuccess();
    await POST(makeReq({ gameId: gameA.id, entryIndex: 0 }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(1200);
  });
});

// ─── Response shape ───────────────────────────────────────────────────────────

describe('POST /api/games/analyze-thinking — response shape', () => {
  beforeEach(() => {
    mockGetGame.mockResolvedValue(gameA);
    mockGetJournal.mockResolvedValue([{ ...thoughtEntry }]);
    mockGetAnalysis.mockResolvedValue(analysisA);
    stubFetchSuccess();
  });

  it('returns success:true, completed, nextEntryIndex, and totalEntries', async () => {
    const res = await POST(makeReq({ gameId: gameA.id, entryIndex: 0 }));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(typeof body.completed).toBe('boolean');
    expect(typeof body.nextEntryIndex).toBe('number');
    expect(typeof body.totalEntries).toBe('number');
  });

  it('completed is true when processing the last entry', async () => {
    const res = await POST(makeReq({ gameId: gameA.id, entryIndex: 0 }));
    // Only one entry total, so completed should be true
    expect((await res.json()).completed).toBe(true);
  });

  it('completed is false when more entries remain', async () => {
    mockGetJournal.mockResolvedValue([{ ...thoughtEntry }, { ...moveEntry }]);
    const res = await POST(makeReq({ gameId: gameA.id, entryIndex: 0 }));
    expect((await res.json()).completed).toBe(false);
  });

  it('nextEntryIndex is always entryIndex + 1', async () => {
    const res = await POST(makeReq({ gameId: gameA.id, entryIndex: 0 }));
    expect((await res.json()).nextEntryIndex).toBe(1);
  });
});
