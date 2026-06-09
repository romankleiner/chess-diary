'use client';

/**
 * Shared types, constants, and interactive components used by both
 * BlogPostModal (in-app modal) and /blog/[gameId] (public page).
 */

import { useRef, useState, useMemo } from 'react';
import Image from 'next/image';
import { Chess } from 'chess.js';

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

// 'puzzle'          — board + timestamp shown; guess input active
// 'thinking_shown'  — thinking revealed manually; can still guess or give up
// 'solved_blind'    — guessed correctly without peeking; thinking shown,
//                     AI/post-game still hidden
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

export function MoveSectionCard({
  section,
}: {
  section: MoveSection;
}) {
  const hasPuzzle = !!section.moveNotation;

  const [phase, setPhase]       = useState<SectionPhase>(hasPuzzle ? 'puzzle' : 'complete');
  const [guess, setGuess]       = useState('');
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const quality = section.engineEval
    ? (QUALITY_STYLE[section.engineEval.moveQuality] ?? null)
    : null;

  const checkGuess = () => {
    if (!section.moveNotation || !guess.trim()) return;
    if (normSan(guess) === normSan(section.moveNotation)) {
      setFeedback('correct');
      // Guessed without peeking → reveal thinking first, post-game behind a button.
      // Already peeked (thinking_shown) → skip straight to complete.
      setPhase(phase === 'puzzle' ? 'solved_blind' : 'complete');
    } else {
      setFeedback('wrong');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') checkGuess();
  };

  // Hide notation until the move has been identified (solved_blind or complete).
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

        {/* ── Board diagram ────────────────────────────────────────── */}
        {section.fen && (
          <div className="space-y-1">
            {section.opponentLastMove && (
              <p className="text-xs text-center text-gray-500 dark:text-gray-400">
                Opponent played <span className="font-mono font-medium">{section.opponentLastMove}</span>
              </p>
            )}
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
          </div>
        )}

        {/* ── Puzzle: guess input ──────────────────────────────────── */}
        {hasPuzzle && (phase === 'puzzle' || phase === 'thinking_shown') && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={guess}
                onChange={e => { setGuess(e.target.value); setFeedback(null); }}
                onKeyDown={handleKeyDown}
                placeholder="Your move (e.g. Nf3)"
                className="flex-1 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-purple-400"
              />
              <button
                onClick={checkGuess}
                disabled={!guess.trim()}
                className="px-3 py-1.5 text-sm bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white rounded-lg transition-colors"
              >
                Check
              </button>
            </div>

            {feedback === 'wrong' && (
              <p className="text-xs text-red-600 dark:text-red-400">
                ✗ Not quite — try again, or reveal thinking below.
              </p>
            )}

            <div className="flex gap-2 flex-wrap">
              {phase === 'puzzle' && (
                <button
                  onClick={() => setPhase('thinking_shown')}
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

        {/* ── Correct guess banner ─────────────────────────────────── */}
        {feedback === 'correct' && (
          <p className="text-xs text-green-600 dark:text-green-400 font-medium">
            ✓ Correct!
          </p>
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

        {/* ── solved_blind: reveal post-game on demand ─────────────── */}
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
