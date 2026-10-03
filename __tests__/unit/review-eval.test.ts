import { describe, it, expect, vi } from 'vitest';
import { Chess } from 'chess.js';
import { addMissingReviewEvals, prepareGame, resolveReviewEval } from '@/lib/review-eval';

// ─── helpers ──────────────────────────────────────────────────────────────────

// Ruy Lopez. Ply 8 is White's 5th move, O-O.
const PGN = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6';
// Both knights can reach d2 on White's 5th move, so it has to be written Nbd2.
const KNIGHTS_PGN = '1. d4 Nf6 2. Nf3 d5 3. e3 e6 4. Bd3 Nc6 5. Nbd2 Be7';

const history = (pgn: string) => { const c = new Chess(); c.loadPgn(pgn); return c.history({ verbose: true }); };
const fenBefore = (pgn: string, ply: number) => history(pgn)[ply].before;

/** An analysis with one entry per ply. Evaluations are exact binary fractions: ply / 4. */
const analysisFor = (pgn: string, over: (ply: number) => Record<string, unknown> = () => ({})) => ({
  moves: history(pgn).map((m, i) => ({
    moveNumber: Math.floor(i / 2) + 1,
    color: i % 2 === 0 ? 'white' : 'black',
    move: m.san,
    evaluation: i / 4,
    centipawnLoss: i * 5,
    moveQuality: 'good',
    ...over(i),
  })),
});

const game = (pgn = PGN, analysis: object = analysisFor(pgn)) => prepareGame(pgn, analysis)!;

// ─── finding the eval ─────────────────────────────────────────────────────────

describe('resolveReviewEval — anchoring by position', () => {
  it('finds the eval of the move played from the position the entry was written from', () => {
    const found = resolveReviewEval(game(), { fen: fenBefore(PGN, 4) }); // Bb5, ply 4
    expect(found).toEqual({ evalBefore: 0.75, evalAfter: 1, moveQuality: 'good', centipawnLoss: 20 });
  });

  it('works when the entry recorded no move, which is how most entries are stored', () => {
    expect(resolveReviewEval(game(), { fen: fenBefore(PGN, 6), moveNotation: null, myMove: null })?.evalAfter).toBe(1.5);
  });

  it('works when the recorded move is exactly the move played', () => {
    expect(resolveReviewEval(game(), { fen: fenBefore(PGN, 4), myMove: 'Bb5' })?.evalAfter).toBe(1);
    expect(resolveReviewEval(game(), { fen: fenBefore(PGN, 4), moveNotation: 'Bb5' })?.evalAfter).toBe(1);
  });

  it('prefers moveNotation to myMove when both are there', () => {
    expect(resolveReviewEval(game(), { fen: fenBefore(PGN, 4), moveNotation: 'Bb5', myMove: 'Qh5' })?.evalAfter).toBe(1);
  });

  it('reads Black’s moves, with the right move number and colour', () => {
    // ply 5 is 3...a6: move number 3, Black
    expect(resolveReviewEval(game(), { fen: fenBefore(PGN, 5) })?.evalAfter).toBe(1.25);
  });

  it('ignores the move counters and en-passant field of the entry’s FEN, which vary by source', () => {
    const fen = fenBefore(PGN, 4).split(' ').slice(0, 3).join(' ') + ' - 99 99';
    expect(resolveReviewEval(game(), { fen })?.evalAfter).toBe(1);
  });
});

describe('resolveReviewEval — the recorded move written differently', () => {
  const castling = { fen: fenBefore(PGN, 8) };

  it.each([
    ['castling written with zeros', '0-0'],
    ['castling with a check mark', 'O-O+'],
    ['castling with an annotation', 'O-O!'],
    ['castling in lower case letter o', 'o-o'],
  ])('accepts %s', (_name, recorded) => {
    // "o-o" can't be read as a move, so it is the one that must not match
    const found = resolveReviewEval(game(), { ...castling, myMove: recorded });
    if (recorded === 'o-o') expect(found).toBeNull();
    else expect(found?.evalAfter).toBe(2);
  });

  it('accepts a move with check or annotation marks the game does not have', () => {
    expect(resolveReviewEval(game(), { fen: fenBefore(PGN, 4), myMove: 'Bb5+!' })?.evalAfter).toBe(1);
  });

  it('accepts a capture written without its x, or with the capture marked', () => {
    const pgn = '1. e4 d5 2. exd5 Qxd5';
    expect(resolveReviewEval(game(pgn), { fen: fenBefore(pgn, 2), myMove: 'exd5' })?.evalAfter).toBe(0.5);
    expect(resolveReviewEval(game(pgn), { fen: fenBefore(pgn, 2), myMove: 'ed5' })?.evalAfter).toBe(0.5);
  });

  it('accepts an ambiguous move that names the right piece and square ("Nd2" for "Nbd2")', () => {
    const k = game(KNIGHTS_PGN);
    const entry = { fen: fenBefore(KNIGHTS_PGN, 8) };
    expect(resolveReviewEval(k, { ...entry, myMove: 'Nd2' })?.evalAfter).toBe(2);
    expect(resolveReviewEval(k, { ...entry, myMove: 'Nbd2' })?.evalAfter).toBe(2);
  });

  it('accepts a move disambiguated more than it needs to be', () => {
    expect(resolveReviewEval(game(), { fen: fenBefore(PGN, 2), myMove: 'Ngf3' })?.evalAfter).toBe(0.5);
  });

  it('accepts a promotion written either way', () => {
    const pgn = '1. e4 d5 2. exd5 c6 3. dxc6 Nf6 4. cxb7 Nbd7 5. bxa8=Q Qc7';
    const fen = fenBefore(pgn, 8);
    expect(resolveReviewEval(game(pgn), { fen, myMove: 'bxa8=Q' })?.evalAfter).toBe(2);
    expect(resolveReviewEval(game(pgn), { fen, myMove: 'bxa8Q' })?.evalAfter).toBe(2);
  });
});

describe('resolveReviewEval — an entry about a different move', () => {
  it('gives no eval when the recorded move is a different move from the one played', () => {
    // Played Bb5; the entry says Bc4 (an idea that was not played)
    expect(resolveReviewEval(game(), { fen: fenBefore(PGN, 4), myMove: 'Bc4' })).toBeNull();
  });

  it('gives no eval for a move by a different piece', () => {
    expect(resolveReviewEval(game(), { fen: fenBefore(PGN, 4), myMove: 'Nc3' })).toBeNull();
  });

  it('gives no eval for the right piece going to a different square', () => {
    expect(resolveReviewEval(game(), { fen: fenBefore(PGN, 4), myMove: 'Bc4' })).toBeNull();
    expect(resolveReviewEval(game(KNIGHTS_PGN), { fen: fenBefore(KNIGHTS_PGN, 8), myMove: 'Nc3' })).toBeNull();
  });

  it('gives no eval when the recorded text is not a move at all', () => {
    expect(resolveReviewEval(game(), { fen: fenBefore(PGN, 4), myMove: 'develop the bishop' })).toBeNull();
  });

  it('does not mistake a pawn move for a piece move to the same square', () => {
    const pgn = '1. e4 e5 2. Nf3 Nc6';
    expect(resolveReviewEval(game(pgn), { fen: fenBefore(pgn, 0), myMove: 'Ne4' })).toBeNull();
  });
});

describe('resolveReviewEval — entries with no FEN', () => {
  it('uses the move number and the recorded move', () => {
    expect(resolveReviewEval(game(), { moveNumber: 3, moveNotation: 'Bb5' })?.evalAfter).toBe(1);
  });

  it('tells White’s and Black’s move of one number apart by the move itself', () => {
    expect(resolveReviewEval(game(), { moveNumber: 3, moveNotation: 'a6' })?.evalAfter).toBe(1.25);
  });

  it('needs both a move number and a recorded move', () => {
    expect(resolveReviewEval(game(), { moveNumber: 3 })).toBeNull();
    expect(resolveReviewEval(game(), { moveNotation: 'Bb5' })).toBeNull();
    expect(resolveReviewEval(game(), {})).toBeNull();
  });

  it('gives nothing when the move was not played at that move number', () => {
    expect(resolveReviewEval(game(), { moveNumber: 4, moveNotation: 'Bb5' })).toBeNull();
  });
});

describe('resolveReviewEval — repeated positions', () => {
  // The knights shuffle out and back, so the starting position occurs three times.
  const PGN3 = '1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1 Ng8 5. e4 e5';

  it('settles a position reached twice by the move the entry recorded', () => {
    const fen = fenBefore(PGN3, 0);
    expect(resolveReviewEval(game(PGN3), { fen, myMove: 'Nf3' })?.evalAfter).toBe(0); // the first occurrence
    expect(resolveReviewEval(game(PGN3), { fen, myMove: 'e4' })?.evalAfter).toBe(2);  // the one where e4 was played
  });

  it('takes the first occurrence when no move was recorded', () => {
    expect(resolveReviewEval(game(PGN3), { fen: fenBefore(PGN3, 0) })?.evalAfter).toBe(0);
  });
});

// ─── when there is nothing to find ────────────────────────────────────────────

describe('resolveReviewEval — nothing to find', () => {
  it('gives nothing for a position that never occurs in the game', () => {
    const other = '1. d4 d5 2. c4 e6';
    expect(resolveReviewEval(game(), { fen: fenBefore(other, 2) })).toBeNull();
  });

  it('gives nothing when the analysis has no entry for that move', () => {
    const missing = analysisFor(PGN);
    missing.moves = missing.moves.filter(m => !(m.moveNumber === 3 && m.color === 'white'));
    expect(resolveReviewEval(game(PGN, missing), { fen: fenBefore(PGN, 4) })).toBeNull();
  });

  it('gives nothing when the analysis was of a different game, so its move does not match', () => {
    const stale = analysisFor(PGN, i => (i === 4 ? { move: 'Bc4' } : {}));
    expect(resolveReviewEval(game(PGN, stale), { fen: fenBefore(PGN, 4) })).toBeNull();
  });

  it('is not put off by check or annotation marks in the analysis’s own move text', () => {
    const marked = analysisFor(PGN, i => (i === 4 ? { move: 'Bb5+!' } : {}));
    expect(resolveReviewEval(game(PGN, marked), { fen: fenBefore(PGN, 4) })?.evalAfter).toBe(1);
  });

  it.each([[undefined], [null], ['not a number'], [NaN], [Infinity]])('gives nothing when the stored evaluation is %s', value => {
    const bad = analysisFor(PGN, i => (i === 4 ? { evaluation: value } : {}));
    expect(resolveReviewEval(game(PGN, bad), { fen: fenBefore(PGN, 4) })).toBeNull();
  });

  it('does not throw on an entry whose FEN is nonsense', () => {
    expect(resolveReviewEval(game(), { fen: 'not a fen' })).toBeNull();
    expect(resolveReviewEval(game(), { fen: '' })).toBeNull();
  });

  it('gives an eval of 0 as an eval, not as missing', () => {
    const level = analysisFor(PGN, i => (i === 4 ? { evaluation: 0 } : {}));
    expect(resolveReviewEval(game(PGN, level), { fen: fenBefore(PGN, 4) })?.evalAfter).toBe(0);
  });
});

describe('resolveReviewEval — the other fields', () => {
  it('takes the eval before the move from the previous ply', () => {
    expect(resolveReviewEval(game(), { fen: fenBefore(PGN, 6) })?.evalBefore).toBe(1.25); // ply 5
  });

  it('starts from level for the very first move', () => {
    expect(resolveReviewEval(game(), { fen: fenBefore(PGN, 0) })?.evalBefore).toBe(0);
  });

  it('leaves the eval before out when the previous ply was not analysed, rather than guessing', () => {
    const gap = analysisFor(PGN);
    gap.moves = gap.moves.filter(m => !(m.moveNumber === 3 && m.color === 'black'));
    const found = resolveReviewEval(game(PGN, gap), { fen: fenBefore(PGN, 6) });
    expect(found?.evalAfter).toBe(1.5);
    expect(found?.evalBefore).toBeUndefined();
  });

  it('carries the move quality and centipawn loss', () => {
    const q = analysisFor(PGN, i => (i === 4 ? { moveQuality: 'blunder', centipawnLoss: 350 } : {}));
    expect(resolveReviewEval(game(PGN, q), { fen: fenBefore(PGN, 4) })).toMatchObject({ moveQuality: 'blunder', centipawnLoss: 350 });
  });

  it('omits quality and loss that were not stored, rather than inventing them', () => {
    const bare = analysisFor(PGN, i => (i === 4 ? { moveQuality: undefined, centipawnLoss: undefined } : {}));
    const found = resolveReviewEval(game(PGN, bare), { fen: fenBefore(PGN, 4) })!;
    expect(found.moveQuality).toBeUndefined();
    expect(found.centipawnLoss).toBeUndefined();
  });

  it('accepts an analysis whose moves carry no colour, using the move number alone', () => {
    const colourless = analysisFor(PGN);
    colourless.moves.forEach(m => { delete (m as { color?: string }).color; });
    // White's 3rd move: with no colour the first move numbered 3 is found
    expect(resolveReviewEval(game(PGN, colourless), { fen: fenBefore(PGN, 4) })?.evalAfter).toBe(1);
  });
});

describe('prepareGame', () => {
  it.each([
    ['no PGN', '', { moves: [{ moveNumber: 1 }] }],
    ['a null PGN', null, { moves: [{ moveNumber: 1 }] }],
    ['no analysis', PGN, null],
    ['an analysis with no moves', PGN, { moves: [] }],
    ['an analysis whose moves is not a list', PGN, { moves: 'lots' }],
    ['a PGN with no moves in it', '[Event "x"]\n\n*', { moves: [{ moveNumber: 1 }] }],
    ['a PGN that cannot be parsed', '1. e4 e5 2. Qxz9', { moves: [{ moveNumber: 1 }] }],
  ])('gives nothing for %s', (_name, pgn, analysis) => {
    expect(prepareGame(pgn as string, analysis as object)).toBeNull();
  });

  it('keeps the whole game and its analysis', () => {
    const prepared = prepareGame(PGN, analysisFor(PGN))!;
    expect(prepared.history).toHaveLength(14);
    expect(prepared.moves).toHaveLength(14);
  });
});

// ─── filling in a list of entries ─────────────────────────────────────────────

describe('addMissingReviewEvals', () => {
  type TestEntry = {
    id: number; gameId: string | null; entryType: string; fen?: string; myMove?: string;
    postReview: Record<string, unknown>;
  };
  const review = (extra: object = {}): Record<string, unknown> =>
    ({ content: 'Looking back…', timestamp: '2026-08-01T10:00:00', type: 'manual', ...extra });
  const entry = (id: number, ply: number, over: Partial<TestEntry> = {}): TestEntry => ({
    id, gameId: 'g1', entryType: 'move', fen: fenBefore(PGN, ply), postReview: review(), ...over,
  });
  const loader = (games: Record<string, { pgn: string; analysis: object } | null> = { g1: { pgn: PGN, analysis: analysisFor(PGN) } }) =>
    vi.fn(async (id: string) => games[id] ?? null);

  it('adds the eval to a review that lacks one, keeping everything else on the review', async () => {
    const [out] = await addMissingReviewEvals([entry(1, 4)], loader());

    expect(out.postReview).toEqual({
      content: 'Looking back…', timestamp: '2026-08-01T10:00:00', type: 'manual',
      evalBefore: 0.75, evalAfter: 1, moveQuality: 'good', centipawnLoss: 20,
    });
  });

  it('leaves an eval that was saved with the review exactly as it was', async () => {
    const saved = entry(1, 4, { postReview: review({ evalAfter: 7.7, moveQuality: 'blunder', centipawnLoss: 999 }) });
    const [out] = await addMissingReviewEvals([saved], loader());

    expect(out).toBe(saved);
    expect(out.postReview.evalAfter).toBe(7.7);
  });

  it('treats a saved eval of 0 as saved', async () => {
    const saved = entry(1, 4, { postReview: review({ evalAfter: 0 }) });
    const [out] = await addMissingReviewEvals([saved], loader());
    expect(out).toBe(saved);
  });

  it('does not touch an entry that has no review', async () => {
    const plain = { id: 2, gameId: 'g1', entryType: 'move', fen: fenBefore(PGN, 4) };
    const l = loader();
    const out = await addMissingReviewEvals([plain], l);

    expect(out[0]).toBe(plain);
    expect(l).not.toHaveBeenCalled();
  });

  it('does not touch a post-game summary, which has no move', async () => {
    const summary = entry(3, 4, { entryType: 'post_game_summary' });
    const [out] = await addMissingReviewEvals([summary], loader());
    expect(out).toBe(summary);
  });

  it('does not touch an entry that is not about a game', async () => {
    const general = entry(4, 4, { gameId: null });
    const l = loader();
    const [out] = await addMissingReviewEvals([general], l);

    expect(out).toBe(general);
    expect(l).not.toHaveBeenCalled();
  });

  it('loads each game once, however many reviews it has', async () => {
    const l = loader();
    const out = await addMissingReviewEvals([entry(1, 4), entry(2, 6), entry(3, 8), entry(4, 5)], l);

    expect(l).toHaveBeenCalledTimes(1);
    expect(out.map(e => e.postReview.evalAfter)).toEqual([1, 1.5, 2, 1.25]);
  });

  it('loads each of several games', async () => {
    const other = '1. d4 d5 2. c4 e6';
    const l = loader({ g1: { pgn: PGN, analysis: analysisFor(PGN) }, g2: { pgn: other, analysis: analysisFor(other) } });
    const out = await addMissingReviewEvals([entry(1, 4), { ...entry(2, 2), gameId: 'g2', fen: fenBefore(other, 2) }], l);

    expect(l).toHaveBeenCalledTimes(2);
    expect(out[1].postReview.evalAfter).toBe(0.5);
  });

  it('does not load anything when no review needs an eval', async () => {
    const l = loader();
    await addMissingReviewEvals([entry(1, 4, { postReview: review({ evalAfter: 1 }) })], l);
    expect(l).not.toHaveBeenCalled();
  });

  it('returns the list itself when nothing needed filling in', async () => {
    const list = [entry(1, 4, { postReview: review({ evalAfter: 1 }) })];
    expect(await addMissingReviewEvals(list, loader())).toBe(list);
  });

  it('keeps the order of the entries', async () => {
    const out = await addMissingReviewEvals([entry(3, 8), entry(1, 4), entry(2, 6)], loader());
    expect(out.map(e => e.id)).toEqual([3, 1, 2]);
  });

  it('leaves a review alone when its game has no analysis, or no record', async () => {
    const noAnalysis = await addMissingReviewEvals([entry(1, 4)], loader({ g1: { pgn: PGN, analysis: { moves: [] } } }));
    const noGame = await addMissingReviewEvals([entry(1, 4)], loader({ g1: null }));

    expect(noAnalysis[0].postReview.evalAfter).toBeUndefined();
    expect(noGame[0].postReview.evalAfter).toBeUndefined();
  });

  it('leaves a review about a move that was not played without an eval', async () => {
    const [out] = await addMissingReviewEvals([entry(1, 4, { myMove: 'Bc4' })], loader());
    expect(out.postReview.evalAfter).toBeUndefined();
  });

  it('survives a game that cannot be loaded, still filling in the others', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const l = vi.fn(async (id: string) => {
      if (id === 'bad') throw new Error('redis went away');
      return { pgn: PGN, analysis: analysisFor(PGN) };
    });
    const out = await addMissingReviewEvals([{ ...entry(1, 4), gameId: 'bad' }, entry(2, 4)], l);

    expect(out[0].postReview.evalAfter).toBeUndefined();
    expect(out[1].postReview.evalAfter).toBe(1);
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });

  it('does not change the entries it was given', async () => {
    const original = entry(1, 4);
    const copy = JSON.parse(JSON.stringify(original));
    const out = await addMissingReviewEvals([original], loader());

    expect(original).toEqual(copy);
    expect(out[0]).not.toBe(original);
    expect(original.postReview).not.toHaveProperty('evalAfter');
  });

  it('works for a mix of everything at once', async () => {
    const out = await addMissingReviewEvals([
      entry(1, 4),                                                   // missing -> filled
      entry(2, 6, { postReview: review({ evalAfter: 9 }) }),         // saved -> kept
      entry(3, 8, { myMove: 'Qh5' }),                                // different move -> left
      { id: 4, gameId: 'g1', entryType: 'move' },                    // no review -> left
      entry(5, 4, { entryType: 'post_game_summary' }),               // summary -> left
      entry(6, 4, { gameId: null }),                                 // no game -> left
    ], loader());

    expect(out.map(e => (e as { postReview?: { evalAfter?: number } }).postReview?.evalAfter)).toEqual([1, 9, undefined, undefined, undefined, undefined]);
  });
});
