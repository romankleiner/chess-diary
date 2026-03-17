'use client';

import { useState } from 'react';

interface Statistics {
  totalMoves: number;
  accuracy: number | null;
  blunders: number;
  mistakes: number;
  inaccuracies: number;
  averageCentipawnLoss: number | null;
}

interface GameSnapshot {
  opponent: string;
  result: string | null;
  date: string;
  white: string;
  black: string;
}

interface PostGameSummaryFormProps {
  gameId: string;
  gameSnapshot: GameSnapshot | null;
  statistics: Statistics | null;
  onSaved: (entry: any) => void;
  onCancel: () => void;
}

export default function PostGameSummaryForm({
  gameId,
  gameSnapshot,
  statistics,
  onSaved,
  onCancel,
}: PostGameSummaryFormProps) {
  const [reflections, setReflections] = useState({
    whatWentWell: '',
    mistakes: '',
    lessonsLearned: '',
    nextSteps: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/journal/post-game-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId, reflections }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      onSaved(data.entry);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save summary');
    } finally {
      setSaving(false);
    }
  };

  const resultLabel = gameSnapshot?.result
    ? gameSnapshot.result.charAt(0).toUpperCase() + gameSnapshot.result.slice(1)
    : 'Unknown result';

  return (
    <div className="border-2 border-blue-400 rounded-xl bg-blue-50 dark:bg-blue-950/30 dark:border-blue-600 p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">🏁</span>
            <h2 className="text-lg font-bold text-blue-800 dark:text-blue-200">
              Post-Game Summary
            </h2>
            <span className="text-xs bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 px-2 py-0.5 rounded-full font-medium">
              New
            </span>
          </div>
          {gameSnapshot && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
              vs. {gameSnapshot.opponent} · {resultLabel} ·{' '}
              {new Date(gameSnapshot.date).toLocaleDateString()}
            </p>
          )}
        </div>
        <button
          onClick={onCancel}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none"
          aria-label="Cancel"
        >
          ×
        </button>
      </div>

      {/* Statistics */}
      {statistics && (
        <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-blue-200 dark:border-blue-700">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
            Game Statistics
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-sm">
            {statistics.accuracy !== null && (
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Accuracy</span>
                <span className="font-semibold text-gray-800 dark:text-gray-200">
                  {statistics.accuracy}%
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Total moves</span>
              <span className="font-semibold text-gray-800 dark:text-gray-200">
                {statistics.totalMoves}
              </span>
            </div>
            {statistics.averageCentipawnLoss !== null && (
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Avg CP loss</span>
                <span className="font-semibold text-gray-800 dark:text-gray-200">
                  {statistics.averageCentipawnLoss}
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-red-500">Blunders</span>
              <span className="font-semibold text-red-600 dark:text-red-400">
                {statistics.blunders}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-orange-500">Mistakes</span>
              <span className="font-semibold text-orange-600 dark:text-orange-400">
                {statistics.mistakes}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-yellow-500">Inaccuracies</span>
              <span className="font-semibold text-yellow-600 dark:text-yellow-500">
                {statistics.inaccuracies}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Reflection fields */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
          Your Reflections
        </h3>

        {[
          {
            key: 'whatWentWell' as const,
            label: '✅ What went well?',
            placeholder: 'Strong opening prep, good endgame technique...',
          },
          {
            key: 'mistakes' as const,
            label: '❌ Key mistakes',
            placeholder: 'Missed tactic on move 23, time pressure in the endgame...',
          },
          {
            key: 'lessonsLearned' as const,
            label: '📚 Lessons learned',
            placeholder: 'Always look for rook sacrifices, calculate one move deeper...',
          },
          {
            key: 'nextSteps' as const,
            label: '🎯 Next steps',
            placeholder: 'Practice rook endgames, study the Sicilian Najdorf...',
          },
        ].map(({ key, label, placeholder }) => (
          <div key={key}>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              {label}
            </label>
            <textarea
              value={reflections[key]}
              onChange={(e) =>
                setReflections((prev) => ({ ...prev, [key]: e.target.value }))
              }
              placeholder={placeholder}
              rows={5}
              className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400 dark:focus:ring-blue-500 resize-none"
            />
          </div>
        ))}
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {saving ? 'Saving...' : '🏁 Save Summary'}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-lg transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
