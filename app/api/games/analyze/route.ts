import { NextRequest, NextResponse } from 'next/server';
import { Chess } from 'chess.js';
import getDb, { saveDb } from '@/lib/db';
import { Stockfish } from '@se-oss/stockfish';

// Detect if running on Vercel
const IS_VERCEL = process.env.VERCEL === '1' || process.env.VERCEL_ENV !== undefined;

// Store progress in database for persistence across requests
export async function setProgress(gameId: string, current: number, total: number) {
  try {
    const db = await getDb() as any;
    if (!db.analysis_progress) {
      db.analysis_progress = {};
    }
    db.analysis_progress[gameId] = { current, total, timestamp: Date.now() };
    // Don't await saveDb - fire and forget for performance
    saveDb(db).catch(err => console.error('[PROGRESS] Save error:', err));
  } catch (error) {
    console.error('[PROGRESS] setProgress error:', error);
  }
}

// GET endpoint to check progress
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const gameId = searchParams.get('gameId');
  
  if (!gameId) {
    return NextResponse.json({ error: 'Missing gameId' }, { status: 400 });
  }
  
  try {
    const db = await getDb() as any;
    const progress = db.analysis_progress?.[gameId];
    
    if (!progress) {
      return NextResponse.json({ current: 0, total: 0 });
    }
    
    // Clean up stale progress (older than 10 minutes)
    if (Date.now() - progress.timestamp > 600000) {
      delete db.analysis_progress[gameId];
      saveDb(db).catch(err => console.error('[PROGRESS] Cleanup error:', err));
      return NextResponse.json({ current: 0, total: 0 });
    }
    
    return NextResponse.json({ current: progress.current, total: progress.total });
  } catch (error) {
    console.error('[PROGRESS] GET error:', error);
    return NextResponse.json({ current: 0, total: 0 });
  }
}

function calculateAccuracy(centipawnLosses: number[]): number {
  if (centipawnLosses.length === 0) return 100;
  
  let totalAccuracy = 0;
  
  for (const loss of centipawnLosses) {
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

// ========== CHESS-API.COM EVALUATION (for Vercel) ==========
async function getChessApiEval(fen: string, depth: number = 18): Promise<{ score: number; bestMove: string } | null> {
  try {
    const url = `https://chess-api.com/v1`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fen: fen,
        depth: depth,
      }),
    });
    
    if (!response.ok) {
      console.log('[CHESS-API] Response not OK:', response.status, response.statusText);
      return null;
    }
    
    const data = await response.json();
    
    if (data.eval !== undefined) {
      const cpScore = data.eval;
      const bestMove = data.move || '';
      return { score: cpScore, bestMove };
    }
    
    return null;
  } catch (error) {
    console.error('[CHESS-API] API error:', error);
    return null;
  }
}

async function analyzeGameChessApiBatched(
  pgn: string, 
  depth: number, 
  userColor: 'white' | 'black', 
  gameId: string,
  startMoveIndex: number = 0,
  batchSize: number = 10
): Promise<{ 
  moves: any[]; 
  whiteAccuracy: number; 
  blackAccuracy: number;
  completed: boolean;
  nextMoveIndex: number;
}> {
  console.log(`[CHESS-API] Batch analysis starting at move ${startMoveIndex}, batch size ${batchSize}`);
  const chess = new Chess();
  chess.loadPgn(pgn);
  const history = chess.history({ verbose: true });
  
  console.log('[CHESS-API] Total moves in game:', history.length);
  
  // Load existing analysis if any
  const db = await getDb();
  const existingAnalysis = db.game_analyses?.[gameId];
  
  // Only keep existing moves if we're continuing a batch (startMoveIndex > 0)
  // If starting from 0, this is a fresh analysis or re-analysis
  const existingMoves = (startMoveIndex > 0 && existingAnalysis?.moves) ? existingAnalysis.moves : [];
  
  // Replay to the start position
  chess.reset();
  for (let i = 0; i < startMoveIndex; i++) {
    chess.move(history[i].san);
  }
  
  const analyses: any[] = [...existingMoves];
  const whiteLosses: number[] = [];
  const blackLosses: number[] = [];
  
  // Re-calculate losses from existing moves
  for (const move of existingMoves) {
    if (move.color === 'white') {
      whiteLosses.push(move.centipawnLoss);
    } else {
      blackLosses.push(move.centipawnLoss);
    }
  }
  
  const endMoveIndex = Math.min(startMoveIndex + batchSize, history.length);
  
  setProgress(gameId, startMoveIndex, history.length);
  
  for (let i = startMoveIndex; i < endMoveIndex; i++) {
    const move = history[i];
    const isWhiteMove = chess.turn() === 'w';
    
    setProgress(gameId, i + 1, history.length);
    
    try {
      const fenBefore = chess.fen();
      const evalBefore = await getChessApiEval(fenBefore, depth);
      
      if (!evalBefore) {
        console.log(`[CHESS-API] Skipping move ${i + 1}: API failed`);
        chess.move(move.san);
        continue;
      }
      
      chess.move(move.san);
      const fenAfter = chess.fen();
      const evalAfter = await getChessApiEval(fenAfter, depth);
      
      if (!evalAfter) {
        console.log(`[CHESS-API] Skipping move ${i + 1}: API failed on after position`);
        continue;
      }
      
      // Convert to white's perspective
      let evalBeforeWhite = isWhiteMove ? evalBefore.score : -evalBefore.score;
      let evalAfterWhite = isWhiteMove ? -evalAfter.score : evalAfter.score;
      
      // Round to 1 decimal place to avoid floating point ugliness
      evalBeforeWhite = Math.round(evalBeforeWhite * 10) / 10;
      evalAfterWhite = Math.round(evalAfterWhite * 10) / 10;
      
      // Calculate CP loss
      let cpLoss = 0;
      if (isWhiteMove) {
        cpLoss = evalBeforeWhite - evalAfterWhite;
      } else {
        cpLoss = evalAfterWhite - evalBeforeWhite;
      }
      cpLoss = Math.max(0, Math.round(cpLoss * 10) / 10);
      
      if (isWhiteMove) {
        whiteLosses.push(cpLoss);
      } else {
        blackLosses.push(cpLoss);
      }
      
      analyses.push({
        moveNumber: Math.floor(i / 2) + 1,
        color: isWhiteMove ? 'white' : 'black',
        move: move.san,
        evaluation: evalAfterWhite,
        bestMove: evalBefore.bestMove,
        centipawnLoss: cpLoss,
        moveQuality: getMoveQuality(cpLoss),
      });
      
      console.log(`[CHESS-API] Move ${i + 1}/${history.length} analyzed: ${move.san}, CP loss = ${cpLoss}`);
    } catch (error) {
      console.error(`[CHESS-API] Error analyzing move ${i + 1}:`, error);
    }
  }
  
  const whiteAccuracy = calculateAccuracy(whiteLosses);
  const blackAccuracy = calculateAccuracy(blackLosses);
  const completed = endMoveIndex >= history.length;
  
  console.log(`[CHESS-API] Batch complete. Analyzed ${endMoveIndex}/${history.length}. White: ${whiteAccuracy}%, Black: ${blackAccuracy}%`);
  
  return { 
    moves: analyses, 
    whiteAccuracy, 
    blackAccuracy, 
    completed,
    nextMoveIndex: endMoveIndex
  };
}

// ========== LOCAL STOCKFISH ==========
async function analyzeGame(pgn: string, depth: number = 10, userColor: 'white' | 'black', gameId: string): Promise<{ moves: any[]; whiteAccuracy: number; blackAccuracy: number }> {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const history = chess.history({ verbose: true });
  
  const engine = new Stockfish();
  await engine.waitReady();
  
  chess.reset();
  const analyses: any[] = [];
  const whiteLosses: number[] = [];
  const blackLosses: number[] = [];
  
  setProgress(gameId, 0, history.length);
  
  console.log(`[STOCKFISH] Starting analysis of ${history.length} moves at depth ${depth}...`);
  
  try {
    for (let i = 0; i < history.length; i++) {
      const move = history[i];
      const isWhiteMove = chess.turn() === 'w';
      
      setProgress(gameId, i + 1, history.length);
      
      try {
        const fenBefore = chess.fen();
        
        const analysisBefore = await engine.analyze(fenBefore, depth);
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
        
        if (!isWhiteMove) {
          evalBefore = -evalBefore;
        }
        
        chess.move(move.san);
        
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
        
        if (isWhiteMove) {
          evalAfter = -evalAfter;
        }
        
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
  const startTime = Date.now();
  console.log('[ANALYZE] Analysis request started');
  
  try {
    const body = await request.json();
    const { gameId, startMoveIndex = 0 } = body;
    
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
    
    const depth = parseInt(db.settings?.analysis_depth || '10');
    const username = db.settings?.chesscom_username?.toLowerCase() || '';
    const userColor: 'white' | 'black' = game.white.toLowerCase() === username ? 'white' : 'black';
    
    let result;
    
    if (IS_VERCEL) {
      const batchResult = await analyzeGameChessApiBatched(game.pgn, depth, userColor, gameId, startMoveIndex, 10);
      
      // Save progress
      if (!db.game_analyses) {
        db.game_analyses = {};
      }
      
      db.game_analyses[gameId] = {
        gameId,
        analyzedAt: new Date().toISOString(),
        whitePlayer: game.white,
        blackPlayer: game.black,
        whiteAccuracy: batchResult.whiteAccuracy,
        blackAccuracy: batchResult.blackAccuracy,
        moves: batchResult.moves,
        depth: depth, // Store the depth used
        engine: 'chess-api.com', // Store which engine was used
      };
      
      if (batchResult.completed) {
        db.games[gameId].analysisCompleted = true;
        // Clear progress from db before saving
        const dbAny = db as any;
        if (dbAny.analysis_progress?.[gameId]) {
          delete dbAny.analysis_progress[gameId];
        }
      }
      
      await saveDb(db);
      
      return NextResponse.json({
        success: true,
        completed: batchResult.completed,
        nextMoveIndex: batchResult.nextMoveIndex,
        analysis: db.game_analyses[gameId],
      });
    } else {
      // Local analysis ignores startMoveIndex - always analyzes full game  
      const analysis = await analyzeGame(game.pgn, depth, userColor, gameId);
      
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
        depth: depth,
        engine: 'Stockfish',
      };
      
      db.games[gameId].analysisCompleted = true;
      
      // Clear progress from this db before saving
      const dbAny = db as any;
      if (dbAny.analysis_progress?.[gameId]) {
        delete dbAny.analysis_progress[gameId];
      }
      
      console.log(`[ANALYZE] Saving analysis for game ${gameId}...`);
      console.log(`[ANALYZE] Analysis has ${analysis.moves.length} moves`);
      await saveDb(db);
      console.log(`[ANALYZE] Save complete`);
      
      // Verify the save worked
      const verifyDb = await getDb();
      const savedAnalysis = verifyDb.game_analyses?.[gameId];
      if (!savedAnalysis) {
        console.error(`[ANALYZE] CRITICAL: Analysis NOT found after save for game ${gameId}`);
        console.error(`[ANALYZE] game_analyses keys:`, Object.keys(verifyDb.game_analyses || {}));
      } else {
        console.log(`[ANALYZE] Verified: Analysis saved with ${savedAnalysis.moves?.length || 0} moves, depth ${savedAnalysis.depth}, engine ${savedAnalysis.engine}`);
      }
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`[ANALYZE] Analysis complete in ${duration}s - White: ${analysis.whiteAccuracy}%, Black: ${analysis.blackAccuracy}%`);
      
      return NextResponse.json({
        success: true,
        completed: true,
        analysis: db.game_analyses[gameId],
      });
    }
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error('[ANALYZE] Error after', duration, 's:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to analyze game' },
      { status: 500 }
    );
  }
}

export const maxDuration = 10; // Vercel free tier limit