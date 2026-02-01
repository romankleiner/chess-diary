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
}

export interface JournalEntry {
  id: number;
  date: string;
  gameId: string | null;
  entryType: 'game_start' | 'thought' | 'move' | 'note';
  content: string;
  moveNumber?: number;
  moveNotation?: string;
  timestamp: string;
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
}

export interface DayJournal {
  date: string;
  entries: JournalEntry[];
}
