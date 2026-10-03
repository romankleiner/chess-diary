import { describe, it, expect } from 'vitest';
import { parsePgnDate, pgnTag, resolveGameDates } from '@/lib/game-dates';

// A daily game as Chess.com serves it: started on the 10th, finished on the 24th.
const DAILY_PGN = `[Event "Let's Play!"]
[Site "Chess.com"]
[Date "2026.07.10"]
[Round "-"]
[White "romank"]
[Black "opponent_a"]
[Result "1-0"]
[Timezone "UTC"]
[UTCDate "2026.07.10"]
[StartTime "11:43:12"]
[EndDate "2026.07.24"]
[EndTime "13:20:11"]
[Link "https://www.chess.com/game/daily/111"]

1. e4 e5 2. Nf3 Nc6 1-0`;

describe('pgnTag', () => {
  it('reads a tag from the header', () => {
    expect(pgnTag(DAILY_PGN, 'Date')).toBe('2026.07.10');
    expect(pgnTag(DAILY_PGN, 'EndDate')).toBe('2026.07.24');
    expect(pgnTag(DAILY_PGN, 'White')).toBe('romank');
  });

  it('keeps a value that contains spaces, punctuation and an escaped quote', () => {
    expect(pgnTag(DAILY_PGN, 'Event')).toBe("Let's Play!");
    expect(pgnTag('[Event "A \\"quoted\\" name"]\n\n1. e4', 'Event')).toBe('A \\"quoted\\" name');
  });

  it('matches the whole tag name, not a prefix or suffix of another', () => {
    expect(pgnTag(DAILY_PGN, 'Dat')).toBeNull();
    expect(pgnTag(DAILY_PGN, 'End')).toBeNull();
    expect(pgnTag(DAILY_PGN, 'UTCDate')).toBe('2026.07.10'); // not confused with Date
    expect(pgnTag('[UTCDate "2026.07.10"]\n\n1. e4', 'Date')).toBeNull();
  });

  it('is case-sensitive, as PGN tag names are', () => {
    expect(pgnTag(DAILY_PGN, 'date')).toBeNull();
  });

  it('returns null when the tag is absent', () => {
    expect(pgnTag(DAILY_PGN, 'Opening')).toBeNull();
  });

  it.each([[''], [null], [undefined], ['1. e4 e5 2. Nf3 Nc6']])('returns null for a PGN with no header (%s)', pgn => {
    expect(pgnTag(pgn as string, 'Date')).toBeNull();
  });

  it('works with Windows line endings', () => {
    expect(pgnTag(DAILY_PGN.replace(/\n/g, '\r\n'), 'EndDate')).toBe('2026.07.24');
  });

  it('does not read a tag-like string out of a move comment', () => {
    const pgn = '[White "a"]\n\n1. e4 { [Date "1999.01.01"] } e5';
    expect(pgnTag(pgn, 'Date')).toBeNull();
  });

  it('works even when the moves could not be parsed', () => {
    expect(pgnTag('[Date "2026.07.10"]\n\nnot a real game ???', 'Date')).toBe('2026.07.10');
  });

  it('can be called repeatedly with the same result', () => {
    expect(pgnTag(DAILY_PGN, 'Date')).toBe(pgnTag(DAILY_PGN, 'Date'));
  });
});

describe('parsePgnDate', () => {
  it('turns a PGN date into an ISO date', () => {
    expect(parsePgnDate('2026.07.10')).toBe('2026-07-10');
    expect(parsePgnDate('2024.02.29')).toBe('2024-02-29'); // a leap day
  });

  it('ignores surrounding whitespace', () => {
    expect(parsePgnDate(' 2026.07.10 ')).toBe('2026-07-10');
  });

  it.each([
    ['the unknown-date placeholder', '????.??.??'],
    ['an unknown day', '2026.07.??'],
    ['an unknown month and day', '2026.??.??'],
    ['an empty string', ''],
    ['a month that does not exist', '2026.13.01'],
    ['month zero', '2026.00.10'],
    ['day zero', '2026.07.00'],
    ['a day that does not exist', '2026.07.32'],
    ['30 February', '2026.02.30'],
    ['29 February in a year that is not a leap year', '2026.02.29'],
    ['an ISO date, which is not the PGN form', '2026-07-10'],
    ['a two-digit year', '26.07.10'],
    ['a year before 1000', '0099.07.10'],
    ['trailing text', '2026.07.10 extra'],
  ])('rejects %s', (_name, value) => {
    expect(parsePgnDate(value)).toBeNull();
  });

  it.each([[null], [undefined]])('rejects %s', value => {
    expect(parsePgnDate(value)).toBeNull();
  });
});

describe('resolveGameDates', () => {
  it('gives the start from the PGN and the end from the stored date', () => {
    expect(resolveGameDates({ pgn: DAILY_PGN, endDate: '2026-07-24', finished: true }))
      .toEqual({ startDate: '2026-07-10', endDate: '2026-07-24' });
  });

  it('uses the stored date for the end, not the PGN’s EndDate', () => {
    // The stored date is what the blog showed before; it stays the end.
    expect(resolveGameDates({ pgn: DAILY_PGN, endDate: '2026-07-25', finished: true }).endDate).toBe('2026-07-25');
  });

  it('has no start when the PGN does not say', () => {
    expect(resolveGameDates({ pgn: '1. e4 e5', endDate: '2026-07-24', finished: true }))
      .toEqual({ startDate: null, endDate: '2026-07-24' });
    expect(resolveGameDates({ pgn: '', endDate: '2026-07-24', finished: true }).startDate).toBeNull();
    expect(resolveGameDates({ pgn: null, endDate: '2026-07-24', finished: true }).startDate).toBeNull();
  });

  it('has no start when the PGN’s date is the unknown placeholder', () => {
    const pgn = '[Date "????.??.??"]\n\n1. e4 e5';
    expect(resolveGameDates({ pgn, endDate: '2026-07-24', finished: true }).startDate).toBeNull();
  });

  it('falls back to the UTC date when the Date tag is unusable', () => {
    const pgn = '[Date "????.??.??"]\n[UTCDate "2026.07.12"]\n\n1. e4 e5';
    expect(resolveGameDates({ pgn, endDate: '2026-07-24', finished: true }).startDate).toBe('2026-07-12');
  });

  it('prefers the Date tag to the UTC date', () => {
    const pgn = '[Date "2026.07.10"]\n[UTCDate "2026.07.11"]\n\n1. e4 e5';
    expect(resolveGameDates({ pgn, endDate: '2026-07-24', finished: true }).startDate).toBe('2026-07-10');
  });

  it('does not report an end for a game still being played', () => {
    // Its stored date is only the day it was fetched.
    expect(resolveGameDates({ pgn: DAILY_PGN, endDate: '2026-07-18', finished: false }))
      .toEqual({ startDate: '2026-07-10', endDate: null });
  });

  it('has no end when there is no stored date', () => {
    expect(resolveGameDates({ pgn: DAILY_PGN, endDate: '', finished: true }).endDate).toBeNull();
    expect(resolveGameDates({ pgn: DAILY_PGN, endDate: null, finished: true }).endDate).toBeNull();
    expect(resolveGameDates({ pgn: DAILY_PGN, endDate: undefined, finished: true }).endDate).toBeNull();
  });

  it('drops a start that falls after the end rather than contradict itself', () => {
    expect(resolveGameDates({ pgn: DAILY_PGN, endDate: '2026-07-05', finished: true }))
      .toEqual({ startDate: null, endDate: '2026-07-05' });
  });

  it('keeps a game that started and ended on the same day', () => {
    expect(resolveGameDates({ pgn: DAILY_PGN, endDate: '2026-07-10', finished: true }))
      .toEqual({ startDate: '2026-07-10', endDate: '2026-07-10' });
  });

  it('compares dates across a month and a year boundary correctly', () => {
    const pgn = '[Date "2025.12.28"]\n\n1. e4 e5';
    expect(resolveGameDates({ pgn, endDate: '2026-01-03', finished: true }))
      .toEqual({ startDate: '2025-12-28', endDate: '2026-01-03' });
  });

  it('has neither when nothing is known', () => {
    expect(resolveGameDates({ pgn: '', endDate: null, finished: false })).toEqual({ startDate: null, endDate: null });
  });
});
