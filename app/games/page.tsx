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

  useEffect(() => {
    loadGames();
  }, []);

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
      const now = new Date();
      const response = await fetch(
        `/api/games/fetch?year=${now.getFullYear()}&month=${now.getMonth() + 1}`
      );
      const data = await response.json();
      
      if (data.error) {
        alert(data.error);
      } else {
        alert(`Fetched ${data.count} games from Chess.com`);
        loadGames();
      }
    } catch (error) {
      console.error('Error fetching games:', error);
      alert('Failed to fetch games from Chess.com');
    } finally {
      setFetching(false);
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
                    <Link
                      href={`/games/${game.id}`}
                      className="text-blue-600 hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
