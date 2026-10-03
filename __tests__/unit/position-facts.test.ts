import { describe, it, expect } from 'vitest';
import {
  describePosition,
  fenAfterMove,
  formatSanLine,
  historyFromPgn,
  isValidFen,
  normalizeMoveToken,
  uciLineToSan,
} from '@/lib/position-facts';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// After 1. e4 e5 2. Nf3 Nc6 — White to move.
const RUY_FEN = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';

// ─── describePosition ─────────────────────────────────────────────────────────

describe('describePosition', () => {
  it('returns null for a missing or invalid FEN', () => {
    expect(describePosition(null)).toBeNull();
    expect(describePosition(undefined)).toBeNull();
    expect(describePosition('')).toBeNull();
    expect(describePosition('not a fen')).toBeNull();
  });

  it('states the side to move and lists all 20 legal moves in the start position', () => {
    const facts = describePosition(START_FEN)!;
    expect(facts).toContain('Side to move: White');
    expect(facts).toContain('Legal moves for White (20):');
    expect(facts).toContain('Nf3');
    expect(facts).toContain('e4');
    expect(facts).not.toContain('Nf6'); // Black's move
  });

  it('reports Black to move and uses Black’s legal moves', () => {
    const facts = describePosition('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1')!;
    expect(facts).toContain('Side to move: Black');
    expect(facts).toContain('Nf6');
  });

  it('lists where every piece stands', () => {
    const facts = describePosition(START_FEN)!;
    expect(facts).toContain('White pieces: King e1; Queen d1; Rooks a1, h1; Bishops c1, f1; Knights b1, g1;');
    expect(facts).toContain('Black pieces: King e8; Queen d8;');
  });

  it('includes an ASCII board', () => {
    const facts = describePosition(START_FEN)!;
    expect(facts).toContain('r  n  b  q  k  b  n  r');
    expect(facts).toContain('a  b  c  d  e  f  g  h');
  });

  it('flags checks and captures among the legal moves', () => {
    // White Qh5 + Bc4 vs Black Ke8 + pawn f7: Qxf7+ is both a capture and a check
    // (not mate — the king can step to d8), while a quiet move is neither.
    const facts = describePosition('4k3/5p2/8/7Q/2B5/8/8/6K1 w - - 0 1')!;
    expect(facts).toMatch(/Of those, checks: .*Qxf7\+/);
    expect(facts).toMatch(/Of those, captures: .*Qxf7\+/);
    expect(facts).not.toMatch(/Of those, checks: .*Qh6[,\n]/);
  });

  it('marks a mating move with # among the checks', () => {
    // Back-rank mate: Ra8#.
    const facts = describePosition('6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1')!;
    expect(facts).toMatch(/Of those, checks: .*Ra8#/);
  });

  it('says there is no check in a quiet position', () => {
    expect(describePosition(START_FEN)).toContain('Status: no check');
  });

  it('detects check and names the checking piece', () => {
    // Black rook a1 checks the White king on e1 along the first rank.
    const facts = describePosition('4k3/8/8/8/8/8/8/r3K3 w - - 0 1')!;
    expect(facts).toContain('Status: White is in check (by rook on a1)');
  });

  it('detects checkmate', () => {
    // Fool's mate.
    const facts = describePosition('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3')!;
    expect(facts).toContain('Status: White is checkmated');
    expect(facts).toContain('Legal moves for White (0): none');
  });

  it('finds a loose piece attacked by a lower-value piece', () => {
    // Black knight d5 is hit by the White pawn on e4 and has no defender.
    const facts = describePosition('4k3/8/8/3n4/4P3/8/8/4K3 b - - 0 1')!;
    expect(facts).toContain('Loose pieces (attacked and not defended): black knight on d5');
    expect(facts).toContain('Pieces attacked by a lower-value piece: black knight on d5 (attacked by pawn on e4)');
  });

  it('does not call a defended piece loose', () => {
    // Same, but the knight is defended by the pawn on c6 (c6 attacks d5 and b5).
    const facts = describePosition('4k3/8/2p5/3n4/4P3/8/8/4K3 b - - 0 1')!;
    expect(facts).toContain('Loose pieces (attacked and not defended): none');
    // Still attacked by a lower-value piece, though.
    expect(facts).toContain('black knight on d5 (attacked by pawn on e4)');
  });

  it('reports none for loose and attacked pieces in the start position', () => {
    const facts = describePosition(START_FEN)!;
    expect(facts).toContain('Loose pieces (attacked and not defended): none');
    expect(facts).toContain('Pieces attacked by a lower-value piece: none');
  });
});

// ─── isValidFen / fenAfterMove ────────────────────────────────────────────────

describe('isValidFen / fenAfterMove', () => {
  it('validates FENs', () => {
    expect(isValidFen(START_FEN)).toBe(true);
    expect(isValidFen('garbage')).toBe(false);
    expect(isValidFen(null)).toBe(false);
  });

  it('plays a SAN or UCI move and returns the new FEN', () => {
    expect(fenAfterMove(START_FEN, 'e4')).toContain('4P3');
    expect(fenAfterMove(START_FEN, 'e2e4')).toContain('4P3');
  });

  it('returns null for an illegal move', () => {
    expect(fenAfterMove(START_FEN, 'Nf6')).toBeNull();
    expect(fenAfterMove(START_FEN, 'e5')).toBeNull();
  });
});

// ─── normalizeMoveToken ───────────────────────────────────────────────────────

describe('normalizeMoveToken', () => {
  it('converts zero-castling to letter O castling', () => {
    expect(normalizeMoveToken('0-0')).toBe('O-O');
    expect(normalizeMoveToken('0-0-0')).toBe('O-O-O');
    expect(normalizeMoveToken('0-0+')).toBe('O-O+');
  });

  it('converts figurine notation and the multiplication sign', () => {
    expect(normalizeMoveToken('♘f3')).toBe('Nf3');
    expect(normalizeMoveToken('♕×d5')).toBe('Qxd5');
    expect(normalizeMoveToken('♙e4')).toBe('e4');
  });

  it('strips wrapping punctuation', () => {
    expect(normalizeMoveToken('(Nf3)')).toBe('Nf3');
    expect(normalizeMoveToken('Nf3,')).toBe('Nf3');
    expect(normalizeMoveToken('Nf3.')).toBe('Nf3');
  });
});

// ─── uciLineToSan ─────────────────────────────────────────────────────────────

describe('uciLineToSan', () => {
  it('converts a UCI array to SAN', () => {
    expect(uciLineToSan(START_FEN, ['e2e4', 'e7e5', 'g1f3'])).toEqual({
      sans: ['e4', 'e5', 'Nf3'],
      complete: true,
    });
  });

  it('converts a space-separated UCI string', () => {
    expect(uciLineToSan(START_FEN, 'e2e4 e7e5')).toEqual({ sans: ['e4', 'e5'], complete: true });
  });

  it('accepts SAN tokens too', () => {
    expect(uciLineToSan(START_FEN, ['e4', 'e5', 'Nf3']).sans).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('handles castling and promotion in UCI', () => {
    expect(uciLineToSan('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', ['e1g1']).sans).toEqual(['O-O']);
    expect(uciLineToSan('8/P3k3/8/8/8/8/8/4K3 w - - 0 1', ['a7a8q']).sans).toEqual(['a8=Q']);
  });

  it('stops at the first illegal move and marks the line incomplete', () => {
    expect(uciLineToSan(START_FEN, ['e2e4', 'e2e4', 'g1f3'])).toEqual({ sans: ['e4'], complete: false });
  });

  it('is incomplete for empty input or a bad FEN', () => {
    expect(uciLineToSan(START_FEN, [])).toEqual({ sans: [], complete: false });
    expect(uciLineToSan(START_FEN, undefined)).toEqual({ sans: [], complete: false });
    expect(uciLineToSan('garbage', ['e2e4'])).toEqual({ sans: [], complete: false });
    expect(uciLineToSan(null, ['e2e4'])).toEqual({ sans: [], complete: false });
  });
});

// ─── formatSanLine ────────────────────────────────────────────────────────────

describe('formatSanLine', () => {
  it('numbers a line that starts with White', () => {
    expect(formatSanLine(START_FEN, ['e4', 'e5', 'Nf3'])).toBe('1. e4 e5 2. Nf3');
  });

  it('uses the ellipsis when Black moves first, and continues the numbering', () => {
    const afterE4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    expect(formatSanLine(afterE4, ['e5', 'Nf3', 'Nc6'])).toBe('1... e5 2. Nf3 Nc6');
  });

  it('starts from the FEN’s move number', () => {
    expect(formatSanLine(RUY_FEN, ['Bb5', 'a6', 'Ba4'])).toBe('3. Bb5 a6 4. Ba4');
  });

  it('returns a lone move bare, or numbered when asked', () => {
    expect(formatSanLine(START_FEN, ['e4'])).toBe('e4');
    expect(formatSanLine(START_FEN, ['e4'], { bareSingle: false })).toBe('1. e4');
  });

  it('returns an empty string for no moves', () => {
    expect(formatSanLine(START_FEN, [])).toBe('');
  });
});

// ─── historyFromPgn ───────────────────────────────────────────────────────────

describe('historyFromPgn', () => {
  const PGN = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6';

  it('replays the PGN up to the given position', () => {
    expect(historyFromPgn(PGN, RUY_FEN)).toBe('1. e4 e5 2. Nf3 Nc6');
  });

  it('works for a position reached after a Black move (Black to move next)', () => {
    const afterE4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    expect(historyFromPgn(PGN, afterE4)).toBe('1. e4');
  });

  it('ignores the en-passant field when matching the position', () => {
    const afterE4NoEp = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    expect(historyFromPgn(PGN, afterE4NoEp)).toBe('1. e4');
  });

  it('returns an empty string for the starting position', () => {
    expect(historyFromPgn(PGN, START_FEN)).toBe('');
  });

  it('includes the final position of the game', () => {
    const final = 'r1bqkb1r/1ppp1ppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 2 5';
    expect(historyFromPgn(PGN, final)).toBe('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6');
  });

  it('handles PGN headers and clock comments', () => {
    const withHeaders = `[Event "Daily"]\n[White "a"]\n[Black "b"]\n\n1. e4 {[%clk 1:00:00]} e5 {[%clk 1:00:00]} 2. Nf3 Nc6 *`;
    expect(historyFromPgn(withHeaders, RUY_FEN)).toBe('1. e4 e5 2. Nf3 Nc6');
  });

  it('returns null when the PGN never reaches the position', () => {
    expect(historyFromPgn('1. d4 d5 2. c4 e6', RUY_FEN)).toBeNull();
  });

  it('returns null for missing, empty or unparseable PGN and missing FEN', () => {
    expect(historyFromPgn(null, RUY_FEN)).toBeNull();
    expect(historyFromPgn('', RUY_FEN)).toBeNull();
    expect(historyFromPgn('1. e4 e5 2. Qh9', RUY_FEN)).toBeNull();
    expect(historyFromPgn(PGN, null)).toBeNull();
  });
});
