/**
 * Engine evaluations of a single position — pure logic, safe for the browser
 * and the server. (Fetching them from the engine API lives in
 * lib/position-eval-server.ts.)
 *
 * The engine API is chess-api.com. What it actually does, which this module
 * has to cope with:
 *   - `eval` is in pawns from WHITE's point of view, whoever is to move.
 *   - A forced mate comes back as eval ±100 with a signed `mate` count
 *     (negative = Black mates); the count may be a number or a string.
 *   - A position that is already checkmate or stalemate is NOT evaluated: it
 *     answers HTTP 200 with `type: "error"` and no eval. A reader's move can
 *     produce exactly such a position, so those are worked out here instead.
 *
 * When chess-api.com doesn't answer, stockfish.online stands in for it. Its replies:
 *   - `evaluation` is in pawns from WHITE's point of view too.
 *   - A forced mate comes back as `evaluation: null` with a signed `mate` count
 *     (negative = Black mates), a number or a string; `mate: 0` is a finished
 *     game, checkmate or stalemate alike.
 *   - `bestmove` reads "bestmove e2e4 ponder e7e5", and `continuation` is the
 *     line as one string of moves.
 *   - It refuses a depth of 16 or more.
 */
import { Chess } from 'chess.js';

export interface PositionEval {
  /** Pawns, from White's point of view; ±MATE_PAWNS when mate is forced. */
  pawns: number;
  /**
   * Moves to a forced mate, signed from White's point of view (negative = Black
   * mates). 0 = the position is already checkmate. null = no forced mate known.
   */
  mate: number | null;
  /** Search depth the engine used, when known. */
  depth: number | null;
}

export const MATE_PAWNS = 100;
/** Anything at or beyond this is a forced mate, not a material/positional edge. */
export const MATE_THRESHOLD_PAWNS = 90;

export const isMatePawns = (pawns: number): boolean => Math.abs(pawns) >= MATE_THRESHOLD_PAWNS;

/**
 * The evaluation of a position the engine API refuses to look at because the
 * game is over: checkmate (won for the side that just moved) or a draw
 * (stalemate, insufficient material, fifty-move rule). null if play continues,
 * or if `fen` is not a valid position.
 */
export function terminalEval(fen: string): PositionEval | null {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return null;
  }
  if (chess.isCheckmate()) {
    const whiteIsMated = chess.turn() === 'w';
    return { pawns: whiteIsMated ? -MATE_PAWNS : MATE_PAWNS, mate: 0, depth: null };
  }
  if (chess.isDraw()) return { pawns: 0, mate: null, depth: null };
  return null;
}

/**
 * A position as chess-api.com will take it: without an en passant square. It
 * rejects any position that has one ("INVALID_FEN_VALIDATION_ERROR"), even a
 * correct one -- and chess.js only writes one when the capture is really there
 * (exd6 after ...d5, say). The engine then overlooks that one capture, which is
 * better than no evaluation at all: it used to leave both moves around such a
 * position unanalysed. Anything that isn't a full FEN is returned as it is.
 */
export function engineFen(fen: string): string {
  const fields = fen.trim().split(/\s+/);
  if (fields.length < 4 || fields[3] === '-') return fen;
  fields[3] = '-';
  return fields.join(' ');
}

/**
 * Read a chess-api.com response body. Returns null for anything that is not a
 * usable evaluation, including its error replies (which arrive as HTTP 200).
 */
export function parseChessApiEval(body: unknown): PositionEval | null {
  if (!body || typeof body !== 'object') return null;
  const data = body as Record<string, unknown>;
  if (data.type === 'error') return null;

  const raw = data.eval ?? data.score;
  const pawns = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof pawns !== 'number' || !Number.isFinite(pawns)) return null;

  return {
    pawns: Math.max(-MATE_PAWNS, Math.min(MATE_PAWNS, pawns)),
    mate: readMateCount(data.mate),
    depth: typeof data.depth === 'number' ? data.depth : null,
  };
}

/** An evaluation with the move the engine would play and the line it expects, in UCI. */
export interface PositionEvalWithLine extends PositionEval {
  /** '' when the engine named none */
  bestMove: string;
  pv: string[];
}

/** A move count, as either engine API writes it: a number or a string. null if absent or unreadable. */
function readMateCount(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Read a stockfish.online response body. Returns null for anything that is not
 * a usable evaluation: its failures (`success: false`, which arrive as HTTP 200),
 * and a finished game (`mate: 0`), which says nothing of who won -- terminalEval
 * works those out instead. It doesn't say how deep it searched (depth is null).
 */
export function parseStockfishOnlineEval(body: unknown): PositionEvalWithLine | null {
  if (!body || typeof body !== 'object') return null;
  const data = body as Record<string, unknown>;
  if (data.success !== true) return null;

  const mate = readMateCount(data.mate);
  if (mate === 0) return null;

  let pawns: number;
  if (mate !== null) {
    pawns = mate > 0 ? MATE_PAWNS : -MATE_PAWNS;
  } else {
    const raw = typeof data.evaluation === 'string' ? Number(data.evaluation) : data.evaluation;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
    pawns = Math.max(-MATE_PAWNS, Math.min(MATE_PAWNS, raw));
  }

  const named = typeof data.bestmove === 'string' ? data.bestmove.match(/^bestmove\s+(\S+)/)?.[1] : undefined;
  const pv = typeof data.continuation === 'string' ? data.continuation.split(/\s+/).filter(Boolean) : [];

  return { pawns, mate, depth: null, bestMove: named && named !== '(none)' ? named : '', pv };
}

/**
 * One-decimal display of an evaluation, White's point of view: "+0.3", "-1.2",
 * "0.0". Forced mates read "+M3" / "-M2", or "+Mate" when the length is not
 * known (stored analyses keep only ±100), and a finished game reads "Checkmate".
 */
export function formatPawns(pawns: number, mate?: number | null): string {
  if (isMatePawns(pawns)) {
    if (mate === 0) return 'Checkmate';
    const sign = pawns > 0 ? '+' : '-';
    return mate ? `${sign}M${Math.abs(mate)}` : `${sign}Mate`;
  }
  const shown = roundPawns(pawns);
  return (shown > 0 ? '+' : '') + shown.toFixed(1);
}

/**
 * Like formatPawns but to two decimals, for places that show the finer figure
 * ("+0.35"). A forced mate still reads "+Mate" rather than "+100.00", and a tiny
 * negative reads "0.00" rather than "-0.00".
 */
export function formatPawnsFine(pawns: number): string {
  if (isMatePawns(pawns)) return formatPawns(pawns);
  const shown = Number(pawns.toFixed(2)) || 0;
  return (shown > 0 ? '+' : '') + shown.toFixed(2);
}

/**
 * Round to the one decimal that gets printed. Anything that compares
 * evaluations must round this way, or a sentence can disagree with the number
 * beside it (Math.round(0.35 * 10) is 4, but 0.35 prints as 0.3). Never
 * returns -0, so a tiny negative reads "0.0" rather than "-0.0".
 */
export function roundPawns(pawns: number): number {
  return Number(pawns.toFixed(1)) || 0;
}
