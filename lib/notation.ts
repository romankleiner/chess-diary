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
 *
 * Branch labels. When working through a position the author names the lines
 * they are calculating: a variation `(a)`, a sub-variation `(a2)` or `(b21)`, a
 * numbered item `(iii)`. Written `(a3)`, that is the same shape as a pawn move,
 * and used to be marked as one. With `branchLabels` such a label is recognised
 * and reported as its own kind, so it can be shown differently from a move.
 * That is only safe for the author's own words: in someone else's text (the AI's)
 * a lone `(e4)` really is the pawn, so the option is off unless asked for.
 */

export type NotationKind = 'text' | 'move' | 'branch';

export interface NotationSegment {
  text: string;
  /** Ordinary words, a chess move (or run of moves), or the label of a branch of a calculation. */
  kind: NotationKind;
}

export interface NotationOptions {
  /** Recognise `(a)`, `(a3)`, `(iii)`, and `b1)` at the start of a line as branch labels. */
  branchLabels?: boolean;
  /**
   * Whether the text begins a line, which a list-style `b1)` needs. True unless the
   * text carries on from earlier in the line (after a bold phrase, say).
   */
  startsLine?: boolean;
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
const NOTATION_SOURCE = `(^|[^A-Za-z0-9_])(${RUN})(?![A-Za-z0-9_])`;

// ─── Branch labels ────────────────────────────────────────────────────────────
//
// Shapes taken from how the author actually writes them (their journal has
// hundreds): letters a-e with roman numerals i-v, and sub-variations such as
// a1, a2, b1, b21, b22.
//  - A single letter a-h can't be mistaken for a move: a move has a rank.
//  - A letter a-e with a rank of 1-4 is a sub-variation. A rank of 5-8 is far more
//    likely the square or move itself, so `(f6)` or `(c5)` stay moves.
//  - A letter then two or more digits can't be a square at all.
//  - Roman numerals i to x.
const LABEL = '(?:[a-h]|[a-e][1-4]|[a-h]\\d{2,}|(?:i{1,3}|iv|vi{0,3}|ix|x))';

// "(a3)", not run into the word before it ("move(s)", "f(a)"), and ending the word.
const PAREN_LABEL = `(^|[^A-Za-z0-9_])(\\(${LABEL}\\))(?![A-Za-z0-9_])`;
// "b1)" or "ii)" opening a line, as in a list. The text's own start counts as one
// unless it carries on from earlier in the line.
const lineLabel = (startsLine: boolean) => `(${startsLine ? '^|' : ''}\\n)[ \\t]*(${LABEL}\\))(?![A-Za-z0-9_])`;
const labelSource = (startsLine: boolean) => `${PAREN_LABEL}|${lineLabel(startsLine)}`;

/** Split a stretch of text into ordinary words and chess moves. */
function splitMoves(text: string): NotationSegment[] {
  const segments: NotationSegment[] = [];
  let cursor = 0;

  const push = (value: string, kind: NotationKind) => {
    if (value) segments.push({ text: value, kind });
  };

  for (const match of text.matchAll(new RegExp(NOTATION_SOURCE, 'g'))) {
    const lead = match[1];
    const run = match[2];
    const runStart = (match.index ?? 0) + lead.length;
    push(text.slice(cursor, runStart), 'text');
    push(run, 'move');
    cursor = runStart + run.length;
  }
  push(text.slice(cursor), 'text');

  return segments;
}

/** Where each branch label sits in `text`, as [start, end) pairs. */
function findBranchLabels(text: string, startsLine: boolean): Array<[number, number]> {
  const found: Array<[number, number]> = [];
  const re = new RegExp(labelSource(startsLine), 'g');

  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const label = match[2] ?? match[4];
    const end = match.index + match[0].length;
    found.push([end - label.length, end]);
    // The next label may open right where this one closes, "(a)(b)", and needs the
    // ")" as the character before it, which this match has already used up.
    re.lastIndex = end - 1;
  }
  return found;
}

/**
 * Split `text` into ordinary text, chess notation and (when asked for) branch
 * labels. Joining the segments back together always gives the original text;
 * empty segments are never returned.
 */
export function splitNotation(
  text: string,
  { branchLabels = false, startsLine = true }: NotationOptions = {},
): NotationSegment[] {
  if (!branchLabels) return splitMoves(text);

  // Labels first, so what is inside one is never taken for a move
  const segments: NotationSegment[] = [];
  let cursor = 0;
  for (const [start, end] of findBranchLabels(text, startsLine)) {
    segments.push(...splitMoves(text.slice(cursor, start)));
    segments.push({ text: text.slice(start, end), kind: 'branch' });
    cursor = end;
  }
  segments.push(...splitMoves(text.slice(cursor)));

  return segments;
}
