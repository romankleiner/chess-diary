import { NextRequest, NextResponse } from 'next/server';
import { Chess } from 'chess.js';
import getDb, { saveDb } from '@/lib/db';
import { Stockfish } from '@se-oss/stockfish';
import { setProgress, clearProgress } from '../[id]/analysis/progress/route';

function calculateAccuracy(centipawnLosses: number[]): number {
  if (centipawnLosses.length === 0) return 100;
  
  // More balanced formula: penalize mistakes but not too harshly
  // Uses winrate-based accuracy similar to Lichess
  let totalAccuracy = 0;
  
  for (const loss of centipawnLosses) {
    // Convert CP loss to move accuracy using win percentage formula
    // Win% = 50 + 50 * (2 / (1 + exp(0.00368208 * cp)) - 1)
    // For loss, we calculate how much worse the position got
    const winPercentageLost = 50 * (2 / (1 + Math.exp(0.00368208 * loss)) - 1);
    const moveAccuracy = 100 - Math.abs(winPercentageLost);
    totalAccuracy += moveAccuracy;
  }
  
  const accuracy = totalAccuracy / centipawnLosses.length;
  return Math.max(0, Math.min(100, Math.round(accuracy * 10) / 10));
}

function getMoveQuality(cpLoss: number): string {
  if (cpLoss <= 25) return 'excellent';
  if (cpLoss <= 50) return 'good';
  if (cpLoss <= 100) return 'inaccuracy';
  if (cpLoss <= 200) return 'mistake';
  return 'blunder';
}

async function analyzeGame(pgn: string, depth: number = 10, userColor: 'white' | 'black', gameId: string): Promise<{ moves: any[]; whiteAccuracy: number; blackAccuracy: number }> {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const history = chess.history({ verbose: true });
  
  // Initialize engine once for the entire game
  const engine = new Stockfish();
  await engine.waitReady();
  
  chess.reset();
  const analyses: any[] = [];
  const whiteLosses: number[] = [];
  const blackLosses: number[] = [];
  
  // Set initial progress
  setProgress(gameId, 0, history.length);
  
  console.log(`[STOCKFISH] Starting analysis of ${history.length} moves at depth ${depth}...`);
  
  try {
    for (let i = 0; i < history.length; i++) {
      const move = history[i];
      const isWhiteMove = chess.turn() === 'w';
      
      // Update progress
      setProgress(gameId, i + 1, history.length);
      const isUserMove = (userColor === 'white' && isWhiteMove) || (userColor === 'black' && !isWhiteMove);
      
      try {
        const fenBefore = chess.fen();
        console.log(`[STOCKFISH] Analyzing move ${i + 1}/${history.length}: ${move.san}`);
        
        // Analyze position before move - this gives us the evaluation and best move
        const analysisBefore = await engine.analyze(fenBefore, depth);
        
        // Extract score from best line
        const scoreBefore = analysisBefore.lines[0]?.score;
        const bestMove = analysisBefore.bestmove || '';
        
        let evalBefore = 0;
        if (scoreBefore) {
          if (scoreBefore.type === 'mate') {
            evalBefore = scoreBefore.value > 0 ? 10000 : -10000;
          } else {
            evalBefore = scoreBefore.value;
          }
        }
        
        // IMPORTANT: Stockfish returns scores from the perspective of side to move
        // Convert to white's perspective
        if (!isWhiteMove) {
          evalBefore = -evalBefore;
        }
        
        // Make the actual move
        chess.move(move.san);
        
        // Analyze position after the actual move
        const fenAfter = chess.fen();
        const analysisAfter = await engine.analyze(fenAfter, depth);
        
        const scoreAfter = analysisAfter.lines[0]?.score;
        
        let evalAfter = 0;
        if (scoreAfter) {
          if (scoreAfter.type === 'mate') {
            evalAfter = scoreAfter.value > 0 ? 10000 : -10000;
          } else {
            evalAfter = scoreAfter.value;
          }
        }
        
        // Convert to white's perspective (now it's black's turn after white moved, or vice versa)
        if (isWhiteMove) {
          // After white's move, it's black's turn, so negate
          evalAfter = -evalAfter;
        }
        
        // Calculate centipawn loss
        // evalBefore = evaluation of position before move (assuming best move)
        // evalAfter = evaluation of position after the actual move
        // Both are from white's perspective
        // For white: loss = evalBefore - evalAfter (if eval drops, white lost centipawns)
        // For black: loss = -(evalBefore - evalAfter) = evalAfter - evalBefore
        //           (if eval becomes more negative, black improved, so we want positive when it goes wrong way)
        
        let cpLoss = 0;
        if (isWhiteMove) {
          cpLoss = evalBefore - evalAfter;
        } else {
          cpLoss = evalAfter - evalBefore;
        }
        
        cpLoss = Math.max(0, cpLoss);
        
        if (isWhiteMove) {
          whiteLosses.push(cpLoss);
        } else {
          blackLosses.push(cpLoss);
        }
        
        analyses.push({
          moveNumber: Math.floor(i / 2) + 1,
          color: isWhiteMove ? 'white' : 'black',
          move: move.san,
          evaluation: evalAfter,
          bestMove: bestMove,
          centipawnLoss: cpLoss,
          moveQuality: getMoveQuality(cpLoss),
        });
      } catch (error) {
        console.error(`[STOCKFISH] Error analyzing move ${i + 1}:`, error);
      }
    }
  } finally {
    // Always terminate engine when done
    engine.terminate();
  }
  
  const whiteAccuracy = calculateAccuracy(whiteLosses);
  const blackAccuracy = calculateAccuracy(blackLosses);
  
  console.log(`[STOCKFISH] Analysis complete! White: ${whiteAccuracy}%, Black: ${blackAccuracy}%`);
  
  return {
    moves: analyses,
    whiteAccuracy,
    blackAccuracy,
  };
}

export async function POST(request: NextRequest) {
  try {
    const { gameId } = await request.json();
    
    if (!gameId) {
      return NextResponse.json({ error: 'Missing gameId' }, { status: 400 });
    }
    
    const db = await getDb();
    
    const game = db.games[gameId];
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }
    
    if (!game.pgn) {
      return NextResponse.json({ error: 'Game has no PGN data' }, { status: 400 });
    }
    
    // Get analysis depth from settings (default to 10)
    const depth = parseInt(db.settings?.analysis_depth || '10');
    
    // Determine which color the user played
    const username = db.settings?.chesscom_username?.toLowerCase() || '';
    const userColor: 'white' | 'black' = game.white.toLowerCase() === username ? 'white' : 'black';
    
    console.log(`[ANALYZE] Starting Stockfish analysis for game ${gameId} at depth ${depth}`);
    
    const analysis = await analyzeGame(game.pgn, depth, userColor, gameId);
    
    // Clear progress when done
    clearProgress(gameId);
    
    if (!db.game_analyses) {
      db.game_analyses = {};
    }
    
    db.game_analyses[gameId] = {
      gameId,
      analyzedAt: new Date().toISOString(),
      whitePlayer: game.white,
      blackPlayer: game.black,
      whiteAccuracy: analysis.whiteAccuracy,
      blackAccuracy: analysis.blackAccuracy,
      moves: analysis.moves,
    };
    
    // Mark game as analyzed - CRITICAL: Set this BEFORE saving
    if (!db.games[gameId]) {
      console.error(`[ANALYZE] Warning: Game ${gameId} not found when setting flag`);
    } else {
      db.games[gameId].analysisCompleted = true;
      console.log(`[ANALYZE] Set analysisCompleted=true for game ${gameId}`);
    }
    
    // Save database
    console.log(`[ANALYZE] Saving database...`);
    await saveDb(db);
    console.log(`[ANALYZE] Database saved successfully`);
    
    // Verify the flag was set
    const verifyDb = await getDb();
    if (!verifyDb.games[gameId]?.analysisCompleted) {
      console.error(`[ANALYZE] ERROR: Flag not persisted for game ${gameId}!`);
      // Try to fix it immediately
      verifyDb.games[gameId].analysisCompleted = true;
      await saveDb(verifyDb);
      console.log(`[ANALYZE] Attempted to fix flag on second save`);
    } else {
      console.log(`[ANALYZE] Verified: analysisCompleted flag is set`);
    }
    
    return NextResponse.json({
      success: true,
      analysis: db.game_analyses[gameId],
    });
  } catch (error) {
    console.error('[ANALYZE] Error analyzing game:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to analyze game' },
      { status: 500 }
    );
  }
}

export const maxDuration = 300;