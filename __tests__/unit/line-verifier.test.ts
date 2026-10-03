import { describe, it, expect } from 'vitest';
import {
  INVALID_LINE_PLACEHOLDER,
  buildCorrectionPrompt,
  tokenizeLine,
  verifyAndClean,
  verifyLine,
} from '@/lib/line-verifier';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
// chess.js records the en-passant square only when a capture is actually possible,
// so FENs it generates after 1.e4 have '-' where the one above has 'e3'.
const AFTER_E4_FROM_CHESSJS = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const CASTLING_FEN = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';

// ─── tokenizeLine ─────────────────────────────────────────────────────────────

describe('tokenizeLine', () => {
  it('splits plain SAN on whitespace', () => {
    expect(tokenizeLine('Nxe5 Nxe5 d4')).toEqual(['Nxe5', 'Nxe5', 'd4']);
  });

  it('drops move numbers, attached or separate', () => {
    expect(tokenizeLine('12. Nxe5 Nxe5 13. d4')).toEqual(['Nxe5', 'Nxe5', 'd4']);
    expect(tokenizeLine('12.Nxe5 Nxe5 13.d4')).toEqual(['Nxe5', 'Nxe5', 'd4']);
    expect(tokenizeLine('12... Nxe5 13. d4')).toEqual(['Nxe5', 'd4']);
    expect(tokenizeLine('12…Nxe5')).toEqual(['Nxe5']);
  });

  it('drops game results, bare numbers and separators', () => {
    expect(tokenizeLine('e4 e5 1-0')).toEqual(['e4', 'e5']);
    expect(tokenizeLine('e4 e5 1/2-1/2')).toEqual(['e4', 'e5']);
    expect(tokenizeLine('e4, e5; Nf3 → Nc6')).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
    expect(tokenizeLine('12 e4')).toEqual(['e4']);
  });

  it('returns nothing for empty input', () => {
    expect(tokenizeLine('   ')).toEqual([]);
    expect(tokenizeLine('')).toEqual([]);
  });
});

// ─── verifyLine ───────────────────────────────────────────────────────────────

describe('verifyLine', () => {
  it('accepts a legal line and returns canonical SAN', () => {
    const check = verifyLine(START_FEN, 'e4 e5 Nf3');
    expect(check.valid).toBe(true);
    expect(check.sans).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('rejects an illegal move and reports where it failed', () => {
    const check = verifyLine(START_FEN, 'e4 e4 Nf3');
    expect(check.valid).toBe(false);
    expect(check.sans).toEqual(['e4']);
    expect(check.failedToken).toBe('e4');
    expect(check.failedAtPly).toBe(1);
    expect(check.fenAtFailure).toBe(AFTER_E4_FROM_CHESSJS);
    expect(check.legalAtFailure).toContain('e5');
    expect(check.legalAtFailure).not.toContain('e4');
  });

  it('rejects a move by a piece that is not on the board', () => {
    // Black has no knight that can reach e5 — the classic hallucination.
    const check = verifyLine(AFTER_E4, 'Nxe5');
    expect(check.valid).toBe(false);
    expect(check.failedAtPly).toBe(0);
  });

  it('rejects a move that would leave the king in check', () => {
    // The e-file pinned knight can't move: White Ke1, Ne2, Black Re8, Ke7... use a simple pin.
    const check = verifyLine('4r1k1/8/8/8/8/8/4N3/4K3 w - - 0 1', 'Nc3');
    expect(check.valid).toBe(false);
  });

  it('rejects an ambiguous move and accepts the disambiguated form', () => {
    // Knights on b1 and f1 can both go to d2.
    const fen = '4k3/8/8/8/8/8/8/1N2KN2 w - - 0 1';
    expect(verifyLine(fen, 'Nd2').valid).toBe(false);
    expect(verifyLine(fen, 'Nbd2').valid).toBe(true);
    expect(verifyLine(fen, 'Nfd2').valid).toBe(true);
  });

  it('tolerates harmless formatting: annotations, missing check marks, zero-castling', () => {
    expect(verifyLine(START_FEN, '1.e4 e5! 2.Nf3?!').sans).toEqual(['e4', 'e5', 'Nf3']);
    expect(verifyLine('4k3/5p2/8/7Q/2B5/8/8/6K1 w - - 0 1', 'Qxf7').sans).toEqual(['Qxf7+']);
    expect(verifyLine(CASTLING_FEN, '0-0 0-0-0').sans).toEqual(['O-O', 'O-O-O']);
  });

  it('accepts long-algebraic moves too', () => {
    expect(verifyLine(START_FEN, 'e2e4 e7e5').sans).toEqual(['e4', 'e5']);
  });

  it('falls back to the position after the move played when the line starts there', () => {
    // From the start position White cannot play e5; from after 1.e4 Black can.
    const afterE4 = verifyLine(START_FEN, 'e5 Nf3', AFTER_E4);
    expect(afterE4.valid).toBe(true);
    expect(afterE4.startFen).toBe(AFTER_E4);
    expect(afterE4.sans).toEqual(['e5', 'Nf3']);
  });

  it('prefers the base position when both starts work', () => {
    const check = verifyLine(START_FEN, 'e4', AFTER_E4);
    expect(check.startFen).toBe(START_FEN);
  });

  it('reports the failure from the start that got furthest when neither works', () => {
    // From START: e4 ok, then Nf6?? is Black's... "e4 Nf6 Qh5 Qh4": legal. Use a clear failure:
    const check = verifyLine(START_FEN, 'e4 e5 Qh6', AFTER_E4);
    expect(check.valid).toBe(false);
    expect(check.sans).toEqual(['e4', 'e5']);
    expect(check.failedToken).toBe('Qh6');
  });
});

// ─── verifyAndClean ───────────────────────────────────────────────────────────

describe('verifyAndClean', () => {
  it('leaves text without markers completely untouched', () => {
    const text = 'Knight on f3 controls key squares.\n\nA second paragraph.';
    const result = verifyAndClean(text, START_FEN, 'e4');
    expect(result.text).toBe(text);
    expect(result.checks).toEqual([]);
    expect(result.invalid).toEqual([]);
  });

  it('replaces a legal multi-move marker with numbered SAN', () => {
    const result = verifyAndClean('Consider [[line: e4 e5 Nf3]] here.', START_FEN);
    expect(result.text).toBe('Consider 1. e4 e5 2. Nf3 here.');
    expect(result.invalid).toEqual([]);
  });

  it('replaces a single-move marker with the bare move', () => {
    expect(verifyAndClean('Try [[line: Nf3]] instead.', START_FEN).text).toBe('Try Nf3 instead.');
  });

  it('numbers a line that starts with Black using the ellipsis', () => {
    expect(verifyAndClean('[[line: e5 Nf3 Nc6]]', AFTER_E4).text).toBe('1... e5 2. Nf3 Nc6');
  });

  it('canonicalizes sloppy notation inside the marker', () => {
    expect(verifyAndClean('[[line: 1.e4 e5! 2.Nf3?!]]', START_FEN).text).toBe('1. e4 e5 2. Nf3');
  });

  it('replaces an illegal marker with the placeholder and records it', () => {
    const result = verifyAndClean('You could play [[line: Nxe5 Nxe5]] here.', AFTER_E4);
    expect(result.text).toBe(`You could play ${INVALID_LINE_PLACEHOLDER} here.`);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].failedToken).toBe('Nxe5');
    expect(result.invalid[0].raw).toBe('Nxe5 Nxe5');
  });

  it('resolves several markers independently', () => {
    const result = verifyAndClean(
      'Good: [[line: e5]]. Bad: [[line: Qh5]]. Good: [[line: e5 Nf3]].',
      AFTER_E4,
    );
    expect(result.checks).toHaveLength(3);
    expect(result.invalid).toHaveLength(1);
    expect(result.text).toBe(`Good: e5. Bad: ${INVALID_LINE_PLACEHOLDER}. Good: 1... e5 2. Nf3.`);
  });

  it('accepts a line that starts after the move the player made', () => {
    const result = verifyAndClean('Then [[line: e5 Nf3]] follows.', START_FEN, 'e4');
    expect(result.invalid).toEqual([]);
    expect(result.text).toBe('Then 1... e5 2. Nf3 follows.');
  });

  it('is case-insensitive and whitespace-tolerant about the marker syntax', () => {
    expect(verifyAndClean('[[LINE: e4]]', START_FEN).text).toBe('e4');
    expect(verifyAndClean('[[ line :   e4  ]]', START_FEN).text).toBe('e4');
    expect(verifyAndClean('[[line:\ne4\ne5]]', START_FEN).text).toBe('1. e4 e5');
  });

  it('removes an empty marker', () => {
    const result = verifyAndClean('before [[line: ]] after', START_FEN);
    expect(result.text).toBe('before  after');
    expect(result.checks).toEqual([]);
  });

  it('cleans up unbalanced marker syntax the model left behind', () => {
    expect(verifyAndClean('text [[line: Nf3 and more', START_FEN).text).toBe('text Nf3 and more');
    expect(verifyAndClean('text ]] more', START_FEN).text).toBe('text  more');
  });

  it('just unwraps markers when the FEN is invalid, without verifying', () => {
    const result = verifyAndClean('Try [[line: Nf3]] now.', 'garbage');
    expect(result.text).toBe('Try Nf3 now.');
    expect(result.checks).toEqual([]);
    expect(verifyAndClean('Try [[line: Nf3]] now.', null).text).toBe('Try Nf3 now.');
  });
});

// ─── buildCorrectionPrompt ────────────────────────────────────────────────────

describe('buildCorrectionPrompt', () => {
  it('names the failing line, the illegal move, the position and the legal alternatives', () => {
    const { invalid } = verifyAndClean('[[line: e4 e4 Nf3]]', START_FEN);
    const prompt = buildCorrectionPrompt(invalid);

    expect(prompt).toContain('[[line: e4 e4 Nf3]]');
    expect(prompt).toContain('move 2 ("e4") is not legal');
    expect(prompt).toContain('After the legal part of the line (1. e4)');
    expect(prompt).toContain(AFTER_E4_FROM_CHESSJS);
    expect(prompt).toContain('Black to move');
    expect(prompt).toContain('Legal moves there:');
    expect(prompt).toContain('e5');
    expect(prompt).toContain('Rewrite the complete analysis');
  });

  it('handles a line whose very first move is illegal', () => {
    const { invalid } = verifyAndClean('[[line: Nxe5]]', AFTER_E4);
    const prompt = buildCorrectionPrompt(invalid);
    expect(prompt).toContain('move 1 ("Nxe5") is not legal');
    expect(prompt).toContain('At the start of the line');
  });

  it('lists every failing line', () => {
    const { invalid } = verifyAndClean('[[line: Qh5]] and [[line: Nxe5]]', AFTER_E4);
    const prompt = buildCorrectionPrompt(invalid);
    expect(prompt).toContain('[[line: Qh5]]');
    expect(prompt).toContain('[[line: Nxe5]]');
  });
});
