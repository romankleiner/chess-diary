import { Chess } from 'chess.js';

// Simple in-memory cache for book positions
const bookCache = new Map<string, boolean>();

/**
 * Check if a position is in the opening book with sufficient master games
 * Uses chess-api.com opening explorer as a lightweight alternative to Polyglot files
 */
export async function isInBook(fen: string, minGames: number = 50): Promise<boolean> {
  // Check cache first
  const cacheKey = `${fen}:${minGames}`;
  if (bookCache.has(cacheKey)) {
    return bookCache.get(cacheKey)!;
  }
  
  try {
    // Use Lichess opening explorer API (free, no rate limits for low volume)
    const fenEncoded = encodeURIComponent(fen);
    const response = await fetch(
      `https://explorer.lichess.ovh/masters?fen=${fenEncoded}&moves=1`,
      {
        headers: {
          'Accept': 'application/json',
        },
      }
    );
    
    if (!response.ok) {
      console.warn(`[BOOK] API error: ${response.status}`);
      return false;
    }
    
    const data = await response.json();
    
    // Check total number of games in this position
    const totalGames = data.white + data.draws + data.black;
    const inBook = totalGames >= minGames;
    
    // Cache result
    bookCache.set(cacheKey, inBook);
    
    return inBook;
  } catch (error) {
    console.error('[BOOK] Error checking opening book:', error);
    return false;
  }
}

/**
 * Count how many moves in a game are in the opening book
 * Returns the move number where book ends
 */
export async function countBookMoves(pgn: string, minGames: number = 50): Promise<number> {
  const chess = new Chess();
  chess.loadPgn(pgn);
  
  const history = chess.history({ verbose: true });
  chess.reset();
  
  let bookMoveCount = 0;
  
  for (let i = 0; i < history.length; i++) {
    const move = history[i];
    const fenBefore = chess.fen();
    
    const inBook = await isInBook(fenBefore, minGames);
    
    if (!inBook) {
      // First move out of book - return previous move number
      return Math.floor(i / 2); // Convert to move number (not half-moves)
    }
    
    chess.move(move.san);
    bookMoveCount++;
  }
  
  // All moves were in book
  return Math.floor(history.length / 2);
}

/**
 * Clear the book cache (useful for testing)
 */
export function clearBookCache() {
  bookCache.clear();
}
