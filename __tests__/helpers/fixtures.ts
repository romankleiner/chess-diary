/**
 * Typed test fixtures shared across Tier 2 (DB) and Tier 3 (route) tests.
 */
import type { Game, JournalEntry } from '@/types';

export const TEST_USER = 'test-user-123';
export const TEST_USERNAME = 'testuser';

// ─── Games ───────────────────────────────────────────────────────────────────

export const gameA: Game = {
  id: 'game-111',
  opponent: 'opponent_a',
  date: '2026-03-10',
  result: '1-0',
  pgn: '1. e4 e5 2. Nf3 Nc6',
  analysisCompleted: false,
  url: 'https://www.chess.com/game/daily/111',
  timeControl: 'daily',
  white: TEST_USERNAME,
  black: 'opponent_a',
};

export const gameB: Game = {
  id: 'game-222',
  opponent: 'opponent_b',
  date: '2026-03-20',
  result: '0-1',
  pgn: '1. d4 d5 2. c4 e6',
  analysisCompleted: false,
  url: 'https://www.chess.com/game/daily/222',
  timeControl: 'daily',
  white: 'opponent_b',
  black: TEST_USERNAME,
};

// ─── Journal entries ──────────────────────────────────────────────────────────

export const thoughtEntry: JournalEntry = {
  id: 1001,
  date: '2026-03-10',
  gameId: 'game-111',
  entryType: 'thought',
  content: 'Playing e4, aiming for an open game.',
  timestamp: '2026-03-10T10:00:00.000Z',
};

export const moveEntry: JournalEntry = {
  id: 1002,
  date: '2026-03-10',
  gameId: 'game-111',
  entryType: 'move',
  content: 'Knight to f3',
  moveNumber: 2,
  moveNotation: 'Nf3',
  fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPPPPPP/RNBQKB1R w KQkq - 2 2',
  timestamp: '2026-03-10T10:05:00.000Z',
};

export const summaryEntry: JournalEntry = {
  id: 2001,
  date: '2026-03-10',
  gameId: 'game-111',
  entryType: 'post_game_summary',
  content: 'Knight outposts are powerful',
  timestamp: '2026-03-10T20:00:00.000Z',
  postGameSummary: {
    statistics: {
      totalMoves: 40,
      accuracy: 87.5,
      blunders: 0,
      mistakes: 1,
      inaccuracies: 3,
      averageCentipawnLoss: 18,
    },
    reflections: {
      whatWentWell: 'Good opening play',
      mistakes: 'Missed a tactic on move 25',
      lessonsLearned: 'Knight outposts are powerful',
      nextSteps: 'Study knight endgames',
    },
  },
  gameSnapshot: {
    opponent: 'opponent_a',
    result: '1-0',
    date: '2026-03-10',
    white: TEST_USERNAME,
    black: 'opponent_a',
    url: 'https://www.chess.com/game/daily/111',
  },
};

// ─── Analysis fixture ─────────────────────────────────────────────────────────

export const analysisA = {
  gameId: 'game-111',
  depth: 20,
  engine: 'stockfish',
  whitePlayer: TEST_USERNAME,
  blackPlayer: 'opponent_a',
  whiteAccuracy: 88.5,
  blackAccuracy: 74.2,
  moves: [
    { color: 'white', centipawnLoss: 10, moveQuality: 'excellent' },
    { color: 'black', centipawnLoss: 150, moveQuality: 'mistake' },
    { color: 'white', centipawnLoss: 30, moveQuality: 'good' },
    { color: 'black', centipawnLoss: 350, moveQuality: 'blunder' },
  ],
};
