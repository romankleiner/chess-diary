'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Game {
  id: string;
  opponent: string;
  date: string;
  result: string;
  white: string;
  black: string;
  analysisCompleted?: boolean;
  analysisDepth?: number;
  analysisEngine?: string;
}

export default function GamesPage() {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<{ current: number; total: number } | null>(null);
  const [toast, setToast] = useState<{ message: string; show: boolean }>({ message: '', show: false });
  const [analyzingThinking, setAnalyzingThinking] = useState<string | null>(null);

  useEffect(() => {
    loadGames();
  }, []);

  const showToast = (message: string) => {
    setToast({ message, show: true });
    setTimeout(() => {
      setToast({ message: '', show: false });
    }, 3000);
  };

  const loadGames = async () => {
    try {
      const response = await fetch('/api/games');
      const data = await response.json();
      setGames(data.games || []);
    } catch (error) {
      console.error('Error loading games:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchFromChessCom = async () => {
    setFetching(true);
    try {
      const response = await fetch('/api/games/fetch?includeRecent=true');
      const data = await response.json();
      
      if (data.error) {
        alert(data.error);
      } else {
        showToast(`Fetched ${data.count} games from Chess.com ✓`);
        loadGames();
      }
    } catch (error) {
      console.error('Error fetching games:', error);
      alert('Failed to fetch games from Chess.com');
    } finally {
      setFetching(false);
    }
  };

  const analyzeGame = async (gameId: string) => {
    const game = games.find(g => g.id === gameId);
    const isReanalyze = game?.analysisCompleted;
    
    if (!confirm(isReanalyze 
      ? 'Re-analyze this game? This will overwrite the existing analysis.' 
      : 'Analyze this game with Stockfish? This may take a few minutes.'
    )) {
      return;
    }
    
    setAnalyzing(gameId);
    setAnalysisProgress({ current: 0, total: 100 });
    
    // Poll for progress - works for both local and Vercel
    const progressInterval = setInterval(async () => {
      try {
        const progressRes = await fetch(`/api/games/analyze?gameId=${gameId}`);
        const progressData = await progressRes.json();
        if (progressData.total > 0) {
          setAnalysisProgress({
            current: progressData.current,
            total: progressData.total
          });
        }
      } catch (error) {
        // Ignore polling errors
      }
    }, 1000);
    
    try {
      let completed = false;
      let nextMoveIndex = 0;
      let finalData = null;
      
      console.log('[FRONTEND] Starting analysis for game:', gameId);
      
      // Keep requesting batches until complete (Vercel batches, local completes in one)
      while (!completed) {
        console.log('[FRONTEND] Requesting batch starting at move:', nextMoveIndex);
        
        const response = await fetch('/api/games/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gameId, startMoveIndex: nextMoveIndex }),
        });
        
        console.log('[FRONTEND] Response status:', response.status);
        
        const data = await response.json();
        console.log('[FRONTEND] Response data:', data);
        
        if (!data.success) {
          throw new Error(data.error || 'Analysis failed');
        }
        
        finalData = data;
        completed = data.completed;
        nextMoveIndex = data.nextMoveIndex || 0;
        
        console.log('[FRONTEND] Batch done. Completed:', completed, 'Next:', nextMoveIndex);
        
        if (!completed) {
          // Small delay between batches (only affects Vercel)
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      console.log('[FRONTEND] Analysis complete. Final data:', finalData);
      
      if (finalData?.analysis) {
        const depth = finalData.analysis.depth || '?';
        const engine = finalData.analysis.engine || 'engine';
        showToast(`Analysis complete! White: ${finalData.analysis.whiteAccuracy}% | Black: ${finalData.analysis.blackAccuracy}% (${engine} depth ${depth})`);
      } else {
        console.warn('[FRONTEND] Analysis completed but no analysis data in response');
        showToast('Analysis complete!');
      }
      
      console.log('[FRONTEND] Reloading games list...');
      await loadGames();
      console.log('[FRONTEND] Games reloaded');
    } catch (error) {
      console.error('[FRONTEND] Error analyzing game:', error);
      alert(`Failed to analyze game: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      clearInterval(progressInterval);
      setAnalyzing(null);
      setAnalysisProgress(null);
    }
  };

  const analyzeThinking = async (gameId: string) => {
    try {
      setAnalyzingThinking(gameId);
      
      // Check if engine analysis exists
      const checkResponse = await fetch('/api/games/analyze-thinking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId })
      });
      
      const checkData = await checkResponse.json();
      
      if (checkData.needsEngineAnalysis) {
        if (!confirm('Engine analysis is required first. Would you like to run it now?')) {
          setAnalyzingThinking(null);
          return;
        }
        // Trigger engine analysis first
        await analyzeGame(gameId);
        setAnalyzingThinking(null);
        return;
      }
      
      if (!confirm('This will analyze all your journal entries for this game using AI. Continue?')) {
        setAnalyzingThinking(null);
        return;
      }
      
      const response = await fetch('/api/games/analyze-thinking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId, reanalyzeEngine: false })
      });
      
      const data = await response.json();
      
      if (data.success) {
        showToast(`🤖 AI analysis complete! ${data.entriesAnalyzed} entries analyzed.`);
      } else {
        alert(data.error || 'Analysis failed');
      }
    } catch (error) {
      console.error('AI analysis error:', error);
      alert('Failed to analyze thinking');
    } finally {
      setAnalyzingThinking(null);
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <p className="text-center text-gray-600">Loading games...</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Toast notification */}
      {toast.show && (
        <div className="fixed top-4 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-fade-in">
          {toast.message}
        </div>
      )}

      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">My Games</h1>
        <button
          onClick={fetchFromChessCom}
          disabled={fetching}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400"
        >
          {fetching ? 'Fetching...' : 'Fetch from Chess.com'}
        </button>
      </div>

      {games.length === 0 ? (
        <p className="text-center text-gray-600">
          No games found. Click "Fetch from Chess.com" to import your games.
        </p>
      ) : (
        <div className="space-y-4">
          {games.map((game) => (
            <div
              key={game.id}
              className="border rounded-lg p-4 hover:shadow-md transition-shadow dark:border-gray-700"
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold">
                      {game.white} vs {game.black}
                    </h3>
                    {game.analysisCompleted && (
                      <span className="text-xs bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 px-2 py-1 rounded" title={`Analyzed with ${game.analysisEngine || 'engine'} at depth ${game.analysisDepth || '?'}`}>
                        ✓ Analyzed (depth {game.analysisDepth || '?'})
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {new Date(game.date).toLocaleDateString()} • Result: {game.result}
                  </p>
                  
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
                </div>
                
                <div className="flex gap-2 ml-4">
                  <Link
                    href={`/games/${game.id}`}
                    className="px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 text-sm"
                  >
                    View
                  </Link>
                  
                  {game.analysisCompleted ? (
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
                          <>
                            🤖 Analyze Thinking
                          </>
                        )}
                      </button>
                    </>
                  ) : (game.result && !game.result.includes('progress')) ? (
                    // Only show analyze for finished games (has a result, not in progress)
                    <button
                      onClick={() => analyzeGame(game.id)}
                      disabled={analyzing === game.id}
                      className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400 text-sm"
                    >
                      {analyzing === game.id ? 'Analyzing...' : 'Analyze'}
                    </button>
                  ) : (
                    // Unfinished game - show status
                    <span className="px-3 py-1 text-sm text-gray-500 italic">
                      In Progress
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
