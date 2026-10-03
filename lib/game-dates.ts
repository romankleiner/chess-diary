/**
 * When a game started and when it ended, for the blog's header. Pure.
 *
 * The stored game has a single `date`: the day its last move was made (or, for
 * a game still being played, the day it was fetched). The start date is only
 * in the PGN: Chess.com's daily-game PGNs carry the day the game began as
 * `[Date "2026.07.10"]` (and the end as `[EndDate ...]`). The tags are read
 * straight from the PGN text rather than through a chess parser, so a PGN whose
 * moves can't be parsed still yields its dates.
 */

/** The value of one PGN header tag, or null if the PGN has no such tag. */
export function pgnTag(pgn: string | null | undefined, name: string): string | null {
  if (!pgn) return null;
  const tag = /^\[([A-Za-z0-9_]+)\s+"((?:[^"\\]|\\.)*)"\]/gm;
  for (const match of pgn.matchAll(tag)) {
    if (match[1] === name) return match[2];
  }
  return null;
}

/**
 * A PGN date ("2026.07.10") as an ISO date ("2026-07-10"). Null for anything
 * else, including the PGN placeholders for an unknown date ("????.??.??",
 * "2026.07.??") and dates that don't exist (2026.02.30).
 */
export function parsePgnDate(value: string | null | undefined): string | null {
  const match = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec((value ?? '').trim());
  if (!match) return null;

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1000) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;

  return `${match[1]}-${match[2]}-${match[3]}`;
}

export interface GameDates {
  /** ISO date the game began, when the PGN says. */
  startDate: string | null;
  /** ISO date the game ended; null while it is still being played. */
  endDate: string | null;
}

/**
 * @param pgn      the game's PGN, for the start date
 * @param endDate  the stored game date (ISO), which is the day of the last move
 * @param finished whether the game is over. An unfinished game's stored date is
 *                 only the day it was fetched, so it is not reported as an end.
 */
export function resolveGameDates({ pgn, endDate, finished }: {
  pgn: string | null | undefined;
  endDate: string | null | undefined;
  finished: boolean;
}): GameDates {
  const end = finished && endDate ? endDate : null;
  const start = parsePgnDate(pgnTag(pgn, 'Date')) ?? parsePgnDate(pgnTag(pgn, 'UTCDate'));

  // A start after the end can't be right (a stray or mis-set tag); say nothing
  // rather than something contradictory.
  return { startDate: start && end && start > end ? null : start, endDate: end };
}
