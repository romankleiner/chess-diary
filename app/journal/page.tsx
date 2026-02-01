'use client';

import { useEffect, useState } from 'react';

interface JournalEntry {
  id: number;
  date: string;
  gameId: string | null;
  entryType: string;
  content: string;
  moveNumber?: number;
  moveNotation?: string;
  timestamp: string;
}

interface Game {
  id: string;
  opponent: string;
  white: string;
  black: string;
  url?: string;
  result: string | null;
  turn?: string;
}

export default function JournalPage() {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeGames, setActiveGames] = useState<Game[]>([]);
  const [allGames, setAllGames] = useState<Game[]>([]);
  const [username, setUsername] = useState<string>('');
  const [showAllGames, setShowAllGames] = useState(false);
  const [currentGameId, setCurrentGameId] = useState<string | null>(null);
  const [thought, setThought] = useState('');
  const [entryMode, setEntryMode] = useState<'general' | 'game'>('general');

  useEffect(() => {
    loadEntries();
    loadActiveGames();
    loadUsername();
  }, [selectedDate]);

  const loadUsername = async () => {
    try {
      const response = await fetch('/api/settings');
      const data = await response.json();
      setUsername(data.settings.chesscom_username || '');
    } catch (error) {
      console.error('Error loading username:', error);
    }
  };

  const loadEntries = async () => {
    setLoading(true);
    try {
      const endDate = new Date(selectedDate);
      const startDate = new Date(selectedDate);
      startDate.setDate(startDate.getDate() - 6);
      
      const allEntries: JournalEntry[] = [];
      const currentDate = new Date(startDate);
      
      while (currentDate <= endDate) {
        const dateStr = currentDate.toISOString().split('T')[0];
        const response = await fetch(`/api/journal?date=${dateStr}`);
        const data = await response.json();
        
        if (data.entries) {
          allEntries.push(...data.entries);
        }
        
        currentDate.setDate(currentDate.getDate() + 1);
      }
      
      allEntries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setEntries(allEntries);
      
      const gameEntries = allEntries.filter((e: JournalEntry) => e.gameId);
      if (gameEntries.length > 0) {
        setCurrentGameId(gameEntries[0].gameId);
      }
      
      // Also load all games so we can display opponent names in entries
      await loadActiveGames();
    } catch (error) {
      console.error('Error loading entries:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadActiveGames = async () => {
    try {
      const response = await fetch('/api/games');
      const data = await response.json();
      
      // Store all games for display in journal
      setAllGames(data.games || []);
      
      // Filter for active games for selection
      const active = data.games.filter((g: Game) => !g.result || g.result === 'null');
      setActiveGames(active);
    } catch (error) {
      console.error('Error loading active games:', error);
    }
  };

  const selectGame = (gameId: string) => {
    setCurrentGameId(gameId);
    setEntryMode('game');
  };

  const addEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!thought.trim()) {
      alert('Please enter your thoughts');
      return;
    }
    
    try {
      const response = await fetch('/api/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: selectedDate,
          gameId: entryMode === 'game' ? currentGameId : null,
          entryType: 'thought',
          content: thought,
          moveNumber: null,
          moveNotation: null,
        }),
      });
      
      if (response.ok) {
        setThought('');
        loadEntries();
      } else {
        alert('Failed to save entry');
      }
    } catch (error) {
      console.error('Error saving entry:', error);
      alert('Failed to save entry');
    }
  };

  const getDateRangeText = () => {
    const endDate = new Date(selectedDate);
    const startDate = new Date(selectedDate);
    startDate.setDate(startDate.getDate() - 6);
    return `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`;
  };

  const groupedEntries = entries.reduce((groups: Record<string, JournalEntry[]>, entry) => {
    const date = entry.date;
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(entry);
    return groups;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold">Chess Journal</h2>
        <div className="text-right">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md dark:bg-gray-700 dark:border-gray-600"
          />
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
            Showing 7 days ending on this date
          </p>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h3 className="text-xl font-semibold mb-4">What would you like to record?</h3>
        <div className="flex gap-4">
          <button
            onClick={() => setEntryMode('general')}
            className={`flex-1 py-3 px-4 rounded-lg border-2 transition ${
              entryMode === 'general'
                ? 'border-blue-600 bg-blue-50 dark:bg-blue-900'
                : 'border-gray-300 dark:border-gray-600 hover:border-blue-400'
            }`}
          >
            <div className="font-semibold">📝 General Thoughts</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Daily reflections, feelings, or general chess thoughts
            </div>
          </button>
          
          <button
            onClick={() => setEntryMode('game')}
            className={`flex-1 py-3 px-4 rounded-lg border-2 transition ${
              entryMode === 'game'
                ? 'border-blue-600 bg-blue-50 dark:bg-blue-900'
                : 'border-gray-300 dark:border-gray-600 hover:border-blue-400'
            }`}
          >
            <div className="font-semibold">♟️ Game-Specific</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Thoughts about a specific move or position
            </div>
          </button>
        </div>
      </div>

      {entryMode === 'game' && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-semibold">Select Game</h3>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showAllGames}
                onChange={(e) => setShowAllGames(e.target.checked)}
                className="rounded"
              />
              Show games where it's not my turn
            </label>
          </div>
          
          {activeGames.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                No active games found. Fetch your games from Chess.com first.
              </p>
              <a href="/games" className="text-blue-600 hover:underline">
                Go to Games →
              </a>
            </div>
          ) : (
            <>
              {currentGameId && (
                <div className="mb-4 p-3 bg-green-100 dark:bg-green-900 rounded">
                  <p className="text-sm">
                    Currently focused on: <strong>{activeGames.find(g => g.id === currentGameId)?.opponent || currentGameId}</strong>
                  </p>
                </div>
              )}
              
              {(() => {
                // Get username from settings
                const username = activeGames[0]?.white === activeGames.find(g => g.id === currentGameId)?.white 
                  ? activeGames[0].white 
                  : activeGames[0]?.black;
                
                // Filter games based on checkbox
                const filteredGames = showAllGames 
                  ? activeGames 
                  : activeGames.filter(game => {
                      // Show game if it's the user's turn
                      const isWhite = game.white.toLowerCase() === username?.toLowerCase();
                      return (isWhite && game.turn === 'white') || (!isWhite && game.turn === 'black');
                    });
                
                if (filteredGames.length === 0) {
                  return (
                    <div className="text-center py-4 text-gray-600 dark:text-gray-400">
                      No games where it's your turn. Check the box above to see all games.
                    </div>
                  );
                }
                
                return (
                  <div className="space-y-2">
                    {filteredGames.map((game) => {
                      const isWhite = game.white.toLowerCase() === username?.toLowerCase();
                      const isMyTurn = (isWhite && game.turn === 'white') || (!isWhite && game.turn === 'black');
                      
                      return (
                        <button
                          key={game.id}
                          onClick={() => selectGame(game.id)}
                          className={`w-full p-4 rounded-lg border text-left transition ${
                            currentGameId === game.id
                              ? 'border-green-500 bg-green-50 dark:bg-green-900'
                              : 'border-gray-300 dark:border-gray-600 hover:border-blue-400'
                          }`}
                        >
                          <div className="flex justify-between items-start">
                            <div>
                              <div className="font-semibold">vs {game.opponent}</div>
                              <div className="text-sm text-gray-600 dark:text-gray-400">
                                {game.white} vs {game.black}
                              </div>
                            </div>
                            {isMyTurn && (
                              <span className="text-xs bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 px-2 py-1 rounded">
                                Your turn
                              </span>
                            )}
                          </div>
                          {game.url && (
                            <a
                              href={game.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 hover:underline mt-2 inline-block"
                              onClick={(e) => e.stopPropagation()}
                            >
                              View on Chess.com →
                            </a>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
            </>
          )}
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h3 className="text-xl font-semibold mb-4">
          {entryMode === 'general' ? 'Add General Thoughts' : 'Add Game Thoughts'}
        </h3>
        
        <form onSubmit={addEntry} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              Your Thoughts
            </label>
            <textarea
              value={thought}
              onChange={(e) => setThought(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md dark:bg-gray-700 dark:border-gray-600 h-32"
              placeholder={
                entryMode === 'general'
                  ? "What's on your mind today? Any general chess thoughts or reflections..."
                  : "What are you thinking about this position or move?"
              }
              required
            />
          </div>
          
          <button
            type="submit"
            className="bg-green-600 text-white px-6 py-2 rounded hover:bg-green-700"
          >
            Add Entry
          </button>
        </form>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h3 className="text-xl font-semibold mb-4">
          Journal Entries ({getDateRangeText()})
        </h3>
        
        {loading ? (
          <p className="text-center text-gray-600">Loading...</p>
        ) : entries.length === 0 ? (
          <p className="text-center text-gray-600">No entries in the last 7 days. Start writing!</p>
        ) : (
          <div className="space-y-6">
            {Object.keys(groupedEntries)
              .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())
              .map((date) => (
                <div key={date}>
                  <h4 className="text-lg font-semibold mb-3 text-blue-600 dark:text-blue-400 border-b pb-2">
                    {new Date(date).toLocaleDateString('en-US', { 
                      weekday: 'long', 
                      year: 'numeric', 
                      month: 'long', 
                      day: 'numeric' 
                    })}
                  </h4>
                  <div className="space-y-3 ml-4">
                    {groupedEntries[date]
                      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
                      .map((entry) => {
                        // Find game info if this is a game-specific entry
                        const game = entry.gameId ? allGames.find(g => g.id === entry.gameId) : null;
                        
                        // Determine user's color and current move
                        let userColor = '';
                        let moveInfo = '';
                        if (game && username) {
                          const isWhite = game.white.toLowerCase() === username.toLowerCase();
                          userColor = isWhite ? '⚪' : '⚫';
                          
                          // Extract move number from FEN if available
                          // FEN format: rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1
                          // The last number is the full move number
                          if (game.fen) {
                            const fenParts = game.fen.split(' ');
                            if (fenParts.length >= 6) {
                              const moveNumber = fenParts[5];
                              moveInfo = ` • Move ${moveNumber}`;
                            }
                          }
                        }
                        
                        return (
                          <div
                            key={entry.id}
                            className={`p-4 rounded border-l-4 ${
                              entry.entryType === 'game_start'
                                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900'
                                : entry.entryType === 'move'
                                ? 'border-green-500 bg-green-50 dark:bg-green-900'
                                : entry.gameId
                                ? 'border-purple-500 bg-purple-50 dark:bg-purple-900'
                                : 'border-gray-500 bg-gray-50 dark:bg-gray-700'
                            }`}
                          >
                            <div className="flex justify-between items-start mb-2">
                              <div>
                                {entry.gameId && game && (
                                  <div className="font-semibold text-sm text-purple-600 dark:text-purple-400">
                                    ♟️ {userColor} vs {game.opponent}{moveInfo}
                                  </div>
                                )}
                                {entry.gameId && entry.entryType === 'game_start' && (
                                  <span className="font-semibold text-sm text-blue-600 dark:text-blue-400">
                                    🎯 Game Focus Changed
                                  </span>
                                )}
                                {entry.moveNumber && entry.moveNotation && (
                                  <span className="font-semibold text-sm">
                                    Move {entry.moveNumber}: {entry.moveNotation}
                                  </span>
                                )}
                                {!entry.gameId && entry.entryType === 'thought' && (
                                  <span className="font-semibold text-sm text-gray-600 dark:text-gray-400">
                                    💭 General Thoughts
                                  </span>
                                )}
                              </div>
                              <span className="text-xs text-gray-500">
                                {new Date(entry.timestamp).toLocaleTimeString()}
                              </span>
                            </div>
                            <p className="text-sm whitespace-pre-wrap">{entry.content}</p>
                          </div>
                        );
                      })}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
