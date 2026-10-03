/**
 * The engine eval shown on a post-game review, worked out from the game itself.
 *
 * A review used to carry a copy of the eval, taken in the browser at the moment
 * it was written. That copy was missing whenever the game hadn't been analysed
 * yet, the review was edited (which saved a fresh review without it), or the
 * text of the move didn't match the analysis exactly -- "0-0" for "O-O",
 * "Nd2" for "Nbd2". Deriving it from the game when the journal is read has none
 * of those problems and follows the analysis if it is re-run.
 *
 * The entry is anchored to the game by the position it was written from (its
 * FEN) -- recorded move text is often missing or loosely written -- and the eval
 * is only attached when the move the entry records is the move that was actually
 * played there. An entry that recorded a different move (an idea not played) gets
 * no eval rather than another move's. Pure; chess.js only.
 */
import { Chess } from 'chess.js';
import type { Move } from 'chess.js';
import { normalizeMoveToken, tryMove } from './position-facts';

export interface ReviewEval {
  evalBefore?: number;      // white-POV, pawn units
  evalAfter: number;        // white-POV, pawn units
  moveQuality?: string;
  centipawnLoss?: number;
}

interface StoredMove {
  moveNumber?: number;
  color?: string;
  move?: string;
  evaluation?: number;
  centipawnLoss?: number;
  moveQuality?: string;
}

/** The parts of a journal entry the lookup reads. */
export interface ReviewEntry {
  fen?: string | null;
  moveNotation?: string | null;
  myMove?: string | null;
  moveNumber?: number | null;
}

/** A game parsed once, so every entry for it can be looked up cheaply. */
export interface PreparedGame {
  history: Move[];
  moves: StoredMove[];
}

const normSan = (s: string) => s.replace(/[+#?!]/g, '').trim().toLowerCase();

// Placement, side to move and castling rights: the move counters and en-passant
// field vary by source.
const positionKey = (fen: string) => fen.split(' ').slice(0, 3).join(' ');

// The parts of a move that stay when its disambiguation is left out or over-specified
const SAN_PARTS = /^([KQRBN])?[a-h]?[1-8]?x?([a-h][1-8])(?:=?([QRBNqrbn]))?[+#]?[!?]*$/;

/**
 * Whether the text an entry recorded is the move `played`. Castling written with
 * zeros, check marks and annotations don't matter. A move that is ambiguous on
 * its own ("Nd2" when two knights can go there) still counts if it names the same
 * piece and the same square.
 */
function agreesWithPlayed(recorded: string, played: Move): boolean {
  const resolved = tryMove(new Chess(played.before), recorded);
  if (resolved) {
    return resolved.from === played.from && resolved.to === played.to
      && (resolved.promotion ?? '') === (played.promotion ?? '');
  }

  const parts = SAN_PARTS.exec(normalizeMoveToken(recorded));
  if (!parts) return false;
  const [, piece = 'P', square, promotion = ''] = parts;
  return piece === played.piece.toUpperCase()
    && square === played.to
    && promotion.toLowerCase() === (played.promotion ?? '');
}

/** Parse a game and its analysis. Null when either is unusable. */
export function prepareGame(pgn: string | null | undefined, analysis: { moves?: unknown } | null | undefined): PreparedGame | null {
  if (!pgn || !Array.isArray(analysis?.moves) || analysis.moves.length === 0) return null;
  try {
    const chess = new Chess();
    chess.loadPgn(pgn);
    const history = chess.history({ verbose: true });
    return history.length > 0 ? { history, moves: analysis.moves as StoredMove[] } : null;
  } catch {
    return null;
  }
}

/** The ply (0-based) an entry is about, or null if it can't be pinned down. */
function findPly(history: Move[], entry: ReviewEntry): number | null {
  const recorded = (entry.moveNotation || entry.myMove || '').trim();
  const plies = history.map((_, i) => i);

  let candidates: number[] = [];
  if (entry.fen) {
    candidates = plies.filter(i => positionKey(history[i].before) === positionKey(entry.fen as string));
  } else if (recorded && entry.moveNumber) {
    candidates = plies.filter(i => Math.floor(i / 2) + 1 === entry.moveNumber && agreesWithPlayed(recorded, history[i]));
  }
  if (candidates.length === 0) return null;

  // An entry that recorded no move is about the move played from its position.
  // One that did must agree with what was played (this also settles a position
  // reached twice).
  if (!recorded) return candidates[0];
  return candidates.find(i => agreesWithPlayed(recorded, history[i])) ?? null;
}

const analysisAt = (moves: StoredMove[], history: Move[], ply: number): StoredMove | undefined =>
  moves.find(m => m.moveNumber === Math.floor(ply / 2) + 1 && (!m.color || m.color === (history[ply].color === 'w' ? 'white' : 'black')));

/** The eval of the move a review is about, or null if it can't be found with confidence. */
export function resolveReviewEval(game: PreparedGame, entry: ReviewEntry): ReviewEval | null {
  const { history, moves } = game;
  const ply = findPly(history, entry);
  if (ply === null) return null;

  const hit = analysisAt(moves, history, ply);
  if (!hit || typeof hit.evaluation !== 'number' || !Number.isFinite(hit.evaluation)) return null;
  // An analysis of a different version of the game would attach the wrong eval
  if (typeof hit.move === 'string' && normSan(hit.move) !== normSan(history[ply].san)) return null;

  const before = ply === 0 ? undefined : analysisAt(moves, history, ply - 1);
  return {
    evalBefore: ply === 0 ? 0 : typeof before?.evaluation === 'number' ? before.evaluation : undefined,
    evalAfter: hit.evaluation,
    moveQuality: typeof hit.moveQuality === 'string' ? hit.moveQuality : undefined,
    centipawnLoss: typeof hit.centipawnLoss === 'number' ? hit.centipawnLoss : undefined,
  };
}

/** A journal entry, as far as filling in review evals needs it. */
export interface JournalEntryLike extends ReviewEntry {
  gameId?: string | null;
  entryType?: string;
  postReview?: Record<string, unknown> | null;
}

const needsEval = (entry: JournalEntryLike): boolean =>
  !!entry.postReview && typeof entry.postReview.evalAfter !== 'number' && !!entry.gameId && entry.entryType !== 'post_game_summary';

/**
 * Fill in the eval on post-game reviews that lack one. A saved eval is left
 * alone, nothing is written back, and a game that can't be loaded just leaves
 * its reviews as they were. Each game is loaded once however many reviews it has.
 */
export async function addMissingReviewEvals<T extends JournalEntryLike>(
  entries: T[],
  loadGame: (gameId: string) => Promise<{ pgn?: string | null; analysis?: { moves?: unknown } | null } | null>,
): Promise<T[]> {
  const needing = entries.filter(needsEval);
  if (needing.length === 0) return entries;

  const prepared = new Map<string, PreparedGame | null>();
  await Promise.all(
    [...new Set(needing.map(e => e.gameId as string))].map(async gameId => {
      try {
        const game = await loadGame(gameId);
        prepared.set(gameId, game ? prepareGame(game.pgn, game.analysis) : null);
      } catch (error) {
        console.error(`[REVIEW-EVAL] Could not load game ${gameId}:`, error instanceof Error ? error.message : error);
        prepared.set(gameId, null);
      }
    }),
  );

  return entries.map(entry => {
    if (!needsEval(entry)) return entry;
    const game = prepared.get(entry.gameId as string);
    let found: ReviewEval | null = null;
    try {
      found = game ? resolveReviewEval(game, entry) : null;
    } catch {
      // A malformed stored entry costs only its own eval, not the others'
    }
    return found ? { ...entry, postReview: { ...entry.postReview, ...found } } : entry;
  });
}
