'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface Game {
  id: string;
  opponent: string;
  date: string;
  result: string;
  pgn: string;
  url?: string;
  white: string;
  black: string;
  analysisCompleted: boolean;
}

interface JournalEntry {
  id: number;
  date: string;
  gameId: string;
  entryType: string;
  content: string;
  moveNumber?: number;
  moveNotation?: string;
  timestamp: string;
}

export default function GamePage() {
  const params = useParams();
  const gameId = params.id as string;
  const [game, setGame] = useState<Game | null>(null);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadGameData();
  }, [gameId]);

  const loadGameData = async () => {
    try {
      // Load game details
      const gamesResponse = await fetch('/api/games');
      const gamesData = await gamesResponse.json();
      const foundGame = gamesData.games.find((g: Game) => g.id === gameId);
      
      if (foundGame) {
        setGame(foundGame);
        
        // Load journal entries for this game
        // We need to search through all dates
        // For now, just show a placeholder
        setEntries([]);
      }
    } catch (error) {
      console.error('Error loading game:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading game...</div>;
  }

  if (!game) {
    return (
      <div className="text-center py-8">
        <p className="text-red-600 mb-4">Game not found</p>
        <Link href="/games" className="text-blue-600 hover:underline">
          ← Back to Games
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold">Game Details</h2>
        <Link href="/games" className="text-blue-600 hover:underline">
          ← Back to Games
        </Link>
      </div>

      {/* Game Info */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400">Date</p>
            <p className="font-semibold">{game.date}</p>
          </div>
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400">Result</p>
            <p className={`font-semibold ${
              game.result === 'win' ? 'text-green-600' :
              game.result === 'loss' ? 'text-red-600' :
              'text-gray-600'
            }`}>
              {game.result || 'In Progress'}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400">White</p>
            <p className="font-semibold">{game.white}</p>
          </div>
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400">Black</p>
            <p className="font-semibold">{game.black}</p>
          </div>
          <div className="col-span-2">
            <p className="text-sm text-gray-600 dark:text-gray-400">Opponent</p>
            <p className="font-semibold">{game.opponent}</p>
          </div>
          {game.url && (
            <div className="col-span-2">
              <p className="text-sm text-gray-600 dark:text-gray-400">Chess.com Link</p>
              <a 
                href={game.url} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                View on Chess.com →
              </a>
            </div>
          )}
        </div>
      </div>

      {/* PGN */}
      {game.pgn && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h3 className="text-xl font-semibold mb-4">PGN</h3>
          <pre className="bg-gray-100 dark:bg-gray-900 p-4 rounded overflow-x-auto text-sm">
            {game.pgn}
          </pre>
        </div>
      )}

      {/* Your Thoughts */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h3 className="text-xl font-semibold mb-4">Your Thoughts</h3>
        {entries.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              No journal entries found for this game yet.
            </p>
            <Link 
              href="/journal" 
              className="text-blue-600 hover:underline"
            >
              Go to Journal to add thoughts →
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="p-4 border-l-4 border-gray-500 bg-gray-50 dark:bg-gray-700 rounded"
              >
                {entry.moveNumber && entry.moveNotation && (
                  <p className="font-semibold text-sm mb-2">
                    Move {entry.moveNumber}: {entry.moveNotation}
                  </p>
                )}
                <p className="text-sm whitespace-pre-wrap">{entry.content}</p>
                <p className="text-xs text-gray-500 mt-2">
                  {new Date(entry.timestamp).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Analysis Section (Placeholder) */}
      {!game.analysisCompleted && (
        <div className="bg-blue-50 dark:bg-blue-900 rounded-lg p-6">
          <h3 className="text-xl font-semibold mb-2">Analysis</h3>
          <p className="text-sm mb-4">
            This game hasn't been analyzed yet. Once the game is complete and you've recorded your thoughts, 
            you can run engine analysis to see how your thinking compared.
          </p>
          <button
            className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 disabled:bg-gray-400"
            disabled
          >
            Analyze Game (Coming Soon)
          </button>
        </div>
      )}
    </div>
  );
}
