/**
 * Whether a game is over, from its stored result. A game still being played has
 * none (older records may hold the text "null" or an "in progress" marker).
 * Browser-safe. Its blog must never be shared before then: the opponent could
 * read the author's thinking.
 */
export function isGameOver(result: unknown): boolean {
  return typeof result === 'string' && result !== '' && result !== 'null' && !result.includes('progress');
}
