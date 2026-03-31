import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { gameA, thoughtEntry, moveEntry, summaryEntry, analysisA } from '../helpers/fixtures';

vi.mock('@/lib/db', () => ({
  getGame: vi.fn(),
  getJournal: vi.fn(),
  getAnalysis: vi.fn(),
  getSetting: vi.fn(),
}));

// Stub fetch once at module level with a persistent vi.fn() so we can
// reset + reconfigure it per test without vi.stubGlobal ordering issues.
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { POST } from '@/app/api/games/[id]/blog-post/route';
import { getGame, getJournal, getAnalysis, getSetting } from '@/lib/db';

const mockGetGame = vi.mocked(getGame);
const mockGetJournal = vi.mocked(getJournal);
const mockGetAnalysis = vi.mocked(getAnalysis);
const mockGetSetting = vi.mocked(getSetting);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeReq(gameId = gameA.id) {
  return new NextRequest(`http://localhost/api/games/${gameId}/blog-post`, { method: 'POST' });
}

function stubFetchSuccess(text = 'Generated blog post content.') {
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
    text: async () => 'Internal server error',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  // Default: username + model configured
  mockGetSetting.mockImplementation(async (key: string) => {
    if (key === 'chesscom_username') return 'testuser';
    if (key === 'ai_model') return 'claude-sonnet-4-6';
    return null;
  });
  mockGetJournal.mockResolvedValue([]);
  mockGetAnalysis.mockResolvedValue(null);
});

// ─── 404 on missing game ──────────────────────────────────────────────────────

describe('POST /api/games/[id]/blog-post — 404', () => {
  it('returns 404 when the game does not exist', async () => {
    mockGetGame.mockResolvedValue(null);
    stubFetchSuccess();
    const res = await POST(makeReq('ghost-id'), params('ghost-id'));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/not found/i);
  });
});

// ─── Prompt contents ──────────────────────────────────────────────────────────

describe('POST /api/games/[id]/blog-post — prompt construction', () => {
  beforeEach(() => mockGetGame.mockResolvedValue(gameA));

  it('prompt includes the game PGN', async () => {
    mockGetJournal.mockResolvedValue([thoughtEntry]);
    stubFetchSuccess();
    await POST(makeReq(), params(gameA.id));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain(gameA.pgn);
  });

  it('prompt includes game metadata (white, black, date)', async () => {
    mockGetJournal.mockResolvedValue([]);
    stubFetchSuccess();
    await POST(makeReq(), params(gameA.id));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const content: string = body.messages[0].content;
    expect(content).toContain(gameA.white);
    expect(content).toContain(gameA.black);
    expect(content).toContain(gameA.date);
  });

  it('prompt includes analysis statistics when analysis.summary is present', async () => {
    mockGetAnalysis.mockResolvedValue({
      summary: { accuracy: 88.5, blunders: 1, mistakes: 2, inaccuracies: 4 },
    });
    mockGetJournal.mockResolvedValue([]);
    stubFetchSuccess();
    await POST(makeReq(), params(gameA.id));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const content: string = body.messages[0].content;
    expect(content).toContain('ANALYSIS STATISTICS');
    expect(content).toContain('88.5%');
    expect(content).toContain('Blunders: 1');
  });

  it('prompt omits ANALYSIS STATISTICS section when analysis has no summary', async () => {
    mockGetAnalysis.mockResolvedValue({ moves: [] }); // analysis exists but no summary
    mockGetJournal.mockResolvedValue([]);
    stubFetchSuccess();
    await POST(makeReq(), params(gameA.id));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[0].content).not.toContain('ANALYSIS STATISTICS');
  });

  it('prompt includes JOURNAL NOTES when entries exist', async () => {
    mockGetJournal.mockResolvedValue([thoughtEntry]);
    stubFetchSuccess();
    await POST(makeReq(), params(gameA.id));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain('JOURNAL NOTES');
    expect(body.messages[0].content).toContain(thoughtEntry.content);
  });

  it('prompt skips journal entries with empty content', async () => {
    // An entry with real content alongside one with whitespace-only content.
    // Only the real entry's text should appear in the prompt.
    const realEntry  = { ...thoughtEntry, id: 9001, content: 'SHOULD_APPEAR_IN_PROMPT' };
    const emptyEntry = { ...thoughtEntry, id: 9002, content: '   ' }; // whitespace-only
    mockGetJournal.mockResolvedValue([realEntry, emptyEntry]);
    stubFetchSuccess();
    await POST(makeReq(), params(gameA.id));

    const content: string = JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content;
    expect(content).toContain('SHOULD_APPEAR_IN_PROMPT');
    // The whitespace-only entry contributes nothing — no empty placeholder line
    // between paragraphs where only spaces appear
    const lines = content.split('\n');
    const blankButNotEmpty = lines.filter(l => l.length > 0 && l.trim() === '');
    expect(blankButNotEmpty).toHaveLength(0);
  });

  it('FEN-tagged entries include [FEN: ...] inline in the prompt', async () => {
    mockGetJournal.mockResolvedValue([moveEntry]); // moveEntry has a FEN
    stubFetchSuccess();
    await POST(makeReq(), params(gameA.id));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain(`[FEN: ${moveEntry.fen}]`);
  });

  it('prompt includes [DIAGRAM:...] marker instructions for FEN entries', async () => {
    mockGetJournal.mockResolvedValue([moveEntry]);
    stubFetchSuccess();
    await POST(makeReq(), params(gameA.id));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    // The instructions tell Claude to emit [DIAGRAM:<fen>:color] markers
    expect(body.messages[0].content).toContain('[DIAGRAM:');
  });

  it('prompt includes POST-GAME REFLECTIONS when a summary entry exists', async () => {
    mockGetJournal.mockResolvedValue([summaryEntry]);
    stubFetchSuccess();
    await POST(makeReq(), params(gameA.id));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain('POST-GAME REFLECTIONS');
    expect(body.messages[0].content).toContain(
      summaryEntry.postGameSummary!.reflections.lessonsLearned!
    );
  });

  it('post-game summary entry is not included in the JOURNAL NOTES section', async () => {
    mockGetJournal.mockResolvedValue([summaryEntry]);
    stubFetchSuccess();
    await POST(makeReq(), params(gameA.id));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const content: string = body.messages[0].content;
    // When only a summary entry exists, regularEntries is empty, so the
    // JOURNAL NOTES (chronological) section header should not be present.
    // (The instructions text may still reference "JOURNAL NOTES" as a concept.)
    expect(content).not.toContain('JOURNAL NOTES (chronological)');
  });

  it('uses default model when ai_model setting is null', async () => {
    mockGetSetting.mockImplementation(async (key: string) => {
      if (key === 'chesscom_username') return 'testuser';
      return null; // ai_model not set
    });
    mockGetJournal.mockResolvedValue([]);
    stubFetchSuccess();
    await POST(makeReq(), params(gameA.id));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('claude-sonnet-4-6');
  });
});

// ─── Response shape ───────────────────────────────────────────────────────────

describe('POST /api/games/[id]/blog-post — response', () => {
  beforeEach(() => {
    mockGetGame.mockResolvedValue(gameA);
    mockGetJournal.mockResolvedValue([thoughtEntry]);
  });

  it('returns { post, prompt } on success', async () => {
    stubFetchSuccess('My amazing chess story.');
    const res = await POST(makeReq(), params(gameA.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.post).toBe('My amazing chess story.');
    expect(typeof body.prompt).toBe('string');
    expect(body.prompt.length).toBeGreaterThan(0);
  });

  it('the returned prompt matches what was sent to Claude', async () => {
    stubFetchSuccess();
    const res = await POST(makeReq(), params(gameA.id));
    const { prompt } = await res.json();
    const fetchBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(fetchBody.messages[0].content).toBe(prompt);
  });
});

// ─── Anthropic failure → 500 ─────────────────────────────────────────────────

describe('POST /api/games/[id]/blog-post — Anthropic errors', () => {
  beforeEach(() => {
    mockGetGame.mockResolvedValue(gameA);
    mockGetJournal.mockResolvedValue([]);
  });

  it('returns 500 when Anthropic responds with an error status', async () => {
    stubFetchFailure(529);
    const res = await POST(makeReq(), params(gameA.id));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/claude api error/i);
  });

  it('returns 500 when fetch itself throws (network error)', async () => {
    fetchMock.mockRejectedValue(new Error('network timeout'));
    const res = await POST(makeReq(), params(gameA.id));
    expect(res.status).toBe(500);
  });
});
