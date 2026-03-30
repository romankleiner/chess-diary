import { describe, it, expect } from 'vitest';
import { parseChessComGame, determineResult } from '@/lib/chesscom';

// ─── fixtures ────────────────────────────────────────────────────────────────

const archivedGame = {
  time_class: 'daily',
  white: { username: 'Alice', result: 'win' },
  black: { username: 'Bob', result: 'resigned' },
  end_time: 1700000000,
  url: 'https://www.chess.com/game/daily/12345',
  pgn: '1. e4 e5 2. Nf3',
  time_control: '1/259200',
};

const activeGame = {
  time_class: 'daily',
  white: 'https://api.chess.com/pub/player/alice',
  black: 'https://api.chess.com/pub/player/bob',
  url: 'https://www.chess.com/game/daily/99999',
  pgn: '',
  time_control: '1/259200',
  turn: 'black',
  fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
};

// ─── parseChessComGame ────────────────────────────────────────────────────────

describe('parseChessComGame', () => {
  it('parses an archived game (object format)', () => {
    const result = parseChessComGame(archivedGame, 'Alice');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('12345');
    expect(result!.white).toBe('Alice');
    expect(result!.black).toBe('Bob');
    expect(result!.opponent).toBe('Bob');
    expect(result!.result).toBe('win');
    expect(result!.pgn).toBe('1. e4 e5 2. Nf3');
    expect(result!.timeControl).toBe('1/259200');
  });

  it('derives date from end_time unix timestamp', () => {
    const result = parseChessComGame(archivedGame, 'Alice');
    // end_time 1700000000 → 2023-11-14
    expect(result!.date).toBe('2023-11-14');
  });

  it('extracts game id from the URL last segment', () => {
    const game = { ...archivedGame, url: 'https://www.chess.com/game/daily/55555' };
    expect(parseChessComGame(game, 'Alice')!.id).toBe('55555');
  });

  it('sets result to null when there is no end_time (active game)', () => {
    const result = parseChessComGame(activeGame, 'alice');
    expect(result).not.toBeNull();
    expect(result!.result).toBeNull();
  });

  it('parses an active game (URL string format)', () => {
    const result = parseChessComGame(activeGame, 'alice');
    expect(result).not.toBeNull();
    expect(result!.white).toBe('alice');
    expect(result!.black).toBe('bob');
    expect(result!.turn).toBe('black');
    expect(result!.fen).toContain('rnbqkbnr');
  });

  it('returns null for non-daily time class', () => {
    expect(parseChessComGame({ ...archivedGame, time_class: 'blitz' }, 'Alice')).toBeNull();
    expect(parseChessComGame({ ...archivedGame, time_class: 'bullet' }, 'Alice')).toBeNull();
    expect(parseChessComGame({ ...archivedGame, time_class: 'rapid' }, 'Alice')).toBeNull();
  });

  it('returns null when time_class is missing', () => {
    const { time_class: _, ...noClass } = archivedGame;
    expect(parseChessComGame(noClass, 'Alice')).toBeNull();
  });

  it('returns null when white username is empty (unknown format)', () => {
    const game = { ...archivedGame, white: { username: '' }, black: { username: 'Bob' } };
    expect(parseChessComGame(game, 'Alice')).toBeNull();
  });

  it('returns null when white/black are neither string nor object with username', () => {
    const game = { ...archivedGame, white: null, black: null };
    expect(parseChessComGame(game, 'Alice')).toBeNull();
  });

  it('picks the opponent correctly when player is black', () => {
    const result = parseChessComGame(archivedGame, 'Bob');
    expect(result!.opponent).toBe('Alice');
  });

  it('opponent selection is case-insensitive', () => {
    const result = parseChessComGame(archivedGame, 'alice');
    expect(result!.opponent).toBe('Bob');
  });

  it('uses today\'s date when end_time is absent', () => {
    const today = new Date().toISOString().split('T')[0];
    const result = parseChessComGame(activeGame, 'alice');
    expect(result!.date).toBe(today);
  });

  it('sets analysisCompleted to false', () => {
    expect(parseChessComGame(archivedGame, 'Alice')!.analysisCompleted).toBe(false);
  });
});

// ─── determineResult ──────────────────────────────────────────────────────────

describe('determineResult', () => {
  const makeGame = (whiteResult: string, blackResult: string) => ({
    white: { username: 'Alice', result: whiteResult },
    black: { username: 'Bob', result: blackResult },
  });

  it('returns win when white wins and player is white', () => {
    expect(determineResult(makeGame('win', 'resigned'), 'Alice')).toBe('win');
  });

  it('returns loss when white wins and player is black', () => {
    expect(determineResult(makeGame('win', 'resigned'), 'Bob')).toBe('loss');
  });

  it('returns loss when black wins and player is white', () => {
    expect(determineResult(makeGame('resigned', 'win'), 'Alice')).toBe('loss');
  });

  it('returns win when black wins and player is black', () => {
    expect(determineResult(makeGame('resigned', 'win'), 'Bob')).toBe('win');
  });

  it('returns draw when neither side has a win result', () => {
    expect(determineResult(makeGame('agreed', 'agreed'), 'Alice')).toBe('draw');
    expect(determineResult(makeGame('stalemate', 'stalemate'), 'Alice')).toBe('draw');
    expect(determineResult(makeGame('repetition', 'repetition'), 'Alice')).toBe('draw');
  });

  it('is case-insensitive for username matching', () => {
    expect(determineResult(makeGame('win', 'resigned'), 'alice')).toBe('win');
    expect(determineResult(makeGame('win', 'resigned'), 'ALICE')).toBe('win');
  });

  it('returns draw for active game (URL string) format', () => {
    const activeFormatGame = {
      white: 'https://api.chess.com/pub/player/alice',
      black: 'https://api.chess.com/pub/player/bob',
    };
    expect(determineResult(activeFormatGame, 'alice')).toBe('draw');
  });
});
