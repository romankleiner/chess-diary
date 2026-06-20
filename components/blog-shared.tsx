'use client';

/**
 * Shared types, constants, and interactive components used by both
 * BlogPostModal (in-app modal) and /blog/[gameId] (public page).
 */

import React, { useRef, useState, useMemo, useEffect, useCallback, useId } from 'react';
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
  plyIndex: number | null;          // 0-based ply of this move in the game PGN, null if unmatched
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

  const [phase, setPhase]           = useState<SectionPhase>(hasPuzzle ? 'puzzle' : 'complete');
  const [boardFen, setBoardFen]     = useState<string>(section.fen ?? 'start');
  const [feedback, setFeedback]     = useState<'correct' | 'wrong' | null>(null);
  const [boardWidth, setBoardWidth] = useState(280);

  // Text-input fallback (when there's a move notation but no FEN)
  const [guess, setGuess] = useState('');
  const inputRef          = useRef<HTMLInputElement>(null);

  // Click-to-move selection state
  const [selectedSquare, setSelectedSquare]         = useState<string | null>(null);
  const [highlightSquares, setHighlightSquares]     = useState<Record<string, React.CSSProperties>>({});
  // Persistent move highlight shown after a move is played (green = correct, red = wrong)
  const [moveHighlight, setMoveHighlight]           = useState<Record<string, React.CSSProperties>>({});
  const wrongMoveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Clear the wrong-move revert timer on unmount
  useEffect(() => () => {
    if (wrongMoveTimerRef.current) clearTimeout(wrongMoveTimerRef.current);
  }, []);

  const quality = section.engineEval
    ? (QUALITY_STYLE[section.engineEval.moveQuality] ?? null)
    : null;

  const isPuzzleActive = phase === 'puzzle' || phase === 'thinking_shown';

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
      !!p && (section.userColor === 'white'
        ? p.pieceType.startsWith('w')
        : p.pieceType.startsWith('b'));

    // Highlight the selected square + its legal destinations
    const buildSelectionHighlights = (sq: string): Record<string, React.CSSProperties> => {
      const c     = new Chess(section.fen!);
      const moves = c.moves({ square: sq as Parameters<typeof c.moves>[0]['square'], verbose: true });
      const h: Record<string, React.CSSProperties> = {
        [sq]: { backgroundColor: 'rgba(255, 215, 0, 0.55)' },
      };
      (moves as { to: string }[]).forEach(m => {
        h[m.to] = { background: 'radial-gradient(circle, rgba(0,0,0,0.18) 29%, transparent 30%)' };
      });
      return h;
    };

    // Cancel any pending wrong-move revert when the user makes a new selection
    if (wrongMoveTimerRef.current) {
      clearTimeout(wrongMoveTimerRef.current);
      wrongMoveTimerRef.current = null;
      setBoardFen(section.fen);
      setMoveHighlight({});
    }

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

          const fromSq = selectedSquare; // capture before state update
          if (normSan(move.san) === normSan(section.moveNotation)) {
            // ── Correct ─────────────────────────────────────────────
            setBoardFen(chess.fen());
            setMoveHighlight({
              [fromSq]: { backgroundColor: 'rgba(80, 200, 100, 0.55)' },
              [square]: { backgroundColor: 'rgba(80, 200, 100, 0.55)' },
            });
            setFeedback('correct');
            setPhase(phase === 'puzzle' ? 'solved_blind' : 'complete');
          } else {
            // ── Wrong — show result briefly then revert ─────────────
            setBoardFen(chess.fen());
            setMoveHighlight({
              [fromSq]: { backgroundColor: 'rgba(220, 60, 60, 0.45)' },
              [square]: { backgroundColor: 'rgba(220, 60, 60, 0.45)' },
            });
            setFeedback('wrong');
            wrongMoveTimerRef.current = setTimeout(() => {
              setBoardFen(section.fen!);
              setMoveHighlight({});
              wrongMoveTimerRef.current = null;
            }, 900);
          }
          return;
        }
      } catch { /* fall through to re-select logic */ }

      // Not a valid chess move — re-select if another own piece, otherwise deselect
      if (isOwnPiece(piece)) {
        setSelectedSquare(square);
        setHighlightSquares(buildSelectionHighlights(square));
        setFeedback(null);
      } else {
        setSelectedSquare(null);
        setHighlightSquares({});
      }
      return;
    }

    // Nothing selected yet — select own piece (also clears previous wrong-move feedback)
    if (isOwnPiece(piece)) {
      setSelectedSquare(square);
      setHighlightSquares(buildSelectionHighlights(square));
      setFeedback(null);
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

        {/* ── Interactive/display board (all puzzle sections) ─────── */}
        {/* Stays mounted after solving so position + highlights are preserved. */}
        {canInteract && (
          <div ref={boardContainerRef} className="flex justify-center">
            <div style={{ width: boardWidth, cursor: isPuzzleActive ? 'pointer' : 'default' }}>
              <Chessboard
                options={{
                  position:           boardFen,
                  boardOrientation:   section.userColor,
                  allowDragging:      false,
                  allowDrawingArrows: false,
                  // Active: respond to clicks; solved: board is display-only
                  ...(isPuzzleActive && { onSquareClick: handleSquareClick }),
                  // Selection dots take visual priority over move highlight
                  squareStyles: { ...moveHighlight, ...highlightSquares },
                  boardStyle:   { borderRadius: '4px', border: '1px solid #d1d5db' },
                }}
              />
            </div>
          </div>
        )}

        {/* ── Static board (sections without a puzzle) ────────────── */}
        {section.fen && !canInteract && (
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
            {/* AI analysis */}
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

            {/* Post-game analysis — eval shown in header, same style as journal */}
            {(section.postReview || section.engineEval) && (
              <div>
                <p className="text-xs font-medium text-amber-600 dark:text-amber-400 mb-0.5">
                  📝 My post-game analysis
                </p>
                {section.engineEval && (
                  <p className="text-xs text-amber-600/70 dark:text-amber-400/70 mb-1">
                    {formatEval(section.engineEval.evaluation)}
                    {quality && (
                      <span className={`ml-1 ${quality.color}`}>· {section.engineEval.moveQuality}</span>
                    )}
                    {section.engineEval.centipawnLoss > 0 && (
                      <span className="text-amber-600/70 dark:text-amber-400/70">
                        {' '}· {section.engineEval.centipawnLoss} cp
                      </span>
                    )}
                  </p>
                )}
                {section.postReview && (
                  <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                    {section.postReview}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Game walkthrough ─────────────────────────────────────────────────────────
// The full game is the backbone of the blog: the reader steps through the game
// from move 1 on per-entry boards. Wherever the author recorded a thought,
// playback pauses and the reader must guess the move before the entry's
// content (and the next stretch of the game) unlocks.

interface ParsedGame {
  fens: string[];                        // fens[i] = position before ply i
  sans: string[];                        // sans[i] = SAN of ply i
  moves: { from: string; to: string }[]; // from/to squares per ply
}

function parseGame(pgn: string): ParsedGame | null {
  try {
    const chess = new Chess();
    chess.loadPgn(pgn);
    const verbose = chess.history({ verbose: true });
    if (verbose.length === 0) return null;
    return {
      fens:  [verbose[0].before, ...verbose.map((m: any) => m.after as string)],
      sans:  verbose.map((m: any) => m.san as string),
      moves: verbose.map((m: any) => ({ from: m.from as string, to: m.to as string })),
    };
  } catch {
    return null;
  }
}

// Responsive board sizing shared by walkthrough cards.
// Uses a callback ref so the observer attaches whenever the measured node
// mounts — a plain useEffect+useRef would miss cards that start locked and
// only render their board (and ref target) once unlocked.
function useBoardWidth(max = 360) {
  const [width, setWidth] = useState(280);
  const obsRef = useRef<ResizeObserver | null>(null);
  const ref = useCallback((node: HTMLDivElement | null) => {
    obsRef.current?.disconnect();
    obsRef.current = null;
    if (node) {
      const obs = new ResizeObserver(entries => {
        const w = entries[0]?.contentRect.width;
        if (w && w > 0) setWidth(Math.min(Math.floor(w), max));
      });
      obs.observe(node);
      obsRef.current = obs;
    }
  }, [max]);
  return { ref, width };
}

// Header with the move notation stripped (shown before the move is known)
function maskedHeader(section: MoveSection): string {
  return section.header.match(/^(Move \d+)/)?.[1] ?? section.header;
}

function LockedCard({ title }: { title: string }) {
  return (
    <div className="border border-dashed border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 flex items-center justify-between opacity-70">
      <span className="font-semibold text-sm text-gray-500 dark:text-gray-400">{title}</span>
      <span className="text-xs text-gray-400 dark:text-gray-500">🔒 Keep playing to unlock</span>
    </div>
  );
}

// Step controls (⏮ ◀ ▶ ⏭) over a fen-index range
function StepControls({ viewIdx, minIdx, maxIdx, goTo }: {
  viewIdx: number;
  minIdx: number;
  maxIdx: number;
  goTo: (idx: number) => void;
}) {
  return (
    <div className="flex items-center justify-center gap-2.5 text-gray-700 dark:text-gray-300">
      {[
        { label: '⏮', action: () => goTo(minIdx),      disabled: viewIdx === minIdx },
        { label: '◀', action: () => goTo(viewIdx - 1), disabled: viewIdx === minIdx },
        { label: '▶', action: () => goTo(viewIdx + 1), disabled: viewIdx === maxIdx },
        { label: '⏭', action: () => goTo(maxIdx),      disabled: viewIdx === maxIdx },
      ].map(({ label, action, disabled }) => (
        <button
          key={label}
          onClick={action}
          disabled={disabled}
          className="w-12 h-12 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-default text-2xl transition-colors"
        >
          {label}
        </button>
      ))}
      <span className="text-sm tabular-nums text-gray-500 dark:text-gray-400 ml-1 w-14 text-center">
        {viewIdx - minIdx} / {maxIdx - minIdx}
      </span>
    </div>
  );
}

// Inline SAN chips for a ply range; clicking jumps to the position after that ply
function MoveChips({ game, fromPly, toPly, viewIdx, goTo, guessPly, guessColor }: {
  game: ParsedGame;
  fromPly: number;
  toPly: number;
  viewIdx: number;
  goTo: (idx: number) => void;
  guessPly?: number;
  guessColor?: 'green' | 'amber';
}) {
  if (toPly < fromPly) return null;
  const plies = Array.from({ length: toPly - fromPly + 1 }, (_, k) => fromPly + k);
  return (
    <div className="flex flex-wrap gap-1 justify-center text-xs font-mono">
      {plies.map(p => {
        const num = Math.floor(p / 2) + 1;
        const label =
          p % 2 === 0     ? `${num}. ${game.sans[p]}` :
          p === fromPly   ? `${num}… ${game.sans[p]}` :
          game.sans[p];
        const isCurrent = viewIdx === p + 1;
        const guessCls = guessColor === 'amber'
          ? 'text-amber-700 dark:text-amber-300 font-semibold'
          : 'text-green-700 dark:text-green-300 font-semibold';
        return (
          <button
            key={p}
            onClick={() => goTo(p + 1)}
            className={`px-1.5 py-0.5 rounded transition-colors ${
              isCurrent
                ? 'bg-purple-100 dark:bg-purple-900/50 text-purple-800 dark:text-purple-200'
                : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400'
            } ${p === guessPly ? guessCls : ''}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// Engine check shown once the move is revealed: the evaluation of the resulting
// position and, separately, how far the move fell short of the engine's best.
function EvalCallout({ engineEval }: { engineEval: EngineEval }) {
  const quality = QUALITY_STYLE[engineEval.moveQuality] ?? null;
  const lost    = engineEval.centipawnLoss;
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-3 space-y-1.5">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">⚙️ Engine check</p>

      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-gray-600 dark:text-gray-400">Evaluation of the position</span>
        <span className="font-mono font-semibold text-gray-800 dark:text-gray-200">
          {formatEval(engineEval.evaluation)}
        </span>
      </div>

      <div className="flex items-baseline justify-between gap-3 text-sm border-t border-gray-200 dark:border-gray-700 pt-1.5">
        <span className="text-gray-600 dark:text-gray-400">My move vs. the engine&apos;s best</span>
        {lost > 0 ? (
          <span className={`font-mono font-semibold ${quality?.color ?? 'text-gray-700 dark:text-gray-300'}`}>
            −{(lost / 100).toFixed(2)} <span className="font-normal">({lost} cp)</span>
          </span>
        ) : (
          <span className="font-mono font-semibold text-green-600 dark:text-green-400">
            best move
          </span>
        )}
      </div>
      {quality && lost > 0 && (
        <p className={`text-[11px] ${quality.color} text-right`}>{quality.label}</p>
      )}
    </div>
  );
}

// Entry content blocks (thinking / analysis), gated by phase
function SectionBody({ section, phase, onShowAnalysis }: {
  section: MoveSection;
  phase: SectionPhase;
  onShowAnalysis: () => void;
}) {
  if (phase === 'puzzle') return null;
  const resolved = phase === 'solved_blind' || phase === 'complete';
  return (
    <>
      <div>
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
          💭 My thinking
        </p>
        <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
          {section.thinking}
        </p>
        {section.moveNotation && phase === 'solved_blind' && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Move played:{' '}
            <span className="font-mono font-medium text-gray-700 dark:text-gray-300">
              {section.moveNotation}
            </span>
          </p>
        )}
      </div>

      {/* Engine eval + diff, shown as soon as the move is revealed */}
      {resolved && section.engineEval && <EvalCallout engineEval={section.engineEval} />}

      {phase === 'solved_blind' && (
        <button
          onClick={onShowAnalysis}
          className="text-xs px-3 py-1.5 border border-amber-300 dark:border-amber-600 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/30 text-amber-700 dark:text-amber-300 transition-colors"
        >
          📊 Show post-game analysis
        </button>
      )}

      {phase === 'complete' && (
        <>
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
              <p className="text-xs font-medium text-amber-600 dark:text-amber-400 mb-0.5">
                📝 My post-game analysis
              </p>
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                {section.postReview}
              </p>
            </div>
          )}
        </>
      )}
    </>
  );
}

// ─── Walkthrough move card ────────────────────────────────────────────────────
// One journal entry anchored to a ply. The reader steps through the moves since
// the previous entry (startPly … guessPly-1), then guesses the author's move at
// guessPly. Resolving (correct guess or give-up) reveals the entry content and
// unlocks the next card via onResolved.

function WalkthroughMoveCard({ section, game, startPly, guessPly, state, onResolved }: {
  section: MoveSection;
  game: ParsedGame;
  startPly: number;
  guessPly: number;
  state: 'locked' | 'active' | 'done';
  onResolved: () => void;
}) {
  const [phase, setPhase]             = useState<SectionPhase>('puzzle');
  const [viewIdx, setViewIdx]         = useState(startPly);
  const [tempFen, setTempFen]         = useState<string | null>(null);
  const [feedback, setFeedback]       = useState<'correct' | 'wrong' | null>(null);
  const [resolvedHow, setResolvedHow] = useState<'guessed' | 'revealed' | null>(null);

  const [selectedSquare, setSelectedSquare]   = useState<string | null>(null);
  const [selHighlights, setSelHighlights]     = useState<Record<string, React.CSSProperties>>({});
  const [flashHighlights, setFlashHighlights] = useState<Record<string, React.CSSProperties>>({});
  const wrongMoveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { ref: boardRef, width: boardWidth } = useBoardWidth();
  // Unique per card — keeps each board's drag/animation state isolated so
  // multiple mounted boards don't interfere (jerky animation otherwise).
  const boardId = `wt-${useId().replace(/:/g, '')}`;

  // Clear the wrong-move revert timer on unmount
  useEffect(() => () => {
    if (wrongMoveTimerRef.current) clearTimeout(wrongMoveTimerRef.current);
  }, []);

  const resolved    = resolvedHow !== null;
  const maxIdx      = resolved ? guessPly + 1 : guessPly;
  const atPuzzle    = state !== 'locked' && !resolved && viewIdx === guessPly;
  const fenBefore   = game.fens[guessPly];
  const expectedSan = game.sans[guessPly];
  const boardFen    = tempFen ?? game.fens[viewIdx];

  // Green (guessed) / amber (revealed) highlight on the journal move, shown
  // only while viewing the position right after it.
  const resolvedHl: Record<string, React.CSSProperties> = {};
  if (resolved && viewIdx === guessPly + 1 && !tempFen) {
    const { from, to } = game.moves[guessPly];
    const color = resolvedHow === 'guessed' ? 'rgba(80, 200, 100, 0.55)' : 'rgba(255, 200, 60, 0.5)';
    resolvedHl[from] = { backgroundColor: color };
    resolvedHl[to]   = { backgroundColor: color };
  }

  const clearTransient = () => {
    if (wrongMoveTimerRef.current) {
      clearTimeout(wrongMoveTimerRef.current);
      wrongMoveTimerRef.current = null;
    }
    setTempFen(null);
    setFlashHighlights({});
    setSelectedSquare(null);
    setSelHighlights({});
  };

  const goTo = (idx: number) => {
    clearTransient();
    setFeedback(null);
    setViewIdx(Math.max(startPly, Math.min(maxIdx, idx)));
  };

  const resolve = (how: 'guessed' | 'revealed', nextPhase: SectionPhase) => {
    clearTransient();
    setResolvedHow(how);
    setPhase(nextPhase);
    setViewIdx(guessPly + 1);
    onResolved();
  };

  const isOwnColor = (pieceType: string) =>
    section.userColor === 'white' ? pieceType.startsWith('w') : pieceType.startsWith('b');

  // Cancel any pending wrong-move revert when the user interacts again
  const cancelPendingRevert = () => {
    if (wrongMoveTimerRef.current) {
      clearTimeout(wrongMoveTimerRef.current);
      wrongMoveTimerRef.current = null;
      setTempFen(null);
      setFlashHighlights({});
    }
  };

  // Try from→to as the puzzle answer. Shared by click-to-move and drag-and-drop.
  const attemptMove = (from: string, to: string): 'correct' | 'wrong' | 'illegal' => {
    let move;
    try {
      const chess = new Chess(fenBefore);
      move = chess.move({ from, to, promotion: 'q' });
      if (!move) return 'illegal';

      if (normSan(move.san) === normSan(expectedSan)) {
        setFeedback('correct');
        resolve('guessed', phase === 'puzzle' ? 'solved_blind' : 'complete');
        return 'correct';
      }
      // Wrong — show the attempted move briefly in red, then revert
      setTempFen(chess.fen());
      setFlashHighlights({
        [from]: { backgroundColor: 'rgba(220, 60, 60, 0.45)' },
        [to]:   { backgroundColor: 'rgba(220, 60, 60, 0.45)' },
      });
      setFeedback('wrong');
      if (wrongMoveTimerRef.current) clearTimeout(wrongMoveTimerRef.current);
      wrongMoveTimerRef.current = setTimeout(() => {
        setTempFen(null);
        setFlashHighlights({});
        wrongMoveTimerRef.current = null;
      }, 900);
      return 'wrong';
    } catch {
      return 'illegal';
    }
  };

  // ── Drag-and-drop handler ───────────────────────────────────────────────
  const handlePieceDrop = ({ sourceSquare, targetSquare }: {
    piece: { pieceType: string };
    sourceSquare: string;
    targetSquare: string | null;
  }): boolean => {
    if (!atPuzzle || !targetSquare) return false;
    cancelPendingRevert();
    setSelectedSquare(null);
    setSelHighlights({});
    return attemptMove(sourceSquare, targetSquare) !== 'illegal';
  };

  // ── Square-click handler (click-to-select → click-to-move) ──────────────
  const handleSquareClick = ({ piece, square }: {
    piece: { pieceType: string } | null;
    square: string;
  }) => {
    if (!atPuzzle) return;

    const isOwnPiece = (p: { pieceType: string } | null) => !!p && isOwnColor(p.pieceType);

    const buildSelectionHighlights = (sq: string): Record<string, React.CSSProperties> => {
      const c     = new Chess(fenBefore);
      const moves = c.moves({ square: sq as Parameters<typeof c.moves>[0]['square'], verbose: true });
      const h: Record<string, React.CSSProperties> = {
        [sq]: { backgroundColor: 'rgba(255, 215, 0, 0.55)' },
      };
      (moves as { to: string }[]).forEach(m => {
        h[m.to] = { background: 'radial-gradient(circle, rgba(0,0,0,0.18) 29%, transparent 30%)' };
      });
      return h;
    };

    cancelPendingRevert();

    // Tap the already-selected square → deselect
    if (square === selectedSquare) {
      setSelectedSquare(null);
      setSelHighlights({});
      return;
    }

    if (selectedSquare !== null) {
      const outcome = attemptMove(selectedSquare, square);
      if (outcome !== 'illegal') {
        setSelectedSquare(null);
        setSelHighlights({});
        return;
      }
      // Not a legal move — re-select if another own piece, otherwise deselect
      if (isOwnPiece(piece)) {
        setSelectedSquare(square);
        setSelHighlights(buildSelectionHighlights(square));
        setFeedback(null);
      } else {
        setSelectedSquare(null);
        setSelHighlights({});
      }
      return;
    }

    // Nothing selected yet — select own piece (also clears previous wrong-move feedback)
    if (isOwnPiece(piece)) {
      setSelectedSquare(square);
      setSelHighlights(buildSelectionHighlights(square));
      setFeedback(null);
    }
  };

  if (state === 'locked') return <LockedCard title={maskedHeader(section)} />;

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="bg-gray-50 dark:bg-gray-700 px-4 py-2 flex items-center justify-between border-b border-gray-200 dark:border-gray-600">
        <span className="font-semibold text-sm text-gray-800 dark:text-gray-200">
          {resolved ? section.header : maskedHeader(section)}
        </span>
        <span className="text-xs text-gray-400">
          {new Date(section.timestamp).toLocaleString([], {
            month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
          })}
        </span>
      </div>

      <div className="p-4 space-y-3">

        {/* ── Hints / prompt ───────────────────────────────────────── */}
        {!resolved && viewIdx < guessPly && (
          <p className="text-xs text-center text-gray-500 dark:text-gray-400">
            ▶ Play through the moves to reach my next thought
            {' '}({guessPly - viewIdx} {guessPly - viewIdx === 1 ? 'move' : 'moves'} to go)
          </p>
        )}
        {atPuzzle && (
          <div className="text-center space-y-0.5">
            {section.opponentLastMove && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Opponent played{' '}
                <span className="font-mono font-medium">{section.opponentLastMove}</span>
              </p>
            )}
            <p className="text-sm font-medium text-purple-700 dark:text-purple-300">
              🎯 Find my move on the board
            </p>
          </div>
        )}

        {/* ── Board ────────────────────────────────────────────────── */}
        <div ref={boardRef} className="flex justify-center">
          <div style={{ width: boardWidth, cursor: atPuzzle ? 'pointer' : 'default' }}>
            <Chessboard
              options={{
                id:                 boardId,
                position:           boardFen,
                boardOrientation:   section.userColor,
                allowDragging:      atPuzzle,
                allowDrawingArrows: false,
                ...(atPuzzle && {
                  onSquareClick: handleSquareClick,
                  onPieceDrop:   handlePieceDrop,
                  canDragPiece:  ({ piece }: { piece: { pieceType: string } }) => isOwnColor(piece.pieceType),
                }),
                squareStyles: { ...resolvedHl, ...flashHighlights, ...selHighlights },
                boardStyle:   { borderRadius: '4px', border: '1px solid #d1d5db' },
              }}
            />
          </div>
        </div>

        {/* ── Navigation ───────────────────────────────────────────── */}
        <StepControls viewIdx={viewIdx} minIdx={startPly} maxIdx={maxIdx} goTo={goTo} />
        <MoveChips
          game={game}
          fromPly={startPly}
          toPly={resolved ? guessPly : guessPly - 1}
          viewIdx={viewIdx}
          goTo={goTo}
          guessPly={guessPly}
          guessColor={resolvedHow === 'revealed' ? 'amber' : 'green'}
        />

        {/* ── Feedback banner ──────────────────────────────────────── */}
        {feedback === 'correct' && (
          <p className="text-xs text-green-600 dark:text-green-400 font-medium">
            ✓ Correct — that&apos;s the move I played!
          </p>
        )}
        {feedback === 'wrong' && atPuzzle && (
          <p className="text-xs text-red-600 dark:text-red-400">
            ✗ Not quite — try a different move.
          </p>
        )}

        {/* ── Puzzle controls ──────────────────────────────────────── */}
        {atPuzzle && (
          <div className="flex gap-2 flex-wrap">
            {phase === 'puzzle' && (
              <button
                onClick={() => {
                  setPhase('thinking_shown');
                  setFeedback(null);
                  setSelectedSquare(null);
                  setSelHighlights({});
                }}
                className="text-xs px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors"
              >
                💭 Reveal thinking
              </button>
            )}
            {phase === 'thinking_shown' && (
              <button
                onClick={() => resolve('revealed', 'complete')}
                className="text-xs px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors"
              >
                🏳 Give up — show the move
              </button>
            )}
          </div>
        )}

        <SectionBody
          section={section}
          phase={phase}
          onShowAnalysis={() => setPhase('complete')}
        />
      </div>
    </div>
  );
}

// ─── Tail card: the rest of the game after the last journal entry ─────────────

function TailCard({ game, startPly, userColor, locked, onReachedEnd }: {
  game: ParsedGame;
  startPly: number;
  userColor: 'white' | 'black';
  locked: boolean;
  onReachedEnd?: () => void;
}) {
  const [viewIdx, setViewIdx] = useState(startPly);
  const { ref, width } = useBoardWidth();
  const boardId = `tail-${useId().replace(/:/g, '')}`;
  const maxIdx = game.sans.length;

  if (locked) return <LockedCard title="♟ The rest of the game" />;

  const goTo = (idx: number) => {
    const clamped = Math.max(startPly, Math.min(maxIdx, idx));
    setViewIdx(clamped);
    if (clamped === maxIdx) onReachedEnd?.(); // game fully played through
  };

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <div className="bg-gray-50 dark:bg-gray-700 px-4 py-2 border-b border-gray-200 dark:border-gray-600">
        <span className="font-semibold text-sm text-gray-800 dark:text-gray-200">
          ♟ The rest of the game
        </span>
      </div>
      <div className="p-4 space-y-3">
        <div ref={ref} className="flex justify-center">
          <div style={{ width }}>
            <Chessboard
              options={{
                id:                 boardId,
                position:           game.fens[viewIdx],
                boardOrientation:   userColor,
                allowDragging:      false,
                allowDrawingArrows: false,
                boardStyle: { borderRadius: '4px', border: '1px solid #d1d5db' },
              }}
            />
          </div>
        </div>
        <StepControls viewIdx={viewIdx} minIdx={startPly} maxIdx={maxIdx} goTo={goTo} />
        <MoveChips game={game} fromPly={startPly} toPly={maxIdx - 1} viewIdx={viewIdx} goTo={goTo} />
      </div>
    </div>
  );
}

// ─── Overall summary card ─────────────────────────────────────────────────────

function SummaryCard({ summary }: { summary: string }) {
  return (
    <div className="border border-purple-200 dark:border-purple-800 rounded-lg overflow-hidden">
      <div className="bg-purple-50 dark:bg-purple-900/30 px-4 py-3 border-b border-purple-200 dark:border-purple-800">
        <span className="font-semibold text-sm text-purple-800 dark:text-purple-200">
          ✨ Overall summary
        </span>
      </div>
      <div className="p-4 space-y-3 text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
        {summary.split('\n\n').map((para, i) => (
          <p key={i}>{renderWithBold(para)}</p>
        ))}
      </div>
    </div>
  );
}

// Locked summary — stays sealed until the whole game has been played through,
// with a fast-forward escape hatch for readers who'd rather skip ahead.
function LockedSummaryCard({ onReveal }: { onReveal: () => void }) {
  return (
    <div className="border border-dashed border-purple-300 dark:border-purple-700 rounded-lg px-4 py-3 flex items-center justify-between gap-3">
      <span className="font-semibold text-sm text-purple-600 dark:text-purple-300">
        ✨ Overall summary
      </span>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs text-gray-400 dark:text-gray-500 hidden sm:inline">
          🔒 Unlocks at the end
        </span>
        <button
          onClick={onReveal}
          className="text-xs px-3 py-1.5 border border-purple-300 dark:border-purple-600 rounded-lg hover:bg-purple-50 dark:hover:bg-purple-900/30 text-purple-700 dark:text-purple-300 transition-colors"
        >
          ⏭ Skip to the end
        </button>
      </div>
    </div>
  );
}

// ─── Game walkthrough container ───────────────────────────────────────────────

export function GameWalkthrough({ pgn, sections, userColor, summary = '' }: {
  pgn: string;
  sections: MoveSection[];
  userColor: 'white' | 'black';
  summary?: string;
}) {
  const game = useMemo(() => parseGame(pgn), [pgn]);

  // Chain sections along the game: each anchored section owns the stretch of
  // plies since the previous anchor. Anchors must be strictly increasing;
  // sections that don't anchor cleanly render as plain cards in sequence.
  const items = useMemo(() => {
    let prevPly = -1;
    return sections.map(section => {
      const p = section.plyIndex;
      const anchored =
        game !== null && p != null && p > prevPly && p < game.sans.length && !!section.moveNotation;
      const item = {
        section,
        startPly: prevPly + 1,
        guessPly: anchored ? (p as number) : null,
      };
      if (anchored) prevPly = p as number;
      return item;
    });
  }, [sections, game]);

  const totalPuzzles = items.filter(it => it.guessPly !== null).length;
  const [doneCount, setDoneCount] = useState(0);
  const [revealEnd, setRevealEnd] = useState(false); // fast-forward past the puzzles
  const [tailDone, setTailDone]   = useState(false); // tail stepped to the final move

  // After a move is guessed/revealed, glide to the next board in the reading view.
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const tailRef  = useRef<HTMLDivElement | null>(null);
  const isFirst  = useRef(true);
  useEffect(() => {
    if (isFirst.current) { isFirst.current = false; return; }
    if (doneCount === 0) return;
    // The card whose unlock order === doneCount is the one that just opened up.
    let order = 0, targetIdx = -1;
    for (let i = 0; i < items.length; i++) {
      if (items[i].guessPly !== null) {
        if (order === doneCount) { targetIdx = i; break; }
        order++;
      }
    }
    const el = targetIdx >= 0 ? cardRefs.current[targetIdx] : tailRef.current;
    const t = setTimeout(() => el?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneCount]);

  // Fallback: no parseable PGN or nothing anchored → original flat layout
  if (!game || totalPuzzles === 0) {
    return (
      <>
        {sections.map((section, i) => (
          <MoveSectionCard key={i} section={section} />
        ))}
        {pgn && (
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <div className="bg-gray-50 dark:bg-gray-700 px-4 py-3 border-b border-gray-200 dark:border-gray-600">
              <span className="font-semibold text-sm text-gray-800 dark:text-gray-200">
                ♟ Full Game
              </span>
            </div>
            <div className="p-4">
              <PgnViewer pgn={pgn} userColor={userColor} />
            </div>
          </div>
        )}
        {summary && <SummaryCard summary={summary} />}
      </>
    );
  }

  // prefix[i] = number of anchored items before item i (resolution is strictly
  // sequential, so this doubles as each anchored item's unlock order)
  const prefix: number[] = [];
  {
    let c = 0;
    for (const it of items) {
      prefix.push(c);
      if (it.guessPly !== null) c++;
    }
  }

  const lastGuessPly = Math.max(...items.filter(it => it.guessPly !== null).map(it => it.guessPly as number));
  const tailStart    = lastGuessPly + 1;
  const hasTail      = tailStart < game.sans.length;
  const allDone      = doneCount >= totalPuzzles;
  // "Played through" means every guess is done AND (if there's a tail) the
  // reader has stepped it to the final move. Fast-forward bypasses both.
  const summaryUnlocked = revealEnd || (allDone && (!hasTail || tailDone));

  return (
    <>
      <p className="text-xs text-left text-gray-500 dark:text-gray-400">
        This post follows my game move by move. Wherever I paused to record my thoughts,
        you can try to guess my move — which isn&apos;t necessarily the best one! Reveal what I was
        thinking first, or guess straight away. Afterwards you&apos;ll see my own self-criticism or
        praise from when I reviewed the moment with an engine — and sometimes AI commentary too,
        depending on whether it was any good.
        <span className="ml-1 font-medium tabular-nums">{doneCount}/{totalPuzzles} unlocked</span>
      </p>

      {items.map((it, i) => {
        let inner: React.ReactNode;
        if (it.guessPly !== null) {
          const order = prefix[i];
          const state = order > doneCount ? 'locked' : order < doneCount ? 'done' : 'active';
          inner = (
            <WalkthroughMoveCard
              section={it.section}
              game={game}
              startPly={it.startPly}
              guessPly={it.guessPly}
              state={state}
              onResolved={() => setDoneCount(c => c + 1)}
            />
          );
        } else {
          inner = prefix[i] <= doneCount
            ? <MoveSectionCard section={it.section} />
            : <LockedCard title={maskedHeader(it.section)} />;
        }
        return (
          <div key={i} ref={el => { cardRefs.current[i] = el; }} className="scroll-mt-4">
            {inner}
          </div>
        );
      })}

      {hasTail && (
        <div ref={tailRef} className="scroll-mt-4">
          <TailCard
            game={game}
            startPly={tailStart}
            userColor={userColor}
            locked={!allDone && !revealEnd}
            onReachedEnd={() => setTailDone(true)}
          />
        </div>
      )}

      {/* Overall summary — sealed until the game is played through (or skipped) */}
      {summary && (
        summaryUnlocked
          ? <SummaryCard summary={summary} />
          : <LockedSummaryCard onReveal={() => setRevealEnd(true)} />
      )}
    </>
  );
}
