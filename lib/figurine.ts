/**
 * Figurine notation: a piece shown as its symbol rather than its letter, so
 * `Nf3` reads `♞f3`. Only for display -- what is stored, copied out or exported
 * keeps the letters. Pure and browser-safe.
 *
 * Only a piece letter that is part of a move is turned into a symbol: the one a
 * piece move opens with (`Nf3`, `Rxe1`, `Qh4+`, `Nbd2`) and a promotion's piece
 * (`e8=Q`). Text to work on should already be known to be notation (a SAN, or a
 * run splitNotation found); the `Figurines` component (components/Figurines.tsx)
 * finds it within any text.
 *
 * One symbol per piece, whichever side moves, as in printed figurine notation:
 * the solid shapes, which stay legible at text size where the outlined ones thin out.
 */

export type PieceLetter = 'K' | 'Q' | 'R' | 'B' | 'N';

export const FIGURINE: Record<PieceLetter, string> = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞' };

export interface FigurineSegment {
  text: string;
  /** Set where `text` is a piece's letter, to be shown as FIGURINE[piece]. */
  piece?: PieceLetter;
}

// A piece move's letter (not inside a word, and followed by a file, rank or
// capture), or a promotion's piece after "=".
const PIECE = /(^|[^A-Za-z0-9_=])([KQRBN])(?=[a-h1-8x])|(=)([QRBN])/g;

/** Split notation into text and the piece letters to show as figurines. Joined, the texts give back the original. */
export function splitPieces(notation: string): FigurineSegment[] {
  const segments: FigurineSegment[] = [];
  let cursor = 0;
  for (const match of notation.matchAll(PIECE)) {
    const lead = match[1] ?? match[3];
    const letter = (match[2] ?? match[4]) as PieceLetter;
    const at = (match.index ?? 0) + lead.length;
    if (at > cursor) segments.push({ text: notation.slice(cursor, at) });
    segments.push({ text: letter, piece: letter });
    cursor = at + 1;
  }
  if (cursor < notation.length) segments.push({ text: notation.slice(cursor) });
  return segments;
}
