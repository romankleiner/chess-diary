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
  fen?: string;
  myMove?: string;
  image?: string;
}

interface Game {
  id: string;
  opponent: string;
  white: string;
  black: string;
  url?: string;
  result: string | null;
  turn?: string;
  fen?: string;
  move_by?: number; // Unix timestamp of when the next move is due
}

export default function JournalPage() {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeGames, setActiveGames] = useState<Game[]>([]);
  const [allGames, setAllGames] = useState<Game[]>([]);
  const [gamesFetchedAt, setGamesFetchedAt] = useState<number>(Date.now());
  const [username, setUsername] = useState<string>('');
  const [showAllGames, setShowAllGames] = useState(false);
  const [currentGameId, setCurrentGameId] = useState<string | null>(null);
  const [thought, setThought] = useState('');
  const [myMove, setMyMove] = useState('');
  const [image, setImage] = useState<string>('');
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportStartDate, setExportStartDate] = useState('');
  const [exportEndDate, setExportEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [entryMode, setEntryMode] = useState<'general' | 'game'>('general');
  const [filterGameId, setFilterGameId] = useState<string>('all'); // 'all', 'general', or specific game ID

  useEffect(() => {
    loadEntries();
    loadActiveGames();
    loadUsername();
  }, [selectedDate]);

  const loadUsername = async () => {
    try {
      const response = await fetch('/api/settings');
      const data = await response.json();
      setUsername(data.settings?.chesscom_username || '');
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
      const fetchTime = Date.now();
      const response = await fetch('/api/games');
      const data = await response.json();
      
      // Store all games for display in journal
      setAllGames(data.games || []);
      
      // Filter for active games for selection
      const active = data.games.filter((g: Game) => !g.result || g.result === 'null');
      setActiveGames(active);
      
      // Store when games were fetched for accurate time remaining calculation
      setGamesFetchedAt(fetchTime);
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
    
    // Validate that a game is selected when in game mode
    if (entryMode === 'game' && !currentGameId) {
      alert('Please select a game first');
      return;
    }
    
    // Get current FEN from the game if it's a game entry
    let currentFen = null;
    if (entryMode === 'game' && currentGameId) {
      const game = allGames.find(g => g.id === currentGameId);
      if (game) {
        currentFen = game.fen;
      }
    }
    
    try {
      if (editingEntry) {
        // Update existing entry
        const response = await fetch(`/api/journal/${editingEntry.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: thought,
            myMove: myMove.trim() || null,
            image: image || null,
          }),
        });
        
        if (response.ok) {
          const data = await response.json();
          
          setThought('');
          setMyMove('');
          setImage('');
          setEditingEntry(null);
          
          // Update the entry in state instead of reloading all entries
          if (data.entry) {
            setEntries(prevEntries => 
              prevEntries.map(e => e.id === data.entry.id ? data.entry : e)
            );
          }
        } else {
          alert('Failed to update entry');
        }
      } else {
        // Create new entry
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
            fen: currentFen,
            myMove: myMove.trim() || null,
            image: image || null,
          }),
        });
        
        if (response.ok) {
          const data = await response.json();
          
          // Track if we should clear the game selection
          const shouldClearGame = myMove.trim() && currentGameId;
          
          // Clear form fields
          setThought('');
          setMyMove('');
          setImage('');
          
          // Add the new entry directly to state instead of reloading all entries
          if (data.entry) {
            setEntries(prevEntries => [...prevEntries, data.entry]);
          }
          
          // If a move was specified, toggle the turn in the game
          if (shouldClearGame) {
            await toggleGameTurn(currentGameId);
            setCurrentGameId(null);
            // Only reload games to update turn status
            loadActiveGames();
          }
        } else {
          alert('Failed to save entry');
        }
      }
    } catch (error) {
      console.error('Error saving entry:', error);
      alert('Failed to save entry');
    }
  };

  const handleImagePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = (event) => {
            setImage(event.target?.result as string);
          };
          reader.readAsDataURL(file);
        }
        break;
      }
    }
  };

  const toggleGameTurn = async (gameId: string) => {
    try {
      const response = await fetch(`/api/games/${gameId}/toggle-turn`, {
        method: 'POST',
      });
      
      if (response.ok) {
        // Reload games to update the "your turn" filter
        await loadActiveGames();
      }
    } catch (error) {
      console.error('Error toggling turn:', error);
    }
  };

  const handleDeleteEntry = async (entryId: number) => {
    if (!confirm('Are you sure you want to delete this entry? This cannot be undone.')) {
      return;
    }
    
    try {
      const response = await fetch(`/api/journal/${entryId}`, {
        method: 'DELETE',
      });
      
      if (response.ok) {
        // Remove entry from state instead of reloading all entries
        setEntries(prevEntries => prevEntries.filter(e => e.id !== entryId));
      } else {
        alert('Failed to delete entry');
      }
    } catch (error) {
      console.error('Error deleting entry:', error);
      alert('Failed to delete entry');
    }
  };

  const handleEditEntry = (entry: JournalEntry) => {
    setEditingEntry(entry);
    setThought(entry.content);
    setMyMove(entry.myMove || '');
    setImage(entry.image || '');
    setCurrentGameId(entry.gameId);
    setEntryMode(entry.gameId ? 'game' : 'general');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleExportJournal = async () => {
    try {
      const startDate = exportStartDate || '2020-01-01';
      const endDate = exportEndDate;
      
      // Request Word document
      const response = await fetch(
        `/api/journal/export?startDate=${startDate}&endDate=${endDate}&format=docx&username=${encodeURIComponent(username)}`
      );
      
      if (!response.ok) {
        alert('Failed to export journal');
        return;
      }
      
      // Download the Word document
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chess-journal-${startDate}-to-${endDate}.docx`;
      a.click();
      URL.revokeObjectURL(url);
      
      setShowExportModal(false);
      
    } catch (error) {
      console.error('Error exporting journal:', error);
      alert('Failed to export journal');
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
        <div className="flex items-center gap-4">
          <button
            onClick={() => setShowExportModal(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-sm"
          >
            📥 Export Journal
          </button>
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
      </div>

      {/* Export Modal */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-semibold mb-4">Export Journal</h3>
            
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm font-medium mb-2">
                  Start Date (optional - leave empty for all entries)
                </label>
                <input
                  type="date"
                  value={exportStartDate}
                  onChange={(e) => setExportStartDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md dark:bg-gray-700 dark:border-gray-600"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">
                  End Date
                </label>
                <input
                  type="date"
                  value={exportEndDate}
                  onChange={(e) => setExportEndDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md dark:bg-gray-700 dark:border-gray-600"
                />
              </div>
              
              <p className="text-xs text-gray-500">
                Export format: Microsoft Word document (.docx) with chronological entries (oldest to newest)
              </p>
            </div>
            
            <div className="flex gap-3">
              <button
                onClick={handleExportJournal}
                className="flex-1 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
              >
                Export
              </button>
              <button
                onClick={() => setShowExportModal(false)}
                className="flex-1 bg-gray-300 text-gray-800 px-4 py-2 rounded hover:bg-gray-400 dark:bg-gray-600 dark:text-white dark:hover:bg-gray-500"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

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
                // Helper function to format time remaining
                const formatTimeRemaining = (moveBy: number | undefined) => {
                  if (!moveBy) return null;
                  
                  // Use when games were fetched, not current time
                  const deadline = moveBy * 1000; // Convert to milliseconds
                  const remaining = deadline - gamesFetchedAt;
                  
                  if (remaining < 0) return 'Time expired';
                  
                  const days = Math.floor(remaining / (1000 * 60 * 60 * 24));
                  const hours = Math.floor((remaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
                  
                  if (days > 0) return `${days}d ${hours}h`;
                  if (hours > 0) return `${hours}h ${minutes}m`;
                  return `${minutes}m`;
                };
                
                // Filter and sort games
                const myTurnGames = activeGames.filter(game => {
                  const isWhite = game.white.toLowerCase() === username?.toLowerCase();
                  return (isWhite && game.turn === 'white') || (!isWhite && game.turn === 'black');
                });
                
                const notMyTurnGames = activeGames.filter(game => {
                  const isWhite = game.white.toLowerCase() === username?.toLowerCase();
                  return !((isWhite && game.turn === 'white') || (!isWhite && game.turn === 'black'));
                });
                
                // Sort my turn games by time remaining (least time first)
                myTurnGames.sort((a, b) => {
                  if (!a.move_by && !b.move_by) return 0;
                  if (!a.move_by) return 1;
                  if (!b.move_by) return -1;
                  return a.move_by - b.move_by;
                });
                
                // Combine: my turn games first, then opponent's turn
                const filteredGames = showAllGames 
                  ? [...myTurnGames, ...notMyTurnGames]
                  : myTurnGames;
                
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
                      const timeRemaining = formatTimeRemaining(game.move_by);
                      
                      // Get move number from FEN
                      let moveNumber = '';
                      if (game.fen) {
                        const fenParts = game.fen.split(' ');
                        if (fenParts.length >= 6) {
                          moveNumber = fenParts[5];
                        }
                      }
                      
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
                              <div className="font-semibold">
                                {isWhite ? '⚪' : '⚫'} vs {game.opponent}
                              </div>
                              <div className="text-sm text-gray-600 dark:text-gray-400">
                                {game.white} vs {game.black}
                              </div>
                              {moveNumber && (
                                <div className="text-xs text-gray-500 mt-1">
                                  Move {moveNumber}
                                </div>
                              )}
                            </div>
                            <div className="flex flex-col items-end gap-1">
                              {isMyTurn && timeRemaining && (
                                <span className="text-xs font-semibold text-orange-600 dark:text-orange-400">
                                  ⏱️ {timeRemaining}
                                </span>
                              )}
                              {isMyTurn && (
                                <span className="text-xs bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 px-2 py-1 rounded">
                                  Your turn
                                </span>
                              )}
                            </div>
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
          {editingEntry ? '✏️ Edit Entry' : (entryMode === 'general' ? 'Add General Thoughts' : 'Add Game Thoughts')}
        </h3>
        
        {editingEntry && (
          <div className="mb-4 p-3 bg-yellow-100 dark:bg-yellow-900 rounded">
            <p className="text-sm">
              Editing entry from {new Date(editingEntry.timestamp).toLocaleString()}
              <button
                onClick={() => {
                  setEditingEntry(null);
                  setThought('');
                  setMyMove('');
                  setImage('');
                }}
                className="ml-4 text-xs text-blue-600 hover:underline"
              >
                Cancel Edit
              </button>
            </p>
          </div>
        )}
        
        <form onSubmit={addEntry} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              Your Thoughts
            </label>
            <textarea
              value={thought}
              onChange={(e) => setThought(e.target.value)}
              onPaste={handleImagePaste}
              spellCheck={true}
              className="w-full px-3 py-2 border border-gray-300 rounded-md dark:bg-gray-700 dark:border-gray-600 h-32"
              placeholder={
                entryMode === 'general'
                  ? "What's on your mind today? Any general chess thoughts or reflections... (Paste images with Ctrl+V)"
                  : "What are you thinking about this position or move? (Paste images with Ctrl+V)"
              }
              required
            />
          </div>
          
          {image && (
            <div>
              <label className="block text-sm font-medium mb-2">
                Attached Image
              </label>
              <div className="relative inline-block">
                <img src={image} alt="Pasted" className="max-w-xs rounded border" />
                <button
                  type="button"
                  onClick={() => setImage('')}
                  className="absolute top-2 right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-600"
                >
                  ✕
                </button>
              </div>
            </div>
          )}
          
          {entryMode === 'game' && currentGameId && (() => {
            const game = allGames.find(g => g.id === currentGameId);
            const fenToUse = game?.fen;
            if (fenToUse && game) {
              // Determine orientation based on player color
              // Compare usernames case-insensitively
              const usernameLower = username?.toLowerCase() || '';
              const whiteLower = game.white?.toLowerCase() || '';
              const blackLower = game.black?.toLowerCase() || '';
              
              const isWhite = usernameLower === whiteLower;
              const isBlack = usernameLower === blackLower;
              
              return (
                <div>
                  <label className="block text-sm font-medium mb-2">
                    Current Position ({isWhite ? 'You are White' : 'You are Black'})
                  </label>
                  <img
                    src={`/api/board-image?fen=${encodeURIComponent(fenToUse)}${isWhite ? '' : '&pov=black'}`}
                    alt="Chess board"
                    className="w-80 h-80 rounded border border-gray-300"
                  />
                </div>
              );
            }
            return null;
          })()}
          
          {entryMode === 'game' && !editingEntry && (
            <div>
              <label className="block text-sm font-medium mb-2">
                My Move (optional)
              </label>
              <input
                type="text"
                value={myMove}
                onChange={(e) => setMyMove(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md dark:bg-gray-700 dark:border-gray-600"
                placeholder="e.g., Nf3, e4, O-O"
              />
              <p className="text-xs text-gray-500 mt-1">
                If you've decided on your move, enter it here. This will mark the game as no longer waiting on you.
              </p>
            </div>
          )}
          
          <button
            type="submit"
            className="bg-green-600 text-white px-6 py-2 rounded hover:bg-green-700"
          >
            {editingEntry ? 'Update Entry' : 'Add Entry'}
          </button>
        </form>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-semibold">
            Journal Entries ({getDateRangeText()})
          </h3>
          
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">Filter:</label>
            <select
              value={filterGameId}
              onChange={(e) => setFilterGameId(e.target.value)}
              className="px-3 py-1 border border-gray-300 rounded-md text-sm dark:bg-gray-700 dark:border-gray-600"
            >
              <option value="all">All Entries</option>
              <option value="general">General Thoughts Only</option>
              <optgroup label="Game-Specific">
                {allGames
                  .filter(g => entries.some(e => e.gameId === g.id))
                  .map(game => (
                    <option key={game.id} value={game.id}>
                      {game.white} vs {game.black}
                    </option>
                  ))}
              </optgroup>
            </select>
          </div>
        </div>
        
        {loading ? (
          <p className="text-center text-gray-600">Loading...</p>
        ) : entries.length === 0 ? (
          <p className="text-center text-gray-600">No entries in the last 7 days. Start writing!</p>
        ) : (
          <div className="space-y-6">
            {Object.keys(groupedEntries)
              .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())
              .map((date) => {
                // Filter entries for this date
                const filteredEntries = groupedEntries[date].filter((entry) => {
                  if (filterGameId === 'all') return true;
                  if (filterGameId === 'general') return !entry.gameId;
                  return entry.gameId === filterGameId;
                });
                
                // Skip this date if no entries match filter
                if (filteredEntries.length === 0) return null;
                
                return (
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
                    {filteredEntries
                      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                      .map((entry) => {
                        // Find game info if this is a game-specific entry
                        const game = entry.gameId ? allGames.find(g => g.id === entry.gameId) : null;
                        
                        // Determine user's color and move number at time of entry
                        let userColor = '';
                        let moveInfo = '';
                        if (game && username) {
                          const isWhite = game.white.toLowerCase() === username.toLowerCase();
                          userColor = isWhite ? '⚪' : '⚫';
                          
                          // Extract move number from the FEN (stored with entry, or fallback to current game FEN)
                          const fenToUse = entry.fen || (game ? game.fen : null);
                          if (fenToUse) {
                            const fenParts = fenToUse.split(' ');
                            if (fenParts.length >= 6) {
                              const moveNumber = fenParts[5];
                              moveInfo = ` • Move ${moveNumber}`;
                            }
                          }
                        }
                        
                        return (
                          <div
                            key={`${entry.id}-${entry.timestamp}`}
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
                                {entry.gameId && game ? (
                                  <div className="font-semibold text-sm text-purple-600 dark:text-purple-400">
                                    ♟️ {userColor} vs {game.opponent}{moveInfo}
                                  </div>
                                ) : entry.gameId ? (
                                  <div className="font-semibold text-sm text-purple-600 dark:text-purple-400">
                                    ♟️ Game Entry (game data not loaded)
                                  </div>
                                ) : null}
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
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-500">
                                  {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                                <button
                                  onClick={() => handleEditEntry(entry)}
                                  className="text-blue-500 hover:text-blue-700 text-xs px-2 py-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900"
                                  title="Edit entry"
                                >
                                  ✏️
                                </button>
                                <button
                                  onClick={() => handleDeleteEntry(entry.id)}
                                  className="text-red-500 hover:text-red-700 text-xs px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900"
                                  title="Delete entry"
                                >
                                  🗑️
                                </button>
                              </div>
                            </div>
                            
                            {/* Chess board visualization for game entries */}
                            {entry.gameId && (entry.fen || (game && game.fen)) && (
                              <div className="my-3 flex flex-col items-center">
                                <div className="relative">
                                  <img
                                    src={`/api/board-image?fen=${encodeURIComponent(entry.fen || game?.fen || '')}${(() => {
                                      // Determine orientation based on user's color
                                      if (game && username) {
                                        const isWhite = game.white.toLowerCase() === username.toLowerCase();
                                        return isWhite ? '' : '&pov=black';
                                      }
                                      return '';
                                    })()}`}
                                    alt="Chess board position"
                                    className="rounded border-2 border-gray-300"
                                    style={{ maxWidth: '400px', width: '100%' }}
                                  />
                                  {!entry.fen && (
                                    <p className="text-xs text-gray-500 italic mt-1">
                                      Note: Showing current position (entry created before position tracking)
                                    </p>
                                  )}
                                  {game?.url && (
                                    <a
                                      href={game.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-xs text-blue-600 hover:underline mt-2 inline-block"
                                    >
                                      View full game on Chess.com →
                                    </a>
                                  )}
                                </div>
                              </div>
                            )}
                            
                            <div className="text-base whitespace-pre-wrap">{(() => {
                              // Function to convert URLs to links
                              const linkifyText = (text: string) => {
                                const urlRegex = /(https?:\/\/[^\s]+)/g;
                                const parts = text.split(urlRegex);
                                
                                return parts.map((part, i) => {
                                  if (part.match(urlRegex)) {
                                    return (
                                      <a
                                        key={i}
                                        href={part}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-blue-600 hover:underline dark:text-blue-400"
                                      >
                                        {part}
                                      </a>
                                    );
                                  }
                                  return part;
                                });
                              };
                              
                              // Convert markdown-style bullets to HTML
                              const lines = entry.content.split('\n');
                              return lines.map((line, idx) => {
                                // Check if line starts with bullet markers
                                const bulletMatch = line.match(/^(\s*)([-*•])\s+(.+)$/);
                                if (bulletMatch) {
                                  const [, indent, , text] = bulletMatch;
                                  const indentLevel = indent.length / 2; // 2 spaces per indent level
                                  return (
                                    <div key={idx} style={{ marginLeft: `${indentLevel * 1.5}rem` }} className="flex gap-2">
                                      <span className="text-gray-600 dark:text-gray-400">•</span>
                                      <span>{linkifyText(text)}</span>
                                    </div>
                                  );
                                }
                                // Regular line with link detection
                                return line ? <div key={idx}>{linkifyText(line)}</div> : <div key={idx} className="h-4" />;
                              });
                            })()}</div>
                            
                            {entry.image && (
                              <div className="mt-3">
                                <img src={entry.image} alt="Entry attachment" className="max-w-md rounded border" />
                              </div>
                            )}
                            
                            {entry.myMove && (
                              <div className="mt-3 pt-3 border-t border-gray-300 dark:border-gray-600">
                                <p className="text-sm font-bold text-green-700 dark:text-green-400">
                                  ✓ My Move: {entry.myMove}
                                </p>
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}
