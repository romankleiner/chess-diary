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

  it('passes on the depth the analysis was run at, so a reader’s guess can be checked as deeply', async () => {
    const customAnalysis = {
      ...analysisA,
      depth: 14,
      moves: [
        { moveNumber: 2, color: 'white', move: 'Nf3', centipawnLoss: 10, moveQuality: 'excellent', evaluation: 0.3 },
      ],
    };
    mockGetAnalysis.mockResolvedValue(customAnalysis);
    mockGetJournal.mockResolvedValue([moveEntry]);
    const { sections } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(sections[0].engineEval.depth).toBe(14);
  });

  it('leaves depth null when the analysis does not record one', async () => {
    const { depth: _omit, ...withoutDepth } = analysisA;
    const customAnalysis = {
      ...withoutDepth,
      moves: [
        { moveNumber: 2, color: 'white', move: 'Nf3', centipawnLoss: 10, moveQuality: 'excellent', evaluation: 0.3 },
      ],
    };
    mockGetAnalysis.mockResolvedValue(customAnalysis);
    mockGetJournal.mockResolvedValue([moveEntry]);
    const { sections } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(sections[0].engineEval.depth).toBeNull();
  });

  // gameA.pgn = '1. e4 e5 2. Nf3 Nc6'; the entry is move 2 for White, so the
  // position before it is after 1. e4 e5 and the numbering starts at "2.".
  const lineFor = async (move: Record<string, unknown>) => {
    mockGetAnalysis.mockResolvedValue({ ...analysisA, moves: [{ moveNumber: 2, color: 'white', move: 'Nf3', moveQuality: 'good', evaluation: 0.1, ...move }] });
    mockGetJournal.mockResolvedValue([moveEntry]);
    const { sections } = await (await POST(makeReq(), params(gameA.id))).json();
    return sections[0].engineEval;
  };

  it('gives the engine’s whole line in numbered SAN when my move was not its top move', async () => {
    const eval_ = await lineFor({ centipawnLoss: 30, bestMove: 'b1c3', principalVariation: ['b1c3', 'g8f6', 'g1f3', 'b8c6'] });
    expect(eval_.topLine).toBe('2. Nc3 Nf6 3. Nf3 Nc6');
  });

  it('starts the numbering at the right move for Black, with an ellipsis', async () => {
    // Black's reply is ply 3; the position before it is after 1. e4 e5 2. Nf3.
    mockGetAnalysis.mockResolvedValue({
      ...analysisA,
      moves: [{ moveNumber: 2, color: 'black', move: 'Nc6', moveQuality: 'good', evaluation: 0.1, centipawnLoss: 30, bestMove: 'g8f6', principalVariation: ['g8f6', 'f3e5'] }],
    });
    mockGetJournal.mockResolvedValue([{ ...moveEntry, moveNumber: 2, moveNotation: 'Nc6' }]);
    mockGetSetting.mockImplementation(async (key: string) => (key === 'chesscom_username' ? 'opponent_a' : null));
    const { sections } = await (await POST(makeReq(), params(gameA.id))).json();
    expect(sections[0].engineEval.topLine).toBe('2... Nf6 3. Nxe5');
  });

  it('has no top line when I played the engine’s top move', async () => {
    const eval_ = await lineFor({ centipawnLoss: 0, bestMove: 'g1f3', principalVariation: ['g1f3', 'b8c6'] });
    expect(eval_.topLine).toBeNull();
  });

  it('falls back to the best move alone when no line was stored', async () => {
    const eval_ = await lineFor({ centipawnLoss: 30, bestMove: 'b1c3' });
    expect(eval_.topLine).toBe('2. Nc3');
  });

  it('accepts a line stored as one space-separated string', async () => {
    const eval_ = await lineFor({ centipawnLoss: 30, bestMove: 'b1c3', principalVariation: 'b1c3 g8f6' });
    expect(eval_.topLine).toBe('2. Nc3 Nf6');
  });

  it('does not trust a stored line that does not start with the best move', async () => {
    const eval_ = await lineFor({ centipawnLoss: 30, bestMove: 'b1c3', principalVariation: ['g1f3', 'b8c6'] });
    expect(eval_.topLine).toBe('2. Nc3');
  });

  it('cuts the line short where it stops being legal, keeping the good part', async () => {
    const eval_ = await lineFor({ centipawnLoss: 30, bestMove: 'b1c3', principalVariation: ['b1c3', 'g8f6', 'e2e5', 'b8c6'] });
    expect(eval_.topLine).toBe('2. Nc3 Nf6');
  });

  it('has no top line when there is no best move to show', async () => {
    const eval_ = await lineFor({ centipawnLoss: 30 });
    expect(eval_.topLine).toBeNull();
  });

  it('leaves the line out rather than failing on a best move that makes no sense', async () => {
    const eval_ = await lineFor({ centipawnLoss: 30, bestMove: 'zzzz', principalVariation: ['zzzz'] });
    expect(eval_.topLine).toBeNull();
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

describe('POST /api/games/[id]/blog-post — game dates', () => {
  const DAILY_PGN = '[Event "Let\'s Play!"]\n[Site "Chess.com"]\n[Date "2026.07.10"]\n[White "testuser"]\n[Black "opponent_a"]\n[EndDate "2026.07.24"]\n\n1. e4 e5 2. Nf3 Nc6';
  const meta = async (game: object) => {
    mockGetGame.mockResolvedValue({ ...gameA, ...game } as any);
    return (await (await POST(makeReq(), params(gameA.id))).json()).gameMeta;
  };

  it('gives the start date from the PGN and the end date separately', async () => {
    const m = await meta({ pgn: DAILY_PGN, date: '2026-07-24', result: 'win' });
    expect(m.startDate).toBe('2026-07-10');
    expect(m.endDate).toBe('2026-07-24');
  });

  it('keeps `date` as the end date, as before', async () => {
    const m = await meta({ pgn: DAILY_PGN, date: '2026-07-24', result: 'win' });
    expect(m.date).toBe('2026-07-24');
  });

  it('has no start date when the PGN has no date tag, but still the end date', async () => {
    const m = await meta({ date: '2026-03-10' }); // gameA's PGN is moves only
    expect(m.startDate).toBeNull();
    expect(m.endDate).toBe('2026-03-10');
  });

  it('reports no end date for a game still being played, whose stored date is only the day it was fetched', async () => {
    const m = await meta({ pgn: DAILY_PGN, date: '2026-07-18', result: null });
    expect(m.startDate).toBe('2026-07-10');
    expect(m.endDate).toBeNull();
    expect(m.date).toBe('2026-07-18');
  });

  it('drops a start date that falls after the end date', async () => {
    const m = await meta({ pgn: DAILY_PGN, date: '2026-07-05', result: 'win' });
    expect(m.startDate).toBeNull();
    expect(m.endDate).toBe('2026-07-05');
  });

  it('still reads the dates from a PGN whose moves cannot be parsed', async () => {
    const m = await meta({ pgn: '[Date "2026.07.10"]\n\n1. e4 e5 2. Qxz9 nonsense', date: '2026-07-24', result: 'win' });
    expect(m.startDate).toBe('2026-07-10');
  });

  it('gives no start for a game with no PGN at all', async () => {
    const m = await meta({ pgn: '', date: '2026-07-24', result: 'win' });
    expect(m.startDate).toBeNull();
    expect(m.endDate).toBe('2026-07-24');
  });
});

describe('POST /api/games/[id]/blog-post — analysisSummary', () => {
  beforeEach(() => {
    mockGetGame.mockResolvedValue(gameA);
  });

  it('summarizes both players’ accuracy and move categories', async () => {
    mockGetAnalysis.mockResolvedValue(analysisA);
    const { analysisSummary } = await (await POST(makeReq(), params(gameA.id))).json();

    expect(analysisSummary.white).toMatchObject({ moves: 2, accuracy: 88.5, counts: { excellent: 1, good: 1 } });
    expect(analysisSummary.black).toMatchObject({ moves: 2, accuracy: 74.2, counts: { mistake: 1, blunder: 1 } });
  });

  it('is null when the game has not been analysed', async () => {
    mockGetAnalysis.mockResolvedValue(null);
    const body = await (await POST(makeReq(), params(gameA.id))).json();

    expect(body.analysisSummary).toBeNull();
  });

  it('is null when the analysis has no moves', async () => {
    mockGetAnalysis.mockResolvedValue({ ...analysisA, moves: [] });
    const body = await (await POST(makeReq(), params(gameA.id))).json();

    expect(body.analysisSummary).toBeNull();
  });
});

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
