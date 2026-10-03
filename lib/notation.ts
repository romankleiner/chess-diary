/**
 * Finding chess notation inside running prose, so it can be set apart from the
 * words around it. Pure and browser-safe.
 *
 * What counts: a move in standard algebraic notation (`Nf3`, `exd5`, `Bxd2+`,
 * `e8=Q#`, `O-O-O`), optionally with its move number (`10.`, `9...`, `...`) and
 * an annotation (`!`, `?!`). Moves written one after another are a single run,
 * so `9...Bxd2+ 10. Nxd2 Qxd2` reads as one piece of notation rather than five.
 *
 * It is a pattern match, not a legality check: `a4` is notation whether it is
 * a move or a square, and text that merely looks like a move is marked too.
 * That suits commentary, where the author is nearly always talking about the
 * board; it is not a parser for PGN.
 */

export interface NotationSegment {
  text: string;
  /** True for chess notation, false for the ordinary words around it. */
  notation: boolean;
}

const CASTLE = '(?:O-O(?:-O)?|0-0(?:-0)?)';
// Piece move: optional file/rank to tell two pieces apart, optional capture.
const PIECE_MOVE = '[KQRBN][a-h]?[1-8]?x?[a-h][1-8]';
// Pawn move: push (e4), capture (exd5), promotion (e8=Q).
const PAWN_MOVE = '(?:[a-h]x)?[a-h][1-8](?:=[QRBN])?';
const SAN = `(?:${CASTLE}|${PIECE_MOVE}|${PAWN_MOVE})[+#]?[!?]{0,2}`;

// "10." / "10.." / "9..." / "9…" / a bare "..." or "…" for a Black move
const MOVE_NUMBER = '(?:\\d{1,3}(?:\\.{3}|…|\\.)|\\.{3}|…)';
const ITEM = `(?:${MOVE_NUMBER}[ \\t]*)?${SAN}`;
// Items separated by spaces form one run.
const RUN = `${ITEM}(?:[ \\t]+${ITEM})*`;

// No lookbehind (older Safari refuses to even parse one): the character before
// a run is captured and handed back as ordinary text instead.
const NOTATION_RE = new RegExp(`(^|[^A-Za-z0-9_])(${RUN})(?![A-Za-z0-9_])`, 'g');

/**
 * Split `text` into ordinary text and chess notation. Joining the segments back
 * together always gives the original text; empty segments are never returned.
 */
export function splitNotation(text: string): NotationSegment[] {
  const segments: NotationSegment[] = [];
  let cursor = 0;

  const push = (value: string, notation: boolean) => {
    if (value) segments.push({ text: value, notation });
  };

  for (const match of text.matchAll(NOTATION_RE)) {
    const lead = match[1];
    const run = match[2];
    const runStart = (match.index ?? 0) + lead.length;
    push(text.slice(cursor, runStart), false);
    push(run, true);
    cursor = runStart + run.length;
  }
  push(text.slice(cursor), false);

  return segments;
}
