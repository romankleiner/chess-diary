/**
 * The private link to a shared game's blog: /blog/<token>, a random token rather
 * than the chess.com game id. Game ids are public (anyone can list a player's
 * games from Chess.com) and sequential, so a link by id let a reader of one shared
 * game find every other one. Pure and browser-safe; the tokens themselves are made
 * and looked up in lib/db.ts.
 */

/** 16 characters of base64url (96 random bits); never all digits, which a game id always is. */
const TOKEN_RE = /^[A-Za-z0-9_-]{16}$/;

/** Whether a /blog/<slug> is a link token, as opposed to a chess.com game id. */
export function isBlogToken(slug: unknown): slug is string {
  return typeof slug === 'string' && TOKEN_RE.test(slug) && /\D/.test(slug);
}

/** The path a shared game's blog opens at. */
export const blogPath = (token: string) => `/blog/${token}`;
