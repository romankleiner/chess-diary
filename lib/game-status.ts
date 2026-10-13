/**
 * Whether a game is over, from its stored result. A game still being played has
 * none (older records may hold the text "null" or an "in progress" marker).
 * Browser-safe. Its blog must never be shared before then: the opponent could
 * read the author's thinking.
 */
export function isGameOver(result: unknown): boolean {
  return typeof result === 'string' && result !== '' && result !== 'null' && !result.includes('progress');
}

const RESULT_TOKEN = /^(1-0|0-1|1\/2-1\/2|\*)$/;

/**
 * How many half-moves a game's PGN records, read from its text rather than by
 * replaying it: chess.js takes about 10 ms to load one of Chess.com's PGNs (their
 * clock comments make it slow), over a second for the games list. What is left
 * once header tags, {comments}, ; comments, (variations), move numbers, $NAGs
 * and the result are taken out is one token per half-move. Browser-safe.
 */
export function countPlies(pgn: string | null | undefined): number {
  if (!pgn) return 0;
  let text = pgn
    .replace(/\[\w+\s+"(?:[^"\\]|\\.)*"\s*\]/g, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/;[^\n]*/g, ' ');
  // Variations can nest: remove the innermost until none are left
  for (let previous = ''; previous !== text; ) {
    previous = text;
    text = text.replace(/\([^()]*\)/g, ' ');
  }
  return text
    .replace(/\d+\.+/g, ' ')
    .split(/\s+/)
    .filter(token => token !== '' && !token.startsWith('$') && !RESULT_TOKEN.test(token))
    .length;
}

/** Fewer whole moves than this, finished, with nothing written about it: a game not worth listing. */
export const SHORT_GAME_MOVES = 5;

/**
 * A finished game of fewer than five moves (counted as players count them: White's
 * move and Black's reply are one) that has nothing written about it -- an aborted
 * or abandoned game, typically. The games list leaves these out. A game still
 * being played is never one, however young, and neither is one with any entry.
 */
export function isVeryShortGame(game: { result?: unknown; pgn?: string | null }, hasEntries: boolean): boolean {
  return isGameOver(game.result) && !hasEntries && Math.ceil(countPlies(game.pgn) / 2) < SHORT_GAME_MOVES;
}

/**
 * The games list split into the games it shows and the very short ones it leaves
 * out, each in the order given. `gamesWithEntries` is null when it isn't known
 * which games have entries (the journal couldn't be read): then nothing is left
 * out, as a short game someone wrote about must not vanish.
 */
export function splitVeryShortGames<T extends { id: string; result?: unknown; pgn?: string | null }>(
  games: readonly T[],
  gamesWithEntries: ReadonlySet<string> | null,
): { kept: T[]; veryShort: T[] } {
  if (!gamesWithEntries) return { kept: [...games], veryShort: [] };
  const kept: T[] = [];
  const veryShort: T[] = [];
  for (const game of games) {
    (isVeryShortGame(game, gamesWithEntries.has(game.id)) ? veryShort : kept).push(game);
  }
  return { kept, veryShort };
}
