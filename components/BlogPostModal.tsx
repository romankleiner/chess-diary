'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';

interface BlogPostModalProps {
  gameId: string;
  opponent: string;
  result: string | null;
  onClose: () => void;
}

type Status = 'generating' | 'done' | 'error';

interface TextSegment {
  type: 'text';
  content: string;
}

interface DiagramSegment {
  type: 'diagram';
  fen: string;
  pov: string;
}

type Segment = TextSegment | DiagramSegment;

/** Split post text into text and [DIAGRAM:fen:pov] segments */
function parsePost(text: string): Segment[] {
  const segments: Segment[] = [];
  const re = /\[DIAGRAM:([^:\]]+):([^\]]+)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index).trim() });
    }
    segments.push({ type: 'diagram', fen: match[1], pov: match[2] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    const tail = text.slice(lastIndex).trim();
    if (tail) segments.push({ type: 'text', content: tail });
  }
  return segments;
}

/** Strip diagram markers for clipboard copy */
function stripDiagrams(text: string): string {
  return text.replace(/\[DIAGRAM:[^\]]+\]\n?/g, '').trim();
}

export default function BlogPostModal({ gameId, opponent, result, onClose }: BlogPostModalProps) {
  const [status, setStatus] = useState<Status>('generating');
  const [post, setPost] = useState('');
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
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
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate blog post');
      }
      setPost(data.post || '');
      setPrompt(data.prompt || '');
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
      await navigator.clipboard.writeText(stripDiagrams(post));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API unavailable
    }
  };

  const resultLabel = result
    ? result.charAt(0).toUpperCase() + result.slice(1)
    : null;

  const segments = status === 'done' ? parsePost(post) : [];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl shadow-xl">

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="font-semibold text-lg text-gray-900 dark:text-gray-100">
              Blog Post Draft
            </h2>
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

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {status === 'generating' && (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600" />
              <p className="text-sm text-gray-600 dark:text-gray-400">Generating your blog post...</p>
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
              {/* Rendered post with inline diagrams */}
              <div className="space-y-4 text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
                {segments.map((seg, i) =>
                  seg.type === 'diagram' ? (
                    <div key={i} className="flex justify-center my-2">
                      <Image
                        src={`/api/board-image?fen=${encodeURIComponent(seg.fen)}&pov=${seg.pov}`}
                        alt={`Board position: ${seg.fen}`}
                        width={320}
                        height={320}
                        className="rounded border border-gray-200 dark:border-gray-600"
                        unoptimized
                      />
                    </div>
                  ) : (
                    <div key={i}>
                      {seg.content.split('\n\n').map((para, j) => (
                        <p key={j} className={j > 0 ? 'mt-3' : ''}>{para}</p>
                      ))}
                    </div>
                  )
                )}
              </div>

              {/* Prompt debug panel */}
              <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
                <button
                  onClick={() => setShowPrompt(v => !v)}
                  className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-1"
                >
                  <span>{showPrompt ? '▾' : '▸'}</span>
                  {showPrompt ? 'Hide prompt' : 'Show prompt'}
                </button>
                {showPrompt && (
                  <textarea
                    readOnly
                    value={prompt}
                    className="mt-2 w-full h-64 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-300 resize-y font-mono text-xs focus:outline-none focus:ring-2 focus:ring-purple-400 dark:focus:ring-purple-500"
                  />
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer — only shown when done */}
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
