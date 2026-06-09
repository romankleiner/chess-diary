'use client';

/**
 * Shared types, constants, and interactive components used by both
 * BlogPostModal (in-app modal) and /blog/[gameId] (public page).
 */

import React, { useRef, useState, useMemo, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { Chess } from 'chess.js';

// react-chessboard uses browser drag APIs — must be client-only.
const Chessboard = dynamic(
  () => import('react-chessboard').then(m => m.Chessboard),
  { ssr: false }
);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EngineEval {
  moveQuality: string;
  centipawnLoss: number;
  evaluation: number; // white-POV, pawn units
}

export interface MoveSection {
  type: 'move';
  header: string;              // e.g. "Move 2: Nf3"
  timestamp: string;           // ISO timestamp
  fen: string | null;
  userColor: 'white' | 'black';
  thinking: string;
  moveNotation: string | null;      // SAN of the played move
  opponentLastMove: string | null;  // decoded, e.g. "Nc4 (c3-c4)"
  engineEval: EngineEval | null;
  aiReview: string | null;
  postReview: string | null;
}

// 'puzzle'          — board shown; guess by dragging pieces
// 'thinking_shown'  — thinking revealed; board still interactive
// 'solved_blind'    — guessed correctly without peeking; post-game still hidden
// 'complete'        — full reveal
export type SectionPhase = 'puzzle' | 'thinking_shown' | 'solved_blind' | 'complete';

// ─── Constants ────────────────────────────────────────────────────────────────

export const QUALITY_STYLE: Record<string, { label: string; color: string }> = {
  excellent:  { label: '✓ Excellent',  color: 'text-green-600 dark:text-green-400'   },
  good:       { label: '✓ Good',       color: 'text-blue-600 dark:text-blue-400'     },
  inaccuracy: { label: '⚠ Inaccuracy', color: 'text-yellow-600 dark:text-yellow-400' },
  mistake:    { label: '✗ Mistake',    color: 'text-orange-600 dark:text-orange-400' },
  blunder:    { label: '✗✗ Blunder',   color: 'text-red-600 dark:text-red-400'       },
};

export function formatEval(v: number): string {
  return (v > 0 ? '+' : '') + v.toFixed(1);
}

// Normalise SAN for comparison: strip check/mate symbols, trim, lower-case.
export function normSan(s: string): string {
  return s.replace(/[+#?!]/g, '').trim().toLowerCase();
}

// ─── Inline bold renderer ─────────────────────────────────────────────────────
// Converts **text** markers to <strong> elements within a paragraph.

export function renderWithBold(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : part
  );
}

// ─── Inline PGN navigator ─────────────────────────────────────────────────────

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKB1R w KQkq - 0 1';

export function PgnViewer({ pgn, userColor }: { pgn: string; userColor: 'white' | 'black' }) {
  const [moveIdx, setMoveIdx] = useState(-1);

  const { fens, sans } = useMemo(() => {
    try {
      const chess = new Chess();
      chess.loadPgn(pgn);
      const moves = chess.history({ verbose: true });
      const fenList = [moves[0]?.before ?? START_FEN, ...moves.map((m: any) => m.after)];
      return { fens: fenList, sans: moves.map((m: any) => m.san as string) };
    } catch {
      return { fens: [START_FEN], sans: [] };
    }
  }, [pgn]);

  const total      = sans.length;
  const currentFen = fens[moveIdx + 1] ?? fens[0];

  const movePairs: Array<{ white: string; black?: string; pairIdx: number }> = [];
  for (let i = 0; i < sans.length; i += 2) {
    movePairs.push({ white: sans[i], black: sans[i + 1], pairIdx: i / 2 });
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-center">
        <Image
          src={`/api/board-image?fen=${encodeURIComponent(currentFen)}&pov=${userColor}`}
          alt="Board position"
          width={280}
          height={280}
          className="rounded border border-gray-200 dark:border-gray-600"
          unoptimized
        />
      </div>

      <div className="flex items-center justify-center gap-2 text-gray-700 dark:text-gray-300">
        {[
          { label: '⏮', action: () => setMoveIdx(-1),                              disabled: moveIdx === -1        },
          { label: '◀', action: () => setMoveIdx(i => Math.max(-1, i - 1)),         disabled: moveIdx === -1        },
          { label: '▶', action: () => setMoveIdx(i => Math.min(total - 1, i + 1)),  disabled: moveIdx === total - 1 },
          { label: '⏭', action: () => setMoveIdx(total - 1),                        disabled: moveIdx === total - 1 },
        ].map(({ label, action, disabled }) => (
          <button
            key={label}
            onClick={action}
            disabled={disabled}
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-default text-lg transition-colors"
          >
            {label}
          </button>
        ))}
        <span className="text-xs tabular-nums text-gray-500 dark:text-gray-400 ml-1 w-16 text-center">
          {moveIdx === -1 ? 'Start' : `${moveIdx + 1} / ${total}`}
        </span>
      </div>

      {movePairs.length > 0 && (
        <div className="max-h-28 overflow-y-auto border border-gray-200 dark:border-gray-600 rounded text-xs font-mono">
          {movePairs.map(({ white, black, pairIdx }) => {
            const whiteIdx = pairIdx * 2;
            const blackIdx = pairIdx * 2 + 1;
            return (
              <div key={pairIdx} className="flex items-center border-b border-gray-100 dark:border-gray-700 last:border-0">
                <span className="w-8 px-2 py-1 text-gray-400 select-none shrink-0">{pairIdx + 1}.</span>
                <button
                  onClick={() => setMoveIdx(whiteIdx)}
                  className={`flex-1 text-left px-2 py-1 transition-colors ${
                    moveIdx === whiteIdx
                      ? 'bg-purple-100 dark:bg-purple-900/50 text-purple-800 dark:text-purple-200'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                  }`}
                >
                  {white}
                </button>
                {black !== undefined ? (
                  <button
                    onClick={() => setMoveIdx(blackIdx)}
                    className={`flex-1 text-left px-2 py-1 transition-colors ${
                      moveIdx === blackIdx
                        ? 'bg-purple-100 dark:bg-purple-900/50 text-purple-800 dark:text-purple-200'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {black}
                  </button>
                ) : (
                  <div className="flex-1" />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Interactive move section card ────────────────────────────────────────────

export function MoveSectionCard({ section }: { section: MoveSection }) {
  const hasPuzzle   = !!section.moveNotation;
  const hasBoard    = !!section.fen;
  const canInteract = hasPuzzle && hasBoard; // interactive board requires both

  const [phase, setPhase]         = useState<SectionPhase>(hasPuzzle ? 'puzzle' : 'complete');
  const [boardFen, setBoardFen]   = useState<string>(section.fen ?? 'start');
  const [feedback, setFeedback]   = useState<'correct' | 'wrong' | null>(null);
  const [boardWidth, setBoardWidth] = useState(280);

  // Text-input fallback (when there's a move notation but no FEN)
  const [guess, setGuess]         = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Measure container to size the board responsively
  const boardContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!boardContainerRef.current) return;
    const obs = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setBoardWidth(Math.min(Math.floor(w), 360));
    });
    obs.observe(boardContainerRef.current);
    return () => obs.disconnect();
  }, []);

  const quality = section.engineEval
    ? (QUALITY_STYLE[section.engineEval.moveQuality] ?? null)
    : null;

  const isPuzzleActive = phase === 'puzzle' || phase === 'thinking_shown';

  // ── Click-to-move state ──────────────────────────────────────────────────
  const [selectedSquare, setSelectedSquare]     = useState<string | null>(null);
  const [highlightSquares, setHighlightSquares] = useState<Record<string, React.CSSProperties>>({});

  // ── Square-click handler (click-to-select → click-to-move) ──────────────
  const handleSquareClick = ({
    piece,
    square,
  }: {
    piece: { pieceType: string } | null;
    square: string;
  }) => {
    if (!section.moveNotation || !section.fen || !isPuzzleActive) return;

    const isOwnPiece = (p: { pieceType: string } | null) =>
      !!p && (section.userColor === 'white' ? p.pieceType.startsWith('w') : p.pieceType.startsWith('b'));

    // Build highlight map for a square's legal moves
    const buildHighlights = (sq: string): Record<string, React.CSSProperties> => {
      const c = new Chess(section.fen!);
      const moves = c.moves({ square: sq as Parameters<typeof c.moves>[0]['square'], verbose: true });
      const h: Record<string, React.CSSProperties> = {
        [sq]: { backgroundColor: 'rgba(255, 215, 0, 0.55)' },
      };
      (moves as { to: string }[]).forEach(m => {
        h[m.to] = { background: 'radial-gradient(circle, rgba(0,0,0,0.18) 29%, transparent 30%)' };
      });
      return h;
    };

    // Tap the already-selected square → deselect
    if (square === selectedSquare) {
      setSelectedSquare(null);
      setHighlightSquares({});
      return;
    }

    if (selectedSquare !== null) {
      // Attempt the move
      try {
        const chess = new Chess(section.fen);
        const move  = chess.move({ from: selectedSquare, to: square, promotion: 'q' });

        if (move) {
          setSelectedSquare(null);
          setHighlightSquares({});
          if (normSan(move.san) === normSan(section.moveNotation)) {
            setBoardFen(chess.fen());
            setFeedback('correct');
            setPhase(phase === 'puzzle' ? 'solved_blind' : 'complete');
          } else {
            setFeedback('wrong');
          }
          return;
        }
      } catch { /* fall through to re-select logic */ }

      // Not a valid move — re-select if it's another own piece, otherwise deselect
      if (isOwnPiece(piece)) {
        setSelectedSquare(square);
        setHighlightSquares(buildHighlights(square));
      } else {
        setSelectedSquare(null);
        setHighlightSquares({});
      }
      return;
    }

    // Nothing selected yet — select own piece
    if (isOwnPiece(piece)) {
      setSelectedSquare(square);
      setHighlightSquares(buildHighlights(square));
    }
  };

  // ── Text-input fallback handler ─────────────────────────────────────────
  const checkTextGuess = () => {
    if (!section.moveNotation || !guess.trim()) return;
    if (normSan(guess) === normSan(section.moveNotation)) {
      setFeedback('correct');
      setPhase(phase === 'puzzle' ? 'solved_blind' : 'complete');
    } else {
      setFeedback('wrong');
    }
  };

  // Hide move notation in the header until the move has been identified
  const displayHeader = (() => {
    if (!hasPuzzle || phase === 'complete' || phase === 'solved_blind') return section.header;
    const match = section.header.match(/^(Move \d+)/);
    return match ? match[1] : section.header;
  })();

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="bg-gray-50 dark:bg-gray-700 px-4 py-2 flex items-center justify-between border-b border-gray-200 dark:border-gray-600">
        <span className="font-semibold text-sm text-gray-800 dark:text-gray-200">
          {displayHeader}
        </span>
        <span className="text-xs text-gray-400">
          {new Date(section.timestamp).toLocaleString([], {
            month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
          })}
        </span>
      </div>

      <div className="p-4 space-y-3">

        {/* ── Opponent's last move label ───────────────────────────── */}
        {section.opponentLastMove && (
          <p className="text-xs text-center text-gray-500 dark:text-gray-400">
            Opponent played{' '}
            <span className="font-mono font-medium">{section.opponentLastMove}</span>
          </p>
        )}

        {/* ── Interactive board (puzzle phases) ───────────────────── */}
        {canInteract && isPuzzleActive && (
          <div ref={boardContainerRef} className="flex justify-center">
            {/* Width-capped container; board fills it via CSS grid */}
            <div style={{ width: boardWidth, cursor: 'pointer' }}>
              <Chessboard
                options={{
                  position:          boardFen,
                  boardOrientation:  section.userColor,
                  allowDragging:     false,
                  allowDrawingArrows: false,
                  onSquareClick:     handleSquareClick,
                  squareStyles:      highlightSquares,
                  boardStyle:        { borderRadius: '4px', border: '1px solid #d1d5db' },
                }}
              />
            </div>
          </div>
        )}

        {/* ── Static board (non-puzzle or after solving) ──────────── */}
        {section.fen && (!canInteract || !isPuzzleActive) && (
          <div className="flex justify-center">
            <Image
              src={`/api/board-image?fen=${encodeURIComponent(section.fen)}&pov=${section.userColor}`}
              alt={`Board position: ${section.fen}`}
              width={240}
              height={240}
              className="rounded border border-gray-200 dark:border-gray-600"
              unoptimized
            />
          </div>
        )}

        {/* ── Feedback banner ──────────────────────────────────────── */}
        {feedback === 'correct' && (
          <p className="text-xs text-green-600 dark:text-green-400 font-medium">✓ Correct!</p>
        )}
        {feedback === 'wrong' && isPuzzleActive && (
          <p className="text-xs text-red-600 dark:text-red-400">
            ✗ Not quite — try a different move.
          </p>
        )}

        {/* ── Puzzle controls ───────────────────────────────────────── */}
        {isPuzzleActive && (
          <div className="space-y-2">
            {/* Text-input fallback when no FEN is stored */}
            {hasPuzzle && !hasBoard && (
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={guess}
                  onChange={e => { setGuess(e.target.value); setFeedback(null); }}
                  onKeyDown={e => e.key === 'Enter' && checkTextGuess()}
                  placeholder="Your move (e.g. Nf3)"
                  className="flex-1 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-400"
                />
                <button
                  onClick={checkTextGuess}
                  disabled={!guess.trim()}
                  className="px-3 py-1.5 text-sm bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white rounded-lg transition-colors"
                >
                  Check
                </button>
              </div>
            )}

            {/* Reveal / give-up buttons */}
            <div className="flex gap-2 flex-wrap">
              {phase === 'puzzle' && (
                <button
                  onClick={() => {
                    setPhase('thinking_shown');
                    setFeedback(null);
                    setSelectedSquare(null);
                    setHighlightSquares({});
                  }}
                  className="text-xs px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors"
                >
                  💭 Reveal thinking
                </button>
              )}
              {phase === 'thinking_shown' && (
                <button
                  onClick={() => setPhase('complete')}
                  className="text-xs px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors"
                >
                  🏳 Give up — see analysis
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Thinking ─────────────────────────────────────────────── */}
        {(phase === 'thinking_shown' || phase === 'solved_blind' || phase === 'complete') && (
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              💭 My thinking
            </p>
            <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
              {section.thinking}
            </p>
            {section.moveNotation && (phase === 'thinking_shown' || phase === 'solved_blind') && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Move played:{' '}
                <span className="font-mono font-medium text-gray-700 dark:text-gray-300">
                  {section.moveNotation}
                </span>
              </p>
            )}
          </div>
        )}

        {/* ── solved_blind: show post-game analysis on demand ──────── */}
        {phase === 'solved_blind' && (
          <button
            onClick={() => setPhase('complete')}
            className="text-xs px-3 py-1.5 border border-amber-300 dark:border-amber-600 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/30 text-amber-700 dark:text-amber-300 transition-colors"
          >
            📊 Show post-game analysis
          </button>
        )}

        {/* ── Full analysis ─────────────────────────────────────────── */}
        {phase === 'complete' && (
          <>
            {section.engineEval && quality && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs bg-gray-50 dark:bg-gray-700 rounded px-3 py-2">
                <span className={`font-semibold ${quality.color}`}>{quality.label}</span>
                <span className="text-gray-300 dark:text-gray-500">·</span>
                <span className="text-gray-600 dark:text-gray-400">
                  {section.engineEval.centipawnLoss} cp loss
                </span>
              </div>
            )}

            {section.engineEval != null && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-500 dark:text-gray-400">📊 Position eval:</span>
                <span className="font-mono font-semibold text-gray-800 dark:text-gray-200">
                  {formatEval(section.engineEval.evaluation)}
                </span>
                <span className="text-gray-400">
                  {section.engineEval.evaluation > 0
                    ? '(White ahead)'
                    : section.engineEval.evaluation < 0
                    ? '(Black ahead)'
                    : '(Equal)'}
                </span>
              </div>
            )}

            {section.aiReview && (
              <div>
                <p className="text-xs font-medium text-cyan-600 dark:text-cyan-400 mb-1">
                  🤖 AI analysis
                </p>
                <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed italic">
                  {section.aiReview}
                </p>
              </div>
            )}

            {section.postReview && (
              <div>
                <p className="text-xs font-medium text-amber-600 dark:text-amber-400 mb-1">
                  📝 My post-game analysis
                </p>
                <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                  {section.postReview}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
