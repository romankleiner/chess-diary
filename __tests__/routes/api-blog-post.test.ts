import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { gameA, thoughtEntry, moveEntry, summaryEntry, analysisA } from '../helpers/fixtures';

vi.mock('@/lib/db', () => ({
  getGame: vi.fn(),
  getJournal: vi.fn(),
  getAnalysis: vi.fn(),
  getSetting: vi.fn(),
  getBlogOwner: vi.fn(),
}));

import { POST } from '@/app/api/games/[id]/blog-post/route';
import { getGame, getJournal, getAnalysis, getSetting, getBlogOwner } from '@/lib/db';
import { auth } from '@clerk/nextjs/server';

const mockGetGame      = vi.mocked(getGame);
const mockGetJournal   = vi.mocked(getJournal);
const mockGetAnalysis  = vi.mocked(getAnalysis);
const mockGetSetting   = vi.mocked(getSetting);
const mockGetBlogOwner = vi.mocked(getBlogOwner);
const mockAuth         = vi.mocked(auth);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeReq(gameId = gameA.id) {
  return new NextRequest(`http://localhost/api/games/${gameId}/blog-post`, { method: 'POST' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSetting.mockImplementation(async (key: string) => {
    if (key === 'chesscom_username') return 'testuser';
    return null;
  });
  mockGetJournal.mockResolvedValue([]);
  mockGetAnalysis.mockResolvedValue(null);
  mockGetBlogOwner.mockResolvedValue(null); // unpublished by default
  // Default: signed-in author (the global mock-clerk stub may be cleared above)
  mockAuth.mockResolvedValue({ userId: 'test-user-123' } as any);
});

// ─── 404 on missing game ──────────────────────────────────────────────────────

describe('POST /api/games/[id]/blog-post — 404', () => {
  it('returns 404 when the game does not exist', async () => {
    mockGetGame.mockResolvedValue(null);
    const res = await POST(makeReq('ghost-id'), params('ghost-id'));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/not found/i);
  });
});

// ─── Anonymous / shared access ────────────────────────────────────────────────

describe('POST /api/games/[id]/blog-post — anonymous access', () => {
  it('returns 404 for an anonymous visitor when the game is not shared', async () => {
    mockAuth.mockResolvedValue({ userId: null } as any);
    mockGetBlogOwner.mockResolvedValue(null);
    mockGetGame.mockResolvedValue(gameA);
    const res = await POST(makeReq(), params(gameA.id));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/shared/i);
    expect(mockGetGame).not.toHaveBeenCalled(); // bails out before touching data
  });

  it('serves a shared game to an anonymous visitor using the published owner', async () => {
    mockAuth.mockResolvedValue({ userId: null } as any);
    mockGetBlogOwner.mockResolvedValue('owner-abc');
    mockGetGame.mockResolvedValue(gameA);
    mockGetJournal.mockResolvedValue([thoughtEntry]);

    const res = await POST(makeReq(), params(gameA.id));
    expect(res.status).toBe(200);
    // db reads are scoped to the published owner, not the (absent) viewer
    expect(mockGetGame).toHaveBeenCalledWith(gameA.id, 'owner-abc');
    expect(mockGetJournal).toHaveBeenCalledWith('owner-abc');
  });

  it('a published game takes precedence over the viewer session', async () => {
    // A signed-in user who is NOT the author still sees the published owner's game
    mockAuth.mockResolvedValue({ userId: 'someone-else' } as any);
    mockGetBlogOwner.mockResolvedValue('owner-abc');
    mockGetGame.mockResolvedValue(gameA);
    await POST(makeReq(), params(gameA.id));
    expect(mockGetGame).toHaveBeenCalledWith(gameA.id, 'owner-abc');
  });

  it('an unpublished game falls back to the author session for previews', async () => {
    mockGetBlogOwner.mockResolvedValue(null);
    mockAuth.mockResolvedValue({ userId: 'author-xyz' } as any);
    mockGetGame.mockResolvedValue(gameA);
    await POST(makeReq(), params(gameA.id));
    expect(mockGetGame).toHaveBeenCalledWith(gameA.id, 'author-xyz');
  });
});

// ─── sections assembly (no Claude needed) ─────────────────────────────────────

describe('POST /api/games/[id]/blog-post — sections', () => {
  beforeEach(() => {
    mockGetGame.mockResolvedValue(gameA);
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

  it('converts UCI bestMove to SAN when the user did not play the engine top choice', async () => {
    // gameA.pgn = '1. e4 e5 2. Nf3 Nc6'. moveEntry: moveNumber=2, moveNotation='Nf3'.
    // Pretend engine preferred Nc3 (UCI: b1c3) and the user lost 30 cp by playing Nf3.
    const customAnalysis = {
      ...analysisA,
      moves: [
        { moveNumber: 2, color: 'white', move: 'Nf3', centipawnLoss: 30, moveQuality: 'good', evaluation: 0.1, bestMove: 'b1c3' },
      ],
    };
    mockGetAnalysis.mockResolvedValue(customAnalysis);
    mockGetJournal.mockResolvedValue([moveEntry]);
    const { sections } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(sections[0].engineEval.bestMoveSan).toBe('Nc3');
  });

  it('omits bestMoveSan when the user already played the engine top choice', async () => {
    const customAnalysis = {
      ...analysisA,
      moves: [
        { moveNumber: 2, color: 'white', move: 'Nf3', centipawnLoss: 0, moveQuality: 'excellent', evaluation: 0.3, bestMove: 'g1f3' },
      ],
    };
    mockGetAnalysis.mockResolvedValue(customAnalysis);
    mockGetJournal.mockResolvedValue([moveEntry]);
    const { sections } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(sections[0].engineEval.bestMoveSan).toBeNull();
  });

  it('leaves bestMoveSan null when analysis omits a bestMove', async () => {
    const customAnalysis = {
      ...analysisA,
      moves: [
        { moveNumber: 2, color: 'white', move: 'Nf3', centipawnLoss: 30, moveQuality: 'good', evaluation: 0.1 /* no bestMove */ },
      ],
    };
    mockGetAnalysis.mockResolvedValue(customAnalysis);
    mockGetJournal.mockResolvedValue([moveEntry]);
    const { sections } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(sections[0].engineEval.bestMoveSan).toBeNull();
  });
});

// ─── aiReview and postReview passthrough ──────────────────────────────────────

describe('POST /api/games/[id]/blog-post — aiReview / postReview', () => {
  beforeEach(() => {
    mockGetGame.mockResolvedValue(gameA);
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

// ─── plyIndex anchoring ───────────────────────────────────────────────────────
// gameA.pgn = '1. e4 e5 2. Nf3 Nc6' → plies: 0=e4, 1=e5, 2=Nf3, 3=Nc6

describe('POST /api/games/[id]/blog-post — plyIndex', () => {
  beforeEach(() => {
    mockGetGame.mockResolvedValue(gameA);
  });

  it('anchors a white move entry to its ply in the PGN', async () => {
    // moveEntry: moveNumber=2, moveNotation='Nf3', user is white → ply 2
    mockGetJournal.mockResolvedValue([moveEntry]);
    const { sections } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(sections[0].plyIndex).toBe(2);
  });

  it('anchors a black move entry to its ply in the PGN', async () => {
    // gameB.pgn = '1. d4 d5 2. c4 e6', user is black → move 1 d5 is ply 1
    const { gameB } = await import('../helpers/fixtures');
    mockGetGame.mockResolvedValue(gameB);
    mockGetJournal.mockResolvedValue([
      { ...moveEntry, gameId: gameB.id, moveNumber: 1, moveNotation: 'd5' },
    ]);
    const res = await POST(
      new NextRequest(`http://localhost/api/games/${gameB.id}/blog-post`, { method: 'POST' }),
      params(gameB.id)
    );
    const { sections } = await res.json();
    expect(sections[0].plyIndex).toBe(1);
  });

  it('anchors by FEN when moveNumber is absent (real-data shape)', async () => {
    // Position before ply 2 (after 1. e4 e5), white to move — the user's move is Nf3
    const fenEntry = {
      ...thoughtEntry,
      myMove: 'Nf3',
      fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
    };
    mockGetJournal.mockResolvedValue([fenEntry]);
    const { sections } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(sections[0].plyIndex).toBe(2);
    // move number is derived from the anchored ply for the header
    expect(sections[0].header).toBe('Move 2: Nf3');
  });

  it('FEN anchoring ignores move counters and en-passant differences', async () => {
    const fenEntry = {
      ...thoughtEntry,
      myMove: 'Nf3',
      fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 5 9',
    };
    mockGetJournal.mockResolvedValue([fenEntry]);
    const { sections } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(sections[0].plyIndex).toBe(2);
  });

  it('anchors by FEN alone when the recorded SAN is a typo, taking the move from the PGN', async () => {
    const fenEntry = {
      ...thoughtEntry,
      myMove: 'Nh3', // user recorded the wrong move; the PGN says Nf3
      fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
    };
    mockGetJournal.mockResolvedValue([fenEntry]);
    const { sections } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(sections[0].plyIndex).toBe(2);
    expect(sections[0].moveNotation).toBe('Nf3');
  });

  it('plyIndex is null when the notation does not match the PGN at that ply', async () => {
    mockGetJournal.mockResolvedValue([{ ...moveEntry, moveNotation: 'Nc3' }]);
    const { sections } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(sections[0].plyIndex).toBeNull();
  });

  it('plyIndex is null for entries without a move number', async () => {
    mockGetJournal.mockResolvedValue([thoughtEntry]);
    const { sections } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(sections[0].plyIndex).toBeNull();
  });

  it('plyIndex is null when the game has no PGN', async () => {
    mockGetGame.mockResolvedValue({ ...gameA, pgn: '' });
    mockGetJournal.mockResolvedValue([moveEntry]);
    const { sections } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(sections[0].plyIndex).toBeNull();
  });
});

// ─── Summary from the user's post-game entry ──────────────────────────────────

describe('POST /api/games/[id]/blog-post — summary', () => {
  beforeEach(() => {
    mockGetGame.mockResolvedValue(gameA);
  });

  it('summary combines free-text content and structured reflections', async () => {
    mockGetJournal.mockResolvedValue([thoughtEntry, summaryEntry]);
    const { summary } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(summary).toContain(summaryEntry.content);
    expect(summary).toContain(summaryEntry.postGameSummary!.reflections.whatWentWell!);
    expect(summary).toContain(summaryEntry.postGameSummary!.reflections.lessonsLearned!);
  });

  it('summary is empty when there is no post_game_summary entry', async () => {
    mockGetJournal.mockResolvedValue([thoughtEntry]);
    const { summary } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(summary).toBe('');
  });
});

// ─── Response shape ───────────────────────────────────────────────────────────

describe('POST /api/games/[id]/blog-post — response shape', () => {
  beforeEach(() => {
    mockGetGame.mockResolvedValue(gameA);
    mockGetJournal.mockResolvedValue([thoughtEntry]);
  });

  it('returns { sections, summary, pgn, userColor, gameMeta } on success', async () => {
    const res = await POST(makeReq(), params(gameA.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.sections)).toBe(true);
    expect(typeof body.summary).toBe('string');
    expect(typeof body.pgn).toBe('string');
    expect(body.userColor).toMatch(/^(white|black)$/);
    expect(body.gameMeta).toMatchObject({ white: gameA.white, black: gameA.black });
  });

  it('returns pgn from the game record', async () => {
    const { pgn } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(pgn).toBe(gameA.pgn);
  });

  it('returns userColor derived from the chesscom_username setting', async () => {
    // gameA.white === 'testuser' → white
    const { userColor } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(userColor).toBe('white');
  });
});
