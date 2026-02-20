import { NextRequest, NextResponse } from 'next/server';
import getDb, { saveDb } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { gameId, reanalyzeEngine } = body;
    
    if (!gameId) {
      return NextResponse.json({ error: 'Missing gameId' }, { status: 400 });
    }
    
    const db = await getDb();
    
    // Check if game exists
    const game = db.games[gameId];
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }
    
    // Get all journal entries for this game
    const gameEntries = db.journal_entries.filter(e => e.gameId === gameId);
    
    if (gameEntries.length === 0) {
      return NextResponse.json({ 
        error: 'No journal entries found for this game' 
      }, { status: 404 });
    }
    
    // Check if engine analysis exists
    const hasEngineAnalysis = !!db.game_analyses?.[gameId];
    
    if (!hasEngineAnalysis && !reanalyzeEngine) {
      return NextResponse.json({
        needsEngineAnalysis: true,
        message: 'Engine analysis required before AI analysis'
      });
    }
    
    // Run engine analysis if requested
    if (reanalyzeEngine && !hasEngineAnalysis) {
      // TODO: Trigger engine analysis
      // For now, return error asking user to run it separately
      return NextResponse.json({
        error: 'Please run engine analysis first from the game page'
      }, { status: 400 });
    }
    
    const analysis = db.game_analyses?.[gameId] || null;
    
    // Process each entry
    let analyzedCount = 0;
    const model = 'claude-sonnet-4-20250514'; // TODO: Make configurable
    
    for (const entry of gameEntries) {
      // Skip entries without content
      if (!entry.content || !entry.content.trim()) {
        continue;
      }
      
      // Get position analysis if available
      let moveAnalysis = null;
      if (analysis?.moves) {
        // Try to match by move number first
        if (entry.moveNumber) {
          moveAnalysis = analysis.moves[entry.moveNumber - 1];
        } else if (entry.fen) {
          // Extract move number from FEN (last field is the full move number)
          const fenParts = entry.fen.split(' ');
          if (fenParts.length >= 6) {
            const fullMoveNumber = parseInt(fenParts[5]);
            if (fullMoveNumber) {
              // Find the move in analysis by matching moveNumber field
              moveAnalysis = analysis.moves.find((m: any) => m.moveNumber === fullMoveNumber);
              
              // If not found, try approximating by index (each full move = 2 plies)
              if (!moveAnalysis) {
                const approximateIndex = (fullMoveNumber - 1) * 2;
                moveAnalysis = analysis.moves[approximateIndex] || analysis.moves[approximateIndex + 1];
              }
            }
          }
        }
        
        // If we found move analysis, convert centipawn values to pawn units (divide by 100)
        if (moveAnalysis) {
          moveAnalysis = {
            ...moveAnalysis,
            evaluation: moveAnalysis.evaluation / 100,
            evaluation_after: moveAnalysis.centipawnLoss !== undefined 
              ? (moveAnalysis.evaluation - moveAnalysis.centipawnLoss) / 100
              : undefined
          };
        }
      }
      
      console.log(`[AI-ANALYSIS] Entry ${entry.id}: moveNumber=${entry.moveNumber}, fen=${entry.fen?.substring(0, 30)}..., moveAnalysis=${!!moveAnalysis}`);
      
      // Build AI prompt
      const prompt = buildAnalysisPrompt(
        entry.content,
        entry.myMove,
        entry.fen,
        moveAnalysis
      );
      
      console.log(`\n========== AI ANALYSIS PROMPT - Entry ${entry.id} ==========`);
      console.log(prompt);
      console.log(`========== END PROMPT ==========\n`);
      
      try {
        // Call Anthropic API
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY || '',
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: model,
            max_tokens: 500,
            messages: [{
              role: 'user',
              content: prompt
            }]
          })
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[AI-ANALYSIS] API error for entry ${entry.id}: ${response.status}`);
          console.error(`[AI-ANALYSIS] Error details:`, errorText);
          console.error(`[AI-ANALYSIS] Request was for model: ${model}`);
          continue;
        }
        
        const data = await response.json();
        const aiResponse = data.content[0]?.text || '';
        
        console.log(`[AI-ANALYSIS] Response for entry ${entry.id}:`);
        console.log(aiResponse);
        console.log('');
        
        // Save AI review to entry
        entry.aiReview = {
          content: aiResponse,
          timestamp: new Date().toISOString(),
          model: model,
          engineEval: moveAnalysis?.evaluation,
          engineBestMove: moveAnalysis?.best_move
        };
        
        analyzedCount++;
        console.log(`[AI-ANALYSIS] Analyzed entry ${entry.id}`);
        
      } catch (error) {
        console.error(`[AI-ANALYSIS] Error analyzing entry ${entry.id}:`, error);
      }
    }
    
    // Save updated entries
    await saveDb(db);
    
    return NextResponse.json({
      success: true,
      entriesAnalyzed: analyzedCount,
      totalEntries: gameEntries.length,
      message: `AI analysis complete: ${analyzedCount} entries analyzed`
    });
    
  } catch (error) {
    console.error('[AI-ANALYSIS] Error:', error);
    return NextResponse.json(
      { error: 'Failed to analyze thinking' },
      { status: 500 }
    );
  }
}

function buildAnalysisPrompt(
  thinking: string,
  movePlayed: string | null | undefined,
  fen: string | null | undefined,
  moveAnalysis: any
): string {
  let prompt = `You are analyzing a chess player's thought process during a game.

Position (FEN): ${fen || 'Not available'}

Player's thinking: "${thinking}"`;

  if (movePlayed) {
    prompt += `\nMove played: ${movePlayed}`;
  }
  
  if (moveAnalysis) {
    prompt += `\n\nEngine analysis:`;
    if (moveAnalysis.evaluation !== undefined) {
      prompt += `\n- Position evaluation: ${moveAnalysis.evaluation > 0 ? '+' : ''}${moveAnalysis.evaluation.toFixed(2)} pawns`;
    }
    if (moveAnalysis.best_move) {
      prompt += `\n- Engine's best move: ${moveAnalysis.best_move}`;
    }
    if (moveAnalysis.evaluation_after !== undefined && movePlayed) {
      prompt += `\n- Evaluation after ${movePlayed}: ${moveAnalysis.evaluation_after > 0 ? '+' : ''}${moveAnalysis.evaluation_after.toFixed(2)} pawns`;
      
      const evalDiff = moveAnalysis.evaluation_after - moveAnalysis.evaluation;
      if (Math.abs(evalDiff) > 0.03) {
        prompt += ` (${evalDiff > 0 ? '+' : ''}${evalDiff.toFixed(2)} change)`;
      }
    }
    if (moveAnalysis.centipawnLoss !== undefined && moveAnalysis.centipawnLoss > 0) {
      prompt += `\n- Centipawn loss from best move: ${(moveAnalysis.centipawnLoss / 100).toFixed(2)} pawns (${moveAnalysis.moveQuality})`;
    }
  }
  
  prompt += `\n\nProvide a brief, constructive analysis (2-3 sentences):
1. Evaluate if their reasoning was sound based on the actual position
2. Point out anything they overlooked (tactical motifs, piece activity, pawn structure)
3. Note key patterns or principles they should recognize
4. If engine suggests differently, explain the concrete reason why

Be educational and encouraging, not critical. Reference specific pieces and squares when relevant.`;

  return prompt;
}