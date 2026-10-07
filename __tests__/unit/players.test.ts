import { describe, it, expect } from 'vitest';
import { chesscomProfileUrl, formatPlayer, ratingsFromPgn } from '@/lib/players';

describe('chesscomProfileUrl', () => {
  it.each(['romank66', 'WhiteLawer', 'opponent_a', 'some-one', 'A1_b-2', 'x'])('links %s to its Chess.com profile', name => {
    expect(chesscomProfileUrl(name)).toBe(`https://www.chess.com/member/${name}`);
  });

  it('keeps the name’s own capitals, which Chess.com ignores when finding the profile', () => {
    expect(chesscomProfileUrl('WhiteLawer')).toBe('https://www.chess.com/member/WhiteLawer');
  });

  it('ignores spaces round the name', () => {
    expect(chesscomProfileUrl('  romank66 ')).toBe('https://www.chess.com/member/romank66');
  });

  it('gives nothing for no name', () => {
    expect(chesscomProfileUrl('')).toBeNull();
    expect(chesscomProfileUrl('   ')).toBeNull();
    expect(chesscomProfileUrl(null)).toBeNull();
    expect(chesscomProfileUrl(undefined)).toBeNull();
  });

  it('never links a name that could take the address anywhere but a Chess.com profile', () => {
    for (const name of [
      '../admin', 'a/b', 'a?b=c', 'a#b', 'a b', 'a@evil.com', 'evil.com', 'a:b', '//evil.com', 'a\\b', 'a%2Fb',
      'javascript:alert(1)', '<script>', 'a"b', "a'b", 'ünïcode', 'a\nb', 'a.b',
    ]) {
      expect(chesscomProfileUrl(name), name).toBeNull();
    }
  });

  it('gives an absurdly long name no link', () => {
    expect(chesscomProfileUrl('a'.repeat(51))).toBeNull();
    expect(chesscomProfileUrl('a'.repeat(50))).not.toBeNull();
  });

  it('always stays on chess.com', () => {
    for (const name of ['romank66', 'a-b_c', 'x']) {
      expect(new URL(chesscomProfileUrl(name)!).origin).toBe('https://www.chess.com');
    }
  });
});

describe('ratingsFromPgn', () => {
  const pgn = (white: string, black: string) => `[Event "Daily"]\n[White "a"]\n[Black "b"]\n[WhiteElo "${white}"]\n[BlackElo "${black}"]\n\n1. e4 e5`;

  it('reads both ratings from the Elo tags', () => {
    expect(ratingsFromPgn(pgn('1523', '1480'))).toEqual({ whiteRating: 1523, blackRating: 1480 });
  });

  it('keeps white and black the right way round', () => {
    expect(ratingsFromPgn(pgn('900', '2100'))).toEqual({ whiteRating: 900, blackRating: 2100 });
  });

  it('takes three-digit and four-digit ratings', () => {
    expect(ratingsFromPgn(pgn('800', '2750'))).toEqual({ whiteRating: 800, blackRating: 2750 });
  });

  it('reads a rating with spaces round it', () => {
    expect(ratingsFromPgn(pgn(' 1523 ', '1480'))).toEqual({ whiteRating: 1523, blackRating: 1480 });
  });

  it.each(['?', '0', '', 'abc', '15', '12345', '-1500', '1500.5', '1,500', '1500 provisional'])('has no rating for "%s"', value => {
    expect(ratingsFromPgn(pgn(value, '1480'))).toEqual({ whiteRating: null, blackRating: 1480 });
  });

  it('has no rating for a tag that is missing', () => {
    expect(ratingsFromPgn('[White "a"]\n[Black "b"]\n\n1. e4 e5')).toEqual({ whiteRating: null, blackRating: null });
    expect(ratingsFromPgn('[WhiteElo "1523"]\n\n1. e4')).toEqual({ whiteRating: 1523, blackRating: null });
  });

  it('has none for no PGN at all', () => {
    expect(ratingsFromPgn('')).toEqual({ whiteRating: null, blackRating: null });
    expect(ratingsFromPgn(null)).toEqual({ whiteRating: null, blackRating: null });
    expect(ratingsFromPgn(undefined)).toEqual({ whiteRating: null, blackRating: null });
  });

  it('reads the ratings of a PGN whose moves cannot be parsed', () => {
    expect(ratingsFromPgn('[WhiteElo "1523"]\n[BlackElo "1480"]\n\n1. e4 e5 2. Qxz9 nonsense')).toEqual({ whiteRating: 1523, blackRating: 1480 });
  });

  it('is not fooled by "Elo" written in the moves or a comment', () => {
    expect(ratingsFromPgn('[White "a"]\n\n1. e4 {[WhiteElo "1523"]} e5')).toEqual({ whiteRating: null, blackRating: null });
  });
});

describe('formatPlayer', () => {
  it('puts the rating in brackets after the name', () => {
    expect(formatPlayer('romank66', 1523)).toBe('romank66 (1523)');
  });

  it('is just the name when there is no rating', () => {
    expect(formatPlayer('romank66', null)).toBe('romank66');
    expect(formatPlayer('romank66', undefined)).toBe('romank66');
  });
});
