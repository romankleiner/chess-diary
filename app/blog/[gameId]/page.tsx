'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { MoveSection, GameWalkthrough } from '@/components/blog-shared';

interface GameMeta {
  white: string;
  black: string;
  result: string | null;
  date: string;
  timeControl: string;
}

interface BlogData {
  sections: MoveSection[];
  summary: string;
  pgn: string;
  userColor: 'white' | 'black';
  gameMeta: GameMeta;
}

type Status = 'loading' | 'done' | 'error';

// ─── Result badge ─────────────────────────────────────────────────────────────

function ResultBadge({ result }: { result: string | null }) {
  if (!result) return null;
  const styles: Record<string, string> = {
    win:  'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300',
    loss: 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300',
    draw: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300',
  };
  const style = styles[result] ?? styles.draw;
  return (
    <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${style}`}>
      {result.charAt(0).toUpperCase() + result.slice(1)}
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BlogPage() {
  const params = useParams();
  const gameId = params.gameId as string;

  const [status, setStatus]   = useState<Status>('loading');
  const [data, setData]       = useState<BlogData | null>(null);
  const [error, setError]     = useState('');

  const load = async () => {
    setStatus('loading');
    setError('');
    try {
      const res = await fetch(`/api/games/${gameId}/blog-post`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load');
      setData(json);
      setStatus('done');

      // Set browser tab title once we have the game info
      if (json.gameMeta) {
        const { white, black, date } = json.gameMeta as GameMeta;
        document.title = white && black
          ? `${white} vs ${black}${date ? ` · ${date}` : ''} — Chess Diary`
          : 'Chess Diary — Game Blog';
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load blog post');
      setStatus('error');
    }
  };

  useEffect(() => {
    load();
    return () => { document.title = 'Chess Diary'; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">

      {/* ── Top bar ──────────────────────────────────────────────────── */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <a
            href="/"
            className="text-sm font-semibold text-purple-600 dark:text-purple-400 hover:underline"
          >
            ♟ Chess Diary
          </a>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">

        {/* ── Loading ──────────────────────────────────────────────────── */}
        {status === 'loading' && (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-purple-600" />
            <p className="text-sm text-gray-500 dark:text-gray-400">Generating blog post…</p>
          </div>
        )}

        {/* ── Error ────────────────────────────────────────────────────── */}
        {status === 'error' && (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <p className="text-sm text-red-600 dark:text-red-400 text-center">{error}</p>
            <button
              onClick={load}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded-lg transition-colors"
            >
              Try Again
            </button>
          </div>
        )}

        {/* ── Content ──────────────────────────────────────────────────── */}
        {status === 'done' && data && (
          <>
            {/* Game header */}
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                  {data.gameMeta.white} vs {data.gameMeta.black}
                </h1>
                <ResultBadge result={data.gameMeta.result} />
              </div>
              <p className="text-base text-gray-500 dark:text-gray-400">
                {data.gameMeta.date}
              </p>
            </div>

            {/* Game walkthrough: the game is the backbone — the reader plays
                through it from move 1, journal entries unlock as guess points
                along the way, and the overall summary unlocks at the end. */}
            <GameWalkthrough
              pgn={data.pgn}
              sections={data.sections}
              userColor={data.userColor}
              summary={data.summary}
            />
          </>
        )}
      </main>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer className="max-w-2xl mx-auto px-4 py-8 text-center text-xs text-gray-400 dark:text-gray-600">
        Written with{' '}
        <a href="/" className="hover:underline text-purple-500 dark:text-purple-400">
          Chess Diary
        </a>
      </footer>
    </div>
  );
}
