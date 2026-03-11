'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { GrammarCheck } from './grammar-check';

// Helper function to get current time in local timezone as ISO string
function getLocalTimestamp(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000; // Convert to milliseconds
  const localTime = new Date(now.getTime() - offset);
  return localTime.toISOString().slice(0, -1); // Remove 'Z' to indicate local time
}

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
  images?: string[];
  postReview?: {
    content: string;
    timestamp: string;
    type: 'manual' | 'ai';
  };
  aiReview?: {
    content: string;
    timestamp: string;
    model: string;
    engineEval?: number;
    engineBestMove?: string;
  };
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
  const [images, setImages] = useState<string[]>([]);
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportStartDate, setExportStartDate] = useState('');
  const [exportEndDate, setExportEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [entryMode, setEntryMode] = useState<'general' | 'game'>('general');
  const [filterGameId, setFilterGameId] = useState<string>('all'); // 'all', 'general', or specific game ID
  const [viewRangeDays, setViewRangeDays] = useState<number>(7); // Configurable view range
  const [savedViewRangeDays, setSavedViewRangeDays] = useState<number>(7);
  const [addingReviewToEntry, setAddingReviewToEntry] = useState<number | null>(null);
  const [reviewContent, setReviewContent] = useState('');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [showRestoreDraft, setShowRestoreDraft] = useState(false);
  const [showPostReviews, setShowPostReviews] = useState(true);
  const [showAiReviews, setShowAiReviews] = useState(true);
  const [editingAiReview, setEditingAiReview] = useState<number | null>(null);
  const [aiReviewContent, setAiReviewContent] = useState('');
  const lastSavedContentRef = useRef<{
    thought: string;
    myMove: string;
    images: string[];
  } | null>(null); // Remember non-game-filter range

  // Auto-resize textarea
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setThought(e.target.value);
    
    // Auto-resize
    e.target.style.height = 'auto';
    const newHeight = Math.min(e.target.scrollHeight, 400); // Max 400px
    e.target.style.height = `${newHeight}px`;
  };

  // Reset textarea height when thought changes externally
  useEffect(() => {
    const textarea = document.querySelector('textarea');
    if (textarea) {
      textarea.style.height = 'auto';
      const newHeight = Math.min(textarea.scrollHeight, 400);
      textarea.style.height = `${newHeight}px`;
    }
  }, [thought]);

  useEffect(() => {
    loadEntries();
  }, [selectedDate, viewRangeDays]);

  useEffect(() => {
    loadActiveGames();
    loadUsername();
    checkForDraft(); // Check for saved draft on mount
  }, []); // Only run once on mount

  const saveDraft = useCallback(() => {
    // Only save if there's content
    if (!thought.trim() && !myMove.trim() && images.length === 0) {
      return;
    }

    // Check if content has actually changed since last save
    const lastContent = lastSavedContentRef.current;
    if (lastContent && 
        lastContent.thought === thought &&
        lastContent.myMove === myMove &&
        JSON.stringify(lastContent.images) === JSON.stringify(images)) {
      // Content hasn't changed, skip saving
      console.log('[AUTO-SAVE] Content unchanged, skipping save');
      return;
    }

    try {
      const draft = {
        thought,
        myMove,
        images,
        currentGameId,
        entryMode,
        timestamp: getLocalTimestamp(),
      };
      localStorage.setItem('journal-draft', JSON.stringify(draft));
      setLastSaved(new Date());
      lastSavedContentRef.current = { thought, myMove, images };
      console.log('[AUTO-SAVE] Draft saved:', {
        thoughtLength: thought.length,
        myMoveLength: myMove.length,
        imagesCount: images.length
      });
    } catch (error) {
      console.error('[AUTO-SAVE] Failed to save draft:', error);
    }
  }, [thought, myMove, images, currentGameId, entryMode]);

  // Auto-save draft every 30 seconds
  useEffect(() => {
    console.log('[AUTO-SAVE] Setting up auto-save interval');
    const autoSaveInterval = setInterval(() => {
      console.log('[AUTO-SAVE] Interval triggered');
      saveDraft();
    }, 30000); // Save every 30 seconds

    // Also save immediately when content changes (debounced by interval)
    const timeoutId = setTimeout(() => {
      saveDraft();
    }, 2000); // Initial save after 2 seconds of typing

    return () => {
      clearInterval(autoSaveInterval);
      clearTimeout(timeoutId);
    };
  }, [saveDraft]);

  const checkForDraft = () => {
    try {
      const savedDraft = localStorage.getItem('journal-draft');
      if (savedDraft) {
        const draft = JSON.parse(savedDraft);
        // Only restore if draft is less than 24 hours old
        const draftAge = Date.now() - new Date(draft.timestamp).getTime();
        if (draftAge < 24 * 60 * 60 * 1000) {
          setShowRestoreDraft(true);
        } else {
          // Clear old draft
          localStorage.removeItem('journal-draft');
        }
      }
    } catch (error) {
      console.error('[AUTO-SAVE] Failed to check for draft:', error);
    }
  };

  const restoreDraft = () => {
    try {
      const savedDraft = localStorage.getItem('journal-draft');
      if (savedDraft) {
        const draft = JSON.parse(savedDraft);
        setThought(draft.thought || '');
        setMyMove(draft.myMove || '');
        setImages(draft.images || []);
        setCurrentGameId(draft.currentGameId || null);
        setEntryMode(draft.entryMode || 'general');
        setShowRestoreDraft(false);
        console.log('[AUTO-SAVE] Draft restored');
      }
    } catch (error) {
      console.error('[AUTO-SAVE] Failed to restore draft:', error);
    }
  };

  const clearDraft = () => {
    localStorage.removeItem('journal-draft');
    setShowRestoreDraft(false);
    setLastSaved(null);
    lastSavedContentRef.current = null;
  };

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
      startDate.setDate(startDate.getDate() - (viewRangeDays - 1));
      
      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];
      
      // Use smart API call instead of polling each day
      const response = await fetch(
        `/api/journal?startDate=${startDateStr}&endDate=${endDateStr}`
      );
      const data = await response.json();
      
      const allEntries: JournalEntry[] = data.entries || [];
      
      allEntries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setEntries(allEntries);
      
      // Auto-select first game only if nothing is currently selected
      const gameEntries = allEntries.filter((e: JournalEntry) => e.gameId);
      if (gameEntries.length > 0 && !currentGameId) {
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
            images: images.length > 0 ? images : null,
          }),
        });
        
        if (response.ok) {
          const data = await response.json();
          
          setThought('');
          setMyMove('');
          setImages([]);
          setEditingEntry(null);
          clearDraft(); // Clear saved draft
          
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
            images: images.length > 0 ? images : null,
          }),
        });
        
        if (response.ok) {
          const data = await response.json();
          
          // Track if we should clear the game selection
          const shouldClearGame = myMove.trim() && currentGameId;
          
          // Clear form fields
          setThought('');
          setMyMove('');
          setImages([]);
          clearDraft(); // Clear saved draft
          
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
            const base64 = event.target?.result as string;
            setImages(prev => [...prev, base64]); // Add to array instead of replacing
          };
          reader.readAsDataURL(file);
        }
      }
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        setImages(prev => [...prev, base64]);
      };
      reader.readAsDataURL(file);
    });
    
    // Reset input so same file can be selected again
    e.target.value = '';
  };

  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
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
    // Load images from array
    if (entry.images && entry.images.length > 0) {
      setImages(entry.images);
    } else {
      setImages([]);
    }
    setCurrentGameId(entry.gameId);
    setEntryMode(entry.gameId ? 'game' : 'general');
    
    // Scroll to the textarea after state updates
    setTimeout(() => {
      const textarea = document.querySelector('textarea');
      if (textarea) {
        textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
        textarea.focus();
      }
    }, 100);
  };

  const handleAddPostReview = (entryId: number) => {
    setAddingReviewToEntry(entryId);
    setReviewContent('');
  };

  const handleSavePostReview = async (entryId: number) => {
    if (!reviewContent.trim()) {
      alert('Please enter review content');
      return;
    }

    try {
      const response = await fetch(`/api/journal/${entryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postReview: {
            content: reviewContent,
            timestamp: getLocalTimestamp(),
            type: 'manual'
          }
        }),
      });

      if (response.ok) {
        const data = await response.json();
        
        // Update entry in state
        if (data.entry) {
          setEntries(prevEntries => 
            prevEntries.map(e => e.id === data.entry.id ? data.entry : e)
          );
        }
        
        setAddingReviewToEntry(null);
        setReviewContent('');
      } else {
        alert('Failed to save post-review');
      }
    } catch (error) {
      console.error('Error saving post-review:', error);
      alert('Failed to save post-review');
    }
  };

  const handleEditPostReview = (entry: JournalEntry) => {
    setAddingReviewToEntry(entry.id);
    setReviewContent(entry.postReview?.content || '');
  };

  const handleDeletePostReview = async (entryId: number) => {
    if (!confirm('Delete this post-game review?')) return;

    try {
      const response = await fetch(`/api/journal/${entryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postReview: null
        }),
      });

      if (response.ok) {
        const data = await response.json();
        
        if (data.entry) {
          setEntries(prevEntries => 
            prevEntries.map(e => e.id === data.entry.id ? data.entry : e)
          );
        }
      } else {
        alert('Failed to delete post-review');
      }
    } catch (error) {
      console.error('Error deleting post-review:', error);
      alert('Failed to delete post-review');
    }
  };


  const handleEditAiReview = (entry: JournalEntry) => {
    setEditingAiReview(entry.id);
    setAiReviewContent(entry.aiReview?.content || '');
  };

  const handleSaveAiReview = async (entryId: number) => {
    if (!aiReviewContent.trim()) {
      alert('Please enter content');
      return;
    }

    try {
      const entry = entries.find(e => e.id === entryId);
      const response = await fetch(`/api/journal/${entryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aiReview: {
            ...entry?.aiReview,
            content: aiReviewContent,
            timestamp: getLocalTimestamp()
          }
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.entry) {
          setEntries(prevEntries => 
            prevEntries.map(e => e.id === data.entry.id ? data.entry : e)
          );
        }
        setEditingAiReview(null);
        setAiReviewContent('');
      } else {
        alert('Failed to update AI review');
      }
    } catch (error) {
      console.error('Error updating AI review:', error);
      alert('Failed to update AI review');
    }
  };

  const handleDeleteAiReview = async (entryId: number) => {
    if (!confirm('Delete this AI analysis?')) return;

    try {
      const response = await fetch(`/api/journal/${entryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiReview: null }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.entry) {
          setEntries(prevEntries => 
            prevEntries.map(e => e.id === data.entry.id ? data.entry : e)
          );
        }
      } else {
        alert('Failed to delete AI review');
      }
    } catch (error) {
      console.error('Error deleting AI review:', error);
      alert('Failed to delete AI review');
    }
  };

  const handleExportJournal = async () => {
    try {
      const startDate = exportStartDate || '2020-01-01';
      const endDate = exportEndDate;
      
      // Request Word document
      const response = await fetch(
        `/api/journal/export?startDate=${startDate}&endDate=${endDate}&format=docx&username=${encodeURIComponent(username)}&includePostReviews=${showPostReviews}`
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
      {/* Restore Draft Banner */}
      {showRestoreDraft && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-400 dark:border-amber-600 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-2xl">💾</span>
              <div>
                <p className="font-bold text-amber-900 dark:text-amber-100">
                  Unsaved Entry Found
                </p>
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  You have an unsaved journal entry. Would you like to restore it?
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={restoreDraft}
                className="px-4 py-2 bg-amber-500 text-white rounded hover:bg-amber-600 font-medium"
              >
                Restore
              </button>
              <button
                onClick={clearDraft}
                className="px-4 py-2 bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-400 dark:hover:bg-gray-500"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold">Chess Journal</h2>
        <div className="flex items-center gap-4">
          {/* Auto-save indicator */}
          {lastSaved && (
            <div className="text-xs text-gray-500 dark:text-gray-400 italic">
              Draft saved at {lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
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
              
              <div className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-700 rounded">
                <input
                  type="checkbox"
                  id="exportPostReviews"
                  checked={showPostReviews}
                  onChange={(e) => setShowPostReviews(e.target.checked)}
                  className="w-4 h-4 text-amber-600 rounded border-gray-300 focus:ring-amber-500"
                />
                <label htmlFor="exportPostReviews" className="text-sm font-medium cursor-pointer">
                  Include post-game reviews in export
                </label>
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
                  setImages([]);
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
              onChange={handleTextareaChange}
              onPaste={handleImagePaste}
              spellCheck={true}
              className="w-full px-3 py-2 border border-gray-300 rounded-md dark:bg-gray-700 dark:border-gray-600 min-h-[8rem] resize-none overflow-y-auto"
              placeholder={
                entryMode === 'general'
                  ? "What's on your mind today? Any general chess thoughts or reflections... (Paste images with Ctrl+V)"
                  : "What are you thinking about this position or move? (Paste images with Ctrl+V)"
              }
              required
            />
            
            {thought && (
              <GrammarCheck 
                text={thought} 
                onApplyFix={(newText) => {
                  setThought(newText);
                  // Trigger textarea resize
                  setTimeout(() => {
                    const textarea = document.querySelector('textarea');
                    if (textarea) {
                      textarea.style.height = 'auto';
                      const newHeight = Math.min(textarea.scrollHeight, 400);
                      textarea.style.height = `${newHeight}px`;
                    }
                  }, 0);
                }} 
              />
            )}
          </div>
          
          {/* Multi-image display and upload */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium">
                Images {images.length > 0 && `(${images.length})`}
              </label>
              <label className="px-3 py-1 bg-blue-500 text-white rounded text-sm cursor-pointer hover:bg-blue-600">
                + Add Image
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </label>
            </div>
            
            {images.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {images.map((img, index) => (
                  <div key={index} className="relative group">
                    <img 
                      src={img} 
                      alt={`Image ${index + 1}`} 
                      className="w-full max-h-64 object-contain rounded border bg-gray-50 dark:bg-gray-800"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(index)}
                      className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Remove image"
                    >
                      ✕
                    </button>
                    <div className="absolute bottom-1 left-1 bg-black bg-opacity-60 text-white text-xs px-2 py-0.5 rounded">
                      {index + 1}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-gray-500 mt-1">
              Paste images with Ctrl+V or click "+ Add Image" to upload
            </p>
          </div>
          
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
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">View:</label>
              <select
                value={viewRangeDays}
                onChange={(e) => setViewRangeDays(Number(e.target.value))}
                className="px-3 py-1 border border-gray-300 rounded-md text-sm dark:bg-gray-700 dark:border-gray-600"
              >
                <option value="7">Last 7 days</option>
                <option value="14">Last 14 days</option>
                <option value="30">Last 30 days</option>
                <option value="60">Last 60 days</option>
                <option value="90">Last 90 days</option>
                <option value="365">Last year</option>
                <option value="9999">All time</option>
              </select>
            </div>
            
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">Filter:</label>
              <select
                value={filterGameId}
                onChange={(e) => {
                  const newFilter = e.target.value;
                  const oldFilter = filterGameId;
                  
                  // When switching TO a specific game filter, save current range and switch to "All time"
                  if (newFilter !== 'all' && newFilter !== 'general' && (oldFilter === 'all' || oldFilter === 'general')) {
                    setSavedViewRangeDays(viewRangeDays);
                    setViewRangeDays(9999);
                  }
                  // When switching FROM a specific game back to all/general, restore saved range
                  else if ((newFilter === 'all' || newFilter === 'general') && oldFilter !== 'all' && oldFilter !== 'general') {
                    setViewRangeDays(savedViewRangeDays);
                  }
                  
                  setFilterGameId(newFilter);
                }}
                className="px-3 py-1 border border-gray-300 rounded-md text-sm dark:bg-gray-700 dark:border-gray-600"
              >
                <option value="all">All Entries</option>
                <option value="general">General Thoughts Only</option>
                {(() => {
                  // Get games that have journal entries
                  const gamesWithEntries = allGames.filter(g => entries.some(e => e.gameId === g.id));
                  
                  // Separate active from finished games
                  const activeGames = gamesWithEntries.filter(g => 
                    !g.result || g.result === 'null' || g.result.includes('progress')
                  );
                  const finishedGames = gamesWithEntries.filter(g => 
                    g.result && g.result !== 'null' && !g.result.includes('progress')
                  );
                  
                  return (
                    <>
                      {activeGames.length > 0 && (
                        <optgroup label="Active Games">
                          {activeGames.map(game => (
                            <option key={game.id} value={game.id}>
                              {game.white} vs {game.black}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {finishedGames.length > 0 && (
                        <optgroup label="Finished Games">
                          {finishedGames.map(game => (
                            <option key={game.id} value={game.id}>
                              {game.white} vs {game.black}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </>
                  );
                })()}
              </select>
            </div>
            
            {/* Post-Review Toggle */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="showPostReviews"
                checked={showPostReviews}
                onChange={(e) => setShowPostReviews(e.target.checked)}
                className="w-4 h-4 text-amber-600 rounded border-gray-300 focus:ring-amber-500"
              />
              <label htmlFor="showPostReviews" className="text-sm font-medium cursor-pointer">
                Show Post-Reviews
              </label>
            </div>
            
            {/* AI Review Toggle */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="showAiReviews"
                checked={showAiReviews}
                onChange={(e) => setShowAiReviews(e.target.checked)}
                className="w-4 h-4 text-cyan-600 rounded border-gray-300 focus:ring-cyan-500"
              />
              <label htmlFor="showAiReviews" className="text-sm font-medium cursor-pointer">
                Show AI Analysis
              </label>
            </div>
          </div>
        </div>
        
        {loading ? (
          <p className="text-center text-gray-600">Loading...</p>
        ) : entries.length === 0 ? (
          <p className="text-center text-gray-600">
            No entries in the last {viewRangeDays} day{viewRangeDays !== 1 ? 's' : ''}. Start writing!
          </p>
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
                                  {(() => {
                                    // Parse local timestamp (format: "2026-02-21T07:57:00.000")
                                    const timestamp = entry.timestamp;
                                    if (timestamp.endsWith('Z')) {
                                      // Old UTC format - convert to local
                                      return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                    } else {
                                      // New local format - extract time directly
                                      const timePart = timestamp.split('T')[1];
                                      if (timePart) {
                                        const [hours, minutes] = timePart.split(':');
                                        return `${hours}:${minutes}`;
                                      }
                                      return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                    }
                                  })()}
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
                                {/* Add Post-Review button - only for finished games without review */}
                                {entry.gameId && (() => {
                                  const game = allGames.find(g => g.id === entry.gameId);
                                  const isFinished = game?.result && game.result !== 'null' && !game.result.includes('progress');
                                  return isFinished && !entry.postReview && (
                                    <button
                                      onClick={() => handleAddPostReview(entry.id)}
                                      className="text-amber-600 hover:text-amber-700 text-xs px-2 py-1 rounded hover:bg-amber-50 dark:hover:bg-amber-900"
                                      title="Add post-game review"
                                    >
                                      + Review
                                    </button>
                                  );
                                })()}
                              </div>
                            </div>
                            
                            {/* Chess board visualization for game entries */}
                            {entry.gameId && (entry.fen || entry.images?.[0] || (game && game.fen)) && (
                              <div className="my-3 flex flex-col items-center">
                                <div className="relative">
                                  <img
                                    src={(() => {
                                      // Use cached image if available (first image is the board)
                                      if (entry.images?.[0]) {
                                        return entry.images[0];
                                      }
                                      // Otherwise generate from FEN
                                      const fenToUse = entry.fen || game?.fen || '';
                                      const pov = game && username && game.black.toLowerCase() === username.toLowerCase() ? 'black' : 'white';
                                      return `/api/board-image?fen=${encodeURIComponent(fenToUse)}&pov=${pov}`;
                                    })()}
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
                            
                            {/* Display images - user-uploaded images only, not cached board */}
                            {(() => {
                              // Skip first image if entry has FEN (it's the cached board diagram)
                              let entryImages: string[] = [];
                              if (entry.images && entry.images.length > 0) {
                                entryImages = entry.fen ? entry.images.slice(1) : entry.images;
                              }
                              
                              if (entryImages.length === 0) return null;
                              
                              return (
                                <div className="mt-3">
                                  <div className="flex flex-wrap gap-3">
                                    {entryImages.map((img, idx) => (
                                      <img 
                                        key={idx}
                                        src={img} 
                                        alt={`Image ${idx + 1}`} 
                                        className="rounded border max-w-full max-h-96 object-contain bg-gray-50 dark:bg-gray-800"
                                      />
                                    ))}
                                  </div>
                                </div>
                              );
                            })()}
                            
                            {entry.myMove && (
                              <div className="mt-3 pt-3 border-t border-gray-300 dark:border-gray-600">
                                <p className="text-sm font-bold text-green-700 dark:text-green-400">
                                  ✓ My Move: {entry.myMove}
                                </p>
                              </div>
                            )}
                            
                            {/* Post-Review Section - only show if toggle is enabled */}
                            {showPostReviews && (
                              <>
                                {addingReviewToEntry === entry.id ? (
                              <div className="mt-4 ml-8 bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-200 dark:border-amber-700 rounded-lg p-4">
                                <div className="font-bold text-amber-900 dark:text-amber-100 mb-2">
                                  📝 ADD POST-GAME REVIEW
                                </div>
                                <textarea
                                  value={reviewContent}
                                  onChange={(e) => setReviewContent(e.target.value)}
                                  placeholder="Looking back at this game, what insights can you share about your thinking during this moment?"
                                  className="w-full p-2 border rounded resize-none dark:bg-gray-800 dark:border-gray-600"
                                  rows={4}
                                  autoFocus
                                />
                                <div className="mt-2 flex gap-2">
                                  <button
                                    onClick={() => handleSavePostReview(entry.id)}
                                    className="px-3 py-1 bg-amber-500 text-white rounded hover:bg-amber-600"
                                  >
                                    Save Review
                                  </button>
                                  <button
                                    onClick={() => {
                                      setAddingReviewToEntry(null);
                                      setReviewContent('');
                                    }}
                                    className="px-3 py-1 bg-gray-300 dark:bg-gray-600 rounded hover:bg-gray-400 dark:hover:bg-gray-500"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : entry.postReview && (
                              <div className="mt-4 ml-8 bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-200 dark:border-amber-700 rounded-lg p-4 relative">
                                {/* Icon badge */}
                                <div className="absolute -left-3 -top-3 bg-amber-500 text-white rounded-full w-8 h-8 flex items-center justify-center text-lg">
                                  📝
                                </div>
                                
                                {/* Header */}
                                <div className="font-bold text-amber-900 dark:text-amber-100 mb-1">
                                  POST-GAME REVIEW
                                </div>
                                
                                {/* Timestamp */}
                                <div className="text-xs text-amber-700 dark:text-amber-300 mb-3">
                                  Added {(() => {
                                    const reviewDate = new Date(entry.postReview.timestamp);
                                    const entryDate = new Date(entry.timestamp);
                                    const daysDiff = Math.floor((reviewDate.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24));
                                    return daysDiff === 0 ? 'same day' : 
                                           daysDiff === 1 ? '1 day after game' : 
                                           `${daysDiff} days after game`;
                                  })()}
                                </div>
                                
                                {/* Separator */}
                                <div className="border-t border-amber-300 dark:border-amber-600 mb-3"></div>
                                
                                {/* Content */}
                                <div className="text-gray-800 dark:text-gray-200 italic whitespace-pre-wrap">
                                  {entry.postReview.content}
                                </div>
                                
                                {/* Actions */}
                                <div className="mt-3 flex gap-2">
                                  <button
                                    onClick={() => handleEditPostReview(entry)}
                                    className="text-sm text-amber-600 hover:underline"
                                  >
                                    Edit Review
                                  </button>
                                  <button
                                    onClick={() => handleDeletePostReview(entry.id)}
                                    className="text-sm text-red-600 hover:underline"
                                  >
                                    Delete Review
                                  </button>
                                </div>
                              </div>
                            )}
                              </>
                            )}
                            
                            {/* AI Review Section */}
                            {showAiReviews && showPostReviews && (
                              <>
                                {editingAiReview === entry.id ? (
                                  <div className="mt-4 ml-8 bg-cyan-50 dark:bg-cyan-900/20 border-2 border-cyan-200 dark:border-cyan-700 rounded-lg p-4">
                                    <div className="font-bold text-cyan-900 dark:text-cyan-100 mb-2">
                                      🤖 EDIT AI ANALYSIS
                                    </div>
                                    <textarea
                                      value={aiReviewContent}
                                      onChange={(e) => setAiReviewContent(e.target.value)}
                                      className="w-full p-2 border rounded resize-none dark:bg-gray-800 dark:border-gray-600"
                                      rows={4}
                                      autoFocus
                                    />
                                    <div className="mt-2 flex gap-2">
                                      <button
                                        onClick={() => handleSaveAiReview(entry.id)}
                                        className="px-3 py-1 bg-cyan-500 text-white rounded hover:bg-cyan-600"
                                      >
                                        Save
                                      </button>
                                      <button
                                        onClick={() => {
                                          setEditingAiReview(null);
                                          setAiReviewContent('');
                                        }}
                                        className="px-3 py-1 bg-gray-300 dark:bg-gray-600 rounded hover:bg-gray-400"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                ) : entry.aiReview && (
                                  <div className="mt-4 ml-8 bg-cyan-50 dark:bg-cyan-900/20 border-2 border-cyan-200 dark:border-cyan-700 rounded-lg p-4 relative">
                                    {/* Icon badge */}
                                    <div className="absolute -left-3 -top-3 bg-cyan-500 text-white rounded-full w-8 h-8 flex items-center justify-center text-lg">
                                      🤖
                                    </div>
                                    
                                    {/* Header */}
                                    <div className="font-bold text-cyan-900 dark:text-cyan-100 mb-1">
                                      AI ANALYSIS
                                    </div>
                                    
                                    {/* Model info */}
                                    <div className="text-xs text-cyan-700 dark:text-cyan-300 mb-3">
                                      {entry.aiReview.model.replace('claude-', '').replace('-20250514', '')} • 
                                      {entry.aiReview.engineEval !== undefined && 
                                        ` Eval: ${entry.aiReview.engineEval > 0 ? '+' : ''}${entry.aiReview.engineEval.toFixed(2)}`
                                      }
                                      {entry.aiReview.engineBestMove && 
                                        ` • Best: ${entry.aiReview.engineBestMove}`
                                      }
                                    </div>
                                    
                                    {/* Separator */}
                                    <div className="border-t border-cyan-300 dark:border-cyan-600 mb-3"></div>
                                    
                                    {/* Content */}
                                    <div className="text-gray-800 dark:text-gray-200 italic whitespace-pre-wrap">
                                      {entry.aiReview.content}
                                    </div>
                                    
                                    {/* Actions */}
                                    <div className="mt-3 flex gap-2">
                                      <button
                                        onClick={() => handleEditAiReview(entry)}
                                        className="text-sm text-cyan-600 hover:underline"
                                      >
                                        Edit
                                      </button>
                                      <button
                                        onClick={() => handleDeleteAiReview(entry.id)}
                                        className="text-sm text-red-600 hover:underline"
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </>
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
