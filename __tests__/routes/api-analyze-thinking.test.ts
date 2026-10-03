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
import { runThinkingAnalysis } from '@/lib/thinking-analysis-client';
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

// ─── Grounding and line verification ─────────────────────────────────────────

// White to move after 1. e4 e5 2. Nf3 Nc6 — matches gameA.pgn.
const RUY_FEN = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';

const textResponse = (text: string) => ({
  ok: true,
  json: async () => ({ content: [{ type: 'text', text }] }),
  text: async () => '',
});

const requestBody = (callIndex = 0) => JSON.parse(fetchMock.mock.calls[callIndex][1].body);

describe('POST /api/games/analyze-thinking — grounding and line verification', () => {
  beforeEach(() => {
    mockGetGame.mockResolvedValue({ ...gameA });
    mockGetJournal.mockResolvedValue([{ ...thoughtEntry, fen: RUY_FEN, myMove: 'Bb5' }]);
    mockGetAnalysis.mockResolvedValue({ ...analysisA });
  });

  const run = () => POST(makeReq({ gameId: gameA.id, entryIndex: 0 }));
  const savedContent = () => mockSaveEntry.mock.calls[0][0].aiReview.content;

  describe('prompt', () => {
    it('includes verified position facts, the real move history and the marker rules', async () => {
      fetchMock.mockResolvedValue(textResponse('Fine.'));
      await run();

      const prompt = requestBody().messages[0].content;
      expect(prompt).toContain('Verified position facts');
      expect(prompt).toContain('Side to move: White');
      expect(prompt).toContain('Game moves so far:\n1. e4 e5 2. Nf3 Nc6');
      expect(prompt).toContain('[[line: Nxe5 Nxe5 d4]]');
    });

    it('skips grounding when the entry has no FEN', async () => {
      mockGetJournal.mockResolvedValue([{ ...thoughtEntry }]);
      fetchMock.mockResolvedValue(textResponse('Fine.'));
      await run();

      const prompt = requestBody().messages[0].content;
      expect(prompt).not.toContain('Verified position facts');
      expect(prompt).not.toContain('[[line:');
    });

    it('shows the engine best move and main line in SAN instead of UCI', async () => {
      mockGetAnalysis.mockResolvedValue({
        ...analysisA,
        moves: [
          {
            moveNumber: 3,
            color: 'white',
            move: 'Bb5',
            evaluation: 0.3,
            centipawnLoss: 20,
            moveQuality: 'good',
            bestMove: 'f3e5',
            principalVariation: ['f3e5', 'c6e5', 'd2d4'],
          },
        ],
      });
      fetchMock.mockResolvedValue(textResponse('Fine.'));
      await run();

      const prompt = requestBody().messages[0].content;
      expect(prompt).toContain("Engine's best move: Nxe5");
      expect(prompt).toContain("Engine's main line: 3. Nxe5 Nxe5 4. d4");
      expect(prompt).not.toContain('f3e5');
    });
  });

  describe('verification', () => {
    it('resolves legal markers into canonical numbered SAN with a single API call', async () => {
      fetchMock.mockResolvedValue(textResponse('Consider [[line: Bb5 a6 Ba4]] next.'));
      await run();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(savedContent()).toBe('Consider 3. Bb5 a6 4. Ba4 next.');
    });

    it('leaves a response without markers exactly as written', async () => {
      fetchMock.mockResolvedValue(textResponse('A plain analysis.\n\nWith two paragraphs.'));
      await run();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(savedContent()).toBe('A plain analysis.\n\nWith two paragraphs.');
    });

    it('retries once with a correction when a line is illegal, and saves the corrected text', async () => {
      // The knight on f3 blocks the queen, so Qh5 is illegal here.
      fetchMock
        .mockResolvedValueOnce(textResponse('Try [[line: Qh5]] to hit e5.'))
        .mockResolvedValueOnce(textResponse('Try [[line: Nxe5]] to win a pawn.'));
      await run();

      expect(fetchMock).toHaveBeenCalledTimes(2);

      const retry = requestBody(1);
      expect(retry.messages.map((m: any) => m.role)).toEqual(['user', 'assistant', 'user']);
      expect(retry.messages[0].content).toBe(requestBody(0).messages[0].content);
      expect(retry.messages[1].content).toBe('Try [[line: Qh5]] to hit e5.');
      expect(retry.messages[2].content).toContain('("Qh5") is not legal');
      expect(retry.messages[2].content).toContain('Legal moves there:');

      expect(savedContent()).toBe('Try Nxe5 to win a pawn.');
    });

    it('replaces lines that are still illegal after the retry, and never retries twice', async () => {
      fetchMock
        .mockResolvedValueOnce(textResponse('Try [[line: Qh5]].'))
        .mockResolvedValueOnce(textResponse('Try [[line: Qh5]] again.'));
      await run();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(savedContent()).toBe('Try [illegal line removed] again.');
    });

    it('keeps the first result when the retry is worse', async () => {
      fetchMock
        .mockResolvedValueOnce(textResponse('First: [[line: Qh5]].'))
        .mockResolvedValueOnce(textResponse('Second: [[line: Qh5]] and [[line: Qg4]].'));
      await run();

      expect(savedContent()).toBe('First: [illegal line removed].');
    });

    it('keeps the first result with placeholders when the retry call fails', async () => {
      fetchMock
        .mockResolvedValueOnce(textResponse('Try [[line: Qh5]].'))
        .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'boom' });
      await run();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(savedContent()).toBe('Try [illegal line removed].');
    });

    it('accepts a line that starts after the move the player made', async () => {
      // Player played Bb5; the model starts its line with Black's reply.
      fetchMock.mockResolvedValue(textResponse('Then [[line: a6 Ba4]] follows.'));
      await run();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(savedContent()).toBe('Then 3... a6 4. Ba4 follows.');
    });
  });

  describe('API response handling', () => {
    it('extracts the text block when a thinking block comes first', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [
            { type: 'thinking', thinking: '' },
            { type: 'text', text: 'The analysis.' },
          ],
        }),
        text: async () => '',
      });
      await run();

      expect(savedContent()).toBe('The analysis.');
    });

    it('joins multiple text blocks', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: 'Part one. ' }, { type: 'text', text: 'Part two.' }] }),
        text: async () => '',
      });
      await run();

      expect(savedContent()).toBe('Part one. Part two.');
    });
  });

  describe('max_tokens headroom for thinking models', () => {
    async function maxTokensFor(model: string): Promise<number> {
      vi.clearAllMocks();
      fetchMock.mockReset();
      mockGetGame.mockResolvedValue({ ...gameA });
      mockGetJournal.mockResolvedValue([{ ...thoughtEntry }]);
      mockGetAnalysis.mockResolvedValue({ ...analysisA });
      mockSaveEntry.mockResolvedValue(undefined);
      mockGetSetting.mockImplementation(async (key: string) => {
        if (key === 'chesscom_username') return 'testuser';
        if (key === 'ai_analysis_verbosity') return 'detailed';
        if (key === 'ai_model') return model;
        return null;
      });
      fetchMock.mockResolvedValue(textResponse('Fine.'));
      await run();
      return requestBody().max_tokens;
    }

    it('adds 6000 tokens for models that think by default', async () => {
      expect(await maxTokensFor('claude-sonnet-5')).toBe(7200);
      expect(await maxTokensFor('claude-fable-5')).toBe(7200);
      expect(await maxTokensFor('claude-mythos-5')).toBe(7200);
    });

    it('leaves other models at the verbosity limit', async () => {
      expect(await maxTokensFor('claude-opus-4-8')).toBe(1200);
      expect(await maxTokensFor('claude-sonnet-4-6')).toBe(1200);
      expect(await maxTokensFor('claude-haiku-4-5')).toBe(1200);
    });
  });
});

// ─── Reporting what happened to each entry ───────────────────────────────────
//
// The client analyses one entry per request. A failed AI call used to come back
// as a plain success, so a move could end up with no comment and nothing said
// so. Every response now carries entryStatus (and the reason when it failed).

describe('POST /api/games/analyze-thinking — entry outcome', () => {
  beforeEach(() => {
    mockGetGame.mockResolvedValue({ ...gameA });
    mockGetJournal.mockResolvedValue([{ ...thoughtEntry }]);
    mockGetAnalysis.mockResolvedValue({ ...analysisA });
  });

  const run = (entryIndex = 0) => POST(makeReq({ gameId: gameA.id, entryIndex }));

  const failureResponse = (status: number, body: unknown = 'error') => ({
    ok: false,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });

  it('reports "analyzed" when the AI comment was produced', async () => {
    fetchMock.mockResolvedValue(textResponse('A comment.'));
    const body = await (await run()).json();

    expect(body.success).toBe(true);
    expect(body.entryStatus).toBe('analyzed');
    expect(body.error).toBeUndefined();
  });

  it('reports "skipped" for an entry with no text to analyse', async () => {
    mockGetJournal.mockResolvedValue([{ ...thoughtEntry, content: '  ' }]);
    const body = await (await run()).json();

    expect(body.entryStatus).toBe('skipped');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([429, 500, 502, 529])('reports a %i from the AI service as a retryable failure', async status => {
    fetchMock.mockResolvedValue(failureResponse(status));
    const body = await (await run()).json();

    expect(body.success).toBe(true); // the request itself worked; the client reads entryStatus
    expect(body.entryStatus).toBe('failed');
    expect(body.retryable).toBe(true);
    expect(body.error).toContain(String(status));
    expect(mockSaveEntry.mock.calls[0][0].aiReview).toBeUndefined();
  });

  it.each([400, 401, 404])('reports a %i as a failure retrying cannot fix, with the service’s reason', async status => {
    fetchMock.mockResolvedValue(failureResponse(status, { error: { message: 'model: claude-nope not found' } }));
    const body = await (await run()).json();

    expect(body.entryStatus).toBe('failed');
    expect(body.retryable).toBe(false);
    expect(body.error).toContain(String(status));
    expect(body.error).toContain('model: claude-nope not found');
  });

  it('reports a network error as a retryable failure', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'));
    const body = await (await run()).json();

    expect(body.entryStatus).toBe('failed');
    expect(body.retryable).toBe(true);
    expect(body.error).toContain('fetch failed');
  });

  it('reports a timed-out AI call as a retryable failure with a clear message', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' }));
    const body = await (await run()).json();

    expect(body.entryStatus).toBe('failed');
    expect(body.retryable).toBe(true);
    expect(body.error).toMatch(/timed out after \d+s/);
  });

  it('puts a deadline on the AI call so a hung request cannot outlive the function', async () => {
    fetchMock.mockResolvedValue(textResponse('A comment.'));
    await run();

    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('still saves the entry and keeps the run going when the AI call fails', async () => {
    fetchMock.mockResolvedValue(failureResponse(529));
    mockGetJournal.mockResolvedValue([{ ...thoughtEntry }, { ...moveEntry }]);
    const body = await (await run(0)).json();

    expect(mockSaveEntry).toHaveBeenCalledOnce();
    expect(body.completed).toBe(false);
    expect(body.nextEntryIndex).toBe(1);
  });
});

// ─── Stable entry order ──────────────────────────────────────────────────────
//
// entryIndex is a position in a list rebuilt from Redis on every request, so
// the order has to be identical each time or entries get skipped / repeated.

describe('POST /api/games/analyze-thinking — entry order', () => {
  const early = { ...thoughtEntry, id: 1, timestamp: '2026-03-10T10:00:00.000', content: 'first' };
  const middle = { ...thoughtEntry, id: 2, timestamp: '2026-03-10T11:00:00.000', content: 'second' };
  const late = { ...thoughtEntry, id: 3, timestamp: '2026-03-10T12:00:00.000', content: 'third' };

  beforeEach(() => {
    mockGetGame.mockResolvedValue({ ...gameA });
    mockGetAnalysis.mockResolvedValue({ ...analysisA });
    fetchMock.mockResolvedValue(textResponse('A comment.'));
  });

  const analysedIds = async (journal: any[]) => {
    const ids: number[] = [];
    for (let entryIndex = 0; entryIndex < journal.length; entryIndex++) {
      mockSaveEntry.mockClear();
      mockGetJournal.mockResolvedValue(journal.map(e => ({ ...e })));
      await POST(makeReq({ gameId: gameA.id, entryIndex }));
      ids.push(mockSaveEntry.mock.calls[0][0].id);
    }
    return ids;
  };

  it('walks the entries oldest-first regardless of the order Redis returns them in', async () => {
    expect(await analysedIds([late, early, middle])).toEqual([1, 2, 3]);
    expect(await analysedIds([middle, late, early])).toEqual([1, 2, 3]);
  });

  it('visits every entry exactly once even if the stored order differs between requests', async () => {
    const orders = [[late, early, middle], [early, middle, late], [middle, early, late]];
    const visited: number[] = [];
    for (let entryIndex = 0; entryIndex < 3; entryIndex++) {
      mockSaveEntry.mockClear();
      mockGetJournal.mockResolvedValue(orders[entryIndex].map(e => ({ ...e })));
      await POST(makeReq({ gameId: gameA.id, entryIndex }));
      visited.push(mockSaveEntry.mock.calls[0][0].id);
    }
    expect([...visited].sort()).toEqual([1, 2, 3]);
  });

  it('breaks timestamp ties by id', async () => {
    const a = { ...early, id: 10 };
    const b = { ...early, id: 5 };
    expect(await analysedIds([a, b])).toEqual([5, 10]);
  });

  it('treats an index past the end as finished instead of failing', async () => {
    mockGetJournal.mockResolvedValue([{ ...early }]);
    const res = await POST(makeReq({ gameId: gameA.id, entryIndex: 7 }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.completed).toBe(true);
    expect(body.entryStatus).toBe('skipped');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── Time budget ─────────────────────────────────────────────────────────────

describe('POST /api/games/analyze-thinking — time budget', () => {
  const RUY_FEN = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';

  beforeEach(() => {
    mockGetGame.mockResolvedValue({ ...gameA });
    mockGetJournal.mockResolvedValue([{ ...thoughtEntry, fen: RUY_FEN, myMove: 'Bb5' }]);
    mockGetAnalysis.mockResolvedValue({ ...analysisA });
  });

  it('skips the verification retry when too little time is left, keeping the first answer', async () => {
    let now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      // The first AI call "takes" 50 s of the 55 s budget; Qh5 is illegal here.
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => {
          now += 50_000;
          return { content: [{ type: 'text', text: 'Try [[line: Qh5]].' }] };
        },
        text: async () => '',
      });

      const body = await (await POST(makeReq({ gameId: gameA.id, entryIndex: 0 }))).json();

      expect(fetchMock).toHaveBeenCalledTimes(1); // no correction retry
      expect(body.entryStatus).toBe('analyzed');
      expect(mockSaveEntry.mock.calls[0][0].aiReview.content).toBe('Try [illegal line removed].');
    } finally {
      clock.mockRestore();
    }
  });

  it('still does the verification retry when there is plenty of time', async () => {
    fetchMock
      .mockResolvedValueOnce(textResponse('Try [[line: Qh5]].'))
      .mockResolvedValueOnce(textResponse('Try [[line: Nxe5]].'));

    await POST(makeReq({ gameId: gameA.id, entryIndex: 0 }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mockSaveEntry.mock.calls[0][0].aiReview.content).toBe('Try Nxe5.');
  });
});

// ─── Client and server together ──────────────────────────────────────────────
//
// The client (lib/thinking-analysis-client.ts) and this route are written
// separately, so unit tests on each side alone would not notice a mismatched
// field name. Here the real client drives the real route, and only the AI
// service itself misbehaves.

describe('analyze-thinking — real client driving the real route', () => {
  const entries = [
    { ...thoughtEntry, id: 1, timestamp: '2026-03-10T10:00:00.000', content: 'first' },
    { ...thoughtEntry, id: 2, timestamp: '2026-03-10T11:00:00.000', content: 'second' },
    { ...thoughtEntry, id: 3, timestamp: '2026-03-10T12:00:00.000', content: '' }, // nothing to analyse
    { ...thoughtEntry, id: 4, timestamp: '2026-03-10T13:00:00.000', content: 'fourth' },
  ];

  /** The client's fetch, answered by the real route instead of the network. */
  const fetchViaRoute = async (url: unknown, init?: RequestInit) =>
    (await POST(
      new NextRequest(`http://localhost${url}`, { method: 'POST', headers: init?.headers, body: init?.body as string })
    )) as unknown as Response;

  beforeEach(() => {
    mockGetGame.mockResolvedValue({ ...gameA });
    mockGetAnalysis.mockResolvedValue({ ...analysisA });
    mockGetJournal.mockImplementation(async () => entries.map(e => ({ ...e })));
  });

  const sleep = vi.fn(async (_ms: number) => {});

  const savedEntries = () => new Map(mockSaveEntry.mock.calls.map(([entry]) => [entry.id, entry]));

  it('comments every entry it can, retries a transient AI failure, and reports the one that cannot work', async () => {
    let secondEntryAttempts = 0;
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const prompt: string = JSON.parse(init.body as string).messages[0].content;
      if (prompt.includes('"first"')) return textResponse('Comment 1');
      if (prompt.includes('"second"')) {
        secondEntryAttempts++;
        // Overloaded the first time, fine the second.
        return secondEntryAttempts === 1
          ? { ok: false, status: 529, text: async () => JSON.stringify({ error: { message: 'Overloaded' } }) }
          : textResponse('Comment 2');
      }
      // Entry 4: a permanent problem — retrying cannot help.
      return { ok: false, status: 400, text: async () => JSON.stringify({ error: { message: 'bad model' } }) };
    });

    const result = await runThinkingAnalysis({ gameId: gameA.id, fetchFn: fetchViaRoute as typeof fetch, sleepFn: sleep });

    expect(result).toEqual({
      total: 4,
      analyzed: 2,
      skipped: 1,
      failures: [{ index: 3, error: expect.stringContaining('bad model') }],
    });

    const saved = savedEntries();
    expect(saved.get(1)!.aiReview.content).toBe('Comment 1');
    expect(saved.get(2)!.aiReview.content).toBe('Comment 2'); // got there on the retry
    expect(saved.has(3)).toBe(false); // skipped: the route returns before touching an empty entry
    expect(saved.get(4)!.aiReview).toBeUndefined(); // failed, and now it is reported rather than silent

    // 1 (first) + 2 (second: 529, then ok) + 0 (skipped) + 1 (fourth: 400, not retried)
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('a retry pass fills in only the entry that was missing', async () => {
    fetchMock.mockResolvedValue(textResponse('Late comment'));

    const retry = await runThinkingAnalysis({
      gameId: gameA.id,
      indices: [3],
      fetchFn: fetchViaRoute as typeof fetch,
      sleepFn: sleep,
    });

    expect(retry).toEqual({ total: 4, analyzed: 1, skipped: 0, failures: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(savedEntries().get(4)!.aiReview.content).toBe('Late comment');
  });

  it('carries on past an entry whose request keeps failing, instead of abandoning the rest', async () => {
    // Redis hiccup on the third request only: the route answers 500 with JSON.
    let requests = 0;
    mockGetJournal.mockImplementation(async () => {
      requests++;
      if (requests >= 3 && requests <= 5) throw new Error('Command timed out');
      return entries.map(e => ({ ...e }));
    });
    fetchMock.mockResolvedValue(textResponse('A comment.'));

    const result = await runThinkingAnalysis({ gameId: gameA.id, fetchFn: fetchViaRoute as typeof fetch, sleepFn: sleep });

    // Requests 3–5 are the three attempts at entry index 2 (the empty one). It is
    // reported as failed, and entry 4 is still analysed afterwards.
    expect(result.failures.map(f => f.index)).toEqual([2]);
    expect(result.analyzed).toBe(3);
    expect(savedEntries().get(4)!.aiReview.content).toBe('A comment.');
  });
});
