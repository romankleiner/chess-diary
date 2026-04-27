'use client';

import { useEffect, useMemo, useState } from 'react';
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
  header: string;
  timestamp: string;
  fen: string | null;
  userColor: 'white' | 'black';
  thinking: string;
  engineEval: EngineEval | null;
  aiReview: string | null;
  postReview: string | null;
}

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

// ─── Inline PGN navigator ────────────────────────────────────────────────────

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKB1R w KQkq - 0 1';

function PgnViewer({ pgn, userColor }: { pgn: string; userColor: 'white' | 'black' }) {
  const [moveIdx, setMoveIdx] = useState(-1); // -1 = starting position

  // Parse PGN once; build parallel arrays of FENs and SANs.
  // chess.js v1 verbose history includes .before/.after FENs on each move.
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

  const total     = sans.length;
  const currentFen = fens[moveIdx + 1] ?? fens[0];

  // Group SANs into pairs for the move list display
  const movePairs: Array<{ white: string; black?: string; pairIdx: number }> = [];
  for (let i = 0; i < sans.length; i += 2) {
    movePairs.push({ white: sans[i], black: sans[i + 1], pairIdx: i / 2 });
  }

  return (
    <div className="space-y-3">
      {/* Board */}
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

      {/* Navigation bar */}
      <div className="flex items-center justify-center gap-2 text-gray-700 dark:text-gray-300">
        {[
          { label: '⏮', action: () => setMoveIdx(-1),           disabled: moveIdx === -1     },
          { label: '◀', action: () => setMoveIdx(i => Math.max(-1,       i - 1)), disabled: moveIdx === -1     },
          { label: '▶', action: () => setMoveIdx(i => Math.min(total - 1, i + 1)), disabled: moveIdx === total - 1 },
          { label: '⏭', action: () => setMoveIdx(total - 1),    disabled: moveIdx === total - 1 },
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

      {/* Move list */}
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
    lines.push(s.timestamp);
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

// ─── Component ───────────────────────────────────────────────────────────────

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

        {/* ── Header ───────────────────────────────────────────────────── */}
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

        {/* ── Body ─────────────────────────────────────────────────────── */}
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
              {/* ── Per-move sections ─────────────────────────────────── */}
              {sections.map((section, i) => {
                const quality = section.engineEval
                  ? (QUALITY_STYLE[section.engineEval.moveQuality] ?? null)
                  : null;

                return (
                  <div
                    key={i}
                    className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
                  >
                    {/* Header row */}
                    <div className="bg-gray-50 dark:bg-gray-700 px-4 py-2 flex items-center justify-between border-b border-gray-200 dark:border-gray-600">
                      <span className="font-semibold text-sm text-gray-800 dark:text-gray-200">
                        {section.header}
                      </span>
                      <span className="text-xs text-gray-400">
                        {new Date(section.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    <div className="p-4 space-y-3">

                      {/* Board diagram */}
                      {section.fen && (
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

                      {/* Original in-game thinking */}
                      <div>
                        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                          💭 My thinking
                        </p>
                        <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
                          {section.thinking}
                        </p>
                      </div>

                      {/* Move quality pill */}
                      {section.engineEval && quality && (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs bg-gray-50 dark:bg-gray-700 rounded px-3 py-2">
                          <span className={`font-semibold ${quality.color}`}>{quality.label}</span>
                          <span className="text-gray-300 dark:text-gray-500">·</span>
                          <span className="text-gray-600 dark:text-gray-400">
                            {section.engineEval.centipawnLoss} cp loss
                          </span>
                        </div>
                      )}

                      {/* Position evaluation — before AI analysis */}
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

                      {/* AI post-game analysis */}
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

                      {/* My own post-game analysis */}
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
                    </div>
                  </div>
                );
              })}

              {/* ── Overall Claude summary ────────────────────────────── */}
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

        {/* ── Footer ───────────────────────────────────────────────────── */}
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
