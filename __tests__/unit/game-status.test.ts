import { describe, it, expect } from 'vitest';
import { Chess } from 'chess.js';
import { SHORT_GAME_MOVES, countPlies, isVeryShortGame, splitVeryShortGames } from '@/lib/game-status';

const pliesByChessJs = (pgn: string) => {
  const chess = new Chess();
  chess.loadPgn(pgn);
  return chess.history().length;
};

// As Chess.com writes them: header tags, then moves with clock comments
const CHESS_COM = `[Event "Let's Play!"]
[Site "Chess.com"]
[Date "2026.09.01"]
[White "romank66"]
[Black "opponent_a"]
[Result "1-0"]
[ECO "C60"]
[ECOUrl "https://www.chess.com/openings/Ruy-Lopez-Opening-3...a6"]
[WhiteElo "1523"]
[BlackElo "1480"]
[TimeControl "1/86400"]
[Termination "romank66 won by resignation"]

1. e4 {[%clk 23:59:51]} 1... e5 {[%clk 23:58:02]} 2. Nf3 {[%clk 23:59:40]} 2... Nc6 {[%clk 23:12:10]} 3. Bb5 {[%clk 23:59:01]} 3... a6 {[%clk 22:40:33]} 4. Ba4 {[%clk 23:59:30]} 1-0`;

describe('countPlies', () => {
  it('counts the half-moves of a Chess.com PGN, clock comments and all', () => {
    expect(countPlies(CHESS_COM)).toBe(7);
    expect(countPlies(CHESS_COM)).toBe(pliesByChessJs(CHESS_COM));
  });

  it.each([
    ['moves with no space after the number', '1.e4 e5 2.Nf3 Nc6 3.Bb5', 5],
    ['Black’s move numbers', '1. e4 1... e5 2. Nf3 2... Nc6', 4],
    ['annotations on a move', '1. e4! e5?! 2. Nf3!! Nc6??', 4],
    ['$-style annotations', '1. e4 $1 e5 $6 2. Nf3', 3],
    ['a variation', '1. e4 e5 (1... c5 2. Nf3) 2. Nf3', 3],
    ['a variation inside a variation', '1. e4 e5 (1... c5 2. Nf3 (2. c3 d5) d6) 2. Nf3', 3],
    ['a ; comment', '1. e4 e5 ; the open game\n2. Nf3', 3],
    ['a comment with brackets and numbers in it', '1. e4 {best by test (1. e4 e5) 2. Nf3} e5', 2],
    ['castling and promotion', '1. e4 d5 2. exd5 Qxd5 3. Nc3 Qa5 4. d4 Nf6 5. Nf3 Bf5 6. Bc4 e6 7. O-O c6', 14],
    ['a draw', '1. e4 e5 1/2-1/2', 2],
    ['a loss', '1. f3 e5 2. g4 Qh4# 0-1', 4],
    ['an unfinished game', '1. d4 d5 2. c4 *', 3],
  ])('counts %s', (_name, pgn, plies) => {
    expect(countPlies(pgn)).toBe(plies);
  });

  it('ignores header values that look like moves', () => {
    expect(countPlies('[Opening "1. e4 e5 2. Nf3"]\n[Annotator "said \\"1. d4\\""]\n\n1. c4 1-0')).toBe(1);
  });

  it.each([
    ['nothing', null],
    ['an empty PGN', ''],
    ['headers and a result only, as for a game aborted before a move', '[Event "Live Chess"]\n[Result "1-0"]\n\n1-0'],
  ])('counts no moves for %s', (_name, pgn) => {
    expect(countPlies(pgn)).toBe(0);
  });

  it('agrees with chess.js on whole games', () => {
    for (const pgn of [
      '1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7#',
      '1. d4 Nf6 2. c4 g6 3. Nc3 Bg7 4. e4 d6 5. Nf3 O-O 6. Be2 e5 7. O-O Nc6 8. d5 Ne7 9. Ne1 Nd7 10. Nd3 f5',
      CHESS_COM.replace('4. Ba4 {[%clk 23:59:30]} ', ''),
    ]) {
      expect(countPlies(pgn)).toBe(pliesByChessJs(pgn));
    }
  });
});

// ─── very short games ─────────────────────────────────────────────────────────

/** A game of this many half-moves (moves taken from a real opening, to stay legal). */
const LINE = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5'];
const pgnOf = (plies: number) =>
  LINE.slice(0, plies).map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}. ${san}` : san)).join(' ');
const game = (plies: number, result: string | null = 'win', id = `g${plies}`) => ({ id, result, pgn: pgnOf(plies) });

describe('isVeryShortGame', () => {
  it('is a finished game of under five moves with nothing written about it', () => {
    expect(SHORT_GAME_MOVES).toBe(5);
    expect(isVeryShortGame(game(8), false)).toBe(true);  // 4 whole moves
    expect(isVeryShortGame(game(1), false)).toBe(true);
  });

  it('counts moves as players do: White’s move and Black’s reply are one, and White’s fifth makes five', () => {
    expect(isVeryShortGame(game(7), false)).toBe(true);  // 4. Ba4 — four moves
    expect(isVeryShortGame(game(9), false)).toBe(false); // 5. O-O — five
    expect(isVeryShortGame(game(10), false)).toBe(false);
  });

  it('includes a game aborted before a single move', () => {
    expect(isVeryShortGame({ result: 'win', pgn: '[Result "1-0"]\n\n1-0' }, false)).toBe(true);
    expect(isVeryShortGame({ result: 'win', pgn: '' }, false)).toBe(true);
  });

  it('never includes a game with anything written about it', () => {
    expect(isVeryShortGame(game(2), true)).toBe(false);
  });

  it.each([null, '', 'null', 'in_progress'])('never includes a game still being played (%s), however young', result => {
    expect(isVeryShortGame(game(2, result), false)).toBe(false);
  });

  it('includes losses and draws too', () => {
    expect(isVeryShortGame(game(4, 'loss'), false)).toBe(true);
    expect(isVeryShortGame(game(4, 'draw'), false)).toBe(true);
  });
});

describe('splitVeryShortGames', () => {
  const games = [game(20, 'win', 'long'), game(3, 'win', 'aborted'), game(4, null, 'young'), game(2, 'loss', 'written'), game(1, 'win', 'quick')];

  it('leaves out the very short games, keeping the rest in order', () => {
    const { kept, veryShort } = splitVeryShortGames(games, new Set(['written']));
    expect(kept.map(g => g.id)).toEqual(['long', 'young', 'written']);
    expect(veryShort.map(g => g.id)).toEqual(['aborted', 'quick']);
  });

  it('leaves out nothing when it isn’t known which games have entries', () => {
    const { kept, veryShort } = splitVeryShortGames(games, null);
    expect(kept.map(g => g.id)).toEqual(games.map(g => g.id));
    expect(veryShort).toEqual([]);
  });

  it('copes with no games', () => {
    expect(splitVeryShortGames([], new Set())).toEqual({ kept: [], veryShort: [] });
  });
});
