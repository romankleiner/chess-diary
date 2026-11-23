import { describe, it, expect } from 'vitest';
import {
  MATE_PAWNS,
  formatPawns,
  formatPawnsFine,
  isMatePawns,
  parseChessApiEval,
  parseStockfishOnlineEval,
  roundPawns,
  engineFen,
  terminalEval,
} from '@/lib/position-eval';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// White to move and checkmated (fool's mate).
const WHITE_MATED = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
// Black to move and checkmated (scholar's mate).
const BLACK_MATED = 'r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4';
const STALEMATE = '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1';

// ─── the position as chess-api.com will take it ───────────────────────────────

describe('engineFen', () => {
  // After 6...d5 in a real game: exd6 e.p. is possible, so chess.js writes d6, which the engine rejects
  const EN_PASSANT = 'r1bqkb1r/pp2pppp/1nn5/2ppP3/8/1BP2N2/PP1P1PPP/RNBQK2R w KQkq d6 0 7';

  it('drops the en passant square, leaving the rest of the position as it was', () => {
    expect(engineFen(EN_PASSANT)).toBe('r1bqkb1r/pp2pppp/1nn5/2ppP3/8/1BP2N2/PP1P1PPP/RNBQK2R w KQkq - 0 7');
  });

  it('leaves a position without one as it is', () => {
    expect(engineFen(START_FEN)).toBe(START_FEN);
  });

  it('leaves anything that is not a full position as it is', () => {
    expect(engineFen('')).toBe('');
    expect(engineFen('8/8/8/8/8/8/8/8 w')).toBe('8/8/8/8/8/8/8/8 w');
  });
});

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

// ─── reading stockfish.online ─────────────────────────────────────────────────

describe('parseStockfishOnlineEval', () => {
  // Real replies, from asking it at depth 12
  it('reads an ordinary evaluation, its best move and its line', () => {
    const reply = { success: true, evaluation: 1.08, mate: null, bestmove: 'bestmove d2d4 ponder c7c5', continuation: 'd2d4 c7c5 d4c5 e7e6' };
    expect(parseStockfishOnlineEval(reply)).toEqual({
      pawns: 1.08, mate: null, depth: null, bestMove: 'd2d4', pv: ['d2d4', 'c7c5', 'd4c5', 'e7e6'],
    });
  });

  it('scores from White’s side whoever is to move, as chess-api.com does', () => {
    // Black to move and a queen up: negative, as for White to move
    const reply = { success: true, evaluation: -5.84, mate: null, bestmove: 'bestmove e8e7 ponder g1h1', continuation: 'e8e7 g1h1 d2b2' };
    expect(parseStockfishOnlineEval(reply)?.pawns).toBe(-5.84);
  });

  it('reads a forced mate for White (the count arrives as a string) as +100 pawns', () => {
    const reply = { success: true, evaluation: null, mate: '1', bestmove: 'bestmove a1a8', continuation: 'a1a8' };
    expect(parseStockfishOnlineEval(reply)).toMatchObject({ pawns: MATE_PAWNS, mate: 1, bestMove: 'a1a8', pv: ['a1a8'] });
  });

  it('reads a forced mate for Black as -100 pawns', () => {
    const reply = { success: true, evaluation: null, mate: -1, bestmove: 'bestmove a8a1', continuation: 'a8a1' };
    expect(parseStockfishOnlineEval(reply)).toMatchObject({ pawns: -MATE_PAWNS, mate: -1 });
  });

  it('turns down a finished game, whose mate: 0 says nothing of who won (terminalEval works those out)', () => {
    expect(parseStockfishOnlineEval({ success: true, evaluation: null, mate: 0, bestmove: 'bestmove (none)', continuation: null })).toBeNull();
  });

  it('rejects its failures, which arrive as HTTP 200', () => {
    expect(parseStockfishOnlineEval({ success: false, error: 'Depth must be less than 16' })).toBeNull();
  });

  it('rejects a reply with no usable evaluation, or that is not an object', () => {
    expect(parseStockfishOnlineEval({ success: true, evaluation: null, mate: null })).toBeNull();
    expect(parseStockfishOnlineEval({ success: true, evaluation: 'lots' })).toBeNull();
    expect(parseStockfishOnlineEval({ evaluation: 0.3 })).toBeNull();
    expect(parseStockfishOnlineEval(null)).toBeNull();
    expect(parseStockfishOnlineEval('0.3')).toBeNull();
  });

  it('copes without a best move or a line', () => {
    expect(parseStockfishOnlineEval({ success: true, evaluation: 0.2 })).toMatchObject({ pawns: 0.2, bestMove: '', pv: [] });
    expect(parseStockfishOnlineEval({ success: true, evaluation: 0.2, bestmove: 'bestmove (none)' })?.bestMove).toBe('');
  });

  it('keeps the evaluation inside ±100 pawns', () => {
    expect(parseStockfishOnlineEval({ success: true, evaluation: 4000 })?.pawns).toBe(100);
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

describe('formatPawnsFine', () => {
  it('shows two decimals, with a sign for White’s edge', () => {
    expect(formatPawnsFine(0.4)).toBe('+0.40');
    expect(formatPawnsFine(-1.255)).toBe('-1.25');
    expect(formatPawnsFine(0)).toBe('0.00');
    expect(formatPawnsFine(12.5)).toBe('+12.50');
  });

  it('reads a forced mate as Mate, not as 100.00, whatever size it was stored at', () => {
    expect(formatPawnsFine(100)).toBe('+Mate');
    expect(formatPawnsFine(-100)).toBe('-Mate');
    expect(formatPawnsFine(104)).toBe('+Mate');
    expect(formatPawnsFine(-1234)).toBe('-Mate');
    expect(formatPawnsFine(90)).toBe('+Mate');
  });

  it('does not mistake a big but ordinary advantage for mate', () => {
    expect(formatPawnsFine(89.5)).toBe('+89.50');
  });

  it('never prints a signed zero', () => {
    expect(formatPawnsFine(-0.004)).toBe('0.00');
    expect(formatPawnsFine(-0)).toBe('0.00');
    expect(formatPawnsFine(0.004)).toBe('0.00');
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
