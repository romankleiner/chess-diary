import { describe, it, expect } from 'vitest';
import {
  MATE_PAWNS,
  formatPawns,
  isMatePawns,
  parseChessApiEval,
  roundPawns,
  terminalEval,
} from '@/lib/position-eval';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// White to move and checkmated (fool's mate).
const WHITE_MATED = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
// Black to move and checkmated (scholar's mate).
const BLACK_MATED = 'r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4';
const STALEMATE = '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1';

// ─── terminal positions ───────────────────────────────────────────────────────

describe('terminalEval', () => {
  it('is null while the game goes on', () => {
    expect(terminalEval(START_FEN)).toBeNull();
  });

  it('is null for something that is not a position', () => {
    expect(terminalEval('not a fen')).toBeNull();
    expect(terminalEval('')).toBeNull();
  });

  it('scores a checkmated White as a loss for White', () => {
    expect(terminalEval(WHITE_MATED)).toEqual({ pawns: -MATE_PAWNS, mate: 0, depth: null });
  });

  it('scores a checkmated Black as a win for White', () => {
    expect(terminalEval(BLACK_MATED)).toEqual({ pawns: MATE_PAWNS, mate: 0, depth: null });
  });

  it('scores stalemate, bare kings and the fifty-move rule as dead level', () => {
    const level = { pawns: 0, mate: null, depth: null };
    expect(terminalEval(STALEMATE)).toEqual(level);
    expect(terminalEval('8/8/8/4k3/8/8/4K3/8 w - - 0 1')).toEqual(level);
    expect(terminalEval('4k3/8/8/8/8/8/8/R3K3 w - - 100 80')).toEqual(level);
  });
});

// ─── reading chess-api.com ────────────────────────────────────────────────────

describe('parseChessApiEval', () => {
  it('reads an ordinary evaluation (a real reply, trimmed)', () => {
    const reply = { type: 'bestmove', depth: 10, move: 'd2d4', eval: 0.3, centipawns: '30', mate: null };
    expect(parseChessApiEval(reply)).toEqual({ pawns: 0.3, mate: null, depth: 10 });
  });

  it('reads a forced mate for White (mate arrives as a string)', () => {
    const reply = { type: 'bestmove', depth: 10, eval: 100, centipawns: 10000, mate: '1' };
    expect(parseChessApiEval(reply)).toEqual({ pawns: 100, mate: 1, depth: 10 });
  });

  it('reads a forced mate for Black as negative, whether number or string', () => {
    expect(parseChessApiEval({ eval: -100, mate: -1 })?.mate).toBe(-1);
    expect(parseChessApiEval({ eval: -100, mate: '-3' })?.mate).toBe(-3);
  });

  it('treats a missing or empty mate as no mate', () => {
    expect(parseChessApiEval({ eval: 0.5 })?.mate).toBeNull();
    expect(parseChessApiEval({ eval: 0.5, mate: '' })?.mate).toBeNull();
    expect(parseChessApiEval({ eval: 0.5, mate: 'soon' })?.mate).toBeNull();
  });

  it('rejects its error replies, which arrive as HTTP 200', () => {
    expect(parseChessApiEval({ type: 'error', error: 'INVALID_INPUT', text: 'move must not be undefined' })).toBeNull();
    expect(parseChessApiEval({ type: 'error', error: 'INVALID_FEN', eval: 0 })).toBeNull();
  });

  it('rejects a reply with no usable evaluation', () => {
    expect(parseChessApiEval({})).toBeNull();
    expect(parseChessApiEval({ eval: null })).toBeNull();
    expect(parseChessApiEval({ eval: 'lots' })).toBeNull();
    expect(parseChessApiEval({ eval: NaN })).toBeNull();
  });

  it('rejects anything that is not an object', () => {
    expect(parseChessApiEval(null)).toBeNull();
    expect(parseChessApiEval(undefined)).toBeNull();
    expect(parseChessApiEval('0.3')).toBeNull();
    expect(parseChessApiEval(0.3)).toBeNull();
  });

  it('accepts the older `score` field, and numeric strings', () => {
    expect(parseChessApiEval({ score: 0.4 })?.pawns).toBe(0.4);
    expect(parseChessApiEval({ eval: '0.4' })?.pawns).toBe(0.4);
  });

  it('keeps the evaluation inside ±100 pawns', () => {
    expect(parseChessApiEval({ eval: 4000 })?.pawns).toBe(100);
    expect(parseChessApiEval({ eval: -4000 })?.pawns).toBe(-100);
  });

  it('leaves depth null when the reply does not say', () => {
    expect(parseChessApiEval({ eval: 0.1 })?.depth).toBeNull();
  });
});

// ─── showing an evaluation ────────────────────────────────────────────────────

describe('formatPawns', () => {
  it('formats ordinary evaluations to one decimal with a sign for White’s edge', () => {
    expect(formatPawns(0.3)).toBe('+0.3');
    expect(formatPawns(0)).toBe('0.0');
    expect(formatPawns(-1.25)).toBe('-1.3');
    expect(formatPawns(12)).toBe('+12.0');
  });

  it('names a forced mate and how far away it is', () => {
    expect(formatPawns(100, 3)).toBe('+M3');
    expect(formatPawns(-100, -2)).toBe('-M2');
  });

  it('says "Mate" when the length is not known, as in a stored analysis', () => {
    expect(formatPawns(100)).toBe('+Mate');
    expect(formatPawns(-100)).toBe('-Mate');
    expect(formatPawns(100, null)).toBe('+Mate');
  });

  it('says "Checkmate" for a position that is already mate', () => {
    expect(formatPawns(100, 0)).toBe('Checkmate');
    expect(formatPawns(-100, 0)).toBe('Checkmate');
  });

  it('does not mistake a big but ordinary advantage for mate', () => {
    expect(formatPawns(15)).toBe('+15.0');
    expect(formatPawns(89.9)).toBe('+89.9');
  });

  it('never prints a signed zero', () => {
    expect(formatPawns(-0.04)).toBe('0.0');
    expect(formatPawns(-0)).toBe('0.0');
    expect(formatPawns(0.04)).toBe('0.0');
  });
});

describe('roundPawns', () => {
  it('rounds to the tenth that formatPawns prints, including awkward halves', () => {
    for (const v of [0.35, -0.35, 1.25, -1.25, 0.05, 2.45, -2.45, 0.149, 0.151]) {
      const printed = Number(formatPawns(v).replace('+', ''));
      expect(roundPawns(v)).toBe(printed);
    }
  });

  it('rounds half-way values away from zero, symmetrically for either colour', () => {
    expect(roundPawns(1.25)).toBe(1.3);
    expect(roundPawns(-1.25)).toBe(-1.3);
  });

  it('never returns negative zero', () => {
    expect(Object.is(roundPawns(-0.04), 0)).toBe(true);
    expect(Object.is(roundPawns(-0), 0)).toBe(true);
  });
});

describe('isMatePawns', () => {
  it('flags the mate sentinels and nothing smaller', () => {
    expect(isMatePawns(100)).toBe(true);
    expect(isMatePawns(-100)).toBe(true);
    expect(isMatePawns(90)).toBe(true);
    expect(isMatePawns(89)).toBe(false);
    expect(isMatePawns(0)).toBe(false);
  });
});
