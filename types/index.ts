export interface Game {
  id: string;
  opponent: string;
  date: string;
  result: string | null;
  pgn: string;
  analysisCompleted: boolean;
  url?: string;
  timeControl?: string;
  white: string;
  black: string;
  turn?: string;
  fen?: string;
  move_by?: number; // Unix timestamp of when the next move is due
}

export interface JournalEntry {
  id: number;
  date: string;
  gameId: string | null;
  entryType: 'game_start' | 'thought' | 'move' | 'note' | 'post_game_summary';
  content: string;
  moveNumber?: number;
  moveNotation?: string;
  timestamp: string;
  fen?: string;
  myMove?: string;
  image?: string; // base64 encoded image

  // Only present when entryType === 'post_game_summary'
  postGameSummary?: {
    statistics: {
      totalMoves: number;
      accuracy: number | null;
      blunders: number;
      mistakes: number;
      inaccuracies: number;
      averageCentipawnLoss: number | null;
    } | null;
    reflections: {
      whatWentWell?: string;
      mistakes?: string;
      lessonsLearned?: string;
      nextSteps?: string;
    };
  };

  // Snapshot of game metadata at time of summary creation
  gameSnapshot?: {
    opponent: string;
    result: string | null;
    date: string;
    white: string;
    black: string;
    url?: string | null;
  } | null;
}

export interface MoveAnalysis {
  id: number;
  gameId: string;
  moveNumber: number;
  engineEvaluation: number;
  engineBestMove: string;
  yourMove: string;
  moveQuality: 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';
  engineLine?: string;
}

export interface Settings {
  chesscomUsername: string;
  analysisDepth: number;
}

export interface DayJournal {
  date: string;
  entries: JournalEntry[];
}