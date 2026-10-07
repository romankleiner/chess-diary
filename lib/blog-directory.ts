/**
 * The public directory of shared game blogs: what each row shows, in what order,
 * grouped how, and filtered how. Pure and browser-safe. (Reading the games out
 * of the database lives in lib/blog-directory-server.ts.)
 */
import { resolveGameDates } from './game-dates';

export type DirectoryResult = 'win' | 'draw' | 'loss';

export interface DirectoryEntry {
  gameId: string;
  white: string;
  black: string;
  /** Which side the author played, when their Chess.com name says. */
  authorColor: 'white' | 'black' | null;
  opponent: string;
  /** From the author's side; null while the game is still being played (or if it ended some other way). */
  result: DirectoryResult | null;
  /** The game has no result yet. */
  inProgress: boolean;
  /** ISO dates: the day the game began (when the PGN says) and the day it ended. */
  startDate: string | null;
  endDate: string | null;
  /** As shown, e.g. "1 day per move". */
  timeControl: string;
  /** Moves the author wrote about. */
  commentedMoves: number;
  hasSummary: boolean;
}

// ─── Building a row ───────────────────────────────────────────────────────────

/** A Chess.com daily time control ("1/86400" is one move per 86 400 seconds) in words; anything else as it came. */
export function formatTimeControl(raw: string | null | undefined): string {
  const value = (raw ?? '').trim();
  if (!value) return '';
  if (value.toLowerCase() === 'daily') return 'Daily';

  const perMove = /^1\/(\d+)$/.exec(value);
  if (perMove) {
    const days = Number(perMove[1]) / 86_400;
    if (days > 0 && Number.isInteger(days)) return days === 1 ? '1 day per move' : `${days} days per move`;
  }
  return value;
}

const asResult = (value: unknown): DirectoryResult | null => {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return v === 'win' || v === 'draw' || v === 'loss' ? v : null;
};

/** The parts of a stored game the directory reads. */
export interface StoredGame {
  white?: string | null;
  black?: string | null;
  opponent?: string | null;
  result?: string | null;
  date?: string | null;
  pgn?: string | null;
  timeControl?: string | null;
}

export function buildDirectoryEntry({ gameId, game, username, commentedMoves, hasSummary }: {
  gameId: string;
  game: StoredGame;
  /** The author's Chess.com name, to tell which side they played. */
  username?: string | null;
  commentedMoves: number;
  hasSummary: boolean;
}): DirectoryEntry {
  const white = game.white ?? '';
  const black = game.black ?? '';
  const me = (username ?? '').trim().toLowerCase();
  const authorColor = !me ? null
    : white.toLowerCase() === me ? 'white'
    : black.toLowerCase() === me ? 'black'
    : null;

  const { startDate, endDate } = resolveGameDates({ pgn: game.pgn, endDate: game.date, finished: !!game.result });

  return {
    gameId,
    white,
    black,
    authorColor,
    opponent: game.opponent || (authorColor === 'white' ? black : authorColor === 'black' ? white : ''),
    result: asResult(game.result),
    inProgress: !game.result,
    startDate,
    endDate,
    timeControl: formatTimeControl(game.timeControl),
    commentedMoves,
    hasSummary,
  };
}

/** How much the author wrote at each game: moves with commentary, and whether there is an overall summary. */
export function countCommentary(
  journal: ReadonlyArray<{ gameId?: string | null; entryType?: string; content?: string }>,
  gameIds: ReadonlySet<string>,
): Map<string, { commentedMoves: number; hasSummary: boolean }> {
  const counts = new Map<string, { commentedMoves: number; hasSummary: boolean }>();
  for (const entry of journal) {
    if (!entry.gameId || !gameIds.has(entry.gameId)) continue;
    const row = counts.get(entry.gameId) ?? { commentedMoves: 0, hasSummary: false };
    if (entry.entryType === 'post_game_summary') row.hasSummary = true;
    // The blog shows an entry as a move only if it has something written in it
    else if (entry.content?.trim()) row.commentedMoves++;
    counts.set(entry.gameId, row);
  }
  return counts;
}

// ─── Order and grouping ───────────────────────────────────────────────────────

/** The date a game is placed by: when it ended, or if it hasn't, when it began. */
const placedOn = (entry: DirectoryEntry): string | null => entry.endDate ?? entry.startDate;

/** Newest first; games with no date at all last. */
export function sortDirectory(entries: readonly DirectoryEntry[]): DirectoryEntry[] {
  return [...entries].sort((a, b) => {
    const [da, db] = [placedOn(a), placedOn(b)];
    if (da !== db) {
      if (!da) return 1;
      if (!db) return -1;
      return da < db ? 1 : -1;
    }
    const [sa, sb] = [a.startDate ?? '', b.startDate ?? ''];
    if (sa !== sb) return sa < sb ? 1 : -1;
    return b.gameId.localeCompare(a.gameId, undefined, { numeric: true });
  });
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export interface DirectoryGroup {
  /** "2026-09", or "undated". */
  key: string;
  /** "September 2026", or "Undated". */
  label: string;
  entries: DirectoryEntry[];
}

/** Entries (already in order) gathered under the month they are placed in. */
export function groupByMonth(entries: readonly DirectoryEntry[]): DirectoryGroup[] {
  const groups: DirectoryGroup[] = [];
  for (const entry of entries) {
    const date = placedOn(entry);
    const month = date && /^\d{4}-(0[1-9]|1[0-2])/.test(date) ? date.slice(0, 7) : null;
    const key = month ?? 'undated';
    let group = groups.find(g => g.key === key);
    if (!group) {
      group = { key, label: month ? `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}` : 'Undated', entries: [] };
      groups.push(group);
    }
    group.entries.push(entry);
  }
  // Order is by date, so the undated ones are already last; keep it so whatever the input
  return [...groups.filter(g => g.key !== 'undated'), ...groups.filter(g => g.key === 'undated')];
}

// ─── Filtering ────────────────────────────────────────────────────────────────

export interface DirectoryFilter {
  /** Matched against both players and the game number, ignoring case. */
  query: string;
  result: DirectoryResult | 'all';
}

export const NO_FILTER: DirectoryFilter = { query: '', result: 'all' };

export function filterDirectory(entries: readonly DirectoryEntry[], filter: DirectoryFilter): DirectoryEntry[] {
  const query = filter.query.trim().toLowerCase();
  return entries.filter(entry => {
    if (filter.result !== 'all' && entry.result !== filter.result) return false;
    if (!query) return true;
    return [entry.white, entry.black, entry.opponent, entry.gameId].some(text => text.toLowerCase().includes(query));
  });
}

export interface DirectoryTally {
  total: number;
  win: number;
  draw: number;
  loss: number;
}

export function tallyResults(entries: readonly DirectoryEntry[]): DirectoryTally {
  const tally: DirectoryTally = { total: entries.length, win: 0, draw: 0, loss: 0 };
  for (const entry of entries) if (entry.result) tally[entry.result]++;
  return tally;
}

// ─── Wording ──────────────────────────────────────────────────────────────────

/** "2026-07-10 – 2026-07-24", or the one date that is known; "" when neither is. */
export function formatDateRange(startDate: string | null, endDate: string | null): string {
  return Array.from(new Set([startDate, endDate].filter((d): d is string => !!d))).join(' – ');
}

export function describeCommentary(entry: Pick<DirectoryEntry, 'commentedMoves' | 'hasSummary'>): string {
  const moves = entry.commentedMoves === 0 ? 'No move commentary'
    : entry.commentedMoves === 1 ? '1 commentated move'
    : `${entry.commentedMoves} commentated moves`;
  return entry.hasSummary ? `${moves} · overall summary` : moves;
}
