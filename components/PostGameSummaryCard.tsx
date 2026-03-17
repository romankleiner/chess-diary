'use client';

import { useState } from 'react';
import Link from 'next/link';

interface Statistics {
  totalMoves: number;
  accuracy: number | null;
  blunders: number;
  mistakes: number;
  inaccuracies: number;
  averageCentipawnLoss: number | null;
}

interface Reflections {
  whatWentWell?: string;
  mistakes?: string;
  lessonsLearned?: string;
  nextSteps?: string;
}

interface PostGameSummaryCardProps {
  entry: {
    id: number;
    gameId: string | null;
    timestamp: string;
    postGameSummary?: {
      statistics: Statistics | null;
      reflections: Reflections;
    };
    gameSnapshot?: {
      opponent: string;
      result: string | null;
      date: string;
      white: string;
      black: string;
      url?: string | null;
    } | null;
  };
  onDelete?: (id: number) => void;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function PostGameSummaryCard({ entry, onDelete }: PostGameSummaryCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [deleting, setDeleting] = useState(false);

  const summary = entry.postGameSummary;
  const game = entry.gameSnapshot;
  const stats = summary?.statistics;
  const reflections = summary?.reflections;

  const hasAnyReflection =
    reflections?.whatWentWell ||
    reflections?.mistakes ||
    reflections?.lessonsLearned ||
    reflections?.nextSteps;

  const handleDelete = async () => {
    if (!confirm('Delete this post-game summary?')) return;
    setDeleting(true);
    try {
      await fetch(`/api/journal?id=${entry.id}`, { method: 'DELETE' });
      onDelete?.(entry.id);
    } catch {
      alert('Failed to delete');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="border-2 border-blue-300 dark:border-blue-700 rounded-xl bg-blue-50 dark:bg-blue-950/20 overflow-hidden">
      {/* Collapsed / header row */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left p-4 flex items-start gap-3 hover:bg-blue-100 dark:hover:bg-blue-900/20 transition-colors"
      >
        <span className="text-lg mt-0.5 shrink-0">🏁</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-blue-800 dark:text-blue-200 text-sm">
              Post-Game Summary
            </span>
            <span className="text-xs bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 px-2 py-0.5 rounded-full">
              No AI
            </span>
          </div>

          {game && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
              vs. {game.opponent}
              {game.result && (
                <span
                  className={`ml-1 font-medium ${
                    game.result === '1-0'
                      ? 'text-green-600 dark:text-green-400'
                      : game.result === '0-1'
                      ? 'text-red-500 dark:text-red-400'
                      : 'text-gray-500'
                  }`}
                >
                  · {game.result}
                </span>
              )}
              {stats?.accuracy !== null && stats?.accuracy !== undefined && (
                <span className="ml-1 text-gray-500 dark:text-gray-400">
                  · {stats.accuracy}% accuracy
                </span>
              )}
            </p>
          )}

          {!game && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {formatDate(entry.timestamp)}
            </p>
          )}

          {/* Collapsed preview of reflections */}
          {!expanded && reflections?.lessonsLearned && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 line-clamp-1 italic">
              &ldquo;{reflections.lessonsLearned}&rdquo;
            </p>
          )}
        </div>
        <span className="text-gray-400 dark:text-gray-500 text-xs shrink-0 mt-0.5">
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-blue-200 dark:border-blue-800 pt-3">
          {/* Statistics grid */}
          {stats && (
            <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-blue-200 dark:border-blue-700">
              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                Game Performance
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-sm">
                {stats.accuracy !== null && (
                  <div className="flex justify-between">
                    <span className="text-gray-500 dark:text-gray-400">Accuracy</span>
                    <span className="font-semibold text-gray-800 dark:text-gray-200">
                      {stats.accuracy}%
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">Moves</span>
                  <span className="font-semibold text-gray-800 dark:text-gray-200">
                    {stats.totalMoves}
                  </span>
                </div>
                {stats.averageCentipawnLoss !== null && (
                  <div className="flex justify-between">
                    <span className="text-gray-500 dark:text-gray-400">Avg CP loss</span>
                    <span className="font-semibold text-gray-800 dark:text-gray-200">
                      {stats.averageCentipawnLoss}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-red-500">Blunders</span>
                  <span className="font-semibold text-red-600 dark:text-red-400">
                    {stats.blunders}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-orange-500">Mistakes</span>
                  <span className="font-semibold text-orange-500">
                    {stats.mistakes}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-yellow-500">Inaccuracies</span>
                  <span className="font-semibold text-yellow-500">
                    {stats.inaccuracies}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Reflections sections */}
          {hasAnyReflection ? (
            <div className="space-y-3">
              {reflections?.whatWentWell && (
                <ReflectionSection icon="✅" title="What Went Well" text={reflections.whatWentWell} />
              )}
              {reflections?.mistakes && (
                <ReflectionSection icon="❌" title="Key Mistakes" text={reflections.mistakes} />
              )}
              {reflections?.lessonsLearned && (
                <ReflectionSection icon="📚" title="Lessons Learned" text={reflections.lessonsLearned} />
              )}
              {reflections?.nextSteps && (
                <ReflectionSection icon="🎯" title="Next Steps" text={reflections.nextSteps} />
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-400 dark:text-gray-500 italic">
              No reflections written yet.
            </p>
          )}

          {/* Footer actions */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-3">
              {entry.gameId && (
                <Link
                  href={`/games/${entry.gameId}/analysis`}
                  className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                >
                  📊 View Full Analysis
                </Link>
              )}
              {game?.url && (
                <a
                  href={game.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-gray-500 dark:text-gray-400 hover:underline flex items-center gap-1"
                >
                  ♟ Chess.com
                </a>
              )}
            </div>
            <div className="flex gap-3 items-center">
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {formatDate(entry.timestamp)}
              </span>
              {onDelete && (
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="text-xs text-red-400 hover:text-red-600 dark:hover:text-red-300 transition-colors"
                >
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReflectionSection({
  icon,
  title,
  text,
}: {
  icon: string;
  title: string;
  text: string;
}) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-1 flex items-center gap-1">
        <span>{icon}</span> {title}
      </h4>
      <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">
        {text}
      </p>
    </div>
  );
}
