'use client';

import { useEffect, useState } from 'react';
import {
  MoveSection,
  MoveSectionCard,
  PgnViewer,
  QUALITY_STYLE,
  formatEval,
  renderWithBold,
} from '@/components/blog-shared';

interface BlogPostModalProps {
  gameId: string;
  opponent: string;
  result: string | null;
  onClose: () => void;
}

type Status = 'generating' | 'done' | 'error';

// ─── Clipboard assembly ───────────────────────────────────────────────────────

function buildClipboardText(sections: MoveSection[], summary: string, pgn: string): string {
  const lines: string[] = [];

  for (const s of sections) {
    lines.push(`== ${s.header} ==`);
    lines.push(new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    lines.push('');
    if (s.opponentLastMove) lines.push(`Opponent played: ${s.opponentLastMove}`);
    lines.push(s.thinking);
    if (s.moveNotation) lines.push(`Move played: ${s.moveNotation}`);
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

function buildClipboardHtml(
  sections: MoveSection[],
  summary: string,
  pgn: string,
  origin: string,
): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const parts: string[] = ['<div>'];

  for (const s of sections) {
    const time = new Date(s.timestamp).toLocaleString([], {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

    parts.push(`<h3>${esc(s.header)}</h3>`);
    parts.push(`<p><em>${esc(time)}</em></p>`);

    if (s.opponentLastMove) {
      parts.push(`<p>Opponent played <strong>${esc(s.opponentLastMove)}</strong></p>`);
    }

    if (s.fen) {
      const imgSrc = `${origin}/api/board-image?fen=${encodeURIComponent(s.fen)}&pov=${s.userColor}`;
      parts.push(`<p><img src="${esc(imgSrc)}" width="240" height="240" alt="Board position" /></p>`);
    }

    parts.push(`<p><strong>💭 My thinking</strong></p>`);
    for (const para of s.thinking.split('\n')) {
      if (para.trim()) parts.push(`<p>${esc(para)}</p>`);
    }

    if (s.moveNotation) {
      parts.push(`<p>Move played: <strong><code>${esc(s.moveNotation)}</code></strong></p>`);
    }

    if (s.engineEval) {
      const q = QUALITY_STYLE[s.engineEval.moveQuality];
      const label = q ? q.label : s.engineEval.moveQuality;
      parts.push(
        `<p>Engine: <strong>${esc(label)}</strong> · ${s.engineEval.centipawnLoss} cp loss · eval ${esc(formatEval(s.engineEval.evaluation))}</p>`
      );
    }

    if (s.aiReview) {
      parts.push(`<p><strong>🤖 AI analysis</strong></p>`);
      for (const para of s.aiReview.split('\n')) {
        if (para.trim()) parts.push(`<p><em>${esc(para)}</em></p>`);
      }
    }

    if (s.postReview) {
      parts.push(`<p><strong>📝 My post-game analysis</strong></p>`);
      for (const para of s.postReview.split('\n')) {
        if (para.trim()) parts.push(`<p>${esc(para)}</p>`);
      }
    }

    parts.push('<hr />');
  }

  if (summary) {
    parts.push('<h3>✨ Overall Summary</h3>');
    for (const para of summary.split('\n\n')) {
      if (para.trim()) parts.push(`<p>${esc(para)}</p>`);
    }
    parts.push('<hr />');
  }

  if (pgn) {
    parts.push(`<p>[pgn]<br />${esc(pgn)}<br />[/pgn]</p>`);
  }

  parts.push('</div>');
  return parts.join('\n');
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export default function BlogPostModal({ gameId, opponent, result, onClose }: BlogPostModalProps) {
  const [status, setStatus]       = useState<Status>('generating');
  const [sections, setSections]   = useState<MoveSection[]>([]);
  const [summary, setSummary]     = useState('');
  const [pgn, setPgn]             = useState('');
  const [userColor, setUserColor] = useState<'white' | 'black'>('white');
  const [error, setError]         = useState('');
  const [copied, setCopied]         = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

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
    const text = buildClipboardText(sections, summary, pgn);
    const html = buildClipboardHtml(sections, summary, pgn, window.location.origin);
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html':  new Blob([html], { type: 'text/html'  }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: plain text only
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch { /* clipboard API unavailable */ }
    }
  };

  const handleShareLink = async () => {
    const url = `${window.location.origin}/blog/${gameId}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
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
              <p className="text-sm text-gray-600 dark:text-gray-400">Loading blog post...</p>
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
              {sections.map((section, i) => (
                <MoveSectionCard key={i} section={section} />
              ))}

              {summary && (
                <div className="border border-purple-200 dark:border-purple-800 rounded-lg overflow-hidden">
                  <div className="bg-purple-50 dark:bg-purple-900/30 px-4 py-2 border-b border-purple-200 dark:border-purple-800">
                    <span className="font-semibold text-sm text-purple-800 dark:text-purple-200">
                      ✨ Overall Summary
                    </span>
                  </div>
                  <div className="p-4 space-y-3 text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
                    {summary.split('\n\n').map((para, i) => (
                      <p key={i}>{renderWithBold(para)}</p>
                    ))}
                  </div>
                </div>
              )}

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

            </>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────── */}
        {status === 'done' && (
          <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2 flex-wrap">
            <button
              onClick={handleShareLink}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {linkCopied ? '✓ Link copied!' : '🔗 Share link'}
            </button>
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
