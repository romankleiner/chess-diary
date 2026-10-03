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

  let mate: number | null = null;
  if (data.mate !== null && data.mate !== undefined && data.mate !== '') {
    const parsed = Number(data.mate);
    if (Number.isFinite(parsed)) mate = parsed;
  }

  return {
    pawns: Math.max(-MATE_PAWNS, Math.min(MATE_PAWNS, pawns)),
    mate,
    depth: typeof data.depth === 'number' ? data.depth : null,
  };
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
