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
  analysis_completed: number;
}

export default function GamesPage() {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [analyzing, setAnalyzing] = useState<string | null>(null); // Track which game is being analyzed
  const [toast, setToast] = useState<{ message: string; show: boolean }>({ message: '', show: false });

  useEffect(() => {
    loadGames();
  }, []);

  const showToast = (message: string) => {
    setToast({ message, show: true });
    setTimeout(() => {
      setToast({ message: '', show: false });
    }, 3000); // Auto-hide after 3 seconds
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
      // Fetch recent games from last 3 months including finished games
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
    if (!confirm('Analyze this game with Stockfish? This may take a few minutes.')) {
      return;
    }
    
    setAnalyzing(gameId);
    try {
      const response = await fetch('/api/games/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        showToast(`Analysis complete! White: ${data.analysis.whiteAccuracy}% | Black: ${data.analysis.blackAccuracy}%`);
        loadGames(); // Reload to update analysis status
      } else {
        alert('Failed to analyze game');
      }
    } catch (error) {
      console.error('Error analyzing game:', error);
      alert('Failed to analyze game');
    } finally {
      setAnalyzing(null);
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading games...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold">My Games</h2>
        <button
          onClick={fetchFromChessCom}
          disabled={fetching}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-gray-400"
        >
          {fetching ? 'Fetching...' : 'Fetch from Chess.com'}
        </button>
      </div>

      {games.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <p className="text-center text-gray-600 dark:text-gray-400">
            No games found. Click "Fetch from Chess.com" to import your games.
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Opponent
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Result
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {games.map((game) => (
                <tr key={game.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    {game.date}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    {game.opponent}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <span className={`px-2 py-1 rounded ${
                      game.result === 'win' ? 'bg-green-100 text-green-800' :
                      game.result === 'loss' ? 'bg-red-100 text-red-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {game.result}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    {game.analysis_completed ? 'Analyzed' : 'Not analyzed'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <div className="flex gap-2">
                      <Link
                        href={`/games/${game.id}`}
                        className="text-blue-600 hover:underline"
                      >
                        View
                      </Link>
                      {game.result && game.result !== 'null' && !game.analysis_completed && (
                        <button
                          onClick={() => analyzeGame(game.id)}
                          disabled={analyzing === game.id}
                          className="text-purple-600 hover:underline disabled:text-gray-400 disabled:cursor-not-allowed"
                        >
                          {analyzing === game.id ? 'Analyzing...' : 'Analyze'}
                        </button>
                      )}
                      {game.analysis_completed && (
                        <span className="text-green-600">✓ Analyzed</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      
      {/* Toast notification */}
      {toast.show && (
        <div className="fixed bottom-4 right-4 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg transition-opacity duration-300 z-50">
          {toast.message}
        </div>
      )}
    </div>
  );
}
