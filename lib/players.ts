/**
 * Who played a game: where to find a player's Chess.com profile, and what their
 * rating was. Pure and browser-safe.
 *
 * The ratings are not stored with the game; they are in its PGN, which Chess.com
 * writes with `WhiteElo` and `BlackElo` tags.
 */
import { pgnTag } from './game-dates';

/**
 * A Chess.com profile address, or null if `username` is not a plausible Chess.com
 * name. Names come from Chess.com's API, so they are not trusted: a name is only
 * linked if it is made of the characters Chess.com allows (letters, digits,
 * underscore, hyphen), which also keeps the address on chess.com whatever the name.
 */
export function chesscomProfileUrl(username: string | null | undefined): string | null {
  const name = (username ?? '').trim();
  return /^[A-Za-z0-9_-]{1,50}$/.test(name) ? `https://www.chess.com/member/${name}` : null;
}

/** A rating from a PGN tag: 3 or 4 digits. Null for a missing tag, "?", "0" and anything else. */
function asRating(value: string | null): number | null {
  const text = (value ?? '').trim();
  return /^\d{3,4}$/.test(text) ? Number(text) : null;
}

export interface GameRatings {
  whiteRating: number | null;
  blackRating: number | null;
}

export function ratingsFromPgn(pgn: string | null | undefined): GameRatings {
  return {
    whiteRating: asRating(pgnTag(pgn, 'WhiteElo')),
    blackRating: asRating(pgnTag(pgn, 'BlackElo')),
  };
}

/** "romank66 (1523)", or just the name when there is no rating. */
export function formatPlayer(name: string, rating: number | null | undefined): string {
  return rating == null ? name : `${name} (${rating})`;
}
