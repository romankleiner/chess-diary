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

const mockGetGame     = vi.mocked(getGame);
const mockGetJournal  = vi.mocked(getJournal);
const mockGetAnalysis = vi.mocked(getAnalysis);
const mockGetSetting  = vi.mocked(getSetting);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeReq(gameId = gameA.id) {
  return new NextRequest(`http://localhost/api/games/${gameId}/blog-post`, { method: 'POST' });
}

function stubFetchSuccess(text = 'Overall this was a strong game.') {
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

// ─── sections assembly (no Claude needed) ─────────────────────────────────────

describe('POST /api/games/[id]/blog-post — sections', () => {
  beforeEach(() => {
    mockGetGame.mockResolvedValue(gameA);
    stubFetchSuccess();
  });

  it('returns a sections array', async () => {
    mockGetJournal.mockResolvedValue([thoughtEntry]);
    const { sections } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(Array.isArray(sections)).toBe(true);
  });

  it('one section per non-summary entry with non-empty content', async () => {
    mockGetJournal.mockResolvedValue([thoughtEntry, moveEntry]);
    const { sections } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(sections).toHaveLength(2);
  });

  it('excludes post_game_summary entries from sections', async () => {
    mockGetJournal.mockResolvedValue([thoughtEntry, summaryEntry]);
    const { sections } = await (await POST(makeReq(), params(gameA.id))).json();
    // summaryEntry is post_game_summary → excluded from sections
    expect(sections).toHaveLength(1);
  });

  it('skips entries with empty content', async () => {
    const emptyEntry = { ...thoughtEntry, content: '   ' };
    mockGetJournal.mockResolvedValue([emptyEntry, thoughtEntry]);
    const { sections } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(sections).toHaveLength(1);
  });

  it('section header includes move number and notation for move entries', async () => {
    mockGetJournal.mockResolvedValue([moveEntry]);
    const { sections } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(sections[0].header).toContain(String(moveEntry.moveNumber));
    expect(sections[0].header).toContain(moveEntry.moveNotation);
  });

  it('section header is the formatted date when moveNumber is absent', async () => {
    // thoughtEntry.date = '2026-03-10' → "March 10, 2026"
    const general = { ...thoughtEntry, moveNumber: undefined, moveNotation: undefined };
    mockGetJournal.mockResolvedValue([general]);
    const { sections } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(sections[0].header).toBe('March 10, 2026');
  });

  it('section contains the original thinking text', async () => {
    mockGetJournal.mockResolvedValue([thoughtEntry]);
    const { sections } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(sections[0].thinking).toBe(thoughtEntry.content.trim());
  });

  it('section includes fen when present on the entry', async () => {
    mockGetJournal.mockResolvedValue([moveEntry]);
    const { sections } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(sections[0].fen).toBe(moveEntry.fen);
  });

  it('fen is null when the entry has no FEN', async () => {
    mockGetJournal.mockResolvedValue([thoughtEntry]); // thoughtEntry has no fen
    const { sections } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(sections[0].fen).toBeNull();
  });

  it('userColor is white when the player is white', async () => {
    // gameA.white === 'testuser' and getSetting returns 'testuser'
    mockGetJournal.mockResolvedValue([thoughtEntry]);
    const { sections } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(sections[0].userColor).toBe('white');
  });

  it('userColor is black when the player is black', async () => {
    // gameB.black === TEST_USERNAME
    const { gameB } = await import('../helpers/fixtures');
    mockGetGame.mockResolvedValue(gameB);
    mockGetJournal.mockResolvedValue([{ ...thoughtEntry, gameId: gameB.id }]);
    const res = await POST(
      new NextRequest(`http://localhost/api/games/${gameB.id}/blog-post`, { method: 'POST' }),
      params(gameB.id)
    );
    const { sections } = await res.json();
    expect(sections[0].userColor).toBe('black');
  });
});

// ─── engineEval matching ─────────────────────────────────────────────────────

describe('POST /api/games/[id]/blog-post — engineEval', () => {
  beforeEach(() => {
    mockGetGame.mockResolvedValue(gameA);
    stubFetchSuccess();
  });

  it('engineEval is populated when analysis move matches by moveNumber + moveNotation', async () => {
    // analysisA.moves[0] = { color: 'white', centipawnLoss: 10, moveQuality: 'excellent' }
    // We need a move with moveNumber and moveNotation matching an analysisA move.
    // analysisA doesn't store move SAN — let's build a custom analysis with the move SAN.
    const customAnalysis = {
      ...analysisA,
      moves: [
        { moveNumber: 2, color: 'white', move: 'Nf3', centipawnLoss: 10, moveQuality: 'excellent', evaluation: 0.3 },
      ],
    };
    mockGetAnalysis.mockResolvedValue(customAnalysis);
    mockGetJournal.mockResolvedValue([moveEntry]); // moveEntry: moveNumber=2, moveNotation='Nf3'

    const { sections } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(sections[0].engineEval).not.toBeNull();
    expect(sections[0].engineEval.moveQuality).toBe('excellent');
    expect(sections[0].engineEval.centipawnLoss).toBe(10);
    expect(sections[0].engineEval.evaluation).toBe(0.3);
  });

  it('engineEval is null when no analysis is available', async () => {
    mockGetAnalysis.mockResolvedValue(null);
    mockGetJournal.mockResolvedValue([moveEntry]);
    const { sections } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(sections[0].engineEval).toBeNull();
  });

  it('engineEval is null when moveNotation does not match any analysis move', async () => {
    mockGetAnalysis.mockResolvedValue(analysisA); // analysisA moves have no .move field
    mockGetJournal.mockResolvedValue([moveEntry]);
    const { sections } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(sections[0].engineEval).toBeNull();
  });

  it('engineEval is null for entries without moveNotation (general thoughts)', async () => {
    mockGetAnalysis.mockResolvedValue(analysisA);
    mockGetJournal.mockResolvedValue([thoughtEntry]); // no moveNotation
    const { sections } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(sections[0].engineEval).toBeNull();
  });
});

// ─── aiReview and postReview passthrough ──────────────────────────────────────

describe('POST /api/games/[id]/blog-post — aiReview / postReview', () => {
  beforeEach(() => {
    mockGetGame.mockResolvedValue(gameA);
    stubFetchSuccess();
  });

  it('aiReview content is included when present on the entry', async () => {
    const entryWithAi = {
      ...thoughtEntry,
      aiReview: { content: 'Knight controls key squares.', model: 'claude-sonnet-4-6', timestamp: '' },
    };
    mockGetJournal.mockResolvedValue([entryWithAi]);
    const { sections } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(sections[0].aiReview).toBe('Knight controls key squares.');
  });

  it('aiReview is null when not present', async () => {
    mockGetJournal.mockResolvedValue([thoughtEntry]);
    const { sections } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(sections[0].aiReview).toBeNull();
  });

  it('postReview content is included when present on the entry', async () => {
    const entryWithPost = {
      ...thoughtEntry,
      postReview: { content: 'In hindsight, Nc3 was better.', timestamp: '' },
    };
    mockGetJournal.mockResolvedValue([entryWithPost]);
    const { sections } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(sections[0].postReview).toBe('In hindsight, Nc3 was better.');
  });

  it('postReview is null when not present', async () => {
    mockGetJournal.mockResolvedValue([thoughtEntry]);
    const { sections } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(sections[0].postReview).toBeNull();
  });
});

// ─── Claude summary prompt ────────────────────────────────────────────────────

describe('POST /api/games/[id]/blog-post — Claude summary prompt', () => {
  beforeEach(() => {
    mockGetGame.mockResolvedValue(gameA);
    mockGetJournal.mockResolvedValue([thoughtEntry]);
    stubFetchSuccess();
  });

  it('prompt includes game metadata (white, black, result)', async () => {
    const { prompt } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(prompt).toContain(gameA.white);
    expect(prompt).toContain(gameA.black);
    expect(prompt).toContain(gameA.result);
  });

  it('prompt includes accuracy statistics when analysis is present', async () => {
    mockGetAnalysis.mockResolvedValue(analysisA);
    const { prompt } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(prompt).toContain('accuracy');
  });

  it('prompt includes post-game reflections when a summary entry is present', async () => {
    mockGetJournal.mockResolvedValue([thoughtEntry, summaryEntry]);
    const { prompt } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(prompt).toContain(summaryEntry.postGameSummary!.reflections.lessonsLearned!);
  });

  it('uses default model when ai_model setting is null', async () => {
    mockGetSetting.mockImplementation(async (key: string) => {
      if (key === 'chesscom_username') return 'testuser';
      return null;
    });
    await POST(makeReq(), params(gameA.id));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('claude-sonnet-4-6');
  });

  it('max_tokens for summary is 600', async () => {
    await POST(makeReq(), params(gameA.id));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(600);
  });
});

// ─── Response shape ───────────────────────────────────────────────────────────

describe('POST /api/games/[id]/blog-post — response shape', () => {
  beforeEach(() => {
    mockGetGame.mockResolvedValue(gameA);
    mockGetJournal.mockResolvedValue([thoughtEntry]);
  });

  it('returns { sections, summary, prompt } on success', async () => {
    stubFetchSuccess('A great game.');
    const res = await POST(makeReq(), params(gameA.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.sections)).toBe(true);
    expect(typeof body.summary).toBe('string');
    expect(typeof body.prompt).toBe('string');
  });

  it('summary contains the Claude-generated text', async () => {
    stubFetchSuccess('An excellent game from start to finish.');
    const { summary } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(summary).toBe('An excellent game from start to finish.');
  });

  it('prompt matches what was sent to Claude', async () => {
    stubFetchSuccess();
    const { prompt } = await (await POST(makeReq(), params(gameA.id))).json();
    const fetchBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(fetchBody.messages[0].content).toBe(prompt);
  });

  it('returns pgn from the game record', async () => {
    stubFetchSuccess();
    const { pgn } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(pgn).toBe(gameA.pgn);
  });

  it('returns userColor derived from the chesscom_username setting', async () => {
    // gameA.white === 'testuser' → white
    stubFetchSuccess();
    const { userColor } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(userColor).toBe('white');
  });
});

// ─── Anthropic failure → 500 ─────────────────────────────────────────────────

describe('POST /api/games/[id]/blog-post — Anthropic errors', () => {
  beforeEach(() => {
    mockGetGame.mockResolvedValue(gameA);
    mockGetJournal.mockResolvedValue([thoughtEntry]);
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
