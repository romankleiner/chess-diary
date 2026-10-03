/**
 * Ground-truth chess facts computed with chess.js — pure, no I/O, never throws.
 *
 * The AI analyzer used to hand Claude a bare FEN string and let it decode the
 * board in its head, which is where invented pieces, threats and moves came
 * from. These helpers compute the facts programmatically so the prompt can
 * state them outright, and provide the move-replay primitives that
 * lib/line-verifier.ts uses to check the model's answer.
 */
import { Chess } from 'chess.js';
import type { Color, Move, PieceSymbol, Square } from 'chess.js';

const PIECE_NAMES: Record<PieceSymbol, string> = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
};
const PIECE_VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const COLOR_NAME: Record<Color, string> = { w: 'white', b: 'black' };
const FIGURINES: Record<string, string> = {
  '♔': 'K', '♚': 'K', '♕': 'Q', '♛': 'Q', '♖': 'R', '♜': 'R',
  '♗': 'B', '♝': 'B', '♘': 'N', '♞': 'N', '♙': '', '♟': '',
};

// Long-algebraic / UCI move, e.g. e2e4 or e7e8q. No valid SAN token has this shape.
const UCI_RE = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function loadFen(fen: string | null | undefined): Chess | null {
  if (!fen) return null;
  try {
    return new Chess(fen);
  } catch {
    return null;
  }
}

export function isValidFen(fen: string | null | undefined): boolean {
  return loadFen(fen) !== null;
}

/** Clean up a single move token the way models and engines tend to write them. */
export function normalizeMoveToken(raw: string): string {
  let t = raw.trim();
  t = t.replace(/[♔♚♕♛♖♜♗♝♘♞♙♟]/g, ch => FIGURINES[ch] ?? '');
  t = t.replace(/×/g, 'x');
  t = t.replace(/^[(\[{]+/, '').replace(/[)\]},;:]+$/, ''); // wrapping punctuation
  t = t.replace(/^0-0-0/, 'O-O-O').replace(/^0-0/, 'O-O'); // zeros → letter O, keep +/# suffix
  t = t.replace(/\.+$/, '');
  return t;
}

/**
 * Play one SAN or UCI token on `chess`. Returns the played move, or null if the
 * token is illegal or ambiguous in the current position. Mutates `chess` on success.
 */
export function tryMove(chess: Chess, token: string): Move | null {
  const t = normalizeMoveToken(token);
  if (!t) return null;
  try {
    const uci = UCI_RE.exec(t);
    if (uci) {
      return chess.move({ from: uci[1] as Square, to: uci[2] as Square, promotion: uci[3] });
    }
    return chess.move(t);
  } catch {
    return null;
  }
}

/** FEN after playing `move` (SAN or UCI) from `fen`, or null if the move is illegal. */
export function fenAfterMove(fen: string | null | undefined, move: string): string | null {
  const chess = loadFen(fen);
  if (!chess) return null;
  return tryMove(chess, move) ? chess.fen() : null;
}

export interface SanLine {
  sans: string[];
  /** True only if every token was played legally (and there was at least one). */
  complete: boolean;
}

/**
 * Convert an engine line (UCI array or space-separated string — SAN is accepted
 * too) to SAN by replaying it from `fen`. Stops at the first illegal token.
 */
export function uciLineToSan(
  fen: string | null | undefined,
  line: string | string[] | null | undefined,
): SanLine {
  const tokens = (Array.isArray(line) ? line.map(String) : typeof line === 'string' ? line.split(/\s+/) : [])
    .map(t => t.trim())
    .filter(Boolean);
  const chess = loadFen(fen);
  if (!chess || tokens.length === 0) return { sans: [], complete: false };

  const sans: string[] = [];
  for (const token of tokens) {
    const move = tryMove(chess, token);
    if (!move) return { sans, complete: false };
    sans.push(move.san);
  }
  return { sans, complete: true };
}

/**
 * Format SAN moves with move numbers, starting from the move number and side to
 * move in `startFen`: "13. Nxe5 Nxe5 14. d4", or "13... Nxe5 14. d4" when Black
 * moves first. A lone move is returned bare unless `bareSingle` is false.
 */
export function formatSanLine(
  startFen: string,
  sans: string[],
  { bareSingle = true }: { bareSingle?: boolean } = {},
): string {
  if (sans.length === 0) return '';
  if (sans.length === 1 && bareSingle) return sans[0];

  const fields = startFen.trim().split(/\s+/);
  let moveNumber = parseInt(fields[5] ?? '1', 10);
  if (!Number.isFinite(moveNumber) || moveNumber < 1) moveNumber = 1;
  let whiteToMove = fields[1] !== 'b';

  const out: string[] = [];
  sans.forEach((san, i) => {
    if (whiteToMove) {
      out.push(`${moveNumber}.`, san);
    } else {
      if (i === 0) out.push(`${moveNumber}...`);
      out.push(san);
      moveNumber++;
    }
    whiteToMove = !whiteToMove;
  });
  return out.join(' ');
}

// Piece placement + side to move + castling rights. The en-passant field is
// ignored on purpose: sources disagree on when to record it.
const positionKey = (fen: string) => fen.trim().split(/\s+/).slice(0, 3).join(' ');
const placementKey = (fen: string) => fen.trim().split(/\s+/).slice(0, 2).join(' ');

/**
 * The real move history of a game up to the position `fen`, replayed from its
 * PGN: "1. e4 e5 2. Nf3 Nc6". Returns '' if `fen` is the starting position and
 * null if the PGN is missing/unparseable or never reaches `fen`.
 */
export function historyFromPgn(
  pgn: string | null | undefined,
  fen: string | null | undefined,
): string | null {
  if (!pgn || !pgn.trim() || !fen) return null;
  try {
    const game = new Chess();
    game.loadPgn(pgn);
    const moves = game.history({ verbose: true });
    if (moves.length === 0) return null;

    const positions = [moves[0].before, ...moves.map(m => m.after)];
    let index = positions.findIndex(p => positionKey(p) === positionKey(fen));
    if (index === -1) index = positions.findIndex(p => placementKey(p) === placementKey(fen));
    if (index === -1) return null;
    if (index === 0) return '';

    return formatSanLine(positions[0], moves.slice(0, index).map(m => m.san), { bareSingle: false });
  } catch {
    return null;
  }
}

function describeSquare(chess: Chess, square: Square): string {
  const piece = chess.get(square);
  return piece ? `${PIECE_NAMES[piece.type]} on ${square}` : square;
}

function inventory(chess: Chess, color: Color): string {
  const byType = new Map<PieceSymbol, Square[]>();
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell && cell.color === color) {
        byType.set(cell.type, [...(byType.get(cell.type) ?? []), cell.square]);
      }
    }
  }
  return (['k', 'q', 'r', 'b', 'n', 'p'] as PieceSymbol[])
    .filter(type => byType.has(type))
    .map(type => {
      const squares = byType.get(type)!.sort();
      return `${capitalize(PIECE_NAMES[type])}${squares.length > 1 ? 's' : ''} ${squares.join(', ')}`;
    })
    .join('; ');
}

function checkStatus(chess: Chess): string {
  const side = capitalize(COLOR_NAME[chess.turn()]);
  if (chess.isCheckmate()) return `Status: ${side} is checkmated`;
  if (chess.isStalemate()) return `Status: stalemate (${side} has no legal move but is not in check)`;
  if (chess.inCheck()) {
    const opponent: Color = chess.turn() === 'w' ? 'b' : 'w';
    let kingSquare: Square | null = null;
    for (const row of chess.board()) {
      for (const cell of row) {
        if (cell && cell.type === 'k' && cell.color === chess.turn()) kingSquare = cell.square;
      }
    }
    const checkers = kingSquare ? chess.attackers(kingSquare, opponent) : [];
    return `Status: ${side} is in check${checkers.length ? ` (by ${checkers.map(s => describeSquare(chess, s)).join(', ')})` : ''}`;
  }
  return 'Status: no check';
}

function threats(chess: Chess): { loose: string[]; lesser: string[] } {
  const loose: string[] = [];
  const lesser: string[] = [];
  for (const row of chess.board()) {
    for (const cell of row) {
      if (!cell || cell.type === 'k') continue;
      const opponent: Color = cell.color === 'w' ? 'b' : 'w';
      const attackers = chess.attackers(cell.square, opponent);
      if (attackers.length === 0) continue;

      const label = `${COLOR_NAME[cell.color]} ${PIECE_NAMES[cell.type]} on ${cell.square}`;
      if (!chess.isAttacked(cell.square, cell.color)) loose.push(label);

      const weaker = attackers.filter(square => {
        const attacker = chess.get(square);
        return attacker !== undefined && PIECE_VALUE[attacker.type] < PIECE_VALUE[cell.type];
      });
      if (weaker.length > 0) {
        lesser.push(`${label} (attacked by ${weaker.map(s => describeSquare(chess, s)).join(', ')})`);
      }
    }
  }
  return { loose, lesser };
}

/**
 * A prompt-ready block of verified facts about the position: side to move, the
 * board, where every piece stands, check status, all legal moves (with the
 * checks and captures among them), and loose / under-attacked pieces. Returns
 * null if `fen` can't be parsed.
 */
export function describePosition(fen: string | null | undefined): string | null {
  const chess = loadFen(fen);
  if (!chess) return null;
  try {
    const side = capitalize(COLOR_NAME[chess.turn()]);
    const moves = chess.moves();
    const checks = moves.filter(m => /[+#]$/.test(m));
    const captures = moves.filter(m => m.includes('x'));
    const { loose, lesser } = threats(chess);
    const list = (items: string[], sep = ', ') => (items.length > 0 ? items.join(sep) : 'none');

    return [
      'Verified position facts (computed from the FEN by a chess library — treat them as ground truth; they are static and do not account for pins or tactics):',
      `- Side to move: ${side}`,
      '- Board (uppercase = White, lowercase = Black):',
      chess.ascii(),
      `- White pieces: ${inventory(chess, 'w')}`,
      `- Black pieces: ${inventory(chess, 'b')}`,
      `- ${checkStatus(chess)}`,
      `- Legal moves for ${side} (${moves.length}): ${list(moves)}`,
      `- Of those, checks: ${list(checks)}`,
      `- Of those, captures: ${list(captures)}`,
      `- Loose pieces (attacked and not defended): ${list(loose, '; ')}`,
      `- Pieces attacked by a lower-value piece: ${list(lesser, '; ')}`,
    ].join('\n');
  } catch {
    return null;
  }
}
