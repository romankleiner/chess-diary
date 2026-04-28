'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import PostGameSummaryForm from '@/components/PostGameSummaryForm';
import BlogPostModal from '@/components/BlogPostModal';

interface Game {
  id: string;
  opponent: string;
  date: string;
  result: string | null;
  white: string;
  black: string;
  analysisCompleted?: boolean;
  analysisDepth?: number;
  analysisEngine?: string;
}

function getResultBadge(result: string | null): { label: string; className: string } | null {
  switch (result?.toLowerCase()) {
    case 'win':
      return { label: 'Win', className: 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200 border border-green-300 dark:border-green-700' };
    case 'loss':
      return { label: 'Loss', className: 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-200 border border-red-300 dark:border-red-700' };
    case 'draw':
      return { label: 'Draw', className: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-200 border border-yellow-300 dark:border-yellow-700' };
    default:
      return null;
  }
}

export default function GamesPage() {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<{ current: number; total: number } | null>(null);
  const [toast, setToast] = useState<{ message: string; show: boolean }>({ message: '', show: false });
  const [analyzingThinking, setAnalyzingThinking] = useState<string | null>(null);
  const [thinkingProgress, setThinkingProgress] = useState<{ current: number; total: number } | null>(null);
  const [gamesWithEntries, setGamesWithEntries] = useState<Set<string>>(new Set());

  // ── Blog post state ────────────────────────────────────────────────────
  const [showBlogModal, setShowBlogModal] = useState<string | null>(null);
  const [blogGameData, setBlogGameData] = useState<{ opponent: string; result: string | null } | null>(null);
  // ──────────────────────────────────────────────────────────────────────

  // ── Post-game summary state ────────────────────────────────────────────
  const [showSummaryForm, setShowSummaryForm] = useState<string | null>(null);
  const [summaryGameData, setSummaryGameData] = useState<{
    gameId: string;
    gameSnapshot: { opponent: string; result: string; date: string; white: string; black: string };
    statistics: null;
  } | null>(null);
  const [existingSummaries, setExistingSummaries] = useState<Set<string>>(new Set());
  // ──────────────────────────────────────────────────────────────────────

  const showToast = (message: string) => {
    setToast({ message, show: true });
    setTimeout(() => setToast({ message: '', show: false }), 3000);
  };

  const loadGames = async () => {
    setLoadError(null);
    try {
      const response = await fetch('/api/games', { signal: AbortSignal.timeout(15000) });
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
      const data = await response.json();
      const loadedGames: Game[] = data.games || [];
      setGames(loadedGames);
      console.log('[FRONTEND] Games reloaded');

      // Check which games already have post-game summaries
      if (loadedGames.length) {
        const summaryChecks = await Promise.allSettled(
          loadedGames.map((g: Game) =>
            fetch(`/api/journal/post-game-summary?gameId=${g.id}`, {
              signal: AbortSignal.timeout(10000),
            }).then(r => r.json())
          )
        );
        const withSummaries = new Set<string>();
        summaryChecks.forEach((result, i) => {
          if (result.status === 'fulfilled' && result.value.summary) {
            withSummaries.add(loadedGames[i].id);
          }
        });
        setExistingSummaries(withSummaries);
      }
    } catch (error) {
      console.error('[FRONTEND] Error loading games:', error);
      const msg = error instanceof Error ? error.message : String(error);
      setLoadError(msg.includes('timed out') || msg.includes('abort') || msg.includes('Abort')
        ? 'Request timed out — the server may be slow or unreachable. Try refreshing.'
        : `Failed to load games: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGames();
    fetch('/api/journal?startDate=2000-01-01&endDate=2099-12-31')
      .then(r => r.json())
      .then(data => {
        const gameIds = new Set<string>(
          (data.entries || []).map((e: any) => e.gameId).filter(Boolean)
        );
        setGamesWithEntries(gameIds);
      })
      .catch(() => {});
  }, []);

  const fetchFromChessCom = async () => {
    setFetching(true);
    try {
      const response = await fetch('/api/games/fetch', { method: 'POST' });
      const data = await response.json();
      if (data.success) {
        showToast(`✅ Fetched ${data.newGames} new games`);
        await loadGames();
      } else {
        alert(data.error || 'Fetch failed');
      }
    } catch (error) {
      alert('Failed to fetch games');
    } finally {
      setFetching(false);
    }
  };

  const analyzeGame = async (gameId: string) => {
    setAnalyzing(gameId);
    setAnalysisProgress(null);
    let progressInterval: ReturnType<typeof setInterval>;
    try {
      progressInterval = setInterval(async () => {
        try {
          const res = await fetch(`/api/games/analyze?gameId=${gameId}`);
          const d = await res.json();
          if (d.total > 0) setAnalysisProgress({ current: d.current, total: d.total });
        } catch {}
      }, 1000);

      // Loop through batches until the server reports completed
      let startMoveIndex = 0;
      let completed = false;
      while (!completed) {
        const response = await fetch('/api/games/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gameId, startMoveIndex }),
        });
        const data = await response.json();
        if (!data.success) {
          alert(data.error || 'Analysis failed');
          return;
        }
        completed = data.completed;
        startMoveIndex = data.nextMoveIndex ?? startMoveIndex;
      }
      showToast(`✅ Analysis complete!`);
      await loadGames();
    } catch (error) {
      console.error('[FRONTEND] Error analyzing game:', error);
      alert(`Failed to analyze game: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      clearInterval(progressInterval!);
      setAnalyzing(null);
      setAnalysisProgress(null);
    }
  };

  const analyzeThinking = async (gameId: string) => {
    const game = games.find(g => g.id === gameId);
    if (!game?.analysisCompleted) {
      if (!confirm('Engine analysis is required first. Would you like to run it now?')) return;
      await analyzeGame(gameId);
      return;
    }
    if (!confirm('This will analyze all your journal entries for this game using AI. Continue?')) return;

    setAnalyzingThinking(gameId);
    setThinkingProgress(null);

    try {
      let entryIndex = 0;
      let completed = false;
      while (!completed) {
        const response = await fetch('/api/games/analyze-thinking', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gameId, reanalyzeEngine: false, entryIndex }),
        });
        const data = await response.json();
        if (!data.success) {
          alert(data.error || 'Analysis failed');
          return;
        }
        // Update progress directly from the POST response — no polling needed
        setThinkingProgress({ current: data.entriesAnalyzed, total: data.totalEntries });
        completed = data.completed;
        entryIndex = data.nextEntryIndex ?? entryIndex + 1;
      }
      showToast(`🧠 AI analysis complete!`);
    } catch (error) {
      alert(`Failed to analyze thinking: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setAnalyzingThinking(null);
      setThinkingProgress(null);
    }
  };

  const openPostGameSummary = (game: Game) => {
    setSummaryGameData({
      gameId: game.id,
      gameSnapshot: {
        opponent: game.opponent,
        result: game.result ?? '',
        date: game.date,
        white: game.white,
        black: game.black,
      },
      statistics: null,
    });
    setShowSummaryForm(game.id);
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <p className="text-center text-gray-600">Loading games...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-center">
          <p className="text-red-700 dark:text-red-300 font-medium mb-2">Could not load games</p>
          <p className="text-red-600 dark:text-red-400 text-sm mb-3">{loadError}</p>
          <button
            onClick={loadGames}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-medium"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Toast notification */}
      {toast.show && (
        <div className="fixed top-4 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50">
          {toast.message}
        </div>
      )}

      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">My Games</h1>
        <button
          onClick={fetchFromChessCom}
          disabled={fetching}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400 text-sm flex items-center gap-1"
        >
          {fetching ? 'Fetching...' : 'Fetch from Chess.com'}
        </button>
      </div>

      {games.length === 0 ? (
        <p className="text-center text-gray-600">
          No games found. Click &quot;Fetch from Chess.com&quot; to import your games.
        </p>
      ) : (
        <div className="space-y-4">
          {games.map((game) => {
            const badge = getResultBadge(game.result);
            return (
              <div
                key={game.id}
                className="border rounded-lg p-4 hover:shadow-md transition-shadow dark:border-gray-700"
              >
                {/* Top row: result badge + game info */}
                <div className="flex items-start gap-3">
                  {badge ? (
                    <div className={`shrink-0 mt-0.5 w-12 py-1 rounded-md text-xs font-bold text-center ${badge.className}`}>
                      {badge.label}
                    </div>
                  ) : (
                    <div className="shrink-0 mt-0.5 w-12 py-1 rounded-md text-xs font-bold text-center bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-gray-600">
                      —
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base font-semibold">
                        {game.white} vs {game.black}
                      </h3>
                      {game.analysisCompleted && (
                        <span className="text-xs bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 px-2 py-0.5 rounded-full whitespace-nowrap">
                          ✓ Analyzed (depth {game.analysisDepth ?? '?'})
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                      {new Date(game.date).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                {/* Analysis progress bar */}
                {analyzing === game.id && analysisProgress && (
                  <div className="mt-2">
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <span>Analyzing...</span>
                      <span>{analysisProgress.current}/{analysisProgress.total} moves</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
                      <div
                        className="bg-blue-500 h-2 rounded-full transition-all"
                        style={{ width: `${(analysisProgress.current / analysisProgress.total) * 100}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* AI Thinking progress bar */}
                {analyzingThinking === game.id && (
                  <div className="mt-2">
                    <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
                      <span>AI analyzing entries...</span>
                      {thinkingProgress && thinkingProgress.total > 0 ? (
                        <span>{thinkingProgress.current}/{thinkingProgress.total} entries</span>
                      ) : (
                        <span>Starting...</span>
                      )}
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mt-1 overflow-hidden">
                      <div
                        className={`h-2 rounded-full transition-all duration-500 ${
                          thinkingProgress && thinkingProgress.total > 0
                            ? 'bg-cyan-500'
                            : 'bg-cyan-400 animate-pulse'
                        }`}
                        style={{
                          width: thinkingProgress && thinkingProgress.total > 0
                            ? `${Math.max(4, (thinkingProgress.current / thinkingProgress.total) * 100)}%`
                            : '100%',
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Bottom row: action buttons */}
                <div className="flex flex-wrap gap-2 mt-3">
                  <Link
                    href={`/games/${game.id}`}
                    className="px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 text-sm"
                  >
                    View
                  </Link>
                  {game.result !== null && (game.analysisCompleted ? (
                    <>
                      <Link
                        href={`/games/${game.id}/analysis`}
                        className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600 text-sm"
                      >
                        View Analysis
                      </Link>
                      <button
                        onClick={() => analyzeGame(game.id)}
                        disabled={analyzing === game.id}
                        className="px-3 py-1 bg-orange-500 text-white rounded hover:bg-orange-600 disabled:bg-gray-400 text-sm"
                      >
                        Re-analyze
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => analyzeGame(game.id)}
                      disabled={analyzing === game.id}
                      className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400 text-sm flex items-center gap-1"
                    >
                      {analyzing === game.id ? (
                        <>
                          <span className="animate-spin">⚙️</span>
                          Analyzing...
                        </>
                      ) : (
                        'Analyze'
                      )}
                    </button>
                  ))}
                  {game.result !== null && game.analysisCompleted && gamesWithEntries.has(game.id) && (
                    <>
                      <button
                        onClick={() => analyzeThinking(game.id)}
                        disabled={analyzingThinking === game.id}
                        className="px-3 py-1 bg-cyan-500 text-white rounded hover:bg-cyan-600 disabled:bg-gray-400 text-sm flex items-center gap-1"
                      >
                        {analyzingThinking === game.id ? (
                          <>
                            <span className="animate-spin">⚙️</span>
                            AI...
                          </>
                        ) : (
                          '🧠 Analyze Thinking'
                        )}
                      </button>
                      {game.analysisCompleted && !existingSummaries.has(game.id) && (
                        <button
                          onClick={() => openPostGameSummary(game)}
                          className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm flex items-center gap-1"
                        >
                          🏁 Summary
                        </button>
                      )}
                      {game.analysisCompleted && existingSummaries.has(game.id) && (
                        <Link
                          href="/journal"
                          className="px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-200 dark:hover:bg-blue-800 text-sm"
                        >
                          🏁 View Summary
                        </Link>
                      )}
                    </>
                  )}
                  {game.result !== null && game.analysisCompleted && gamesWithEntries.has(game.id) && (
                    <button
                      onClick={() => {
                        setShowBlogModal(game.id);
                        setBlogGameData({ opponent: game.opponent, result: game.result });
                      }}
                      className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded text-sm"
                    >
                      Blog Post
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showSummaryForm && summaryGameData && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <PostGameSummaryForm
              gameId={summaryGameData.gameId}
              gameSnapshot={summaryGameData.gameSnapshot}
              statistics={summaryGameData.statistics}
              onSaved={() => {
                setExistingSummaries(prev => new Set([...prev, summaryGameData.gameId]));
                setShowSummaryForm(null);
                setSummaryGameData(null);
                showToast('🏁 Post-game summary saved to journal!');
              }}
              onCancel={() => {
                setShowSummaryForm(null);
                setSummaryGameData(null);
              }}
            />
          </div>
        </div>
      )}
      {showBlogModal && blogGameData && (
        <BlogPostModal
          gameId={showBlogModal}
          opponent={blogGameData.opponent}
          result={blogGameData.result}
          onClose={() => {
            setShowBlogModal(null);
            setBlogGameData(null);
          }}
        />
      )}
    </div>
  );
}
