'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { Chess } from 'chess.js';

interface BlogPostModalProps {
  gameId: string;
  opponent: string;
  result: string | null;
  onClose: () => void;
}

interface EngineEval {
  moveQuality: string;
  centipawnLoss: number;
  evaluation: number; // white-POV, pawn units
}

interface MoveSection {
  type: 'move';
  header: string;               // e.g. "Move 2: Nf3"
  timestamp: string;
  fen: string | null;
  userColor: 'white' | 'black';
  thinking: string;
  moveNotation: string | null;       // SAN of the played move, e.g. "Nf3"
  opponentLastMove: string | null;   // decoded, e.g. "Nc4 (c3-c4)"
  engineEval: EngineEval | null;
  aiReview: string | null;
  postReview: string | null;
}

// 'puzzle'         — board + timestamp shown; guess input active
// 'thinking_shown' — also showing player's thinking + actual move
// 'complete'       — full reveal: eval, AI review, post-game review
type SectionPhase = 'puzzle' | 'thinking_shown' | 'complete';

type Status = 'generating' | 'done' | 'error';

// ─── Move-quality display config ─────────────────────────────────────────────

const QUALITY_STYLE: Record<string, { label: string; color: string }> = {
  excellent:  { label: '✓ Excellent',  color: 'text-green-600 dark:text-green-400'   },
  good:       { label: '✓ Good',       color: 'text-blue-600 dark:text-blue-400'     },
  inaccuracy: { label: '⚠ Inaccuracy', color: 'text-yellow-600 dark:text-yellow-400' },
  mistake:    { label: '✗ Mistake',    color: 'text-orange-600 dark:text-orange-400' },
  blunder:    { label: '✗✗ Blunder',   color: 'text-red-600 dark:text-red-400'       },
};

function formatEval(v: number): string {
  return (v > 0 ? '+' : '') + v.toFixed(1);
}

// Normalise SAN for comparison: strip check/mate symbols, trim, lower-case.
function normSan(s: string): string {
  return s.replace(/[+#?!]/g, '').trim().toLowerCase();
}

// ─── Inline PGN navigator ────────────────────────────────────────────────────

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKB1R w KQkq - 0 1';

function PgnViewer({ pgn, userColor }: { pgn: string; userColor: 'white' | 'black' }) {
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

// ─── Clipboard text assembly ─────────────────────────────────────────────────

function buildClipboardText(sections: MoveSection[], summary: string, pgn: string): string {
  const lines: string[] = [];

  for (const s of sections) {
    lines.push(`== ${s.header} ==`);
    lines.push(new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    lines.push('');
    lines.push(s.thinking);
    if (s.engineEval) {
      lines.push(
        `Engine: ${s.engineEval.moveQuality} · ${s.engineEval.centipawnLoss} cp loss · eval ${formatEval(s.engineEval.evaluation)}`
      );
    }
    if (s.aiReview) {
      lines.push('');
      lines.push(`AI analysis: ${s.aiReview}`);
    }
    if (s.postReview) {
      lines.push('');
      lines.push(`My post-game analysis: ${s.postReview}`);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  if (summary) {
    lines.push('== Overall Summary ==');
    lines.push('');
    lines.push(summary);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  if (pgn) {
    lines.push('[pgn]');
    lines.push(pgn);
    lines.push('[/pgn]');
  }

  return lines.join('\n');
}

// ─── Interactive move section ─────────────────────────────────────────────────

function MoveSectionCard({
  section,
  index,
}: {
  section: MoveSection;
  index: number;
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
      setPhase('complete');
    } else {
      setFeedback('wrong');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') checkGuess();
  };

  // Derived header: hide notation during puzzle phase
  const displayHeader = (() => {
    if (!hasPuzzle || phase === 'complete') return section.header;
    // Extract "Move N" prefix without the notation part
    const match = section.header.match(/^(Move \d+)/);
    return match ? match[1] : section.header;
  })();

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">

      {/* ── Header row ─────────────────────────────────────────────────── */}
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

        {/* ── Board diagram ─────────────────────────────────────────── */}
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

        {/* ── Puzzle: guess input ────────────────────────────────────── */}
        {hasPuzzle && phase !== 'complete' && (
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

            {/* Feedback */}
            {feedback === 'wrong' && (
              <p className="text-xs text-red-600 dark:text-red-400">
                ✗ Not quite — try again, or reveal thinking below.
              </p>
            )}

            {/* Action buttons */}
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

        {/* ── Correct guess banner ───────────────────────────────────── */}
        {feedback === 'correct' && (
          <p className="text-xs text-green-600 dark:text-green-400 font-medium">
            ✓ Correct!
          </p>
        )}

        {/* ── Thinking (shown from thinking_shown phase onwards) ──────── */}
        {(phase === 'thinking_shown' || phase === 'complete') && (
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              💭 My thinking
            </p>
            <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
              {section.thinking}
            </p>
            {section.moveNotation && phase === 'thinking_shown' && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Move played:{' '}
                <span className="font-mono font-medium text-gray-700 dark:text-gray-300">
                  {section.moveNotation}
                </span>
              </p>
            )}
          </div>
        )}

        {/* ── Full analysis (complete phase only) ───────────────────── */}
        {phase === 'complete' && (
          <>
            {/* Move quality + cp loss */}
            {section.engineEval && quality && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs bg-gray-50 dark:bg-gray-700 rounded px-3 py-2">
                <span className={`font-semibold ${quality.color}`}>{quality.label}</span>
                <span className="text-gray-300 dark:text-gray-500">·</span>
                <span className="text-gray-600 dark:text-gray-400">
                  {section.engineEval.centipawnLoss} cp loss
                </span>
              </div>
            )}

            {/* Position eval */}
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

            {/* Post-game analysis */}
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

// ─── Main modal ───────────────────────────────────────────────────────────────

export default function BlogPostModal({ gameId, opponent, result, onClose }: BlogPostModalProps) {
  const [status, setStatus]       = useState<Status>('generating');
  const [sections, setSections]   = useState<MoveSection[]>([]);
  const [summary, setSummary]     = useState('');
  const [prompt, setPrompt]       = useState('');
  const [pgn, setPgn]             = useState('');
  const [userColor, setUserColor] = useState<'white' | 'black'>('white');
  const [error, setError]         = useState('');
  const [copied, setCopied]       = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);

  const generate = async () => {
    setStatus('generating');
    setError('');
    try {
      const res = await fetch(`/api/games/${gameId}/blog-post`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate blog post');
      setSections(data.sections || []);
      setSummary(data.summary || '');
      setPrompt(data.prompt || '');
      setPgn(data.pgn || '');
      setUserColor(data.userColor || 'white');
      setStatus('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate blog post');
      setStatus('error');
    }
  };

  useEffect(() => {
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildClipboardText(sections, summary, pgn));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard API unavailable */ }
  };

  const resultLabel = result ? result.charAt(0).toUpperCase() + result.slice(1) : null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl shadow-xl">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="font-semibold text-lg text-gray-900 dark:text-gray-100">Blog Post Draft</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              vs. {opponent}{resultLabel ? ` · ${resultLabel}` : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-2xl leading-none ml-4"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {status === 'generating' && (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600" />
              <p className="text-sm text-gray-600 dark:text-gray-400">Assembling your blog post...</p>
            </div>
          )}

          {status === 'error' && (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
              <p className="text-sm text-red-600 dark:text-red-400 text-center">{error}</p>
              <button
                onClick={generate}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded-lg transition-colors"
              >
                Try Again
              </button>
            </div>
          )}

          {status === 'done' && (
            <>
              {/* ── Per-move sections (interactive) ──────────────────── */}
              {sections.map((section, i) => (
                <MoveSectionCard key={i} section={section} index={i} />
              ))}

              {/* ── Overall summary ───────────────────────────────────── */}
              {summary && (
                <div className="border border-purple-200 dark:border-purple-800 rounded-lg overflow-hidden">
                  <div className="bg-purple-50 dark:bg-purple-900/30 px-4 py-2 border-b border-purple-200 dark:border-purple-800">
                    <span className="font-semibold text-sm text-purple-800 dark:text-purple-200">
                      ✨ Overall Summary
                    </span>
                  </div>
                  <div className="p-4 space-y-3 text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
                    {summary.split('\n\n').map((para, i) => (
                      <p key={i}>{para}</p>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Playable game replay ──────────────────────────────── */}
              {pgn && (
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                  <div className="bg-gray-50 dark:bg-gray-700 px-4 py-2 border-b border-gray-200 dark:border-gray-600 flex items-center justify-between">
                    <span className="font-semibold text-sm text-gray-800 dark:text-gray-200">
                      ♟ Full Game
                    </span>
                    <span className="text-xs text-gray-400">
                      Copies as <code className="font-mono">[pgn]…[/pgn]</code>
                    </span>
                  </div>
                  <div className="p-4">
                    <PgnViewer pgn={pgn} userColor={userColor} />
                  </div>
                </div>
              )}

              {/* ── Summary prompt debug panel ────────────────────────── */}
              <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
                <button
                  onClick={() => setShowPrompt(v => !v)}
                  className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-1"
                >
                  <span>{showPrompt ? '▾' : '▸'}</span>
                  {showPrompt ? 'Hide summary prompt' : 'Show summary prompt'}
                </button>
                {showPrompt && (
                  <textarea
                    readOnly
                    value={prompt}
                    className="mt-2 w-full h-48 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-300 resize-y font-mono text-xs focus:outline-none focus:ring-2 focus:ring-purple-400 dark:focus:ring-purple-500"
                  />
                )}
              </div>
            </>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────── */}
        {status === 'done' && (
          <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
            <button
              onClick={handleCopy}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {copied ? 'Copied!' : 'Copy to Clipboard'}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 text-sm font-medium rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
